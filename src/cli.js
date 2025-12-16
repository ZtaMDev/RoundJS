#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer, build as viteBuild, preview as vitePreview } from 'vite';
import RoundPlugin from './compiler/vite-plugin.js';

function normalizePath(p) {
    return p.replaceAll('\\', '/');
}

const colors = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

function c(text, color) {
    return `${colors[color] ?? ''}${text}${colors.reset}`;
}

class CliError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'CliError';
        this.code = Number.isFinite(Number(options.code)) ? Number(options.code) : 1;
        this.showHelp = Boolean(options.showHelp);
    }
}

function printError(message) {
    const msg = String(message ?? '').trimEnd();
    if (!msg) return;
    process.stderr.write(`${c('Error:', 'red')} ${msg}\n`);
}

function getRoundVersion() {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const pkgPath = path.resolve(here, '..', 'package.json');
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const json = JSON.parse(raw);
        return typeof json?.version === 'string' ? json.version : null;
    } catch {
        return null;
    }
}

function banner(title) {
    const v = getRoundVersion();
    const name = c('ROUND', 'cyan');
    const version = v ? c(`v${v}`, 'gray') : '';
    process.stdout.write(`\n  ${name} ${version}`.trimEnd() + `\n`);
    process.stdout.write(`\n`);
}

function createViteLogger() {
    let hasError = false;
    const noop = () => { };
    return {
        hasErrorLogged: () => hasError,
        info(msg) {
            const s = String(msg ?? '');
            if (!s) return;
            if (s.includes('hmr update') || s.includes('page reload') || s.includes('hot updated') || s.includes('modules transformed')) {
                process.stdout.write(`${c('[round]', 'cyan')} ${s.replace(/^\[vite\]\s*/i, '')}\n`);
            }
        },
        warn(msg) {
            process.stderr.write(String(msg) + '\n');
        },
        warnOnce(msg) {
            process.stderr.write(String(msg) + '\n');
        },
        clearScreen: noop,
        error(msg) {
            hasError = true;
            const s = String(msg ?? '');
            if (s.startsWith('[round] Runtime error')) {
                process.stderr.write(`${c(s, 'red')}\n`);
                return;
            }
            if (/^\s*at\s+/.test(s) || s.includes('http://localhost:')) {
                process.stderr.write(`${c(s, 'gray')}\n`);
                return;
            }
            process.stderr.write(s + '\n');
        }
    };
}

function printUrls(resolvedUrls, base = '/', ms = null) {
    const local = resolvedUrls?.local?.[0];
    const network = resolvedUrls?.network?.[0];
    const label = c('ROUND', 'cyan');
    const ready = c('ready', 'green');
    const inMs = (typeof ms === 'number') ? `${c('in', 'gray')} ${c(`${ms} ms`, 'gray')}` : '';
    process.stdout.write(`  ${label} ${ready}${inMs ? ' ' + inMs : ''}\n\n`);
    if (local) process.stdout.write(`  ${c('➜', 'green')}  ${c('Local:', 'green')}   ${local}\n`);
    if (network) process.stdout.write(`  ${c('➜', 'green')}  ${c('Network:', 'green')} ${network}\n`);
    process.stdout.write(`\n`);
}

function resolveFrom(baseDir, p) {
    if (!p) return null;
    if (path.isAbsolute(p)) return p;
    return path.resolve(baseDir, p);
}

function ensureIndexHtml(rootDir, entryRel, title = 'Round') {
    const indexPath = path.join(rootDir, 'index.html');
    if (fs.existsSync(indexPath)) return;

    const entryPath = entryRel.startsWith('/') ? entryRel : `/${entryRel}`;
    fs.writeFileSync(indexPath, [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `    <title>${title}</title>`,
        '</head>',
        '<body>',
        '    <div id="app"></div>',
        '    <script type="module">',
        "        import { render } from 'round-core';",
        `        import App from '${entryPath}';`,
        '',
        '        render(App, document.getElementById("app"));',
        '    </script>',
        '</body>',
        '</html>',
        ''
    ].join('\n'), 'utf8');
}

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a) continue;
        if (a === '--help' || a === '-h') {
            args.help = true;
            continue;
        }
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq !== -1) {
                const k = a.slice(2, eq);
                const v = a.slice(eq + 1);
                args[k] = v;
            } else {
                const k = a.slice(2);
                const next = argv[i + 1];
                if (next && !next.startsWith('-')) {
                    args[k] = next;
                    i++;
                } else {
                    args[k] = true;
                }
            }
            continue;
        }
        args._.push(a);
    }
    return args;
}

