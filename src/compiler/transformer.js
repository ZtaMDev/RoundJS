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

    function prevNonWsIndex(str, fromIndex) {
        for (let k = fromIndex; k >= 0; k--) {
            if (!/\s/.test(str[k])) return k;
        }
        return -1;
    }

    function prevWord(str, fromIndex) {
        let k = fromIndex;
        while (k >= 0 && /[\w$]/.test(str[k])) k--;
        const w = str.slice(k + 1, fromIndex + 1);
        return w;
    }

    function isRegexStart(str, slashIndex) {
        const next = str[slashIndex + 1] || '';
        if (next === '/' || next === '*') return false;

        const prevIdx = prevNonWsIndex(str, slashIndex - 1);
        if (prevIdx === -1) return true;

        const prev = str[prevIdx];
        if (/[({[=:+\-!*,?;|&~%^<>]/.test(prev)) return true;

        if (/[\w$]/.test(prev)) {
            const w = prevWord(str, prevIdx);
            if (w === 'return' || w === 'throw' || w === 'case' || w === 'yield' || w === 'await') return true;
        }

        return false;
    }

    function consumeRegexLiteralEnd(str, slashIndex) {
        let inClass = false;
        let escaped = false;

        for (let k = slashIndex + 1; k < str.length; k++) {
            const ch = str[k];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '[') {
                inClass = true;
                continue;
            }
            if (ch === ']' && inClass) {
                inClass = false;
                continue;
            }
            if (ch === '/' && !inClass) {
                let end = k + 1;
                while (end < str.length && /[a-z]/i.test(str[end])) end++;
                return end;
            }
            if (ch === '\n' || ch === '\r') return null;
        }
        return null;
    }

    function wrapControlExpressionForJsx(expr) {
        const t = String(expr ?? '').trim();
        if (!t) return '{null}';
        const isInvokedIife = /\)\s*\(\s*\)\s*$/.test(t);
        const isThunk = (t.startsWith('function') || t.startsWith('() =>') || t.startsWith('(() =>')) && !isInvokedIife;
        if (isThunk) return `{(${t})()}`;
        return `{${t}}`;
    }

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
                else if (ch === '\n' || ch === '\r') inSingle = false; // Reset on newline (JS strings don't span lines)
                continue;
            }
            if (inDouble) {
                if (ch === '"' && prev !== '\\') inDouble = false;
                else if (ch === '\n' || ch === '\r') inDouble = false; // Reset on newline
                continue;
            }

            if (ch === '/' && next !== '/' && next !== '*' && isRegexStart(str, j)) {
                const end = consumeRegexLiteralEnd(str, j);
                if (end !== null) { j = end - 1; continue; }
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

            if (!inSingle && !inDouble && !inTemplate && ch === '/' && isRegexStart(str, j)) {
                const end = consumeRegexLiteralEnd(str, j);
                if (end !== null) { j = end; continue; }
            }

            if (!inSingle && !inDouble && !inTemplate) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
            }
            j++;
        }
        if (depth !== 0) return null;
        return { cond: str.substring(startIndex + 1, j - 1), end: j };
    }

    // --- Control Flow Helpers (Return { replacement, end, processed }) ---
    // These now return the EXPRESSION string (without outer {}) and the end index.
    // They accept 'startPtr' which is the index AFTER the opening '{' (or start of keyword if bare).

    function handleIfContent(startPtr) {
        // Strict verification: code at startPtr should start with 'if'
        if (!code.startsWith('if', startPtr)) return null;

        // Parse 'if' ... '('
        // Fix: tolerate whitespace between if and (
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

        return { end: currentPtr, expression: expr };
    }

    function handleForContent(startPtr) {
        if (!code.startsWith('for', startPtr)) return null;
        let ptr = startPtr + 3;
        ptr = consumeWhitespace(code, ptr);

        const condRes = extractCondition(code, ptr);
        if (!condRes) return null;

        const forCond = condRes.cond;
        const inMatch = forCond.match(/^\s*(\S+)\s+in\s+(.+)$/);
        if (!inMatch) return null;

        const item = inMatch[1].trim();
        const list = inMatch[2].trim();

        ptr = consumeWhitespace(code, condRes.end);

        // --- KEY PARSING ---
        let keyExpr = null;
        if (code.startsWith('key', ptr)) {
            let kPtr = consumeWhitespace(code, ptr + 3);
            if (code[kPtr] === '=') {
                kPtr = consumeWhitespace(code, kPtr + 1);
                if (code[kPtr] === '{') {
                    const keyBlock = parseBlock(code, kPtr);
                    if (keyBlock) {
                        keyExpr = code.substring(keyBlock.start + 1, keyBlock.end);
                        ptr = consumeWhitespace(code, keyBlock.end + 1);
                    }
                } else {
                    let start = kPtr;
                    while (kPtr < code.length && !/\s/.test(code[kPtr]) && code[kPtr] !== '{') kPtr++;
                    keyExpr = code.substring(start, kPtr);
                    ptr = consumeWhitespace(code, kPtr);
                }
            }
        }

        if (code[ptr] !== '{') return null;
        const block = parseBlock(code, ptr);
        if (!block) return null;

        const rawContent = code.substring(block.start + 1, block.end);
        const transformedContent = transform(rawContent, 1);
        const endIdx = block.end + 1;

        let expression;
        if (keyExpr) {
            expression = `createElement(ForKeyed, { each: () => ${list}, key: (${item}) => ${keyExpr} }, (${item}) => (<Fragment>${transformedContent}</Fragment>))`;
        } else {
            expression = `(() => ${list}.map(${item} => (<Fragment>${transformedContent}</Fragment>)))`;
        }
        return { end: endIdx, expression };
    }

    function handleSwitchContent(startPtr) {
        if (!code.startsWith('switch', startPtr)) return null;
        let ptr = startPtr + 6;
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

        // Use token to avoid nested switch overlap
        const expression = `function() { __ROUND_SWITCH_TOKEN__(${cond}) { ${finalContent} } }`;
        return { end: block.end + 1, expression };
    }

    function handleTryContent(startPtr) {
        if (!code.startsWith('try', startPtr)) return null;
        let ptr = startPtr + 3;
        ptr = consumeWhitespace(code, ptr);

        let reactiveExpr = null;
        if (code[ptr] === '(') {
            const condRes = extractCondition(code, ptr);
            if (condRes) {
                reactiveExpr = condRes.cond;
                ptr = consumeWhitespace(code, condRes.end);
            }
        }

        if (code[ptr] !== '{') return null;
        const tryBlock = parseBlock(code, ptr);
        if (!tryBlock) return null;

        const tryContent = code.substring(tryBlock.start + 1, tryBlock.end);
        const transformedTry = transform(tryContent, 1);

        ptr = tryBlock.end + 1;
        ptr = consumeWhitespace(code, ptr);

        if (!code.startsWith('catch', ptr)) return null;
        ptr += 5;
        ptr = consumeWhitespace(code, ptr);

        let catchParam = 'e';
        if (code[ptr] === '(') {
            const catchCondRes = extractCondition(code, ptr);
            if (catchCondRes) {
                catchParam = catchCondRes.cond.trim() || 'e';
                ptr = consumeWhitespace(code, catchCondRes.end);
            }
        }

        if (code[ptr] !== '{') return null;
        const catchBlock = parseBlock(code, ptr);
        if (!catchBlock) return null;

        const catchContent = code.substring(catchBlock.start + 1, catchBlock.end);
        const transformedCatch = transform(catchContent, 1);

        let expression;
        if (reactiveExpr) {
            expression = `() => { try { ${reactiveExpr}; return (<Fragment>${transformedTry}</Fragment>); } catch(${catchParam}) { return (<Fragment>${transformedCatch}</Fragment>); } }`;
        } else {
            expression = `(() => { try { return (<Fragment>${transformedTry}</Fragment>); } catch(${catchParam}) { return (<Fragment>${transformedCatch}</Fragment>); } })()`;
        }
        return { end: catchBlock.end + 1, expression };
    }

    // --- Aggregator ---

    function handleControlBlock(currI) {
        // We are at '{'. Check if content starts with control flow.
        let ptr = consumeWhitespace(code, currI + 1);

        // Peek first keyword
        let keyword = '';
        if (code.startsWith('if', ptr)) keyword = 'if';
        else if (code.startsWith('for', ptr)) keyword = 'for';
        else if (code.startsWith('switch', ptr)) keyword = 'switch';
        else if (code.startsWith('try', ptr)) keyword = 'try';

        if (!keyword) return null;

        // Start collecting expressions
        const expressions = [];
        let loopPtr = ptr;

        while (true) {
            // Find which handler to call
            let res = null;
            if (code.startsWith('if', loopPtr)) res = handleIfContent(loopPtr);
            else if (code.startsWith('for', loopPtr)) res = handleForContent(loopPtr);
            else if (code.startsWith('switch', loopPtr)) res = handleSwitchContent(loopPtr);
            else if (code.startsWith('try', loopPtr)) res = handleTryContent(loopPtr);

            if (!res) {
                // If we hit something else, maybe invalid or normal JS.
                // Must stop. Explicitly check if we are at '}'.
                loopPtr = consumeWhitespace(code, loopPtr);
                if (code[loopPtr] === '}') {
                    // Clean loop end
                    break;
                } else {
                    // Found garbage or non-transformable code. 
                    // To be safe, we abort the whole sequence transform to avoid breaking mixed content?
                    // Or we just break and hope for the best?
                    // Previous logic returned null if strict check failed.
                    return null;
                }
            }

            expressions.push(res.expression);
            loopPtr = consumeWhitespace(code, res.end);

            if (code[loopPtr] === '}') {
                break;
            }
            // Check if next is also control flow. If not, loop repeats, hits 'if(!res)' and returns null.
        }

        const finalExprs = expressions.map(e => {
            return wrapControlExpressionForJsx(e);
        });

        const sequence = finalExprs.join(' ');
        const replacement = `{(<Fragment>${sequence}</Fragment>)}`;

        // consume the final '}'
        let endIdx = loopPtr + 1;

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
            else if (ch === '\n' || ch === '\r') inSingle = false;
            i++; continue;
        }
        if (inDouble) {
            result += ch;
            if (ch === '"' && prev !== '\\') inDouble = false;
            else if (ch === '\n' || ch === '\r') inDouble = false;
            i++; continue;
        }

        if (ch === '/' && next === '/') { inCommentLine = true; result += '//'; i += 2; continue; }
        if (ch === '/' && next === '*') { inCommentMulti = true; result += '/*'; i += 2; continue; }

        if (ch === '/' && next !== '/' && next !== '*' && isRegexStart(code, i)) {
            const end = consumeRegexLiteralEnd(code, i);
            if (end !== null) {
                result += code.slice(i, end);
                i = end;
                continue;
            }
        }

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
                if (prevWasEquals || attrBraceDepth > 0) attrBraceDepth++;
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
            if (!/\s/.test(ch)) prevWasEquals = false;
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

            // 1. Handlers for { control } - BLOCK (Supported Nested Sequence)
            if (ch === '{') {
                const res = handleControlBlock(i);
                if (res) {
                    result += res.replacement;
                    i = res.end;
                    processed = true;
                }
            }

            // 2. Handlers for bare control flow (implicit nesting)
            // Bare control flow is single statement, so we can wrap it individually.
            if (!processed) {
                if (ch === 'i' && code.startsWith('if', i)) {
                    let ptr = consumeWhitespace(code, i + 2);
                    if (code[ptr] === '(') {
                        const res = handleIfContent(i); // Reuse content handler
                        if (res) {
                            result += wrapControlExpressionForJsx(res.expression);
                            i = res.end;
                            processed = true;
                        }
                    }
                } else if (ch === 'f' && code.startsWith('for', i)) {
                    let ptr = consumeWhitespace(code, i + 3);
                    if (code[ptr] === '(') {
                        const res = handleForContent(i);
                        if (res) {
                            result += wrapControlExpressionForJsx(res.expression);
                            i = res.end;
                            processed = true;
                        }
                    }
                } else if (ch === 's' && code.startsWith('switch', i)) {
                    let ptr = consumeWhitespace(code, i + 6);
                    if (code[ptr] === '(') {
                        const res = handleSwitchContent(i);
                        if (res) {
                            // handleSwitchContent returns `function() ...`
                            // Need `{function() ...}`.
                            result += wrapControlExpressionForJsx(res.expression);
                            i = res.end;
                            processed = true;
                        }
                    }
                } else if (ch === 't' && code.startsWith('try', i)) {
                    let ptr = consumeWhitespace(code, i + 3);
                    if (code[ptr] === '{' || code[ptr] === '(') {
                        const res = handleTryContent(i);
                        if (res) {
                            // handleTryContent returns `() => ...` or IIFE.
                            // If IIFE `(() => ...)()`, wrap in `{...}`.
                            result += wrapControlExpressionForJsx(res.expression);
                            i = res.end;
                            processed = true;
                        }
                    }
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

            if (c === '/' && isRegexStart(str, k)) {
                const end = consumeRegexLiteralEnd(str, k);
                if (end !== null) { k = end - 1; continue; }
            }

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