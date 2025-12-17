// Transformer for .round files
// Handles custom syntax like:
// {if(cond){ ... }} -> {cond ? (...) : null}
// {for(item in list){ ... }} -> {list.map(item => (...))}

export function transform(code) {
    // Process "if" blocks first, then "for" blocks (or vice versa, order matters if nested)

    // Helper to find balanced block starting at index
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

            // Handle strings and comments
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

            // Check for start of strings/comments
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

    let result = code;

    function consumeWhitespace(str, i) {
        while (i < str.length && /\s/.test(str[i])) i++;
        return i;
    }

    function parseIfChain(str, ifIndex) {
        const head = str.slice(ifIndex);
        const m = head.match(/^if\s*\((.*?)\)\s*\{/);
        if (!m) return null;

        let i = ifIndex;
        const cases = [];
        let elseContent = null;

        while (true) {
            const cur = str.slice(i);
            const mm = cur.match(/^if\s*\((.*?)\)\s*\{/);
            if (!mm) return null;
            let cond = mm[1];

            // Allow {if(signal){...}} where signal is a simple identifier/member path.
            // For those cases, auto-unwrap signal-like values by calling them.
            // Examples supported:
            // - if(flags.showCounter){...}
            // - if(user.loggedIn){...}
            // Complex expressions are left untouched.
            const trimmedCond = String(cond).trim();
            const isSimplePath = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(trimmedCond);
            if (isSimplePath && !trimmedCond.endsWith(')')) {
                cond = `((typeof (${trimmedCond}) === 'function' && typeof (${trimmedCond}).peek === 'function' && ('value' in (${trimmedCond}))) ? (${trimmedCond})() : (${trimmedCond}))`;
            }
            const blockStart = i + mm[0].length - 1;
            const block = parseBlock(str, blockStart);
            if (!block) return null;

            const content = str.substring(block.start + 1, block.end);
            cases.push({ cond, content });

            i = block.end + 1;
            i = consumeWhitespace(str, i);

            if (!str.startsWith('else', i)) {
                break;
            }

            i += 4;
            i = consumeWhitespace(str, i);

            if (str.startsWith('if', i)) {
                continue;
            }

            if (str[i] !== '{') return null;
            const elseBlock = parseBlock(str, i);
            if (!elseBlock) return null;
            elseContent = str.substring(elseBlock.start + 1, elseBlock.end);
            i = elseBlock.end + 1;
            break;
        }

        const end = i;

        let expr = '';
        for (let idx = 0; idx < cases.length; idx++) {
            const c = cases[idx];
            const body = `<Fragment>${c.content}</Fragment>`;
            if (idx === 0) {
                expr = `(${c.cond}) ? (${body}) : `;
            } else {
                expr += `(${c.cond}) ? (${body}) : `;
            }
        }
        if (elseContent !== null) {
            expr += `(<Fragment>${elseContent}</Fragment>)`;
        } else {
            expr += 'null';
        }

        const replacement = `(() => ${expr})`;
        return { start: ifIndex, end, replacement };
    }

    function parseIfStatement(str, ifIndex) {
        if (!str.startsWith('if', ifIndex)) return null;
        const chain = parseIfChain(str, ifIndex);
        if (!chain) return null;
        return {
            start: chain.start,
            end: chain.end,
            replacement: `{${chain.replacement}}`
        };
    }

    function parseIfExpression(str, exprStart) {
        if (str[exprStart] !== '{') return null;

        let i = consumeWhitespace(str, exprStart + 1);
        if (!str.startsWith('if', i)) return null;

        const outer = parseBlock(str, exprStart);
        if (!outer) return null;

        const chain = parseIfChain(str, i);
        if (!chain) return null;

        return {
            start: exprStart,
            end: outer.end + 1,
            replacement: `{${chain.replacement}}`
        };
    }

    let prev = null;
    while (prev !== result) {
        prev = result;

        while (true) {
            const match = result.match(/\{\s*if\s*\(/);
            if (!match) break;
            const matchIndex = match.index;

            const parsed = parseIfExpression(result, matchIndex);
            if (!parsed) {
                console.warn('Unbalanced IF expression found, skipping transformation.');
                break;
            }

            const before = result.substring(0, parsed.start);
            const after = result.substring(parsed.end);
            result = before + parsed.replacement + after;
        }

        while (true) {
            const match = result.match(/(^|[\n\r])\s*if\s*\(/m);
            if (!match) break;
            const ifIndex = match.index + match[0].lastIndexOf('if');

            const parsed = parseIfStatement(result, ifIndex);
            if (!parsed) break;

            const before = result.substring(0, parsed.start);
            const after = result.substring(parsed.end);
            result = before + parsed.replacement + after;
        }

        while (true) {
            const match = result.match(/\{\s*for\s*\((.*?)\s+in\s+(.*?)\)\s*\{/);
            if (!match) break;

            const item = match[1];
            const list = match[2];
            const exprStart = match.index;

            const outer = parseBlock(result, exprStart);
            if (!outer) break;

            let i = consumeWhitespace(result, exprStart + 1);
            const head = result.slice(i);
            const mm = head.match(/^for\s*\((.*?)\s+in\s+(.*?)\)\s*\{/);
            if (!mm) break;
            const forStart = i;
            const blockStart = forStart + mm[0].length - 1;
            const block = parseBlock(result, blockStart);
            if (!block) break;

            const content = result.substring(block.start + 1, block.end);
            const replacement = `{${list}.map(${item} => (<Fragment>${content}</Fragment>))}`;

            const before = result.substring(0, exprStart);
            const after = result.substring(outer.end + 1);

            result = before + replacement + after;
        }

        while (true) {
            const match = result.match(/(^|[\n\r])\s*for\s*\((.*?)\s+in\s+(.*?)\)\s*\{/m);
            if (!match) break;

            const exprStart = match.index + match[0].lastIndexOf('for');
            const item = match[2];
            const list = match[3];

            const forHead = result.slice(exprStart);
            const mm = forHead.match(/^for\s*\((.*?)\s+in\s+(.*?)\)\s*\{/);
            if (!mm) break;

            const blockStart = exprStart + mm[0].length - 1;
            const block = parseBlock(result, blockStart);
            if (!block) break;

            const content = result.substring(block.start + 1, block.end);
            const replacement = `{${list}.map(${item} => (<Fragment>${content}</Fragment>))}`;

            const before = result.substring(0, exprStart);
            const after = result.substring(block.end + 1);
            result = before + replacement + after;
        }
    }

    function findJsxTagEnd(str, startIndex) {
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        let braceDepth = 0;

        for (let i = startIndex; i < str.length; i++) {
            const ch = str[i];
            const prevCh = i > 0 ? str[i - 1] : '';

            if (!inDouble && !inTemplate && ch === '\'' && prevCh !== '\\') inSingle = !inSingle;
            else if (!inSingle && !inTemplate && ch === '"' && prevCh !== '\\') inDouble = !inDouble;
            else if (!inSingle && !inDouble && ch === '`' && prevCh !== '\\') inTemplate = !inTemplate;

            if (inSingle || inDouble || inTemplate) continue;

            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (ch === '>' && braceDepth === 0) return i;
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
            if (/\/>\s*$/.test(openTagText)) {
                cursor = openEnd + 1;
                continue;
            }

            let depth = 1;
            let i = openEnd + 1;
            let closeStart = -1;
            while (i < out.length) {
                const nextOpen = out.indexOf('<Suspense', i);
                const nextClose = out.indexOf('</Suspense>', i);
                if (nextClose === -1) break;
                if (nextOpen !== -1 && nextOpen < nextClose) {
                    const innerOpenEnd = findJsxTagEnd(out, nextOpen);
                    if (innerOpenEnd === -1) break;
                    const innerOpenText = out.slice(nextOpen, innerOpenEnd + 1);
                    if (!/\/>\s*$/.test(innerOpenText)) depth++;
                    i = innerOpenEnd + 1;
                    continue;
                }

                depth--;
                if (depth === 0) {
                    closeStart = nextClose;
                    break;
                }
                i = nextClose + '</Suspense>'.length;
            }
            if (closeStart === -1) break;

            const inner = out.slice(openEnd + 1, closeStart);
            const innerTrim = inner.trim();
            if (innerTrim.startsWith('{() =>')) {
                cursor = closeStart + '</Suspense>'.length;
                continue;
            }

            const wrapped = `{() => (<Fragment>${inner}</Fragment>)}`;
            out = out.slice(0, openEnd + 1) + wrapped + out.slice(closeStart);
            cursor = closeStart + wrapped.length + '</Suspense>'.length;
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

            const openTagText = out.slice(lt, openEnd + 1);
            if (/\/>\s*$/.test(openTagText)) {
                cursor = openEnd + 1;
                continue;
            }

            const m = openTagText.match(/^<\s*([A-Za-z_$][\w$]*\.Provider)\b/);
            if (!m) {
                cursor = openEnd + 1;
                continue;
            }
            const tagName = m[1];
            const closeTag = `</${tagName}>`;

            let depth = 1;
            let i = openEnd + 1;
            let closeStart = -1;
            while (i < out.length) {
                const nextOpen = out.indexOf(`<${tagName}`, i);
                const nextClose = out.indexOf(closeTag, i);
                if (nextClose === -1) break;
                if (nextOpen !== -1 && nextOpen < nextClose) {
                    const innerOpenEnd = findJsxTagEnd(out, nextOpen);
                    if (innerOpenEnd === -1) break;
                    const innerOpenText = out.slice(nextOpen, innerOpenEnd + 1);
                    if (!/\/>\s*$/.test(innerOpenText)) depth++;
                    i = innerOpenEnd + 1;
                    continue;
                }

                depth--;
                if (depth === 0) {
                    closeStart = nextClose;
                    break;
                }
                i = nextClose + closeTag.length;
            }
            if (closeStart === -1) break;

            const inner = out.slice(openEnd + 1, closeStart);
            const innerTrim = inner.trim();
            if (innerTrim.startsWith('{() =>')) {
                cursor = closeStart + closeTag.length;
                continue;
            }

            const wrapped = `{() => (<Fragment>${inner}</Fragment>)}`;
            out = out.slice(0, openEnd + 1) + wrapped + out.slice(closeStart);
            cursor = closeStart + wrapped.length + closeTag.length;
        }
        return out;
    }

    result = transformSuspenseBlocks(result);
    result = transformProviderBlocks(result);

    // Make `signal()` reactive in JSX by passing a function to the runtime.
    // `{count()}` -> `{() => count()}``
    // `value={count()}` -> `value={() => count()}``
    // This is intentionally limited to zero-arg identifier calls.
    result = result
        .replace(/\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, '{() => $1()}')
        .replace(/=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, '={() => $1()}');

    return result;
}