function printHelp() {
    const header = `${c('round', 'cyan')} ${c('(CLI)', 'gray')}`;
    process.stdout.write(
        [
            header,
            '',
            c('Usage', 'bold') + ':',
            `  ${c('round', 'cyan')} dev ${c('[--config <path>] [--root <path>]', 'gray')}`,
            `  ${c('round', 'cyan')} build ${c('[--config <path>] [--root <path>]', 'gray')}`,
            `  ${c('round', 'cyan')} preview ${c('[--config <path>] [--root <path>]', 'gray')}`,
            `  ${c('round', 'cyan')} init ${c('<name>', 'yellow')}`,
            '',
            c('Options', 'bold') + ':',
            `  ${c('--config', 'yellow')}   ${c('Path to round.config.json', 'gray')} ${c('(default: ./round.config.json)', 'gray')}`,
            `  ${c('--root', 'yellow')}     ${c('Project root', 'gray')} ${c('(default: process.cwd())', 'gray')}`,
            `  ${c('-h, --help', 'yellow')} ${c('Show this help', 'gray')}`,
            ''
        ].join('\n')
    );
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfMissing(filePath, content) {
    if (fs.existsSync(filePath)) {
        throw new Error(`File already exists: ${filePath}`);
    }
    fs.writeFileSync(filePath, content, 'utf8');
}

async function runInit({ name }) {
    if (!name || typeof name !== 'string') {
        throw new CliError(
            `Missing project name.\n\nUsage:\n  round init <name>`,
            { code: 1 }
        );
    }

    const mode = 'spa';

    const projectDir = path.resolve(process.cwd(), name);
    const srcDir = path.join(projectDir, 'src');

    ensureDir(srcDir);

    const pkgPath = path.join(projectDir, 'package.json');
    const configPath = path.join(projectDir, 'round.config.json');
    const viteConfigPath = path.join(projectDir, 'vite.config.js');
    const indexHtmlPath = path.join(projectDir, 'index.html');
    const appRoundPath = path.join(srcDir, 'app.round');
    const counterRoundPath = path.join(srcDir, 'counter.round');

    writeFileIfMissing(pkgPath, JSON.stringify({
        name,
        private: true,
        version: '0.0.1',
        type: 'module',
        scripts: {
            dev: 'round dev',
            build: 'round build',
            preview: 'round preview'
        },
        dependencies: {
            'round-core': '^0.0.1'
        },
        devDependencies: {
            vite: '^5.0.0'
        }
    }, null, 4) + '\n');

    writeFileIfMissing(configPath, JSON.stringify({
        mode,
        entry: './src/app.round',
        public: './public',
        output: './dist',
        include: ['./src'],
        exclude: ['./node_modules', './dist'],
        dev: {
            port: 5173,
            open: false,
            hmr: true
        },
        build: {
            minify: true,
            sourcemap: false,
            target: 'es2020',
            splitting: true
        },
        routing: {
            base: '/',
            trailingSlash: true
        }
    }, null, 4) + '\n');

    writeFileIfMissing(viteConfigPath, [
        "import { defineConfig } from 'vite';",
        "import RoundPlugin from 'round-core/src/compiler/vite-plugin.js';",
        '',
        'export default defineConfig({',
        "    plugins: [RoundPlugin({ configPath: './round.config.json' })],",
        '    server: {',
        '        port: 5173',
        '    }',
        '});',
        ''
    ].join('\n'));

    writeFileIfMissing(indexHtmlPath, [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `    <title>${name}</title>`,
        '</head>',
        '<body>',
        '    <div id="app"></div>',
        '    <script type="module">',
        "        import { render } from 'round-core';",
        "        import App from '/src/app.round';",
        '',
        "        render(App, document.getElementById('app'));",
        '    </script>',
        '</body>',
        '</html>',
        ''
    ].join('\n'));

    writeFileIfMissing(appRoundPath, [
        "import { Route } from 'round-core';",
        'import { Counter } from "./counter"',
        '',
        'export default function App() {',
        '    return (',
        '        <div style={{display: "flex", flexDirection: "column", alignItems: "center"}}>',
        '            <Route route="/" title="Home">',
        '                <Counter />',
        '            </Route>',
        '        </div>',
        '    )',
        '}',
        ''
    ].join('\n'));

    writeFileIfMissing(counterRoundPath, [
        "import { signal } from 'round-core';",
        '',
        'export function Counter() {',
        '    const count = signal(0)',
        '',
        '    return (',
        "        <div style={{ padding: '16px', fontFamily: 'system-ui' }}>",
        "            <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '12px' }}>",
        '                Counter: {count()}',
        '            </h1>',
        '',
        "            <div style={{ display: 'flex', gap: '8px' }}>",
        "                <button onClick={() => count(count() + 1)} style={{ padding: '8px 12px', borderRadius: '8px' }}>",
        '                    Increment',
        '                </button>',
        '',
        "                <button onClick={() => count(count() - 1)} style={{ padding: '8px 12px', borderRadius: '8px' }}>",
        '                    Decrement',
        '                </button>',
        '',
        "                <button onClick={() => count(0)} style={{ padding: '8px 12px', borderRadius: '8px' }}>",
        '                    Reset',
        '                </button>',
        '            </div>',
        '        </div>',
        '    )',
        '}',
        ''
    ].join('\n'));

    process.stdout.write(`\n${c('Project created:', 'green')} ${projectDir}\n`);
    process.stdout.write(`${c('Mode:', 'cyan')} ${mode}\n\n`);
    process.stdout.write(`${c('Next steps:', 'bold')}\n`);
    process.stdout.write(`${c('  1)', 'cyan')} cd ${name}\n`);
    process.stdout.write(`${c('  2)', 'cyan')} npm install  ${c('(or bun install)', 'gray')}\n`);
    process.stdout.write(`${c('  3)', 'cyan')} npm run dev\n\n`);
}

function loadRoundConfig(configPathAbs) {
    const raw = fs.readFileSync(configPathAbs, 'utf8');
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : {};
}

function coerceNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

async function runDev({ rootDir, configPathAbs, config }) {
    const startedAt = Date.now();
    const configDir = path.dirname(configPathAbs);

    const entryAbs = config?.entry ? resolveFrom(configDir, config.entry) : null;
    if (!entryAbs || !fs.existsSync(entryAbs)) {
        throw new Error(`Entry not found: ${entryAbs ?? '(missing entry)'} (config: ${configPathAbs})`);
    }
    const entryRel = normalizePath(path.relative(rootDir, entryAbs));
    ensureIndexHtml(rootDir, entryRel, config?.name ?? 'Round');

    let viteServer = null;
    let restarting = false;
    let restartTimer = null;

    const startServer = async (nextConfig, { showBanner, showReady } = { showBanner: true, showReady: true }) => {
        const cfgDir = path.dirname(configPathAbs);

        const entryAbs2 = nextConfig?.entry ? resolveFrom(cfgDir, nextConfig.entry) : null;
        if (!entryAbs2 || !fs.existsSync(entryAbs2)) {
            throw new Error(`Entry not found: ${entryAbs2 ?? '(missing entry)'} (config: ${configPathAbs})`);
        }
        const entryRel2 = normalizePath(path.relative(rootDir, entryAbs2));
        ensureIndexHtml(rootDir, entryRel2, nextConfig?.name ?? 'Round');

        const serverPort2 = coerceNumber(nextConfig?.dev?.port, 5173);
        const open2 = Boolean(nextConfig?.dev?.open);
        const base2 = nextConfig?.routing?.base ?? '/';

        if (showBanner) {
            banner('Dev Server');
            process.stdout.write(`${c('  Config', 'gray')}  ${configPathAbs}\n`);
            process.stdout.write(`${c('  Base', 'gray')}    ${base2}\n`);
            process.stdout.write(`${c('  Port', 'gray')}    ${serverPort2}\n\n`);
        }

        const server = await createServer({
            configFile: false,
            root: rootDir,
            base: base2,
            logLevel: 'info',
            customLogger: createViteLogger(),
            plugins: [RoundPlugin({
                configPath: normalizePath(path.relative(rootDir, configPathAbs)),
                restartOnConfigChange: false
            })],
            server: {
                port: serverPort2,
                open: open2
            },
            publicDir: nextConfig?.public ? resolveFrom(cfgDir, nextConfig.public) : undefined
        });

        await server.listen();

        if (showReady) {
            const ms = Date.now() - startedAt;
            printUrls(server.resolvedUrls, base2, ms);
        }

        return server;
    };

    viteServer = await startServer(config, { showBanner: true, showReady: true });

    if (typeof fs.watch === 'function') {
        try {
            fs.watch(configPathAbs, { persistent: true }, () => {
                if (restartTimer) clearTimeout(restartTimer);
                restartTimer = setTimeout(async () => {
                    if (restarting) return;
                    restarting = true;
                    try {
                        const next = loadRoundConfig(configPathAbs);
                        process.stdout.write(`\n${c('[round]', 'cyan')} ${c('config changed', 'gray')} ${c('restarting dev server...', 'gray')}\n`);
                        if (viteServer) await viteServer.close();
                        viteServer = await startServer(next, { showBanner: true, showReady: true });
                    } catch (e) {
                        process.stderr.write(String(e?.stack ?? e?.message ?? e) + '\n');
                    } finally {
                        restarting = false;
                    }
                }, 150);
            });
        } catch {
        }
    }
}

async function runBuild({ rootDir, configPathAbs, config }) {
    const startedAt = Date.now();
    const configDir = path.dirname(configPathAbs);

    const entryAbs = config?.entry ? resolveFrom(configDir, config.entry) : null;
    if (!entryAbs || !fs.existsSync(entryAbs)) {
        throw new Error(`Entry not found: ${entryAbs ?? '(missing entry)'} (config: ${configPathAbs})`);
    }
    const entryRel = normalizePath(path.relative(rootDir, entryAbs));
    ensureIndexHtml(rootDir, entryRel, config?.name ?? 'Round');

    const outDir = config?.output ? resolveFrom(configDir, config.output) : resolveFrom(rootDir, './dist');
    const base = config?.routing?.base ?? '/';

    banner('Build');
    process.stdout.write(`${c('  Config', 'gray')}  ${configPathAbs}\n`);
    process.stdout.write(`${c('  OutDir', 'gray')}  ${outDir}\n`);
    process.stdout.write(`${c('  Base', 'gray')}    ${base}\n\n`);

    await viteBuild({
        configFile: false,
        root: rootDir,
        base,
        logLevel: 'warn',
        customLogger: createViteLogger(),
        plugins: [RoundPlugin({ configPath: normalizePath(path.relative(rootDir, configPathAbs)) })],
        publicDir: config?.public ? resolveFrom(configDir, config.public) : undefined,
        build: {
            outDir,
            sourcemap: Boolean(config?.build?.sourcemap),
            minify: config?.build?.minify !== undefined ? config.build.minify : true,
            target: config?.build?.target ?? 'es2020'
        }
    });

    const ms = Date.now() - startedAt;
    process.stdout.write(`\n  ${c('ROUND', 'cyan')} ${c('built', 'green')} ${c('in', 'gray')} ${c(`${ms} ms`, 'gray')}\n\n`);
}

async function runPreview({ rootDir, configPathAbs, config }) {
    const configDir = path.dirname(configPathAbs);
    const outDir = config?.output ? resolveFrom(configDir, config.output) : resolveFrom(rootDir, './dist');
    const base = config?.routing?.base ?? '/';
    const previewPort = coerceNumber(config?.dev?.port, 5173);

    const entryAbs = config?.entry ? resolveFrom(configDir, config.entry) : null;
    if (entryAbs && fs.existsSync(entryAbs)) {
        const entryRel = normalizePath(path.relative(rootDir, entryAbs));
        ensureIndexHtml(rootDir, entryRel, config?.name ?? 'Round');
    }

    banner('Preview');
    process.stdout.write(`${c('Config:', 'cyan')} ${configPathAbs}\n`);
    process.stdout.write(`${c('OutDir:', 'cyan')} ${outDir}\n`);
    process.stdout.write(`${c('Base:', 'cyan')} ${base}\n`);
    process.stdout.write(`${c('Port:', 'cyan')} ${previewPort}\n\n`);

    if (!fs.existsSync(outDir)) {
        process.stdout.write(`${c('Error:', 'red')} Build output not found: ${outDir}\n`);
        process.stdout.write(`${c('Hint:', 'gray')} Run \"round build\" first.\n`);
        process.exit(1);
    }

    const server = await vitePreview({
        configFile: false,
        root: rootDir,
        base,
        logLevel: 'warn',
        customLogger: createViteLogger(),
        preview: {
            port: previewPort
        },
        build: {
            outDir
        }
    });

    printUrls(server.resolvedUrls, base);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];

    if (args.help || !cmd || (cmd !== 'dev' && cmd !== 'build' && cmd !== 'preview' && cmd !== 'init')) {
        printHelp();
        process.exit(cmd ? 1 : 0);
    }

    if (cmd === 'init') {
        const name = args._[1];
        await runInit({ name, template: args.template });
        return;
    }

    const initialRootDir = path.resolve(process.cwd(), args.root ?? '.');
    const configPathAbs = resolveFrom(initialRootDir, args.config ?? './round.config.json');

    const rootDir = args.root
        ? initialRootDir
        : path.dirname(configPathAbs);

    if (!fs.existsSync(configPathAbs)) {
        throw new CliError(`Config not found: ${configPathAbs}`, { code: 1 });
    }

    let config;
    try {
        config = loadRoundConfig(configPathAbs);
    } catch (e) {
        throw new CliError(`Failed to read config: ${configPathAbs}\n${String(e?.message ?? e)}`, { code: 1 });
    }

    if (cmd === 'dev') {
        await runDev({ rootDir, configPathAbs, config });
        return;
    }

    if (cmd === 'build') {
        await runBuild({ rootDir, configPathAbs, config });
        return;
    }

    if (cmd === 'preview') {
        await runPreview({ rootDir, configPathAbs, config });
    }
}

main().catch((e) => {
    if (e && e.name === 'CliError') {
        printError(e.message);
        if (e.showHelp) printHelp();
        process.exit(e.code ?? 1);
    }
    const msg = String(e?.stack ?? e?.message ?? e);
    process.stderr.write(c(msg, 'red') + '\n');
    process.exit(1);
});
