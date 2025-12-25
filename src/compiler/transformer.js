// Transformer for .round files
// Handles custom syntax like:
// {if(cond){ ... }} -> {cond ? (...) : null}
// if(cond){ ... } (bare in JSX) -> {cond ? (...) : null}
// {for(item in list){ ... }} -> {list.map(item => (...))}
// {switch(cond) { case ... }} -> {function() { switch ... }}

export function transform(code, initialDepth = 0) {
    let result = '';
    let i = 0;
    let jsxDepth = initialDepth;

    // --- Helpers ---

    function parseBlock(str, startIndex) {
        let open = 0;
        let startBlockIndex = -1;

        let inSingle = false, inDouble = false, inTemplate = false;
        let inCommentLine = false, inCommentMulti = false;

        for (let j = startIndex; j < str.length; j++) {
            const ch = str[j];
            const prev = j > 0 ? str[j - 1] : '';
            const next = j < str.length - 1 ? str[j + 1] : '';

            if (inCommentLine) {
                if (ch === '\n' || ch === '\r') inCommentLine = false;
                continue;
            }
            if (inCommentMulti) {
                if (ch === '*' && next === '/') { inCommentMulti = false; j++; }
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

            if (ch === '/' && next === '/') { inCommentLine = true; j++; continue; }
            if (ch === '/' && next === '*') { inCommentMulti = true; j++; continue; }
            if (ch === '`') { inTemplate = true; continue; }
            if (ch === '\'') { inSingle = true; continue; }
            if (ch === '"') { inDouble = true; continue; }

            if (ch === '{') {
                if (open === 0) startBlockIndex = j;
                open++;
            } else if (ch === '}') {
                open--;
                if (open === 0) {
                    return { start: startBlockIndex, end: j };
                }
            }
        }
        return null;
    }

    function consumeWhitespace(str, idx) {
        while (idx < str.length && /\s/.test(str[idx])) idx++;
        return idx;
    }

    function extractCondition(str, startIndex) {
        if (str[startIndex] !== '(') return null;
        let depth = 1;
        let j = startIndex + 1;
        let inSingle = false, inDouble = false, inTemplate = false;

        while (j < str.length && depth > 0) {
            const ch = str[j], prev = str[j - 1] || '';
            if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') inSingle = !inSingle;
            else if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') inDouble = !inDouble;
            else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') inTemplate = !inTemplate;

            if (!inSingle && !inDouble && !inTemplate) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
            }
            j++;
        }
        if (depth !== 0) return null;
        return { cond: str.substring(startIndex + 1, j - 1), end: j };
    }

    // --- Control Flow Handlers ---

    function handleIf(currI, isBare = false) {
        // If bare, currI is at 'i' of 'if'. If not bare, currI is at '{'.
        let startPtr = currI;
        if (!isBare) {
            startPtr = consumeWhitespace(code, currI + 1);
        }

        // Strict verification
        if (!code.startsWith('if', startPtr)) return null;

        let ptr = startPtr + 2;
        ptr = consumeWhitespace(code, ptr);
        if (code[ptr] !== '(') return null;

        const cases = [];
        let elseContent = null;
        let currentPtr = ptr;
        let first = true;

        while (true) {
            if (!first) {
                if (!code.startsWith('if', currentPtr)) break;
                currentPtr += 2;
                currentPtr = consumeWhitespace(code, currentPtr);
            }
            first = false;

            const condRes = extractCondition(code, currentPtr);
            if (!condRes) return null;

            currentPtr = consumeWhitespace(code, condRes.end);
            if (code[currentPtr] !== '{') return null;

            const block = parseBlock(code, currentPtr);
            if (!block) return null;

            const rawContent = code.substring(block.start + 1, block.end);
            // RECURSIVE: content wrapped in fragment, so depth=1
            const transformedContent = transform(rawContent, 1);

            cases.push({ cond: condRes.cond, content: transformedContent });

            currentPtr = block.end + 1;
            currentPtr = consumeWhitespace(code, currentPtr);

            if (code.startsWith('else', currentPtr)) {
                currentPtr += 4;
                currentPtr = consumeWhitespace(code, currentPtr);
                if (code.startsWith('if', currentPtr)) {
                    continue;
                } else if (code[currentPtr] === '{') {
                    const elseBlock = parseBlock(code, currentPtr);
                    if (!elseBlock) return null;
                    const rawElse = code.substring(elseBlock.start + 1, elseBlock.end);
                    elseContent = transform(rawElse, 1);
                    currentPtr = elseBlock.end + 1;
                    break;
                } else {
                    return null;
                }
            } else {
                break;
            }
        }

        // If not bare, consume closing '}'. If bare, we are done.
        let endIdx = currentPtr;
        if (!isBare) {
            endIdx = consumeWhitespace(code, endIdx);
            if (code[endIdx] !== '}') return null;
            endIdx++;
        }

        let expr = '';
        for (let idx = 0; idx < cases.length; idx++) {
            const c = cases[idx];
            let cond = c.cond.trim();
            const isSimplePath = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(cond);
            if (isSimplePath && !cond.endsWith(')')) {
                cond = `((typeof (${cond}) === 'function' && typeof (${cond}).peek === 'function' && ('value' in (${cond}))) ? (${cond})() : (${cond}))`;
            }
            const body = `<Fragment>${c.content}</Fragment>`;
            expr += `(${cond}) ? (${body}) : `;
        }
        expr += elseContent ? `(<Fragment>${elseContent}</Fragment>)` : 'null';

        // Always wrap in Thunk `{(() => ...)}`
        return { end: endIdx, replacement: `{(() => ${expr})}` };
    }

    function handleFor(currI, isBare = false) {
        let ptr = currI;
        if (!isBare) ptr = consumeWhitespace(code, currI + 1);

        if (!code.startsWith('for', ptr)) return null;
        ptr += 3;
        ptr = consumeWhitespace(code, ptr);

        const condRes = extractCondition(code, ptr);
        if (!condRes) return null;

        const forCond = condRes.cond;
        const inMatch = forCond.match(/^\s*(\S+)\s+in\s+(.+)$/);
        if (!inMatch) return null;

        const item = inMatch[1].trim();
        const list = inMatch[2].trim();

        ptr = consumeWhitespace(code, condRes.end);
        if (code[ptr] !== '{') return null;

        const block = parseBlock(code, ptr);
        if (!block) return null;

        const rawContent = code.substring(block.start + 1, block.end);
        const transformedContent = transform(rawContent, 1);

        let endIdx = block.end + 1;
        if (!isBare) {
            endIdx = consumeWhitespace(code, endIdx);
            if (code[endIdx] !== '}') return null;
            endIdx++;
        }

        const replacement = `{(() => ${list}.map(${item} => (<Fragment>${transformedContent}</Fragment>)))}`;
        return { end: endIdx, replacement };
    }

    function handleSwitch(currI, isBare = false) {
        let ptr = currI;
        if (!isBare) ptr = consumeWhitespace(code, currI + 1);

        if (!code.startsWith('switch', ptr)) return null;
        ptr += 6;
        ptr = consumeWhitespace(code, ptr);

        const condRes = extractCondition(code, ptr);
        if (!condRes) return null;
        const cond = condRes.cond;

        ptr = consumeWhitespace(code, condRes.end);
        if (code[ptr] !== '{') return null;

        const block = parseBlock(code, ptr);
        if (!block) return null;

        const rawContent = code.substring(block.start + 1, block.end);
        const transformedInner = transform(rawContent, 0);

        const finalContent = transformedInner.replace(/(case\s+.*?:|default:)([\s\S]*?)(?=case\s+.*?:|default:|$)/g, (m, label, body) => {
            const trimmed = body.trim();
            if (!trimmed) return m;
            if (trimmed.startsWith('return ')) return m;
            return `${label} return (<Fragment>${body}</Fragment>);`;
        });

        let endIdx = block.end + 1;
        if (!isBare) {
            endIdx = consumeWhitespace(code, endIdx);
            if (code[endIdx] !== '}') return null;
            endIdx++;
        }

        // Fix Reactivity: Return a function (Thunk) instead of IIFE result
        // { function() { ... } }
        const replacement = `{function() { __ROUND_SWITCH_TOKEN__(${cond}) { ${finalContent} } }}`;
        return { end: endIdx, replacement };
    }

    function handleTry(currI, isBare = false) {
        let ptr = currI;
        if (!isBare) ptr = consumeWhitespace(code, currI + 1);

        if (!code.startsWith('try', ptr)) return null;
        ptr += 3;
        ptr = consumeWhitespace(code, ptr);

        // Check for reactive try: try(expr) {...}
        let reactiveExpr = null;
        if (code[ptr] === '(') {
            const condRes = extractCondition(code, ptr);
            if (condRes) {
                reactiveExpr = condRes.cond;
                ptr = consumeWhitespace(code, condRes.end);
            }
        }

        // Must have opening brace for try block
        if (code[ptr] !== '{') return null;

        const tryBlock = parseBlock(code, ptr);
        if (!tryBlock) return null;

        const tryContent = code.substring(tryBlock.start + 1, tryBlock.end);
        const transformedTry = transform(tryContent, 1);

        ptr = tryBlock.end + 1;
        ptr = consumeWhitespace(code, ptr);

        // Must have catch
        if (!code.startsWith('catch', ptr)) return null;
        ptr += 5;
        ptr = consumeWhitespace(code, ptr);

        // Extract catch parameter (e) or (err)
        let catchParam = 'e';
        if (code[ptr] === '(') {
            const catchCondRes = extractCondition(code, ptr);
            if (catchCondRes) {
                catchParam = catchCondRes.cond.trim() || 'e';
                ptr = consumeWhitespace(code, catchCondRes.end);
            }
        }

        // Must have catch block
        if (code[ptr] !== '{') return null;

        const catchBlock = parseBlock(code, ptr);
        if (!catchBlock) return null;

        const catchContent = code.substring(catchBlock.start + 1, catchBlock.end);
        const transformedCatch = transform(catchContent, 1);

        let endIdx = catchBlock.end + 1;

        // If not bare, consume closing '}'
        if (!isBare) {
            endIdx = consumeWhitespace(code, endIdx);
            if (code[endIdx] !== '}') return null;
            endIdx++;
        }

        let replacement;
        if (reactiveExpr) {
            // Reactive try: return a THUNK (function) so dom.js handles it as a reactive child (effect)
            replacement = `{() => { try { ${reactiveExpr}; return (<Fragment>${transformedTry}</Fragment>); } catch(${catchParam}) { return (<Fragment>${transformedCatch}</Fragment>); } }}`;
        } else {
            // Static try: simple IIFE
            replacement = `{(() => { try { return (<Fragment>${transformedTry}</Fragment>); } catch(${catchParam}) { return (<Fragment>${transformedCatch}</Fragment>); } })()}`;
        }

        return { end: endIdx, replacement };
    }

    // --- Main Parser Loop ---

    let inSingle = false, inDouble = false, inTemplate = false;
    let inCommentLine = false, inCommentMulti = false;

    // Track JSX opening tag state to avoid transforming code inside attribute expressions
    let inOpeningTag = false;      // True when between <Tag and > (parsing attributes)
    let attrBraceDepth = 0;        // Brace nesting depth inside ={...} expressions
    let prevWasEquals = false;     // Track if previous non-whitespace char was '='

    while (i < code.length) {
        const ch = code[i];
        const next = i < code.length - 1 ? code[i + 1] : '';
        const prev = i > 0 ? code[i - 1] : '';

        if (inCommentLine) {
            result += ch;
            if (ch === '\n' || ch === '\r') inCommentLine = false;
            i++; continue;
        }
        if (inCommentMulti) {
            result += ch;
            if (ch === '*' && next === '/') { inCommentMulti = false; result += '/'; i += 2; continue; }
            i++; continue;
        }
        if (inTemplate) {
            result += ch;
            if (ch === '`' && prev !== '\\') inTemplate = false;
            i++; continue;
        }
        if (inSingle) {
            result += ch;
            if (ch === '\'' && prev !== '\\') inSingle = false;
            i++; continue;
        }
        if (inDouble) {
            result += ch;
            if (ch === '"' && prev !== '\\') inDouble = false;
            i++; continue;
        }

        if (ch === '/' && next === '/') { inCommentLine = true; result += '//'; i += 2; continue; }
        if (ch === '/' && next === '*') { inCommentMulti = true; result += '/*'; i += 2; continue; }
        if (ch === '`') { inTemplate = true; result += ch; i++; continue; }
        if (ch === '\'') { inSingle = true; result += ch; i++; continue; }
        if (ch === '"') { inDouble = true; result += ch; i++; continue; }

        // Track attribute expression braces BEFORE other logic
        if (inOpeningTag) {
            if (ch === '=' && !attrBraceDepth) {
                prevWasEquals = true;
                result += ch;
                i++;
                continue;
            }
            if (ch === '{') {
                if (prevWasEquals || attrBraceDepth > 0) {
                    // Entering or continuing inside an attribute expression
                    attrBraceDepth++;
                }
                prevWasEquals = false;
                result += ch;
                i++;
                continue;
            }
            if (ch === '}' && attrBraceDepth > 0) {
                attrBraceDepth--;
                result += ch;
                i++;
                continue;
            }
            if (!/\s/.test(ch)) {
                prevWasEquals = false;
            }
            // End of opening tag
            if (ch === '>' && attrBraceDepth === 0) {
                inOpeningTag = false;
                result += ch;
                i++;
                continue;
            }
            // Self-closing tag
            if (ch === '/' && next === '>' && attrBraceDepth === 0) {
                inOpeningTag = false;
                if (jsxDepth > 0) jsxDepth--;
                result += '/>';
                i += 2;
                continue;
            }
        }

        // JSX tag detection (only when NOT inside an opening tag already)
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
                // Closing tag </tag>
                if (jsxDepth > 0) jsxDepth--;
            } else if (isFragment) {
                // Fragment <>
                jsxDepth++;
            }
        }

        // Fragment closing </>
        if (ch === '<' && next === '/' && code[i + 2] === '>') {
            if (jsxDepth > 0) jsxDepth--;
            result += '</>';
            i += 3;
            continue;
        }

        // ONLY transform when in JSX children context (not in opening tag, not in attr expression)
        if (jsxDepth > 0 && !inOpeningTag && attrBraceDepth === 0) {
            let processed = false;

            // 1. Handlers for { control }
            if (ch === '{') {
                let ptr = consumeWhitespace(code, i + 1);
                if (code.startsWith('if', ptr)) {
                    const res = handleIf(i, false);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                } else if (code.startsWith('for', ptr)) {
                    const res = handleFor(i, false);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                } else if (code.startsWith('switch', ptr)) {
                    const res = handleSwitch(i, false);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                } else if (code.startsWith('try', ptr)) {
                    const res = handleTry(i, false);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                }
            }

            // 2. Handlers for bare control flow (implicit nesting)
            // Strict check: must look like "if (" inside a code block
            else if (ch === 'i' && code.startsWith('if', i)) {
                // Verify it is followed by (
                let ptr = consumeWhitespace(code, i + 2);
                if (code[ptr] === '(') {
                    const res = handleIf(i, true);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                }
            } else if (ch === 'f' && code.startsWith('for', i)) {
                let ptr = consumeWhitespace(code, i + 3);
                if (code[ptr] === '(') {
                    const res = handleFor(i, true);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                }
            } else if (ch === 's' && code.startsWith('switch', i)) {
                let ptr = consumeWhitespace(code, i + 6);
                if (code[ptr] === '(') {
                    const res = handleSwitch(i, true);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                }
            } else if (ch === 't' && code.startsWith('try', i)) {
                // Bare try: try { ... } catch { ... } or try(expr) { ... } catch { ... }
                let ptr = consumeWhitespace(code, i + 3);
                if (code[ptr] === '{' || code[ptr] === '(') {
                    const res = handleTry(i, true);
                    if (res) { result += res.replacement; i = res.end; processed = true; }
                }
            }

            if (processed) continue;
        }

        result += ch;
        i++;
    }

    // --- Helpers for global transforms ---

    function findJsxTagEnd(str, startIndex) {
        let inSingle = false, inDouble = false, inTemplate = false;
        let braceDepth = 0;
        for (let k = startIndex; k < str.length; k++) {
            const c = str[k];
            const p = k > 0 ? str[k - 1] : '';
            if (!inDouble && !inTemplate && c === '\'' && p !== '\\') inSingle = !inSingle;
            else if (!inSingle && !inTemplate && c === '"' && p !== '\\') inDouble = !inDouble;
            else if (!inSingle && !inDouble && c === '`' && p !== '\\') inTemplate = !inTemplate;
            if (inSingle || inDouble || inTemplate) continue;
            if (c === '{') braceDepth++;
            else if (c === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (c === '>' && braceDepth === 0) return k;
        }
        return -1;
    }

    function transformSuspenseBlocks(str) {
        let out = str;
        let cursor = 0;
        while (true) {
            const openIndex = out.indexOf('<Suspense', cursor);
            if (openIndex === -1) break;
            const openEnd = findJsxTagEnd(out, openIndex);
            if (openEnd === -1) break;
            const openTagText = out.slice(openIndex, openEnd + 1);
            if (/\/>\s*$/.test(openTagText)) { cursor = openEnd + 1; continue; }
            let depth = 1, k = openEnd + 1, closeStart = -1;
            while (k < out.length) {
                if (out.slice(k).startsWith('<Suspense')) { depth++; k += 9; }
                else if (out.slice(k).startsWith('</Suspense>')) {
                    depth--; if (depth === 0) { closeStart = k; break; } k += 11;
                } else k++;
            }
            if (closeStart === -1) break;
            const inner = out.slice(openEnd + 1, closeStart);
            const wrapped = `{(() => (<Fragment>${inner}</Fragment>))}`;
            out = out.slice(0, openEnd + 1) + wrapped + out.slice(closeStart);
            cursor = closeStart + wrapped.length + 11;
        }
        return out;
    }

    function transformProviderBlocks(str) {
        let out = str;
        let cursor = 0;
        while (true) {
            const dot = out.indexOf('.Provider', cursor);
            if (dot === -1) break;
            const lt = out.lastIndexOf('<', dot);
            if (lt === -1) break;
            const openEnd = findJsxTagEnd(out, lt);
            if (openEnd === -1) break;
            const tagText = out.slice(lt, openEnd + 1);
            if (/\/>\s*$/.test(tagText)) { cursor = openEnd + 1; continue; }
            const m = tagText.match(/^<\s*([A-Za-z_$][\w$]*\.Provider)\b/);
            if (!m) { cursor = openEnd + 1; continue; }
            const tagName = m[1];
            const closeTag = `</${tagName}>`;
            let depth = 1, k = openEnd + 1, closeStart = -1;
            while (k < out.length) {
                const nOpen = out.indexOf(`<${tagName}`, k);
                const nClose = out.indexOf(closeTag, k);
                if (nClose === -1) break;
                if (nOpen !== -1 && nOpen < nClose) {
                    const innerEnd = findJsxTagEnd(out, nOpen);
                    if (innerEnd !== -1 && !/\/>\s*$/.test(out.slice(nOpen, innerEnd + 1))) depth++;
                    k = innerEnd + 1; continue;
                }
                depth--;
                if (depth === 0) { closeStart = nClose; break; }
                k = nClose + closeTag.length;
            }
            if (closeStart === -1) break;
            const inner = out.slice(openEnd + 1, closeStart);
            const wrapped = `{(() => (<Fragment>${inner}</Fragment>))}`;
            out = out.slice(0, openEnd + 1) + wrapped + out.slice(closeStart);
            cursor = closeStart + wrapped.length + closeTag.length;
        }
        return out;
    }

    result = transformSuspenseBlocks(result);
    result = transformProviderBlocks(result);

    result = result
        .replace(/\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, '{() => $1()}')
        .replace(/=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, '={' + '() => $1()}');

    return result.replace(/__ROUND_SWITCH_TOKEN__/g, 'switch');
}