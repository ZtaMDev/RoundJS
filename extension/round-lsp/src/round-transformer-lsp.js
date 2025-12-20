const MagicString = require('magic-string');

function transformLSP(code, filename = 'file.round') {
    const s = new MagicString(code);
    const edits = [];
    const editedRanges = [];

    const VIRTUAL_IMPORT = `// @ts-nocheck
import { Fragment, createElement } from 'round-core';
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
    s.prepend(VIRTUAL_IMPORT);
    edits.push({ offset: 0, length: 0, newLength: VIRTUAL_IMPORT.length });

    function applyOverlapOverwrite(start, end, content) {
        if (start < 0 || end < start) return;
        // Check for strict overlaps to avoid 'Cannot split a chunk'
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
        let open = 0;
        let startBlockIndex = -1;
        let endBlockIndex = -1;
        let inSingle = false, inDouble = false, inTemplate = false, inCommentLine = false, inCommentMulti = false;

        for (let i = startIndex; i < str.length; i++) {
            const ch = str[i], next = str[i + 1] || '', prev = str[i - 1] || '';
            if (inCommentLine) { if (ch === '\n' || ch === '\r') inCommentLine = false; continue; }
            if (inCommentMulti) { if (ch === '*' && next === '/') { inCommentMulti = false; i++; } continue; }
            if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; continue; }
            if (inSingle) { if (ch === '\'' && prev !== '\\') inSingle = false; continue; }
            if (inDouble) { if (ch === '"' && prev !== '\\') inDouble = false; continue; }
            if (ch === '/' && next === '/') { inCommentLine = true; i++; continue; }
            if (ch === '/' && next === '*') { inCommentMulti = true; i++; continue; }
            if (ch === '`') { inTemplate = true; continue; }
            if (ch === '\'') { inSingle = true; continue; }
            if (ch === '"') { inDouble = true; continue; }

            if (ch === '{') {
                if (open === 0) startBlockIndex = i;
                open++;
            } else if (ch === '}') {
                open--;
                if (open === 0) { endBlockIndex = i; return { start: startBlockIndex, end: endBlockIndex }; }
            }
        }
        return null;
    }

    function consumeWhitespace(str, i) {
        while (i < str.length && /\s/.test(str[i])) i++;
        return i;
    }

    function parseIfChain(str, ifIndex) {
        let i = ifIndex;
        let isFirst = true;
        while (true) {
            const cur = str.slice(i);
            const mm = cur.match(/^if\s*\((.*?)\)\s*\{/);
            if (!mm) break;
            const condStartInMatch = mm[0].indexOf('(');
            const condEndInMatch = mm[0].lastIndexOf(')');

            applyOverlapOverwrite(i, i + condStartInMatch + 1, '(');
            applyOverlapOverwrite(i + condEndInMatch, i + mm[0].length, ') ? (<Fragment>');

            const block = parseBlock(str, i + mm[0].length - 1);
            if (!block) break;

            const endOfBlock = block.end;
            i = consumeWhitespace(str, endOfBlock + 1);

            if (str.startsWith('else', i)) {
                const nextI = consumeWhitespace(str, i + 4);
                if (str.startsWith('if', nextI)) {
                    applyOverlapOverwrite(endOfBlock, nextI, '</Fragment>) : ');
                    isFirst = false;
                    i = nextI;
                    continue;
                }
                if (str[nextI] === '{') {
                    const elseBlock = parseBlock(str, nextI);
                    if (elseBlock) {
                        applyOverlapOverwrite(endOfBlock, nextI + 1, '</Fragment>) : (<Fragment>');
                        applyOverlapOverwrite(elseBlock.end, elseBlock.end + 1, '</Fragment>)');
                        return { hasElse: true };
                    }
                }
            }
            applyOverlapOverwrite(endOfBlock, endOfBlock + 1, '</Fragment>) : null');
            break;
        }
        return { hasElse: false };
    }

    let currentCode = s.original;
    let match;

    // IF
    const ifExprRegex = /\{\s*if\s*\(/g;
    while ((match = ifExprRegex.exec(currentCode)) !== null) {
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;
        applyOverlapOverwrite(start, start + 1, '{(() => ');
        parseIfChain(currentCode, consumeWhitespace(currentCode, start + 1));
        applyOverlapOverwrite(outer.end, outer.end + 1, ')}');
        ifExprRegex.lastIndex = start + 1;
    }

    // SWITCH
    const switchExprRegex = /\{\s*switch\s*\(/g;
    while ((match = switchExprRegex.exec(currentCode)) !== null) {
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;
        applyOverlapOverwrite(start, start + match[0].indexOf('switch'), '{(() => { ');
        const mBody = currentCode.slice(start).match(/switch\s*\(.*?\)\s*\{/);
        if (mBody) {
            const blockStart = start + mBody.index + mBody[0].length - 1;
            const block = parseBlock(currentCode, blockStart);
            if (block) {
                const content = currentCode.substring(block.start + 1, block.end);
                const labelRegex = /(case\s+.*?:|default:)/g;
                let lMatch, lastEnd = -1;
                while ((lMatch = labelRegex.exec(content)) !== null) {
                    const lS = block.start + 1 + lMatch.index;
                    const lE = lS + lMatch[0].length;
                    applyOverlapOverwrite(lS, lE, (lastEnd !== -1 ? '</Fragment>); ' : '') + lMatch[0] + ' return (<Fragment>');
                    lastEnd = lE;
                }
                if (lastEnd !== -1) applyOverlapOverwrite(block.end, block.end + 1, '</Fragment>); }');
            }
        }
        applyOverlapOverwrite(outer.end, outer.end + 1, ' }) }');
        switchExprRegex.lastIndex = start + 1;
    }

    // FOR
    const forExprRegex = /\{\s*for\s*\((.*?)\s+in\s+(.*?)\)\s*\{/g;
    while ((match = forExprRegex.exec(currentCode)) !== null) {
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;
        const bStart = start + match[0].lastIndexOf('{');
        const b = parseBlock(currentCode, bStart);
        if (b) {
            const pS = start + match[0].indexOf('(');
            applyOverlapOverwrite(start, pS + 1, '{(() => ');
            applyOverlapOverwrite(pS + 1, b.start + 1, `${match[2]}.map(${match[1]} => (<Fragment>`);
            applyOverlapOverwrite(b.end, b.end + 1, '</Fragment>)))}');
        }
        forExprRegex.lastIndex = start + 1;
    }

    // FRAGMENTS <></> support mapping (implicitly handled by TSX, but ensuring we don't break them)
    // SIGNALS
    const sigRegex = /\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    while ((match = sigRegex.exec(currentCode)) !== null) {
        const bE = match[0].indexOf(match[1]);
        applyOverlapOverwrite(match.index, match.index + bE, '{() => ');
    }
    const sigAttrRegex = /=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    while ((match = sigAttrRegex.exec(currentCode)) !== null) {
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
