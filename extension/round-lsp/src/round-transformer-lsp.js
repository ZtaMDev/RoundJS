const MagicString = require('magic-string');

function transformLSP(code, filename = 'file.round') {
    const s = new MagicString(code);

    const edits = [];
    const VIRTUAL_IMPORT = `// @ts-nocheck
import { Fragment, createElement } from 'round-core';
const React = { createElement, Fragment };

declare global {
    namespace JSX {
        interface IntrinsicElements {
            [elemName: string]: any;
        }
        interface ElementAttributesProperty { props: {}; }
        type Element = any;
    }
}
`;
    s.prepend(VIRTUAL_IMPORT);
    edits.push({ offset: 0, length: 0, newLength: VIRTUAL_IMPORT.length });

    function applyOverlapOverwrite(start, end, content) {
        s.overwrite(start, end, content);
        edits.push({ offset: start, length: end - start, newLength: content.length });
    }

    // Helper to find balanced block starting at index
    // ... (rest of helper functions same as before)
    function parseBlock(str, startIndex) {
        let open = 0;
        let startBlockIndex = -1;
        let endBlockIndex = -1;

        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        let inCommentLine = false;
        let inCommentMulti = false;

        for (let i = startIndex; i < str.length; i++) {
            const ch = str[i];
            const prev = i > 0 ? str[i - 1] : '';
            const next = i < str.length - 1 ? str[i + 1] : '';

            if (inCommentLine) {
                if (ch === '\n' || ch === '\r') inCommentLine = false;
                continue;
            }
            if (inCommentMulti) {
                if (ch === '*' && next === '/') {
                    inCommentMulti = false;
                    i++;
                }
                continue;
            }
            if (inTemplate) {
                if (ch === '`' && prev !== '\\') inTemplate = false;
                continue;
            }
            if (inSingle) {
                if (ch === '\'' && prev !== '\\') inSingle = false;
                continue;
            }
            if (inDouble) {
                if (ch === '"' && prev !== '\\') inDouble = false;
                continue;
            }

            if (ch === '/' && next === '/') {
                inCommentLine = true;
                i++;
                continue;
            }
            if (ch === '/' && next === '*') {
                inCommentMulti = true;
                i++;
                continue;
            }
            if (ch === '`') {
                inTemplate = true;
                continue;
            }
            if (ch === '\'') {
                inSingle = true;
                continue;
            }
            if (ch === '"') {
                inDouble = true;
                continue;
            }

            if (ch === '{') {
                if (open === 0) startBlockIndex = i;
                open++;
            } else if (ch === '}') {
                open--;
                if (open === 0) {
                    endBlockIndex = i;
                    return { start: startBlockIndex, end: endBlockIndex };
                }
            }
        }
        return null;
    }

    function consumeWhitespace(str, i) {
        while (i < str.length && /\s/.test(str[i])) i++;
        return i;
    }

    function parseIfChain(str, ifIndex) {
        const head = str.slice(ifIndex);
        const m = head.match(/^if\s*\((.*?)\)\s*\{/);
        if (!m) return null;

        let i = ifIndex;
        const chainEdits = [];
        let hasElse = false;
        let isFirst = true;

        while (true) {
            const cur = str.slice(i);
            const mm = cur.match(/^if\s*\((.*?)\)\s*\{/);
            if (!mm) break;

            const cond = mm[1];
            const condStartInMatch = mm[0].indexOf('(') + 1;
            const condEndInMatch = mm[0].lastIndexOf(')');

            // 1. "if (" or "else if (" -> "(" or ") : ("
            const prefixReplacement = isFirst ? '(' : ') : (';
            applyOverlapOverwrite(i, i + condStartInMatch, prefixReplacement);

            // 2. Condition preserved as-is for mapping/hover accuracy
            // Since we have // @ts-nocheck, we don't need complex ternary wrapping here.

            // 3. ") {" -> ") ? (<Fragment>"
            applyOverlapOverwrite(i + condEndInMatch, i + mm[0].length, ') ? (<Fragment>');

            const blockStart = i + mm[0].length - 1;
            const block = parseBlock(str, blockStart);
            if (!block) break;

            i = block.end;
            const endOfBlock = i;

            i++; // skip }
            i = consumeWhitespace(str, i);

            isFirst = false;

            if (str.startsWith('else', i)) {
                const nextI = consumeWhitespace(str, i + 4);
                if (str.startsWith('if', nextI)) {
                    // Handled by next loop iteration
                    i = nextI;
                    continue;
                }

                if (str[nextI] === '{') {
                    const elseBlock = parseBlock(str, nextI);
                    if (elseBlock) {
                        applyOverlapOverwrite(endOfBlock, nextI + 1, '</Fragment>) : (<Fragment>');
                        applyOverlapOverwrite(elseBlock.end, elseBlock.end + 1, '</Fragment>)');
                        hasElse = true;
                        i = elseBlock.end + 1;
                        break;
                    }
                }
            }

            applyOverlapOverwrite(endOfBlock, endOfBlock + 1, '</Fragment>) : null');
            break;
        }

        return { hasElse }; // chainEdits are applied immediately via applyOverlapOverwrite
    }

    // Process "if" expressions {if(cond){...}}
    let currentCode = s.original;
    let match;
    const ifExprRegex = /\{\s*if\s*\(/g;
    while ((match = ifExprRegex.exec(currentCode)) !== null) {
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;

        const innerIfStart = consumeWhitespace(currentCode, start + 1);
        applyOverlapOverwrite(start, start + 1, '{(() => ');
        parseIfChain(currentCode, innerIfStart);
        applyOverlapOverwrite(outer.end, outer.end + 1, ')}');
    }

    // Process "for" expressions {for(item in list){...}}
    const forExprRegex = /\{\s*for\s*\((.*?)\s+in\s+(.*?)\)\s*\{/g;
    currentCode = s.original;
    while ((match = forExprRegex.exec(currentCode)) !== null) {
        const start = match.index;
        const outer = parseBlock(currentCode, start);
        if (!outer) continue;

        const blockStart = start + match[0].lastIndexOf('{');
        const block = parseBlock(currentCode, blockStart);
        if (!block) continue;

        const item = match[1];
        const list = match[2];
        const parenStart = start + match[0].indexOf('(');
        const parenEnd = start + match[0].indexOf(')');

        applyOverlapOverwrite(start, parenStart + 1, '{(() => ');
        applyOverlapOverwrite(parenStart + 1, block.start + 1, `${list}.map(${item} => (<Fragment>`);
        applyOverlapOverwrite(block.end, block.end + 1, '</Fragment>)))}');
    }

    // signal() replacements
    const signalRegex = /\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    currentCode = s.original;
    while ((match = signalRegex.exec(currentCode)) !== null) {
        const braceEnd = match[0].indexOf(match[1]);
        applyOverlapOverwrite(match.index, match.index + braceEnd, '{() => ');
    }

    const signalAttrRegex = /=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g;
    while ((match = signalAttrRegex.exec(currentCode)) !== null) {
        const braceEnd = match[0].indexOf(match[1]);
        applyOverlapOverwrite(match.index, match.index + braceEnd, '={() => ');
    }

    // Sort edits by original offset for easy lookup
    edits.sort((a, b) => a.offset - b.offset);

    return {
        code: s.toString(),
        edits,
        map: s.generateMap({
            source: filename,
            file: filename + '.tsx',
            includeContent: true,
            hires: true
        })
    };
}


module.exports = { transformLSP };
