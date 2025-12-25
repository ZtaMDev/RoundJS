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
            try { return fs.statSync(normalized).mtimeMs.toString(); } catch (e) { return '0'; }
        }
        return '0';
    },
    getScriptSnapshot: fileName => {
        const text = host.readFile(fileName);
        return text ? ts.ScriptSnapshot.fromString(text) : undefined;
    },
    getCurrentDirectory: () => workspaceRoot || process.cwd(),
    getCompilationSettings: () => {
        const root = getRoundRoot();
        const dtsPaths = [
            path.join(root, "src/index.d.ts"),
            path.join(root, "index.d.ts"),
            path.join(root, "dist/index.d.ts")
        ];
        const dtsPath = dtsPaths.find(p => fs.existsSync(p));
        const entryPath = dtsPath || normalizePath(path.join(root, "index.js"));

        return {
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
            paths: {
                "round-core": [entryPath],
                "round-core/*": [path.join(root, "*")]
            }
        };
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
            try { return ts.sys.readFile(normalized); } catch (e) { return undefined; }
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
            definitionProvider: true,
            completionProvider: { resolveProvider: true, triggerCharacters: ['.', '"', "'", '/', '<', '@', '*', ' '] },
            signatureHelpProvider: { triggerCharacters: ['(', ','] }
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
            edits,
            version
        });

        if (send) sendDiagnostics(uri, tsxFsPath);
    } catch (e) {
        connection.console.error(`Transform failed for ${uri}: ${e.message}`);
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
        } else {
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
            if (originalOffset >= edit.offset + edit.length) {
                current += (edit.newLength - edit.length);
            } else {
                current += (edit.offset - originalOffset);
                break;
            }
        } else break;
    }
    return current;
}

function toOriginalOffset(generatedOffset, edits) {
    let accum = 0;
    for (const edit of edits) {
        const genStart = edit.offset + accum;
        const genEnd = genStart + edit.newLength;
        if (generatedOffset < genStart) return generatedOffset - accum;
        if (generatedOffset >= genStart && generatedOffset < genEnd) return edit.offset;
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

function mapCompletionKind(kind) {
    switch (kind) {
        case ts.ScriptElementKind.keyword: return 14;
        case ts.ScriptElementKind.scriptElement: return 17;
        case ts.ScriptElementKind.moduleElement: return 9;
        case ts.ScriptElementKind.classElement:
        case ts.ScriptElementKind.localClassElement: return 7;
        case ts.ScriptElementKind.interfaceElement:
        case ts.ScriptElementKind.typeElement: return 8;
        case ts.ScriptElementKind.enumElement: return 13;
        case ts.ScriptElementKind.enumMemberElement: return 20;
        case ts.ScriptElementKind.variableElement:
        case ts.ScriptElementKind.localVariableElement:
        case ts.ScriptElementKind.letElement:
        case ts.ScriptElementKind.parameterElement: return 6;
        case ts.ScriptElementKind.constElement: return 21;
        case ts.ScriptElementKind.functionElement:
        case ts.ScriptElementKind.localFunctionElement: return 3;
        case ts.ScriptElementKind.memberFunctionElement: return 2;
        case ts.ScriptElementKind.memberGetAccessorElement:
        case ts.ScriptElementKind.memberSetAccessorElement: return 10;
        case ts.ScriptElementKind.memberVariableElement: return 5;
        case ts.ScriptElementKind.constructorImplementationElement: return 4;
        case ts.ScriptElementKind.typeParameterElement: return 25;
        case ts.ScriptElementKind.string: return 1;
        case ts.ScriptElementKind.alias: return 18;
        case ts.ScriptElementKind.jsxAttribute: return 5;
        default: return 1;
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
        return {
            contents: {
                kind: 'markdown',
                value: `\`\`\`typescript\n${ts.displayPartsToString(info.displayParts)}\n\`\`\`\n\n${ts.displayPartsToString(info.documentation)}${info.tags ? '\n\n' + info.tags.map(t => `*@${t.name}* ${t.text ? ts.displayPartsToString(t.text) : ''}`).join('\n\n') : ''}`
            }
        };
    } catch (e) { return null; }
});

connection.onCompletion((params) => {
    try {
        const vdoc = virtualDocs.get(params.textDocument.uri);
        const tsxFsPath = normalizePath(URI.parse(params.textDocument.uri + (vdoc ? '.tsx' : '')).fsPath);
        const doc = vdoc ? vdoc.roundDoc : documents.get(params.textDocument.uri);
        if (!doc) return null;
        const offset = vdoc ? toGeneratedOffset(doc.offsetAt(params.position), vdoc.edits || []) : doc.offsetAt(params.position);
        const completions = ls.getCompletionsAtPosition(tsxFsPath, offset, { includeExternalModuleExports: true, includeInsertTextCompletions: true });
        if (!completions) return null;
        return completions.entries.map(entry => ({
            label: entry.name,
            kind: mapCompletionKind(entry.kind),
            data: { uri: params.textDocument.uri, offset, name: entry.name }
        }));
    } catch (e) { return null; }
});

connection.onCompletionResolve((item) => {
    try {
        const { uri, offset, name } = item.data;
        const vdoc = virtualDocs.get(uri);
        const tsxFsPath = normalizePath(URI.parse(uri + (vdoc ? '.tsx' : '')).fsPath);
        const details = ls.getCompletionEntryDetails(tsxFsPath, offset, name, undefined, undefined, undefined, undefined);
        if (details) {
            item.detail = ts.displayPartsToString(details.displayParts);
            item.documentation = { kind: 'markdown', value: ts.displayPartsToString(details.documentation) };
        }
        return item;
    } catch (e) { return item; }
});

connection.onSignatureHelp((params) => {
    try {
        const vdoc = virtualDocs.get(params.textDocument.uri);
        const tsxFsPath = normalizePath(URI.parse(params.textDocument.uri + (vdoc ? '.tsx' : '')).fsPath);
        const doc = vdoc ? vdoc.roundDoc : documents.get(params.textDocument.uri);
        if (!doc) return null;
        const offset = vdoc ? toGeneratedOffset(doc.offsetAt(params.position), vdoc.edits || []) : doc.offsetAt(params.position);
        const help = ls.getSignatureHelpItems(tsxFsPath, offset, undefined);
        if (!help) return null;
        return {
            signatures: help.items.map(item => ({
                label: ts.displayPartsToString(item.prefixDisplayParts) + item.parameters.map(p => ts.displayPartsToString(p.displayParts)).join(', ') + ts.displayPartsToString(item.suffixDisplayParts),
                documentation: ts.displayPartsToString(item.documentation),
                parameters: item.parameters.map(p => ({ label: ts.displayPartsToString(p.displayParts), documentation: ts.displayPartsToString(p.documentation) }))
            })),
            activeSignature: help.selectedItemIndex, activeParameter: help.argumentIndex
        };
    } catch (e) { return null; }
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
            const isVirtual = def.fileName.endsWith('.round.tsx');
            const uri = URI.file(isVirtual ? def.fileName.slice(0, -4) : def.fileName).toString();
            const targetVdoc = virtualDocs.get(uri);
            let start = def.textSpan.start;
            if (targetVdoc) start = toOriginalOffset(start, targetVdoc.edits || []);
            const targetDoc = targetVdoc ? targetVdoc.roundDoc : documents.get(uri);
            if (!targetDoc) return null;
            return { uri, range: { start: targetDoc.positionAt(start), end: targetDoc.positionAt(start + def.textSpan.length) } };
        }).filter(Boolean);
    } catch (e) { return null; }
});

documents.listen(connection);
connection.listen();
