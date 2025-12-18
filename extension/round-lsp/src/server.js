const {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    TextDocumentSyncKind,
    Diagnostic,
    DiagnosticSeverity,
    Position,
    Range,
    FileChangeType,
    DidChangeWatchedFilesNotification
} = require('vscode-languageserver/node');

const { TextDocument } = require('vscode-languageserver-textdocument');
const { transformLSP } = require('./round-transformer-lsp');
const ts = require('typescript');
const path = require('path');
const fs = require('fs');
const { glob } = require('glob');
const { URI } = require('vscode-uri');

function normalizePath(p) {
    if (!p) return p;
    return path.normalize(p).replace(/\\/g, '/');
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Virtual document storage
const virtualDocs = new Map(); // roundUri -> { roundDoc, tsxText, map, version }
const tsFiles = new Map();     // tsxFsPath -> { text, version }
let workspaceRoot = null;
let roundRootCached = null;
function getRoundRoot() {
    if (roundRootCached) return roundRootCached;
    const localNodeModules = path.join(workspaceRoot || '', 'node_modules', 'round-core');
    const sourceDir = path.resolve(__dirname, "../../src");
    roundRootCached = normalizePath(fs.existsSync(localNodeModules) ? localNodeModules : sourceDir);
    return roundRootCached;
}

const host = {
    getScriptFileNames: () => {
        const names = Array.from(tsFiles.keys());
        const root = getRoundRoot();

        // Try to find the best d.ts
        const dtsPaths = [
            path.join(root, "src/index.d.ts"),
            path.join(root, "index.d.ts"),
            path.join(root, "dist/index.d.ts")
        ];

        const dtsPath = dtsPaths.find(p => fs.existsSync(p));
        const entryPath = dtsPath || normalizePath(path.join(root, "index.js"));

        if (fs.existsSync(entryPath) && !names.includes(entryPath)) names.push(entryPath);
        return names;
    },
    getScriptVersion: fileName => {
        const normalized = normalizePath(fileName);
        if (tsFiles.has(normalized)) return tsFiles.get(normalized).version.toString();
        if (fs.existsSync(normalized)) {
            try {
                return fs.statSync(normalized).mtimeMs.toString();
            } catch (e) {
                return '0';
            }
        }
        return '0';
    },
    getScriptSnapshot: fileName => {
        const text = host.readFile(fileName);
        return text ? ts.ScriptSnapshot.fromString(text) : undefined;
    },
    getCurrentDirectory: () => workspaceRoot || process.cwd(),
    getCompilationSettings: () => {
        const settings = {
            jsx: ts.JsxEmit.React,
            jsxFactory: 'React.createElement',
            jsxFragmentFactory: 'React.Fragment',
            allowJs: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            skipLibCheck: true,
            lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
            baseUrl: workspaceRoot || '.',
            paths: {}
        };

        const root = getRoundRoot();
        const dtsPaths = [
            path.join(root, "src/index.d.ts"),
            path.join(root, "index.d.ts"),
            path.join(root, "dist/index.d.ts")
        ];
        const dtsPath = dtsPaths.find(p => fs.existsSync(p));
        const entryPath = dtsPath || normalizePath(path.join(root, "index.js"));

        settings.paths["round-core"] = [entryPath];
        settings.paths["round-core/*"] = [path.join(root, "*")];

        return settings;
    },
    getDefaultLibFileName: options => normalizePath(ts.getDefaultLibFilePath(options)),
    fileExists: fileName => {
        const normalized = normalizePath(fileName);
        return tsFiles.has(normalized) || ts.sys.fileExists(normalized);
    },
    readFile: fileName => {
        const normalized = normalizePath(fileName);
        if (tsFiles.has(normalized)) return tsFiles.get(normalized).text;
        if (ts.sys.fileExists(normalized)) {
            try {
                return ts.sys.readFile(normalized);
            } catch (e) {
                return undefined;
            }
        }
        return undefined;
    },
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
};

const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

connection.onInitialize((params) => {
    workspaceRoot = params.rootPath || (params.workspaceFolders?.[0]?.uri ? URI.parse(params.workspaceFolders[0].uri).fsPath : null);

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            hoverProvider: true,
            definitionProvider: true
        }
    };
});

