const MagicString = require('magic-string');

function transformLSP(code, filename = 'file.round') {
    const s = new MagicString(code);
    const edits = [];
    const editedRanges = [];

    const VIRTUAL_IMPORT = `// @ts-nocheck
import { Fragment, createElement, ForKeyed } from 'round-core';
const React = { createElement, Fragment };

declare global {
    namespace JSX {
        interface IntrinsicElements {
            [elemName: string]: HTMLAttributes;
        }
        interface HTMLAttributes {
            [propName: string]: any;
            children?: any;
            className?: string | object;
            style?: string | object;
            onClick?: (e: MouseEvent) => void;
            onInput?: (e: InputEvent) => void;
            onChange?: (e: Event) => void;
            onKeyDown?: (e: KeyboardEvent) => void;
            onKeyUp?: (e: KeyboardEvent) => void;
            onKeyPress?: (e: KeyboardEvent) => void;
            onBlur?: (e: FocusEvent) => void;
            onFocus?: (e: FocusEvent) => void;
            value?: any;
            checked?: boolean;
            type?: string;
            placeholder?: string;
            disabled?: boolean;
            readonly?: boolean;
        }
        interface ElementAttributesProperty { props: {}; }
        type Element = any;
    }
}
`;
    if (!code.includes('import { Fragment')) {
        s.prepend(VIRTUAL_IMPORT);
        edits.push({ offset: 0, length: 0, newLength: VIRTUAL_IMPORT.length });
    }

    function applyOverlapOverwrite(start, end, content) {
        if (start < 0 || end < start || isNaN(start) || isNaN(end)) return;
        for (const range of editedRanges) {
            if (start < range.end && end > range.start) return;
        }
        try {
            s.overwrite(start, end, content);
            edits.push({ offset: start, length: end - start, newLength: content.length });
            editedRanges.push({ start, end });
        } catch (e) { }
    }

    function parseBlock(str, startIndex) {
        let open = 0, startBlockIndex = -1;
        let inSingle = false, inDouble = false, inTemplate = false, inCommentLine = false, inCommentMulti = false;
        for (let i = startIndex; i < str.length; i++) {
            const ch = str[i], next = str[i + 1] || '', prev = str[i - 1] || '';
            if (inCommentLine) { if (ch === '\n' || ch === '\r') inCommentLine = false; continue; }
            if (inCommentMulti) { if (ch === '*' && next === '/') { inCommentMulti = false; i++; } continue; }
            if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; continue; }
            if (inSingle) { if (ch === '\'' && prev !== '\\') inSingle = false; else if (ch === '\n' || ch === '\r') inSingle = false; continue; }
            if (inDouble) { if (ch === '"' && prev !== '\\') inDouble = false; else if (ch === '\n' || ch === '\r') inDouble = false; continue; }
            if (ch === '/' && next === '/') { inCommentLine = true; i++; continue; }
            if (ch === '/' && next === '*') { inCommentMulti = true; i++; continue; }
            if (ch === '{') { if (open === 0) startBlockIndex = i; open++; }
            else if (ch === '}') { open--; if (open === 0) return { start: startBlockIndex, end: i }; }
        }
        return null;
    }

    function consumeWhitespace(str, i) {
        while (i < str.length && /\s/.test(str[i])) i++;
        return i;
    }

    function extractCondition(str, startIndex) {
        if (str[startIndex] !== '(') return null;
        let depth = 1, i = startIndex + 1;
        let inSingle = false, inDouble = false, inTemplate = false;
        while (i < str.length && depth > 0) {
            const ch = str[i], prev = str[i - 1] || '';
            if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') inSingle = !inSingle;
            else if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') inDouble = !inDouble;
            else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') inTemplate = !inTemplate;
            if (!inSingle && !inDouble && !inTemplate) { if (ch === '(') depth++; else if (ch === ')') depth--; }
            i++;
        }
        if (depth !== 0) return null;
        return { cond: str.substring(startIndex + 1, i - 1), start: startIndex, end: i };
    }

    function isInsideJsSemantics(str, blockStart) {
        let ptr = blockStart - 1;
        while (ptr >= 0 && /\s/.test(str[ptr])) ptr--;
        if (ptr < 0) return false;
        if (str[ptr] === '>' && str[ptr - 1] === '=') return true;
        if (str[ptr] === ')') {
            let depth = 1; ptr--;
            while (ptr >= 0 && depth > 0) { if (str[ptr] === ')') depth++; else if (str[ptr] === '(') depth--; ptr--; }
            while (ptr >= 0 && /\s/.test(str[ptr])) ptr--;
        }
        const wordEnd = ptr + 1; let wordStart = ptr;
        while (wordStart >= 0 && /[a-zA-Z0-9_$]/.test(str[wordStart])) wordStart--;
        const word = str.substring(wordStart + 1, wordEnd);
        if (['return', 'function', 'class', 'else'].includes(word)) return true;
        if (str[ptr] === ':') return true;
        return false;
    }

    // --- RECURSIVE BLOCK CONTENT WALKER ---
    // Walks inside a block (between { and }) and transforms nested control flow
    function walkBlockContent(blockStart, blockEnd) {
        let jsxDepth = 1; // We are inside JSX since parent called us
        let inOpeningTag = false, attrBraceDepth = 0, prevWasEquals = false;
        let inSingle = false, inDouble = false, inTemplate = false, inCommentLine = false, inCommentMulti = false;

        for (let i = blockStart + 1; i < blockEnd; i++) {
            const ch = code[i], next = code[i + 1] || '', prev = code[i - 1] || '';

            if (inCommentLine) { if (ch === '\n' || ch === '\r') inCommentLine = false; continue; }
            if (inCommentMulti) { if (ch === '*' && next === '/') { inCommentMulti = false; i++; } continue; }
            if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; continue; }
            if (inSingle) { if (ch === '\'' && prev !== '\\') inSingle = false; else if (ch === '\n' || ch === '\r') inSingle = false; continue; }
            if (inDouble) { if (ch === '"' && prev !== '\\') inDouble = false; else if (ch === '\n' || ch === '\r') inDouble = false; continue; }
            if (ch === '/' && next === '/') { inCommentLine = true; i++; continue; }
            if (ch === '/' && next === '*') { inCommentMulti = true; i++; continue; }

            if (inOpeningTag) {
                if (ch === '=' && !attrBraceDepth) { prevWasEquals = true; continue; }
                if (ch === '{') { if (prevWasEquals || attrBraceDepth > 0) attrBraceDepth++; prevWasEquals = false; continue; }
                if (ch === '}' && attrBraceDepth > 0) { attrBraceDepth--; continue; }
                if (!/\s/.test(ch)) prevWasEquals = false;
                if (ch === '>' && attrBraceDepth === 0) { inOpeningTag = false; continue; }
                if (ch === '/' && next === '>' && attrBraceDepth === 0) { inOpeningTag = false; if (jsxDepth > 0) jsxDepth--; i++; continue; }
            }
            if (ch === '<' && !inOpeningTag) {
                const isOpenTag = /[a-zA-Z0-9_$]/.test(next), isCloseTag = next === '/', isFragment = next === '>';
                if (isOpenTag || isFragment) { jsxDepth++; if (isOpenTag) { inOpeningTag = true; attrBraceDepth = 0; prevWasEquals = false; } }
                else if (isCloseTag) { if (jsxDepth > 0) jsxDepth--; }
            }
            if (ch === '<' && next === '/' && code[i + 2] === '>') { if (jsxDepth > 0) jsxDepth--; i += 2; continue; }

            // If we are in JSX children and find a `{`
            if (jsxDepth > 0 && !inOpeningTag && attrBraceDepth === 0 && ch === '{') {
                const ptr = consumeWhitespace(code, i + 1);
                let isControl = false;
                if (code.startsWith('if', ptr)) isControl = true;
                else if (code.startsWith('for', ptr)) isControl = true;
                else if (code.startsWith('switch', ptr)) isControl = true;
                else if (code.startsWith('try', ptr)) isControl = true;

                if (isControl && !isInsideJsSemantics(code, i)) {
                    const block = parseBlock(code, i);
                    if (block) {
                        handleControlBlock(i, block.end);
                        i = block.end;
                    }
                }
            }
        }
    }

    // --- MAIN WALKER ---
    let jsxDepth = 0, inOpeningTag = false, attrBraceDepth = 0, prevWasEquals = false;
    let inSingle = false, inDouble = false, inTemplate = false, inCommentLine = false, inCommentMulti = false;

    for (let i = 0; i < code.length; i++) {
        const ch = code[i], next = code[i + 1] || '', prev = code[i - 1] || '';

        if (inCommentLine) { if (ch === '\n' || ch === '\r') inCommentLine = false; continue; }
        if (inCommentMulti) { if (ch === '*' && next === '/') { inCommentMulti = false; i++; } continue; }
        if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; continue; }
        if (inSingle) { if (ch === '\'' && prev !== '\\') inSingle = false; else if (ch === '\n' || ch === '\r') inSingle = false; continue; }
        if (inDouble) { if (ch === '"' && prev !== '\\') inDouble = false; else if (ch === '\n' || ch === '\r') inDouble = false; continue; }
        if (ch === '/' && next === '/') { inCommentLine = true; i++; continue; }
        if (ch === '/' && next === '*') { inCommentMulti = true; i++; continue; }

        if (inOpeningTag) {
            if (ch === '=' && !attrBraceDepth) { prevWasEquals = true; continue; }
            if (ch === '{') { if (prevWasEquals || attrBraceDepth > 0) attrBraceDepth++; prevWasEquals = false; continue; }
            if (ch === '}' && attrBraceDepth > 0) { attrBraceDepth--; continue; }
            if (!/\s/.test(ch)) prevWasEquals = false;
            if (ch === '>' && attrBraceDepth === 0) { inOpeningTag = false; continue; }
            if (ch === '/' && next === '>' && attrBraceDepth === 0) { inOpeningTag = false; if (jsxDepth > 0) jsxDepth--; i++; continue; }
        }
        if (ch === '<' && !inOpeningTag) {
            const isOpenTag = /[a-zA-Z0-9_$]/.test(next), isCloseTag = next === '/', isFragment = next === '>';
            if (isOpenTag || isFragment) { jsxDepth++; if (isOpenTag) { inOpeningTag = true; attrBraceDepth = 0; prevWasEquals = false; } }
            else if (isCloseTag) { if (jsxDepth > 0) jsxDepth--; }
        }
        if (ch === '<' && next === '/' && code[i + 2] === '>') { if (jsxDepth > 0) jsxDepth--; i += 2; continue; }

        if (jsxDepth > 0 && !inOpeningTag && attrBraceDepth === 0 && ch === '{') {
            const ptr = consumeWhitespace(code, i + 1);
            let isControl = false;
            if (code.startsWith('if', ptr)) isControl = true;
            else if (code.startsWith('for', ptr)) isControl = true;
            else if (code.startsWith('switch', ptr)) isControl = true;
            else if (code.startsWith('try', ptr)) isControl = true;

            if (isControl && !isInsideJsSemantics(code, i)) {
                const block = parseBlock(code, i);
                if (block) {
                    handleControlBlock(i, block.end);
                    i = block.end;
                }
            }
        }
    }

    function handleControlBlock(start, end) {
        applyOverlapOverwrite(start, start + 1, '{(() => <Fragment>');

        let ptr = consumeWhitespace(code, start + 1);

        while (ptr < end) {
            let nextPtr = -1;

            if (code.startsWith('if', ptr)) {
                nextPtr = handleIf(ptr);
            } else if (code.startsWith('for', ptr)) {
                nextPtr = handleFor(ptr);
            } else if (code.startsWith('switch', ptr)) {
                nextPtr = handleSwitch(ptr);
            } else if (code.startsWith('try', ptr)) {
                nextPtr = handleTry(ptr);
            } else {
                if (code[ptr] === '}') break;
                ptr++;
                continue;
            }

            if (nextPtr !== -1) {
                ptr = consumeWhitespace(code, nextPtr);
            } else {
                ptr++;
            }
        }

        applyOverlapOverwrite(end, end + 1, '</Fragment>)}');
    }

    function handleIf(startPtr) {
        let currentPtr = startPtr;
        let first = true;

        while (true) {
            let ifStart = currentPtr;
            if (!first) {
                if (!code.startsWith('if', currentPtr)) break;
                currentPtr += 2;
            } else {
                currentPtr += 2; first = false;
            }
            currentPtr = consumeWhitespace(code, currentPtr);
            const condRes = extractCondition(code, currentPtr);
            if (!condRes) return -1;

            // First if: replace "if (" with "{(" to wrap the whole chain
            // Subsequent else if: replace "if (" with just "("
            const prefix = (ifStart === startPtr) ? '{(' : '(';
            applyOverlapOverwrite(ifStart, condRes.start + 1, prefix);
            applyOverlapOverwrite(condRes.end - 1, consumeWhitespace(code, condRes.end) + 1, ') ? (<Fragment>');

            const ptrAfterCond = consumeWhitespace(code, condRes.end);
            const block = parseBlock(code, ptrAfterCond);
            if (!block) return -1;

            // RECURSIVE: Walk inside the block content for nested control flow
            walkBlockContent(block.start, block.end);

            currentPtr = consumeWhitespace(code, block.end + 1);

            if (code.startsWith('else', currentPtr)) {
                let nextI = consumeWhitespace(code, currentPtr + 4);
                if (code.startsWith('if', nextI)) {
                    applyOverlapOverwrite(block.end, nextI, '</Fragment>) : ');
                    currentPtr = nextI;
                    continue;
                }
                if (code[nextI] === '{') {
                    applyOverlapOverwrite(block.end, nextI + 1, '</Fragment>) : (<Fragment>');
                    const elseBlock = parseBlock(code, nextI);
                    if (elseBlock) {
                        // RECURSIVE: Walk inside else block too
                        walkBlockContent(elseBlock.start, elseBlock.end);
                        applyOverlapOverwrite(elseBlock.end, elseBlock.end + 1, '</Fragment>) }');
                        return elseBlock.end + 1;
                    }
                }
            }

            applyOverlapOverwrite(block.end, block.end + 1, '</Fragment>) : null }');
            return block.end + 1;
        }
        return -1;
    }

    function handleFor(startPtr) {
        let ptr = consumeWhitespace(code, startPtr + 3);
        const condRes = extractCondition(code, ptr);
        if (!condRes) return -1;
        const forCond = condRes.cond;
        const inMatch = forCond.match(/^\s*(\S+)\s+in\s+([^]*)$/);
        if (!inMatch) return -1;
        const item = inMatch[1].trim(), listStr = inMatch[2];
        ptr = consumeWhitespace(code, condRes.end);

        let keyExpr = null;
        if (code.startsWith('key', ptr)) {
            let kPtr = consumeWhitespace(code, ptr + 3);
            if (code[kPtr] === '=') {
                kPtr = consumeWhitespace(code, kPtr + 1);
                if (code[kPtr] === '{') {
                    const kb = parseBlock(code, kPtr);
                    if (kb) { keyExpr = code.substring(kb.start + 1, kb.end); ptr = consumeWhitespace(code, kb.end + 1); }
                } else {
                    let ks = kPtr;
                    while (kPtr < code.length && !/\s/.test(code[kPtr]) && code[kPtr] !== '{') kPtr++;
                    keyExpr = code.substring(ks, kPtr); ptr = consumeWhitespace(code, kPtr);
                }
            }
        }

        if (code[ptr] !== '{') return -1;
        const block = parseBlock(code, ptr);
        if (!block) return -1;

        // RECURSIVE: Walk inside for block
        walkBlockContent(block.start, block.end);

        if (keyExpr) {
            applyOverlapOverwrite(startPtr, block.start + 1, `{createElement(ForKeyed, { each: () => ${listStr}, key: (${item}) => ${keyExpr} }, (${item}) => (<Fragment>`);
            applyOverlapOverwrite(block.end, block.end + 1, '</Fragment>)) }');
        } else {
            applyOverlapOverwrite(startPtr, block.start + 1, `{(() => ${listStr}.map((${item}) => (<Fragment>`);
            applyOverlapOverwrite(block.end, block.end + 1, '</Fragment>)))() }');
        }
        return block.end + 1;
    }

    function handleSwitch(startPtr) {
        let ptr = consumeWhitespace(code, startPtr + 6);
        const condRes = extractCondition(code, ptr);
        if (!condRes) return -1;
        const block = parseBlock(code, consumeWhitespace(code, condRes.end));
        if (!block) return -1;

        // RECURSIVE: Walk inside switch block
        walkBlockContent(block.start, block.end);

        applyOverlapOverwrite(startPtr, block.start + 1, `{function() { switch(${condRes.cond}) {`);
        const content = code.substring(block.start + 1, block.end);
        const labelRegex = /(case\s+.*?:|default:)/g;
        let lMatch, lastEnd = -1;
        while ((lMatch = labelRegex.exec(content)) !== null) {
            const lS = block.start + 1 + lMatch.index, lE = lS + lMatch[0].length;
            if (lastEnd !== -1) applyOverlapOverwrite(lS, lS, '</Fragment>); ');
            applyOverlapOverwrite(lE, lE, ' return (<Fragment>');
            lastEnd = lE;
        }
        if (lastEnd !== -1) applyOverlapOverwrite(block.end, block.end, '</Fragment>);');
        applyOverlapOverwrite(block.end, block.end + 1, '} } }');
        return block.end + 1;
    }

    function handleTry(startPtr) {
        let ptr = consumeWhitespace(code, startPtr + 3);
        let reactiveExprReq = null;
        if (code[ptr] === '(') { const c = extractCondition(code, ptr); reactiveExprReq = c; ptr = consumeWhitespace(code, c.end); }
        if (code[ptr] !== '{') return -1;
        const tryBlock = parseBlock(code, ptr); if (!tryBlock) return -1;

        // RECURSIVE: Walk inside try block
        walkBlockContent(tryBlock.start, tryBlock.end);

        ptr = consumeWhitespace(code, tryBlock.end + 1);
        if (!code.startsWith('catch', ptr)) return -1;
        const catchStart = ptr;
        ptr = consumeWhitespace(code, ptr + 5);
        let catchParam = 'e';
        if (code[ptr] === '(') { const c = extractCondition(code, ptr); if (c) { catchParam = c.cond.trim(); ptr = consumeWhitespace(code, c.end); } }
        if (code[ptr] !== '{') return -1;
        const catchBlock = parseBlock(code, ptr); if (!catchBlock) return -1;

        // RECURSIVE: Walk inside catch block
        walkBlockContent(catchBlock.start, catchBlock.end);

        if (reactiveExprReq) {
            applyOverlapOverwrite(startPtr, reactiveExprReq.start, '{ () => { try { ');
            applyOverlapOverwrite(reactiveExprReq.end, tryBlock.start + 1, '; return (<Fragment>');
        } else {
            applyOverlapOverwrite(startPtr, tryBlock.start + 1, '{ (() => { try { return (<Fragment>');
        }
        applyOverlapOverwrite(tryBlock.end, catchStart, '</Fragment>); } ');
        applyOverlapOverwrite(catchStart + 5, catchBlock.start + 1, `(${catchParam}) { return (<Fragment>`);
        if (reactiveExprReq) applyOverlapOverwrite(catchBlock.end, catchBlock.end + 1, '</Fragment>); } } }');
        else applyOverlapOverwrite(catchBlock.end, catchBlock.end + 1, '</Fragment>); } })() }');
        return catchBlock.end + 1;
    }

    // SIGNALS
    const sigRegex = /\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    let match;
    while ((match = sigRegex.exec(code)) !== null) {
        const bE = match[0].indexOf(match[1]);
        applyOverlapOverwrite(match.index, match.index + bE, '{() => ');
    }
    const sigAttrRegex = /=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    while ((match = sigAttrRegex.exec(code)) !== null) {
        const bE = match[0].indexOf(match[1]);
        applyOverlapOverwrite(match.index, match.index + bE, '={() => ');
    }

    edits.sort((a, b) => a.offset - b.offset);
    return {
        code: s.toString(),
        edits,
        map: s.generateMap({ source: filename, file: filename + '.tsx', includeContent: true, hires: true })
    };
}

module.exports = { transformLSP };