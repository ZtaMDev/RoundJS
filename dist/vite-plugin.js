var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
import fs from "node:fs";
import path from "node:path";
function transform(code, initialDepth = 0) {
  let result = "";
  let i = 0;
  let jsxDepth = initialDepth;
  function parseBlock(str, startIndex) {
    let open = 0;
    let startBlockIndex = -1;
    let inSingle2 = false, inDouble2 = false, inTemplate2 = false;
    let inCommentLine2 = false, inCommentMulti2 = false;
    for (let j = startIndex; j < str.length; j++) {
      const ch = str[j];
      const prev = j > 0 ? str[j - 1] : "";
      const next = j < str.length - 1 ? str[j + 1] : "";
      if (inCommentLine2) {
        if (ch === "\n" || ch === "\r") inCommentLine2 = false;
        continue;
      }
      if (inCommentMulti2) {
        if (ch === "*" && next === "/") {
          inCommentMulti2 = false;
          j++;
        }
        continue;
      }
      if (inTemplate2) {
        if (ch === "`" && prev !== "\\") inTemplate2 = false;
        continue;
      }
      if (inSingle2) {
        if (ch === "'" && prev !== "\\") inSingle2 = false;
        continue;
      }
      if (inDouble2) {
        if (ch === '"' && prev !== "\\") inDouble2 = false;
        continue;
      }
      if (ch === "/" && next === "/") {
        inCommentLine2 = true;
        j++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inCommentMulti2 = true;
        j++;
        continue;
      }
      if (ch === "`") {
        inTemplate2 = true;
        continue;
      }
      if (ch === "'") {
        inSingle2 = true;
        continue;
      }
      if (ch === '"') {
        inDouble2 = true;
        continue;
      }
      if (ch === "{") {
        if (open === 0) startBlockIndex = j;
        open++;
      } else if (ch === "}") {
        open--;
        if (open === 0) {
          return { start: startBlockIndex, end: j };
        }
      }
    }
    return null;
  }
  __name(parseBlock, "parseBlock");
  function consumeWhitespace(str, idx) {
    while (idx < str.length && /\s/.test(str[idx])) idx++;
    return idx;
  }
  __name(consumeWhitespace, "consumeWhitespace");
  function extractCondition(str, startIndex) {
    if (str[startIndex] !== "(") return null;
    let depth = 1;
    let j = startIndex + 1;
    let inSingle2 = false, inDouble2 = false, inTemplate2 = false;
    while (j < str.length && depth > 0) {
      const ch = str[j], prev = str[j - 1] || "";
      if (!inDouble2 && !inTemplate2 && ch === "'" && prev !== "\\") inSingle2 = !inSingle2;
      else if (!inSingle2 && !inTemplate2 && ch === '"' && prev !== "\\") inDouble2 = !inDouble2;
      else if (!inSingle2 && !inDouble2 && ch === "`" && prev !== "\\") inTemplate2 = !inTemplate2;
      if (!inSingle2 && !inDouble2 && !inTemplate2) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      j++;
    }
    if (depth !== 0) return null;
    return { cond: str.substring(startIndex + 1, j - 1), end: j };
  }
  __name(extractCondition, "extractCondition");
  function handleIf(currI, isBare = false) {
    let startPtr = currI;
    if (!isBare) {
      startPtr = consumeWhitespace(code, currI + 1);
    }
    if (!code.startsWith("if", startPtr)) return null;
    let ptr = startPtr + 2;
    ptr = consumeWhitespace(code, ptr);
    if (code[ptr] !== "(") return null;
    const cases = [];
    let elseContent = null;
    let currentPtr = ptr;
    let first = true;
    while (true) {
      if (!first) {
        if (!code.startsWith("if", currentPtr)) break;
        currentPtr += 2;
        currentPtr = consumeWhitespace(code, currentPtr);
      }
      first = false;
      const condRes = extractCondition(code, currentPtr);
      if (!condRes) return null;
      currentPtr = consumeWhitespace(code, condRes.end);
      if (code[currentPtr] !== "{") return null;
      const block = parseBlock(code, currentPtr);
      if (!block) return null;
      const rawContent = code.substring(block.start + 1, block.end);
      const transformedContent = transform(rawContent, 1);
      cases.push({ cond: condRes.cond, content: transformedContent });
      currentPtr = block.end + 1;
      currentPtr = consumeWhitespace(code, currentPtr);
      if (code.startsWith("else", currentPtr)) {
        currentPtr += 4;
        currentPtr = consumeWhitespace(code, currentPtr);
        if (code.startsWith("if", currentPtr)) {
          continue;
        } else if (code[currentPtr] === "{") {
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
    let endIdx = currentPtr;
    if (!isBare) {
      endIdx = consumeWhitespace(code, endIdx);
      if (code[endIdx] !== "}") return null;
      endIdx++;
    }
    let expr = "";
    for (let idx = 0; idx < cases.length; idx++) {
      const c = cases[idx];
      let cond = c.cond.trim();
      const isSimplePath = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(cond);
      if (isSimplePath && !cond.endsWith(")")) {
        cond = `((typeof (${cond}) === 'function' && typeof (${cond}).peek === 'function' && ('value' in (${cond}))) ? (${cond})() : (${cond}))`;
      }
      const body = `<Fragment>${c.content}</Fragment>`;
      expr += `(${cond}) ? (${body}) : `;
    }
    expr += elseContent ? `(<Fragment>${elseContent}</Fragment>)` : "null";
    return { end: endIdx, replacement: `{(() => ${expr})}` };
  }
  __name(handleIf, "handleIf");
  function handleFor(currI, isBare = false) {
    let ptr = currI;
    if (!isBare) ptr = consumeWhitespace(code, currI + 1);
    if (!code.startsWith("for", ptr)) return null;
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
    if (code[ptr] !== "{") return null;
    const block = parseBlock(code, ptr);
    if (!block) return null;
    const rawContent = code.substring(block.start + 1, block.end);
    const transformedContent = transform(rawContent, 1);
    let endIdx = block.end + 1;
    if (!isBare) {
      endIdx = consumeWhitespace(code, endIdx);
      if (code[endIdx] !== "}") return null;
      endIdx++;
    }
    const replacement = `{(() => ${list}.map(${item} => (<Fragment>${transformedContent}</Fragment>)))}`;
    return { end: endIdx, replacement };
  }
  __name(handleFor, "handleFor");
  function handleSwitch(currI, isBare = false) {
    let ptr = currI;
    if (!isBare) ptr = consumeWhitespace(code, currI + 1);
    if (!code.startsWith("switch", ptr)) return null;
    ptr += 6;
    ptr = consumeWhitespace(code, ptr);
    const condRes = extractCondition(code, ptr);
    if (!condRes) return null;
    const cond = condRes.cond;
    ptr = consumeWhitespace(code, condRes.end);
    if (code[ptr] !== "{") return null;
    const block = parseBlock(code, ptr);
    if (!block) return null;
    const rawContent = code.substring(block.start + 1, block.end);
    const transformedInner = transform(rawContent, 0);
    const finalContent = transformedInner.replace(/(case\s+.*?:|default:)([\s\S]*?)(?=case\s+.*?:|default:|$)/g, (m, label, body) => {
      const trimmed = body.trim();
      if (!trimmed) return m;
      if (trimmed.startsWith("return ")) return m;
      return `${label} return (<Fragment>${body}</Fragment>);`;
    });
    let endIdx = block.end + 1;
    if (!isBare) {
      endIdx = consumeWhitespace(code, endIdx);
      if (code[endIdx] !== "}") return null;
      endIdx++;
    }
    const replacement = `{function() { __ROUND_SWITCH_TOKEN__(${cond}) { ${finalContent} } }}`;
    return { end: endIdx, replacement };
  }
  __name(handleSwitch, "handleSwitch");
  let inSingle = false, inDouble = false, inTemplate = false;
  let inCommentLine = false, inCommentMulti = false;
  while (i < code.length) {
    const ch = code[i];
    const next = i < code.length - 1 ? code[i + 1] : "";
    const prev = i > 0 ? code[i - 1] : "";
    if (inCommentLine) {
      result += ch;
      if (ch === "\n" || ch === "\r") inCommentLine = false;
      i++;
      continue;
    }
    if (inCommentMulti) {
      result += ch;
      if (ch === "*" && next === "/") {
        inCommentMulti = false;
        result += "/";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inTemplate) {
      result += ch;
      if (ch === "`" && prev !== "\\") inTemplate = false;
      i++;
      continue;
    }
    if (inSingle) {
      result += ch;
      if (ch === "'" && prev !== "\\") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      result += ch;
      if (ch === '"' && prev !== "\\") inDouble = false;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inCommentLine = true;
      result += "//";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inCommentMulti = true;
      result += "/*";
      i += 2;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      result += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      result += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      result += ch;
      i++;
      continue;
    }
    if (ch === "<") {
      const isTag = /[a-zA-Z0-9_$]/.test(next) || next === ">";
      if (isTag) jsxDepth++;
    }
    if (ch === "<" && next === "/") {
      if (jsxDepth > 0) jsxDepth--;
    }
    if (ch === "/" && next === ">") {
      if (jsxDepth > 0) jsxDepth--;
    }
    if (jsxDepth > 0) {
      let processed = false;
      if (ch === "{") {
        let ptr = consumeWhitespace(code, i + 1);
        if (code.startsWith("if", ptr)) {
          const res = handleIf(i, false);
          if (res) {
            result += res.replacement;
            i = res.end;
            processed = true;
          }
        } else if (code.startsWith("for", ptr)) {
          const res = handleFor(i, false);
          if (res) {
            result += res.replacement;
            i = res.end;
            processed = true;
          }
        } else if (code.startsWith("switch", ptr)) {
          const res = handleSwitch(i, false);
          if (res) {
            result += res.replacement;
            i = res.end;
            processed = true;
          }
        }
      } else if (ch === "i" && code.startsWith("if", i)) {
        let ptr = consumeWhitespace(code, i + 2);
        if (code[ptr] === "(") {
          const res = handleIf(i, true);
          if (res) {
            result += res.replacement;
            i = res.end;
            processed = true;
          }
        }
      } else if (ch === "f" && code.startsWith("for", i)) {
        let ptr = consumeWhitespace(code, i + 3);
        if (code[ptr] === "(") {
          const res = handleFor(i, true);
          if (res) {
            result += res.replacement;
            i = res.end;
            processed = true;
          }
        }
      } else if (ch === "s" && code.startsWith("switch", i)) {
        let ptr = consumeWhitespace(code, i + 6);
        if (code[ptr] === "(") {
          const res = handleSwitch(i, true);
          if (res) {
            result += res.replacement;
            i = res.end;
            processed = true;
          }
        }
      }
      if (processed) continue;
    }
    result += ch;
    i++;
  }
  function findJsxTagEnd(str, startIndex) {
    let inSingle2 = false, inDouble2 = false, inTemplate2 = false;
    let braceDepth = 0;
    for (let k = startIndex; k < str.length; k++) {
      const c = str[k];
      const p = k > 0 ? str[k - 1] : "";
      if (!inDouble2 && !inTemplate2 && c === "'" && p !== "\\") inSingle2 = !inSingle2;
      else if (!inSingle2 && !inTemplate2 && c === '"' && p !== "\\") inDouble2 = !inDouble2;
      else if (!inSingle2 && !inDouble2 && c === "`" && p !== "\\") inTemplate2 = !inTemplate2;
      if (inSingle2 || inDouble2 || inTemplate2) continue;
      if (c === "{") braceDepth++;
      else if (c === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (c === ">" && braceDepth === 0) return k;
    }
    return -1;
  }
  __name(findJsxTagEnd, "findJsxTagEnd");
  function transformSuspenseBlocks(str) {
    let out = str;
    let cursor = 0;
    while (true) {
      const openIndex = out.indexOf("<Suspense", cursor);
      if (openIndex === -1) break;
      const openEnd = findJsxTagEnd(out, openIndex);
      if (openEnd === -1) break;
      const openTagText = out.slice(openIndex, openEnd + 1);
      if (/\/>\s*$/.test(openTagText)) {
        cursor = openEnd + 1;
        continue;
      }
      let depth = 1, k = openEnd + 1, closeStart = -1;
      while (k < out.length) {
        if (out.slice(k).startsWith("<Suspense")) {
          depth++;
          k += 9;
        } else if (out.slice(k).startsWith("</Suspense>")) {
          depth--;
          if (depth === 0) {
            closeStart = k;
            break;
          }
          k += 11;
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
  __name(transformSuspenseBlocks, "transformSuspenseBlocks");
  function transformProviderBlocks(str) {
    let out = str;
    let cursor = 0;
    while (true) {
      const dot = out.indexOf(".Provider", cursor);
      if (dot === -1) break;
      const lt = out.lastIndexOf("<", dot);
      if (lt === -1) break;
      const openEnd = findJsxTagEnd(out, lt);
      if (openEnd === -1) break;
      const tagText = out.slice(lt, openEnd + 1);
      if (/\/>\s*$/.test(tagText)) {
        cursor = openEnd + 1;
        continue;
      }
      const m = tagText.match(/^<\s*([A-Za-z_$][\w$]*\.Provider)\b/);
      if (!m) {
        cursor = openEnd + 1;
        continue;
      }
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
          k = innerEnd + 1;
          continue;
        }
        depth--;
        if (depth === 0) {
          closeStart = nClose;
          break;
        }
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
  __name(transformProviderBlocks, "transformProviderBlocks");
  result = transformSuspenseBlocks(result);
  result = transformProviderBlocks(result);
  result = result.replace(/\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, "{() => $1()}").replace(/=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, "={() => $1()}");
  return result.replace(/__ROUND_SWITCH_TOKEN__/g, "switch");
}
__name(transform, "transform");
function normalizePath(p) {
  return p.replaceAll("\\", "/");
}
__name(normalizePath, "normalizePath");
function isMdRawRequest(id) {
  return typeof id === "string" && id.includes(".md") && id.includes("?raw");
}
__name(isMdRawRequest, "isMdRawRequest");
function stripQuery(id) {
  return id.split("?")[0];
}
__name(stripQuery, "stripQuery");
function escapeForJsString(s) {
  return String(s).replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}
__name(escapeForJsString, "escapeForJsString");
function resolveMaybeRelative(baseDir, p) {
  if (!p) return null;
  if (path.isAbsolute(p)) return p;
  return path.resolve(baseDir, p);
}
__name(resolveMaybeRelative, "resolveMaybeRelative");
function inlineMarkdownInRound(code, fileAbs, addWatchFile) {
  if (typeof code !== "string" || typeof fileAbs !== "string") return code;
  const dir = path.dirname(fileAbs);
  const re = /<Markdown\b([^>]*?)\bsrc\s*=\s*("([^"]+)"|'([^']+)')([^>]*)\/>/g;
  return code.replace(re, (full, beforeAttrs, _q, dbl, sgl, afterAttrs) => {
    const src = dbl ?? sgl;
    if (!src || typeof src !== "string") return full;
    if (!src.startsWith("./") && !src.startsWith("../")) return full;
    const mdAbs = path.resolve(dir, src);
    try {
      const raw = fs.readFileSync(mdAbs, "utf8");
      if (typeof addWatchFile === "function") {
        try {
          addWatchFile(mdAbs);
        } catch {
        }
      }
      const content = escapeForJsString(raw);
      const rebuilt = `<Markdown${beforeAttrs}content={\`${content}\`} ${afterAttrs} />`;
      return rebuilt.replace(/\s+\/>$/, " />");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Markdown file not found: ${src} (resolved: ${mdAbs})
${msg}`);
    }
  });
}
__name(inlineMarkdownInRound, "inlineMarkdownInRound");
function isExcluded(fileAbsPath, excludeAbs) {
  const file = normalizePath(fileAbsPath);
  for (const pat of excludeAbs) {
    const patNorm = normalizePath(pat);
    const prefix = patNorm.endsWith("/**") ? patNorm.slice(0, -3) : patNorm;
    if (file.startsWith(prefix)) return true;
  }
  return false;
}
__name(isExcluded, "isExcluded");
function isIncluded(fileAbsPath, includeAbs) {
  if (!includeAbs.length) return true;
  const file = normalizePath(fileAbsPath);
  for (const pat of includeAbs) {
    const patNorm = normalizePath(pat);
    const prefix = patNorm.endsWith("/**") ? patNorm.slice(0, -3) : patNorm;
    if (file.startsWith(prefix)) return true;
  }
  return false;
}
__name(isIncluded, "isIncluded");
function RoundPlugin(pluginOptions = {}) {
  const state = {
    rootDir: process.cwd(),
    includeAbs: [],
    excludeAbs: [],
    configLoaded: false,
    routingTrailingSlash: true,
    configPathAbs: null,
    configDir: null,
    entryAbs: null,
    entryRel: null,
    name: "Round",
    startHead: null,
    startHeadHtml: null
  };
  let lastRuntimeErrorKey = null;
  let lastRuntimeErrorAt = 0;
  const runtimeImport = pluginOptions.runtimeImport ?? "round-core";
  const restartOnConfigChange = pluginOptions.restartOnConfigChange !== void 0 ? Boolean(pluginOptions.restartOnConfigChange) : true;
  function loadConfigOnce(rootDir) {
    if (state.configLoaded) return;
    state.configLoaded = true;
    const configPath = pluginOptions.configPath ? resolveMaybeRelative(rootDir, pluginOptions.configPath) : resolveMaybeRelative(rootDir, "./round.config.json");
    state.configPathAbs = configPath;
    const configDir = configPath ? path.dirname(configPath) : rootDir;
    state.configDir = configDir;
    let config = null;
    if (configPath && fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        config = JSON.parse(raw);
      } catch {
        config = null;
      }
    }
    const trailingSlash = config?.routing?.trailingSlash;
    state.routingTrailingSlash = trailingSlash !== void 0 ? Boolean(trailingSlash) : true;
    const customTags = config?.htmlTags;
    state.customTags = Array.isArray(customTags) ? customTags : [];
    state.name = config?.name ?? "Round";
    const entryRel = config?.entry;
    state.entryRel = entryRel;
    state.entryAbs = entryRel ? resolveMaybeRelative(configDir, entryRel) : null;
    const include = pluginOptions.include ?? config?.include ?? [];
    const exclude = pluginOptions.exclude ?? config?.exclude ?? ["./node_modules", "./dist"];
    const includeBase = pluginOptions.include ? rootDir : configDir;
    const excludeBase = pluginOptions.exclude ? rootDir : configDir;
    state.includeAbs = Array.isArray(include) ? include.map((p) => resolveMaybeRelative(includeBase, p)).filter(Boolean) : [];
    state.excludeAbs = Array.isArray(exclude) ? exclude.map((p) => resolveMaybeRelative(excludeBase, p)).filter(Boolean) : [];
  }
  __name(loadConfigOnce, "loadConfigOnce");
  function findBlock(str, startIndex) {
    let open = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let start = -1;
    for (let i = startIndex; i < str.length; i++) {
      const ch = str[i];
      const prev = i > 0 ? str[i - 1] : "";
      if (!inDouble && !inTemplate && ch === "'" && prev !== "\\") inSingle = !inSingle;
      else if (!inSingle && !inTemplate && ch === '"' && prev !== "\\") inDouble = !inDouble;
      else if (!inSingle && !inDouble && ch === "`" && prev !== "\\") inTemplate = !inTemplate;
      if (inSingle || inDouble || inTemplate) continue;
      if (ch === "{") {
        if (open === 0) start = i;
        open++;
      } else if (ch === "}") {
        open--;
        if (open === 0 && start !== -1) {
          return { start, end: i };
        }
      }
    }
    return null;
  }
  __name(findBlock, "findBlock");
  function parseStartHeadCallArgument(str, fromIndex) {
    const idx = str.indexOf("startHead", fromIndex);
    if (idx === -1) return null;
    const callIdx = str.indexOf("(", idx);
    if (callIdx === -1) return null;
    let i = callIdx;
    let paren = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    for (; i < str.length; i++) {
      const ch = str[i];
      const prev = i > 0 ? str[i - 1] : "";
      if (!inDouble && !inTemplate && ch === "'" && prev !== "\\") inSingle = !inSingle;
      else if (!inSingle && !inTemplate && ch === '"' && prev !== "\\") inDouble = !inDouble;
      else if (!inSingle && !inDouble && ch === "`" && prev !== "\\") inTemplate = !inTemplate;
      if (inSingle || inDouble || inTemplate) continue;
      if (ch === "(") paren++;
      else if (ch === ")") {
        paren--;
        if (paren === 0) {
          const inner = str.slice(callIdx + 1, i).trim();
          return { arg: inner, start: idx, end: i + 1 };
        }
      }
    }
    return null;
  }
  __name(parseStartHeadCallArgument, "parseStartHeadCallArgument");
  function parseStartHeadInDefaultExport(code) {
    const m = code.match(/export\s+default\s+function\b/);
    const hasAnyCall = /\bstartHead\s*\(/.test(code);
    if (!m || typeof m.index !== "number") return { headExpr: null, hasAny: hasAnyCall };
    const fnStart = m.index;
    const braceIdx = code.indexOf("{", fnStart);
    if (braceIdx === -1) return { headExpr: null, hasAny: hasAnyCall };
    const block = findBlock(code, braceIdx);
    if (!block) return { headExpr: null, hasAny: hasAnyCall };
    const body = code.slice(block.start + 1, block.end);
    const call = parseStartHeadCallArgument(body, 0);
    return { headExpr: call ? call.arg : null, hasAny: hasAnyCall, hasOutside: hasAnyCall && !call };
  }
  __name(parseStartHeadInDefaultExport, "parseStartHeadInDefaultExport");
  function headToHtml(head) {
    if (!head || typeof head !== "object") return "";
    let out = "";
    if (typeof head.title === "string") {
      out += `
    <title>${head.title}</title>`;
    }
    const meta = head.meta;
    const links = head.links;
    const renderAttrs = /* @__PURE__ */ __name((attrs) => {
      if (!attrs || typeof attrs !== "object") return "";
      return Object.entries(attrs).filter(([, v]) => v !== null && v !== void 0).map(([k, v]) => ` ${k}="${String(v).replaceAll('"', "&quot;")}"`).join("");
    }, "renderAttrs");
    if (Array.isArray(meta)) {
      meta.forEach((m) => {
        if (!m) return;
        if (Array.isArray(m) && m.length >= 2) {
          out += `
    <meta name="${String(m[0]).replaceAll('"', "&quot;")}" content="${String(m[1] ?? "").replaceAll('"', "&quot;")}">`;
          return;
        }
        if (typeof m === "object") {
          out += `
    <meta${renderAttrs(m)}>`;
        }
      });
    } else if (meta && typeof meta === "object") {
      Object.entries(meta).forEach(([name, content]) => {
        out += `
    <meta name="${String(name).replaceAll('"', "&quot;")}" content="${String(content ?? "").replaceAll('"', "&quot;")}">`;
      });
    }
    if (Array.isArray(links)) {
      links.forEach((l) => {
        if (!l || typeof l !== "object") return;
        out += `
    <link${renderAttrs(l)}>`;
      });
    }
    if (typeof head.raw === "string" && head.raw.trim()) {
      out += `
${head.raw}`;
    }
    return out;
  }
  __name(headToHtml, "headToHtml");
  return {
    name: "vite-plugin-round",
    enforce: "pre",
    transformIndexHtml(html) {
      if (!state.startHeadHtml) return html;
      if (!html.includes("</head>")) return html;
      let next = html;
      if (state.startHead && typeof state.startHead.title === "string") {
        next = next.replace(/<title>[\s\S]*?<\/title>/i, "");
      }
      return next.replace("</head>", `${state.startHeadHtml}
</head>`);
    },
    config(userConfig, env) {
      const rootDir = path.resolve(process.cwd(), userConfig.root ?? ".");
      state.rootDir = rootDir;
      loadConfigOnce(rootDir);
      return {
        define: {
          __ROUND_ROUTING_TRAILING_SLASH__: JSON.stringify(state.routingTrailingSlash),
          __ROUND_CUSTOM_TAGS__: JSON.stringify(state.customTags ?? [])
        },
        esbuild: {
          include: /\.(round|js|jsx|ts|tsx)$/,
          loader: "jsx",
          jsxFactory: "createElement",
          jsxFragment: "Fragment"
          // NOTE: Inject the runtime import in transform() to avoid
        },
        // Ensure .round files are treated as JS/JSX
        resolve: {
          extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json", ".round"]
        }
      };
    },
    resolveId(id) {
      return null;
    },
    load(id) {
      if (!isMdRawRequest(id)) return;
      const fileAbs = stripQuery(id);
      try {
        const raw = fs.readFileSync(fileAbs, "utf8");
        this.addWatchFile(fileAbs);
        return `export default \`${escapeForJsString(raw)}\`;`;
      } catch {
        this.addWatchFile(fileAbs);
        return "export default ``;";
      }
    },
    configureServer(server) {
      loadConfigOnce(server.config.root ?? process.cwd());
      if (state.configPathAbs) {
        server.watcher.add(state.configPathAbs);
      }
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const [urlPath] = req.url.split("?");
        if (urlPath && urlPath.endsWith(".md")) {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
        }
        next();
      });
      server.ws.on("round:runtime-error", (payload = {}) => {
        try {
          const message = typeof payload.message === "string" ? payload.message : "Runtime error";
          const phase = typeof payload.phase === "string" && payload.phase ? ` (${payload.phase})` : "";
          const component = typeof payload.component === "string" && payload.component ? ` in ${payload.component}` : "";
          const header = `[round] Runtime error${component}${phase}: ${message}`;
          const stack = payload.stack ? String(payload.stack) : "";
          const key = `${header}
${stack}`;
          const now = Date.now();
          if (lastRuntimeErrorKey === key && now - lastRuntimeErrorAt < 2e3) return;
          lastRuntimeErrorKey = key;
          lastRuntimeErrorAt = now;
          server.config.logger.error(header);
          if (stack) server.config.logger.error(stack);
        } catch {
          server.config.logger.error("[round] Runtime error");
        }
      });
    },
    handleHotUpdate(ctx) {
      if (state.configPathAbs && ctx.file === state.configPathAbs) {
        if (!restartOnConfigChange) return [];
        try {
          if (typeof ctx.server.restart === "function") {
            ctx.server.restart();
          } else {
            ctx.server.ws.send({ type: "full-reload" });
          }
        } catch {
          ctx.server.ws.send({ type: "full-reload" });
        }
        return [];
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const [urlPath] = req.url.split("?");
        if (urlPath && urlPath.endsWith(".md")) {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
        }
        next();
      });
    },
    transform(code, id) {
      if (id.endsWith(".round")) {
        const fileAbs = path.isAbsolute(id) ? id : path.resolve(state.rootDir, id);
        if (!isIncluded(fileAbs, state.includeAbs)) return;
        if (isExcluded(fileAbs, state.excludeAbs)) return;
        const isEntry = state.entryAbs && normalizePath(fileAbs) === normalizePath(state.entryAbs);
        const parsedHead = parseStartHeadInDefaultExport(code);
        if (parsedHead.hasAny && !isEntry) {
          this.error(new Error(`startHead() can only be used in the entry module's export default function: ${state.entryAbs ?? "(unknown entry)"}
Found in: ${fileAbs}`));
        }
        if (isEntry && parsedHead.hasOutside) {
          this.error(new Error(`startHead() must be called inside the entry module's export default function body (not at top-level).
Entry: ${fileAbs}`));
        }
        if (isEntry && parsedHead.headExpr) {
          const trimmed = parsedHead.headExpr.trim();
          if (!trimmed.startsWith("{")) {
            this.error(new Error(`startHead(...) expects an object literal. Example: startHead({ title: 'Home' })
Found: ${trimmed.slice(0, 60)}...`));
          }
          if (/\bfunction\b|=>|\bimport\b|\brequire\b|\bprocess\b|\bglobal\b/.test(trimmed)) {
            this.error(new Error("startHead object must be static data (no functions/imports)."));
          }
          let headObj = null;
          try {
            headObj = Function(`"use strict"; return (${trimmed});`)();
          } catch (e) {
            this.error(new Error(`Failed to parse startHead(...) object in ${fileAbs}: ${String(e?.message ?? e)}`));
          }
          state.startHead = headObj;
          state.startHeadHtml = headToHtml(headObj);
        }
        let nextCode = code;
        try {
          nextCode = inlineMarkdownInRound(nextCode, fileAbs, (p) => this.addWatchFile(p));
        } catch (e) {
          this.error(e);
        }
        let transformedCode = transform(nextCode);
        if (!/^\s*import\s+\{\s*createElement\s*,\s*Fragment\s*\}\s+from\s+['"][^'"]+['"];?/m.test(transformedCode)) {
          transformedCode = `import { createElement, Fragment } from '${runtimeImport}';
` + transformedCode;
        }
        return {
          code: transformedCode,
          map: null
        };
      }
    }
  };
}
__name(RoundPlugin, "RoundPlugin");
export {
  RoundPlugin as default
};
