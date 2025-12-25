import { transform } from './transformer.js';
import fs from 'node:fs';
import path from 'node:path';

function normalizePath(p) {
    return p.replaceAll('\\', '/');
}

function isMdRawRequest(id) {
    return typeof id === 'string' && id.includes('.md') && id.includes('?raw');
}

function stripQuery(id) {
    return id.split('?')[0];
}

function escapeForJsString(s) {
    return String(s)
        .replaceAll('\\', '\\\\')
        .replaceAll('`', '\\`')
        .replaceAll('${', '\\${');
}

function resolveMaybeRelative(baseDir, p) {
    if (!p) return null;
    if (path.isAbsolute(p)) return p;
    return path.resolve(baseDir, p);
}

function inlineMarkdownInRound(code, fileAbs, addWatchFile) {
    if (typeof code !== 'string' || typeof fileAbs !== 'string') return code;

    // Only handle simple self-closing tags with literal src: <Markdown src="./x.md" ... />
    // This runs before the .round transformer, so it's safe string-level rewriting.
    const dir = path.dirname(fileAbs);

    // Match src="..." or src='...'
    const re = /<Markdown\b([^>]*?)\bsrc\s*=\s*("([^"]+)"|'([^']+)')([^>]*)\/>/g;
    return code.replace(re, (full, beforeAttrs, _q, dbl, sgl, afterAttrs) => {
        const src = dbl ?? sgl;
        if (!src || typeof src !== 'string') return full;

        // Only inline relative paths; absolute/public URLs should remain runtime-resolved.
        if (!src.startsWith('./') && !src.startsWith('../')) return full;

        const mdAbs = path.resolve(dir, src);
        try {
            const raw = fs.readFileSync(mdAbs, 'utf8');
            if (typeof addWatchFile === 'function') {
                try { addWatchFile(mdAbs); } catch { }
            }

            const content = escapeForJsString(raw);

            // Remove the src=... portion and inject content={...}
            const rebuilt = `<Markdown${beforeAttrs}content={\`${content}\`} ${afterAttrs} />`;
            return rebuilt.replace(/\s+\/>$/, ' />');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Markdown file not found: ${src} (resolved: ${mdAbs})\n${msg}`);
        }
    });
}

function isExcluded(fileAbsPath, excludeAbs) {
    const file = normalizePath(fileAbsPath);
    for (const pat of excludeAbs) {
        const patNorm = normalizePath(pat);
        const prefix = patNorm.endsWith('/**') ? patNorm.slice(0, -3) : patNorm;
        if (file.startsWith(prefix)) return true;
    }
    return false;
}

function isIncluded(fileAbsPath, includeAbs) {
    if (!includeAbs.length) return true;
    const file = normalizePath(fileAbsPath);
    for (const pat of includeAbs) {
        const patNorm = normalizePath(pat);
        const prefix = patNorm.endsWith('/**') ? patNorm.slice(0, -3) : patNorm;
        if (file.startsWith(prefix)) return true;
    }
    return false;
}

export default function RoundPlugin(pluginOptions = {}) {
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
        name: 'Round',
        startHead: null,
        startHeadHtml: null
    };

    let lastRuntimeErrorKey = null;
    let lastRuntimeErrorAt = 0;

    const runtimeImport = pluginOptions.runtimeImport ?? 'round-core';
    const restartOnConfigChange = pluginOptions.restartOnConfigChange !== undefined
        ? Boolean(pluginOptions.restartOnConfigChange)
        : true;

    function loadConfigOnce(rootDir) {
        if (state.configLoaded) return;
        state.configLoaded = true;

        const configPath = pluginOptions.configPath
            ? resolveMaybeRelative(rootDir, pluginOptions.configPath)
            : resolveMaybeRelative(rootDir, './round.config.json');

        state.configPathAbs = configPath;

        const configDir = configPath ? path.dirname(configPath) : rootDir;
        state.configDir = configDir;

        let config = null;
        if (configPath && fs.existsSync(configPath)) {
            try {
                const raw = fs.readFileSync(configPath, 'utf8');
                config = JSON.parse(raw);
            } catch {
                config = null;
            }
        }

        const trailingSlash = config?.routing?.trailingSlash;
        state.routingTrailingSlash = trailingSlash !== undefined ? Boolean(trailingSlash) : true;

        const customTags = config?.htmlTags;
        state.customTags = Array.isArray(customTags) ? customTags : [];

        state.name = config?.name ?? 'Round';

        const entryRel = config?.entry;
        state.entryRel = entryRel;
        state.entryAbs = entryRel ? resolveMaybeRelative(configDir, entryRel) : null;

        const include = pluginOptions.include ?? config?.include ?? [];
        const exclude = pluginOptions.exclude ?? config?.exclude ?? ['./node_modules', './dist'];

        const includeBase = pluginOptions.include ? rootDir : configDir;
        const excludeBase = pluginOptions.exclude ? rootDir : configDir;

        state.includeAbs = Array.isArray(include) ? include.map(p => resolveMaybeRelative(includeBase, p)).filter(Boolean) : [];
        state.excludeAbs = Array.isArray(exclude) ? exclude.map(p => resolveMaybeRelative(excludeBase, p)).filter(Boolean) : [];
    }

    function findBlock(str, startIndex) {
        let open = 0;
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;

        let start = -1;
        for (let i = startIndex; i < str.length; i++) {
            const ch = str[i];
            const prev = i > 0 ? str[i - 1] : '';

            if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') inSingle = !inSingle;
            else if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') inDouble = !inDouble;
            else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') inTemplate = !inTemplate;

            if (inSingle || inDouble || inTemplate) continue;

            if (ch === '{') {
                if (open === 0) start = i;
                open++;
            } else if (ch === '}') {
                open--;
                if (open === 0 && start !== -1) {
                    return { start, end: i };
                }
            }
        }
        return null;
    }

    function parseStartHeadCallArgument(str, fromIndex) {
        const idx = str.indexOf('startHead', fromIndex);
        if (idx === -1) return null;

        const callIdx = str.indexOf('(', idx);
        if (callIdx === -1) return null;

        let i = callIdx;
        let paren = 0;
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;

        for (; i < str.length; i++) {
            const ch = str[i];
            const prev = i > 0 ? str[i - 1] : '';

            if (!inDouble && !inTemplate && ch === '\'' && prev !== '\\') inSingle = !inSingle;
            else if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') inDouble = !inDouble;
            else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') inTemplate = !inTemplate;

            if (inSingle || inDouble || inTemplate) continue;

            if (ch === '(') paren++;
            else if (ch === ')') {
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
        // Find `export default function ... { ... }`
        const m = code.match(/export\s+default\s+function\b/);
        const hasAnyCall = /\bstartHead\s*\(/.test(code);
        if (!m || typeof m.index !== 'number') return { headExpr: null, hasAny: hasAnyCall };

        const fnStart = m.index;
        const braceIdx = code.indexOf('{', fnStart);
        if (braceIdx === -1) return { headExpr: null, hasAny: hasAnyCall };

        const block = findBlock(code, braceIdx);
        if (!block) return { headExpr: null, hasAny: hasAnyCall };

        const body = code.slice(block.start + 1, block.end);
        const call = parseStartHeadCallArgument(body, 0);
        return { headExpr: call ? call.arg : null, hasAny: hasAnyCall, hasOutside: hasAnyCall && !call };
    }

    function headToHtml(head) {
        if (!head || typeof head !== 'object') return '';

        let out = '';
        if (typeof head.title === 'string') {
            out += `\n    <title>${head.title}</title>`;
        }

        const meta = head.meta;
        const links = head.links;

        const renderAttrs = (attrs) => {
            if (!attrs || typeof attrs !== 'object') return '';
            return Object.entries(attrs)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => ` ${k}="${String(v).replaceAll('"', '&quot;')}"`)
                .join('');
        };

        if (Array.isArray(meta)) {
            meta.forEach((m) => {
                if (!m) return;
                if (Array.isArray(m) && m.length >= 2) {
                    out += `\n    <meta name="${String(m[0]).replaceAll('"', '&quot;')}" content="${String(m[1] ?? '').replaceAll('"', '&quot;')}">`;
                    return;
                }
                if (typeof m === 'object') {
                    out += `\n    <meta${renderAttrs(m)}>`;
                }
            });
        } else if (meta && typeof meta === 'object') {
            Object.entries(meta).forEach(([name, content]) => {
                out += `\n    <meta name="${String(name).replaceAll('"', '&quot;')}" content="${String(content ?? '').replaceAll('"', '&quot;')}">`;
            });
        }

        if (Array.isArray(links)) {
            links.forEach((l) => {
                if (!l || typeof l !== 'object') return;
                out += `\n    <link${renderAttrs(l)}>`;
            });
        }

        // allow raw html injection (advanced escape hatch)
        if (typeof head.raw === 'string' && head.raw.trim()) {
            out += `\n${head.raw}`;
        }

        return out;
    }

    return {
        name: 'vite-plugin-round',
        enforce: 'pre',

        transformIndexHtml(html) {
            if (!state.startHeadHtml) return html;
            if (!html.includes('</head>')) return html;

            // Remove existing <title> to avoid duplicates if we set it.
            let next = html;
            if (state.startHead && typeof state.startHead.title === 'string') {
                next = next.replace(/<title>[\s\S]*?<\/title>/i, '');
            }

            return next.replace('</head>', `${state.startHeadHtml}\n</head>`);
        },

        config(userConfig, env) {
            const rootDir = path.resolve(process.cwd(), userConfig.root ?? '.');
            state.rootDir = rootDir;
            loadConfigOnce(rootDir);

            return {
                define: {
                    __ROUND_ROUTING_TRAILING_SLASH__: JSON.stringify(state.routingTrailingSlash),
                    __ROUND_CUSTOM_TAGS__: JSON.stringify(state.customTags ?? [])
                },
                esbuild: {
                    include: /\.(round|js|jsx|ts|tsx)$/,
                    loader: 'jsx',
                    jsxFactory: 'createElement',
                    jsxFragment: 'Fragment'
                    // NOTE: Inject the runtime import in transform() to avoid
                },
                // Ensure .round files are treated as JS/JSX
                resolve: {
                    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.round']
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
                const raw = fs.readFileSync(fileAbs, 'utf8');
                this.addWatchFile(fileAbs);
                return `export default \`${escapeForJsString(raw)}\`;`;
            } catch {
                this.addWatchFile(fileAbs);
                return 'export default ``;';
            }
        },

        configureServer(server) {
            loadConfigOnce(server.config.root ?? process.cwd());

            if (state.configPathAbs) {
                server.watcher.add(state.configPathAbs);
            }

            server.middlewares.use((req, res, next) => {
                if (!req.url) return next();
                const [urlPath] = req.url.split('?');
                if (urlPath && urlPath.endsWith('.md')) {
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                }
                next();
            });

            server.ws.on('round:runtime-error', (payload = {}) => {
                try {
                    const message = typeof payload.message === 'string' ? payload.message : 'Runtime error';
                    const phase = typeof payload.phase === 'string' && payload.phase ? ` (${payload.phase})` : '';
                    const component = typeof payload.component === 'string' && payload.component ? ` in ${payload.component}` : '';
                    const header = `[round] Runtime error${component}${phase}: ${message}`;

                    const stack = payload.stack ? String(payload.stack) : '';
                    const key = `${header}\n${stack}`;
                    const now = Date.now();
                    if (lastRuntimeErrorKey === key && (now - lastRuntimeErrorAt) < 2000) return;
                    lastRuntimeErrorKey = key;
                    lastRuntimeErrorAt = now;

                    server.config.logger.error(header);
                    if (stack) server.config.logger.error(stack);
                } catch {
                    server.config.logger.error('[round] Runtime error');
                }
            });
        },

        handleHotUpdate(ctx) {
            if (state.configPathAbs && ctx.file === state.configPathAbs) {
                if (!restartOnConfigChange) return [];
                try {
                    if (typeof ctx.server.restart === 'function') {
                        ctx.server.restart();
                    } else {
                        ctx.server.ws.send({ type: 'full-reload' });
                    }
                } catch {
                    ctx.server.ws.send({ type: 'full-reload' });
                }
                return [];
            }
        },

        configurePreviewServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!req.url) return next();
                const [urlPath] = req.url.split('?');
                if (urlPath && urlPath.endsWith('.md')) {
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                }
                next();
            });
        },

        transform(code, id) {
            if (id.endsWith('.round')) {
                const fileAbs = path.isAbsolute(id) ? id : path.resolve(state.rootDir, id);
                if (!isIncluded(fileAbs, state.includeAbs)) return;
                if (isExcluded(fileAbs, state.excludeAbs)) return;

                const isEntry = state.entryAbs && normalizePath(fileAbs) === normalizePath(state.entryAbs);
                const parsedHead = parseStartHeadInDefaultExport(code);

                if (parsedHead.hasAny && !isEntry) {
                    this.error(new Error(`startHead() can only be used in the entry module's export default function: ${state.entryAbs ?? '(unknown entry)'}\nFound in: ${fileAbs}`));
                }

                if (isEntry && parsedHead.hasOutside) {
                    this.error(new Error(`startHead() must be called inside the entry module's export default function body (not at top-level).\nEntry: ${fileAbs}`));
                }

                if (isEntry && parsedHead.headExpr) {
                    const trimmed = parsedHead.headExpr.trim();
                    if (!trimmed.startsWith('{')) {
                        this.error(new Error(`startHead(...) expects an object literal. Example: startHead({ title: 'Home' })\nFound: ${trimmed.slice(0, 60)}...`));
                    }

                    if (/\bfunction\b|=>|\bimport\b|\brequire\b|\bprocess\b|\bglobal\b/.test(trimmed)) {
                        this.error(new Error('startHead object must be static data (no functions/imports).'));
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
                    // Fail fast in build and show the file that triggered the problem.
                    this.error(e);
                }

                let transformedCode = transform(nextCode);

                if (!/^\s*import\s+\{\s*createElement\s*,\s*Fragment\s*,\s*ForKeyed\s*\}\s+from\s+['"][^'"]+['"];?/m.test(transformedCode)) {
                    transformedCode = `import { createElement, Fragment, ForKeyed } from '${runtimeImport}';\n` + transformedCode;
                }

                return {
                    code: transformedCode,
                    map: null
                };
            }
        }
    };
}