connection.onInitialized(async () => {
    if (workspaceRoot) {
        connection.console.log(`Scanning workspace: ${workspaceRoot}`);
        const files = await glob('**/*.round', { cwd: workspaceRoot, ignore: 'node_modules/**', absolute: true });
        const discovered = [];
        for (const file of files) {
            const uri = URI.file(file).toString();
            const content = fs.readFileSync(file, 'utf8');
            processFile(uri, content, 0, false);
            discovered.push(uri);
        }
        // Phase 2: Send diagnostics now that all files are in context
        for (const uri of discovered) {
            const tsxFsPath = normalizePath(URI.parse(uri + '.tsx').fsPath);
            sendDiagnostics(uri, tsxFsPath);
        }
        connection.console.log(`Initialized with ${files.length} .round files`);
    }

    connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [{ globPattern: '**/*.round' }]
    });
});

function processFile(uri, text, version, send = true) {
    try {
        const { code, edits } = transformLSP(text, uri);
        const tsxFsPath = normalizePath(URI.parse(uri + '.tsx').fsPath);

        tsFiles.set(tsxFsPath, { text: code, version });
        virtualDocs.set(uri, {
            roundDoc: TextDocument.create(uri, 'round', version, text),
            tsxText: code,
            edits, // Store precise edits
            version
        });

        if (send) sendDiagnostics(uri, tsxFsPath);
    } catch (e) {
        // connection.console.error(`Transform failed for ${uri}: ${e.message}`);
    }
}

documents.onDidChangeContent(change => {
    processFile(change.document.uri, change.document.getText(), change.document.version);
});

connection.onDidChangeWatchedFiles(params => {
    for (const change of params.changes) {
        if (change.type === FileChangeType.Deleted) {
            const tsxFsPath = normalizePath(URI.parse(change.uri + '.tsx').fsPath);
            tsFiles.delete(tsxFsPath);
            virtualDocs.delete(change.uri);
        } else if (change.type === FileChangeType.Created || change.type === FileChangeType.Changed) {
            const doc = documents.get(change.uri);
            if (!doc) {
                const fsPath = normalizePath(URI.parse(change.uri).fsPath);
                if (fs.existsSync(fsPath)) {
                    processFile(change.uri, fs.readFileSync(fsPath, 'utf8'), Date.now());
                }
            }
        }
    }
});

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

function sendDiagnostics(roundUri, tsxFsPath) {
    try {
        const vdoc = virtualDocs.get(roundUri);
        if (!vdoc) return;

        const allDiagnostics = [
            ...ls.getSyntacticDiagnostics(tsxFsPath),
            ...ls.getSemanticDiagnostics(tsxFsPath),
            ...ls.getSuggestionDiagnostics(tsxFsPath)
        ];

        const mapped = allDiagnostics.map(diag => {
            const range = mapTsxRangeToRound(diag.start, diag.length, vdoc);
            if (!range) return null;
            return {
                severity: mapSeverity(diag.category),
                range,
                message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
                source: 'round-ts'
            };
        }).filter(Boolean);

        connection.sendDiagnostics({ uri: roundUri, diagnostics: mapped });
    } catch (e) {
        connection.console.error(`Diagnostics failed for ${tsxFsPath}: ${e.message}`);
    }
}

function toGeneratedOffset(originalOffset, edits) {
    let current = originalOffset;
    for (const edit of edits) {
        if (edit.offset <= originalOffset) {
            // If the edit is entirely before our offset, or starts at it
            if (originalOffset >= edit.offset + edit.length) {
                current += (edit.newLength - edit.length);
            } else {
                // Offset is inside the range being replaced
                // map it to the start of the replacement
                current += (edit.offset - originalOffset);
                break;
            }
        }
    }
    return current;
}

