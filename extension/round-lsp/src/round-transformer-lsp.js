const MagicString = require('magic-string');

function transformLSP(code, filename = 'file.round') {
    const s = new MagicString(code);
    const edits = [];
    const editedRanges = [];

    const VIRTUAL_IMPORT = `// @ts-nocheck
import { Fragment, createElement, NoErrorReport } from 'round-core';
const React = { createElement, Fragment };
function NoErrorReport({ children }: { children?: any }) { return null; }

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
    // Only prepend if not present
    if (!code.includes('import { Fragment')) {
        s.prepend(VIRTUAL_IMPORT);
        edits.push({ offset: 0, length: 0, newLength: VIRTUAL_IMPORT.length });
    }

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

    function extractCondition(str, startIndex) {
        if (str[startIndex] !== '(') return null;
        let depth = 1;
        let i = startIndex + 1;
        let inSingle = false, inDouble = false, inTemplate = false;
        while (i < str.length && depth > 0) {
            const ch = str[i], prev = str[i - 1] || '';
            if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') inSingle = !inSingle;
            else if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') inDouble = !inDouble;
            else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') inTemplate = !inTemplate;
            if (!inSingle && !inDouble && !inTemplate) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
            }
            i++;
        }
        if (depth !== 0) return null;
        return { cond: str.substring(startIndex + 1, i - 1), end: i };
    }

    // --- Context-aware JSX detection with prop tracking ---
    function getJsxContext(str, limitIndex) {
        let jsxDepth = 0;
        let inOpeningTag = false;
        let attrBraceDepth = 0;
        let prevWasEquals = false;

        let inSingle = false, inDouble = false, inTemplate = false;
        let inCommentLine = false, inCommentMulti = false;

        for (let i = 0; i < limitIndex; i++) {
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

            // Track attribute expression braces
            if (inOpeningTag) {
                if (ch === '=' && !attrBraceDepth) {
                    prevWasEquals = true;
                    continue;
                }
                if (ch === '{') {
                    if (prevWasEquals || attrBraceDepth > 0) {
                        attrBraceDepth++;
                    }
                    prevWasEquals = false;
                    continue;
                }
                if (ch === '}' && attrBraceDepth > 0) {
                    attrBraceDepth--;
                    continue;
                }
                if (!/\s/.test(ch)) {
                    prevWasEquals = false;
                }
                // End of opening tag
                if (ch === '>' && attrBraceDepth === 0) {
                    inOpeningTag = false;
                    continue;
                }
                // Self-closing tag
                if (ch === '/' && next === '>' && attrBraceDepth === 0) {
                    inOpeningTag = false;
                    if (jsxDepth > 0) jsxDepth--;
                    i++; // skip the >
                    continue;
                }
            }

            // JSX tag detection
            if (ch === '<' && !inOpeningTag) {
                const isOpenTag = /[a-zA-Z0-9_$]/.test(next);
                const isCloseTag = next === '/';
                const isFragment = next === '>';

                if (isOpenTag) {
                    jsxDepth++;
                    inOpeningTag = true;
                    attrBraceDepth = 0;
                    prevWasEquals = false;
                } else if (isCloseTag) {
                    if (jsxDepth > 0) jsxDepth--;
                } else if (isFragment) {
                    jsxDepth++;
                }
            }

            // Fragment closing </>
            if (ch === '<' && next === '/' && str[i + 2] === '>') {
                if (jsxDepth > 0) jsxDepth--;
                i += 2;
                continue;
            }
        }

        return {
            jsxDepth,
            inOpeningTag,
            attrBraceDepth,
            // ONLY transform when in JSX children context
            shouldTransform: jsxDepth > 0 && !inOpeningTag && attrBraceDepth === 0
        };
    }

    function parseIfChain(str, ifIndex) {
        let i = ifIndex;
        let isFirst = true;
        while (true) {
            if (!str.slice(i).startsWith('if')) break;
            i += 2;
            i = consumeWhitespace(str, i);

            const condResult = extractCondition(str, i);
            if (!condResult) break;

            const condStart = i;
            const condEnd = condResult.end;
            i = consumeWhitespace(str, condEnd);
            if (str[i] !== '{') break;

            applyOverlapOverwrite(condStart - 2, condStart + 1, '(');
            applyOverlapOverwrite(condEnd - 1, i + 1, ') ? (<Fragment>');

            const block = parseBlock(str, i);
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

    // IF - with context check
    const ifExprRegex = /\{\s*if\s*\(/g;
    while ((match = ifExprRegex.exec(currentCode)) !== null) {
        const ctx = getJsxContext(currentCode, match.index);
        if (!ctx.shouldTransform) continue; // SAFETY GUARD
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;
        applyOverlapOverwrite(start, start + 1, '{(() => ');
        parseIfChain(currentCode, consumeWhitespace(currentCode, start + 1));
        applyOverlapOverwrite(outer.end, outer.end + 1, ')}');
        ifExprRegex.lastIndex = start + 1;
    }

    // SWITCH - with context check
    const switchExprRegex = /\{\s*switch\s*\(/g;
    while ((match = switchExprRegex.exec(currentCode)) !== null) {
        const ctx = getJsxContext(currentCode, match.index);
        if (!ctx.shouldTransform) continue; // SAFETY GUARD
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;

        let i = consumeWhitespace(currentCode, start + 1);
        if (!currentCode.slice(i).startsWith('switch')) continue;
        i += 6;
        i = consumeWhitespace(currentCode, i);

        const condResult = extractCondition(currentCode, i);
        if (!condResult) continue;

        i = consumeWhitespace(currentCode, condResult.end);
        if (currentCode[i] !== '{') continue;

        const block = parseBlock(currentCode, i);
        if (!block) continue;

        applyOverlapOverwrite(start, start + 1, '{(() => { ');
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
        applyOverlapOverwrite(outer.end, outer.end + 1, ' }) }');
        switchExprRegex.lastIndex = start + 1;
    }

    // FOR - with context check
    const forExprRegex = /\{\s*for\s*\(/g;
    while ((match = forExprRegex.exec(currentCode)) !== null) {
        const ctx = getJsxContext(currentCode, match.index);
        if (!ctx.shouldTransform) continue; // SAFETY GUARD
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;

        let i = consumeWhitespace(currentCode, start + 1);
        if (!currentCode.slice(i).startsWith('for')) continue;
        i += 3;
        i = consumeWhitespace(currentCode, i);

        const condResult = extractCondition(currentCode, i);
        if (!condResult) continue;

        // Parse "item in list" from the condition
        const forCond = condResult.cond;
        const inMatch = forCond.match(/^\s*(\S+)\s+in\s+(.+)$/);
        if (!inMatch) continue;

        const item = inMatch[1].trim();
        const list = inMatch[2].trim();

        i = consumeWhitespace(currentCode, condResult.end);
        if (currentCode[i] !== '{') continue;

        const block = parseBlock(currentCode, i);
        if (!block) continue;

        applyOverlapOverwrite(start, i + 1, `{(() => ${list}.map(${item} => (<Fragment>`);
        applyOverlapOverwrite(block.end, outer.end + 1, '</Fragment>)))}');
        forExprRegex.lastIndex = start + 1;
    }

    // TRY/CATCH - with context check
    const tryExprRegex = /\{\s*try\s*[\(\{]/g;
    while ((match = tryExprRegex.exec(currentCode)) !== null) {
        const ctx = getJsxContext(currentCode, match.index);
        if (!ctx.shouldTransform) continue; // SAFETY GUARD
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;

        let i = consumeWhitespace(currentCode, start + 1);
        if (!currentCode.slice(i).startsWith('try')) continue;
        i += 3;
        i = consumeWhitespace(currentCode, i);

        // Check for reactive try: try(expr) {...}
        let reactiveExpr = null;
        if (currentCode[i] === '(') {
            const condResult = extractCondition(currentCode, i);
            if (condResult) {
                reactiveExpr = condResult.cond;
                i = consumeWhitespace(currentCode, condResult.end);
            }
        }

        // Must have opening brace for try block
        if (currentCode[i] !== '{') continue;

        const tryBlock = parseBlock(currentCode, i);
        if (!tryBlock) continue;

        let j = consumeWhitespace(currentCode, tryBlock.end + 1);

        // Must have catch
        if (!currentCode.slice(j).startsWith('catch')) continue;
        j += 5;
        j = consumeWhitespace(currentCode, j);

        // Extract catch parameter
        let catchParam = 'e';
        if (currentCode[j] === '(') {
            const catchCondResult = extractCondition(currentCode, j);
            if (catchCondResult) {
                catchParam = catchCondResult.cond.trim() || 'e';
                j = consumeWhitespace(currentCode, catchCondResult.end);
            }
        }

        // Must have catch block
        if (currentCode[j] !== '{') continue;

        const catchBlock = parseBlock(currentCode, j);
        if (!catchBlock) continue;

        // Apply transformations
        if (reactiveExpr) {
            // Reactive try: {() => { try { expr; return (<Fragment>...</Fragment>); } catch(e) { return (<Fragment>...</Fragment>); } }}
            applyOverlapOverwrite(start, i + 1, `{() => { try { ${reactiveExpr}; return (<Fragment>`);
            applyOverlapOverwrite(tryBlock.end, j + 1, `</Fragment>); } catch(${catchParam}) { return (<Fragment>`);
            applyOverlapOverwrite(catchBlock.end, outer.end + 1, '</Fragment>); } }}');
        } else {
            // Static try: {(() => { try { return (<Fragment>...</Fragment>); } catch(e) { return (<Fragment>...</Fragment>); } })()}
            applyOverlapOverwrite(start, i + 1, '{(() => { try { return (<Fragment>');
            applyOverlapOverwrite(tryBlock.end, j + 1, `</Fragment>); } catch(${catchParam}) { return (<Fragment>`);
            applyOverlapOverwrite(catchBlock.end, outer.end + 1, '</Fragment>); } })()}');
        }
        tryExprRegex.lastIndex = start + 1;
    }

    // SIGNALS - with context check
    const sigRegex = /\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    while ((match = sigRegex.exec(currentCode)) !== null) {
        const ctx = getJsxContext(currentCode, match.index);
        if (!ctx.shouldTransform) continue; // SAFETY GUARD
        const bE = match[0].indexOf(match[1]);
        applyOverlapOverwrite(match.index, match.index + bE, '{() => ');
    }
    const sigAttrRegex = /=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    while ((match = sigAttrRegex.exec(currentCode)) !== null) {
        // Attributes are always in JSX tag (depth > 0). Guard is good practice.
        const ctx = getJsxContext(currentCode, match.index);
        if (ctx.jsxDepth === 0) continue; // SAFETY GUARD
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