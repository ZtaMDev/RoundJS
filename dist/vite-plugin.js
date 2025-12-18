import fs from "node:fs";
import path from "node:path";
function transform(code) {
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
      const prev2 = i > 0 ? str[i - 1] : "";
      const next = i < str.length - 1 ? str[i + 1] : "";
      if (inCommentLine) {
        if (ch === "\n" || ch === "\r") inCommentLine = false;
        continue;
      }
      if (inCommentMulti) {
        if (ch === "*" && next === "/") {
          inCommentMulti = false;
          i++;
        }
        continue;
      }
      if (inTemplate) {
        if (ch === "`" && prev2 !== "\\") inTemplate = false;
        continue;
      }
      if (inSingle) {
        if (ch === "'" && prev2 !== "\\") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '"' && prev2 !== "\\") inDouble = false;
        continue;
      }
      if (ch === "/" && next === "/") {
        inCommentLine = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inCommentMulti = true;
        i++;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "{") {
        if (open === 0) startBlockIndex = i;
        open++;
      } else if (ch === "}") {
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
      const trimmedCond = String(cond).trim();
      const isSimplePath = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(trimmedCond);
      if (isSimplePath && !trimmedCond.endsWith(")")) {
        cond = `((typeof (${trimmedCond}) === 'function' && typeof (${trimmedCond}).peek === 'function' && ('value' in (${trimmedCond}))) ? (${trimmedCond})() : (${trimmedCond}))`;
      }
      const blockStart = i + mm[0].length - 1;
      const block = parseBlock(str, blockStart);
      if (!block) return null;
      const content = str.substring(block.start + 1, block.end);
      cases.push({ cond, content });
      i = block.end + 1;
      i = consumeWhitespace(str, i);
      if (!str.startsWith("else", i)) {
        break;
      }
      i += 4;
      i = consumeWhitespace(str, i);
      if (str.startsWith("if", i)) {
        continue;
      }
      if (str[i] !== "{") return null;
      const elseBlock = parseBlock(str, i);
      if (!elseBlock) return null;
      elseContent = str.substring(elseBlock.start + 1, elseBlock.end);
      i = elseBlock.end + 1;
      break;
    }
    const end = i;
    let expr = "";
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
      expr += "null";
    }
    const replacement = `(() => ${expr})`;
    return { start: ifIndex, end, replacement };
  }
  function parseIfStatement(str, ifIndex) {
    if (!str.startsWith("if", ifIndex)) return null;
    const chain = parseIfChain(str, ifIndex);
    if (!chain) return null;
    return {
      start: chain.start,
      end: chain.end,
      replacement: `{${chain.replacement}}`
    };
  }
  function parseIfExpression(str, exprStart) {
    if (str[exprStart] !== "{") return null;
    let i = consumeWhitespace(str, exprStart + 1);
    if (!str.startsWith("if", i)) return null;
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
        console.warn("Unbalanced IF expression found, skipping transformation.");
        break;
      }
      const before = result.substring(0, parsed.start);
      const after = result.substring(parsed.end);
      result = before + parsed.replacement + after;
    }
    while (true) {
      const match = result.match(/(^|[\n\r])\s*if\s*\(/m);
      if (!match) break;
      const ifIndex = match.index + match[0].lastIndexOf("if");
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
      const exprStart = match.index + match[0].lastIndexOf("for");
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
      const prevCh = i > 0 ? str[i - 1] : "";
      if (!inDouble && !inTemplate && ch === "'" && prevCh !== "\\") inSingle = !inSingle;
      else if (!inSingle && !inTemplate && ch === '"' && prevCh !== "\\") inDouble = !inDouble;
      else if (!inSingle && !inDouble && ch === "`" && prevCh !== "\\") inTemplate = !inTemplate;
      if (inSingle || inDouble || inTemplate) continue;
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === ">" && braceDepth === 0) return i;
    }
    return -1;
  }
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
      let depth = 1;
      let i = openEnd + 1;
      let closeStart = -1;
      while (i < out.length) {
        const nextOpen = out.indexOf("<Suspense", i);
        const nextClose = out.indexOf("</Suspense>", i);
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
        i = nextClose + "</Suspense>".length;
      }
      if (closeStart === -1) break;
      const inner = out.slice(openEnd + 1, closeStart);
      const innerTrim = inner.trim();
      if (innerTrim.startsWith("{() =>")) {
        cursor = closeStart + "</Suspense>".length;
        continue;
      }
      const wrapped = `{() => (<Fragment>${inner}</Fragment>)}`;
      out = out.slice(0, openEnd + 1) + wrapped + out.slice(closeStart);
      cursor = closeStart + wrapped.length + "</Suspense>".length;
    }
    return out;
  }
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
      if (innerTrim.startsWith("{() =>")) {
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
  result = result.replace(/\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, "{() => $1()}").replace(/=\{\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/g, "={() => $1()}");
  return result;
}
function normalizePath(p) {
  return p.replaceAll("\\", "/");
}
function isMdRawRequest(id) {
  return typeof id === "string" && id.includes(".md") && id.includes("?raw");
}
function stripQuery(id) {
  return id.split("?")[0];
}
function escapeForJsString(s) {
  return String(s).replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}
function resolveMaybeRelative(baseDir, p) {
  if (!p) return null;
  if (path.isAbsolute(p)) return p;
  return path.resolve(baseDir, p);
}
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
function isExcluded(fileAbsPath, excludeAbs) {
  const file = normalizePath(fileAbsPath);
  for (const pat of excludeAbs) {
    const patNorm = normalizePath(pat);
    const prefix = patNorm.endsWith("/**") ? patNorm.slice(0, -3) : patNorm;
    if (file.startsWith(prefix)) return true;
  }
  return false;
}
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
  function headToHtml(head) {
    if (!head || typeof head !== "object") return "";
    let out = "";
    if (typeof head.title === "string") {
      out += `
    <title>${head.title}</title>`;
    }
    const meta = head.meta;
    const links = head.links;
    const renderAttrs = (attrs) => {
      if (!attrs || typeof attrs !== "object") return "";
      return Object.entries(attrs).filter(([, v]) => v !== null && v !== void 0).map(([k, v]) => ` ${k}="${String(v).replaceAll('"', "&quot;")}"`).join("");
    };
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
export {
  RoundPlugin as default
};