function toOriginalOffset(generatedOffset, edits) {
    let current = generatedOffset;
    let original = generatedOffset;

    // Need to work backwards through the edits to find the original location
    // Since edits are sorted by original offset, we can simulate the transformation
    let accum = 0;
    for (const edit of edits) {
        const genStart = edit.offset + accum;
        const genEnd = genStart + edit.newLength;

        if (generatedOffset < genStart) {
            // Offset is before this edit
            return generatedOffset - accum;
        }

        if (generatedOffset >= genStart && generatedOffset < genEnd) {
            // Offset is inside the replacement
            return edit.offset;
        }

        accum += (edit.newLength - edit.length);
    }

    return generatedOffset - accum;
}

function mapTsxRangeToRound(start, length, vdoc) {
    const edits = vdoc.edits || [];
    const originalStart = toOriginalOffset(start, edits);
    const originalEnd = toOriginalOffset(start + length, edits);

    return {
        start: vdoc.roundDoc.positionAt(originalStart),
        end: vdoc.roundDoc.positionAt(originalEnd)
    };
}

function mapSeverity(category) {
    switch (category) {
        case ts.DiagnosticCategory.Error: return DiagnosticSeverity.Error;
        case ts.DiagnosticCategory.Warning: return DiagnosticSeverity.Warning;
        case ts.DiagnosticCategory.Message: return DiagnosticSeverity.Information;
        case ts.DiagnosticCategory.Suggestion: return DiagnosticSeverity.Hint;
        default: return DiagnosticSeverity.Error;
    }
}

connection.onHover((params) => {
    try {
        const vdoc = virtualDocs.get(params.textDocument.uri);
        if (!vdoc) return null;

        const tsxFsPath = normalizePath(URI.parse(params.textDocument.uri + '.tsx').fsPath);
        const originalOffset = vdoc.roundDoc.offsetAt(params.position);
        const offset = toGeneratedOffset(originalOffset, vdoc.edits || []);

        const info = ls.getQuickInfoAtPosition(tsxFsPath, offset);
        if (!info) return null;

        const text = ts.displayPartsToString(info.displayParts);
        const docs = ts.displayPartsToString(info.documentation);
        const tags = info.tags ? info.tags.map(t => `*@${t.name}* ${t.text ? ts.displayPartsToString(t.text) : ''}`).join('\n\n') : '';

        return {
            contents: {
                kind: 'markdown',
                value: `\`\`\`typescript\n${text}\n\`\`\`\n${docs}${tags ? '\n\n' + tags : ''}`
            }
        };
    } catch (e) {
        return null;
    }
});

connection.onDefinition((params) => {
    try {
        const vdoc = virtualDocs.get(params.textDocument.uri);
        if (!vdoc) return null;

        const tsxFsPath = normalizePath(URI.parse(params.textDocument.uri + '.tsx').fsPath);
        const originalOffset = vdoc.roundDoc.offsetAt(params.position);
        const offset = toGeneratedOffset(originalOffset, vdoc.edits || []);

        const defs = ls.getDefinitionAtPosition(tsxFsPath, offset);
        if (!defs || defs.length === 0) return null;

        return defs.map(def => {
            let fsPath = normalizePath(def.fileName);
            let start = def.textSpan.start;
            let length = def.textSpan.length;

            const isVirtual = fsPath.endsWith('.round.tsx');
            const uri = isVirtual ? URI.file(fsPath.slice(0, -4)).toString() : URI.file(fsPath).toString();

            if (isVirtual) {
                const targetVdoc = virtualDocs.get(uri);
                if (targetVdoc && targetVdoc.edits) {
                    start = toOriginalOffset(start, targetVdoc.edits);
                }
            }

            const targetVdoc = virtualDocs.get(uri);
            if (targetVdoc) {
                return {
                    uri,
                    range: {
                        start: targetVdoc.roundDoc.positionAt(start),
                        end: targetVdoc.roundDoc.positionAt(start + length)
                    }
                };
            }

            return {
                uri,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 }
                }
            };
        }).filter(Boolean);
    } catch (e) {
        return null;
    }
});

documents.listen(connection);
connection.listen();
