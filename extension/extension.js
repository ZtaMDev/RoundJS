const vscode = require('vscode');
const path = require('path');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('Round');
    outputChannel.appendLine('Round Extension Activated (LSP)');
    context.subscriptions.push(outputChannel);

    // --- LSP Setup ---
    const serverModule = context.asAbsolutePath(path.join('round-lsp', 'src', 'server.js'));
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    const serverOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    const clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'round' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.round')
        }
    };

    client = new LanguageClient(
        'roundLSP',
        'Round Language Server',
        serverOptions,
        clientOptions
    );

    client.start();

    // --- Smart Snippets ---
    const provider = vscode.languages.registerCompletionItemProvider('round', {
        provideCompletionItems(document, position) {
            const items = [];

            const snippets = [
                {
                    label: 'round:signal',
                    detail: 'Create a signal()',
                    body: "const ${1:name} = signal(${2:initial});$0",
                    member: "signal"
                },
                {
                    label: 'round:bindable',
                    detail: 'Create a bindable()',
                    body: "const ${1:name} = bindable(${2:initial});$0",
                    member: "bindable"
                },
                {
                    label: 'round:route',
                    detail: 'Insert a <Route> block',
                    body: "<Route route=\"${1:/}\" title=\"${2:Title}\">\n\t$0\n</Route>",
                    member: "Route"
                },
                {
                    label: 'round:suspense',
                    detail: 'Insert a <Suspense> block',
                    body: "<Suspense fallback={<div>${1:Loading...}</div>}>\n\t$0\n</Suspense>",
                    member: "Suspense"
                },
                {
                    label: 'round:markdown',
                    detail: 'Insert a <Markdown> component',
                    body: "<Markdown src=\"${1:./README.md}\" />$0",
                    member: "Markdown"
                },
                {
                    label: 'round:component',
                    detail: 'Create a Round component',
                    body: "export function ${1:ComponentName}() {\n\treturn (\n\t\t<div>\n\t\t\t$0\n\t\t</div>\n\t);\n}",
                },
                {
                    label: 'round:if',
                    detail: 'Round JSX superset if block',
                    body: "{if(${1:condition}){\n\t$0\n}}",
                },
                {
                    label: 'round:ifelse',
                    detail: 'Round JSX superset if/else block',
                    body: "{if(${1:condition}){\n\t$0\n} else {\n\t\n}}",
                },
                {
                    label: 'round:for',
                    detail: 'Round JSX superset for-in block',
                    body: "{for(${1:item} in ${2:list}){\n\t$0\n}}",
                }
            ];

            for (const s of snippets) {
                const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Snippet);
                item.insertText = new vscode.SnippetString(s.body);
                item.detail = s.detail;

                if (s.member) {
                    const text = document.getText();
                    const importRegex = /import\s*{\s*([^}]*)\s*}\s*from\s*['"]round-core['"]/g;
                    let match;
                    let found = false;

                    while ((match = importRegex.exec(text)) !== null) {
                        const members = match[1].split(',').map(m => m.trim());
                        if (members.includes(s.member)) {
                            found = true;
                            break;
                        } else {
                            const startPos = document.positionAt(match.index);
                            const endPos = document.positionAt(match.index + match[0].length);
                            const range = new vscode.Range(startPos, endPos);

                            const newMembers = [...members.filter(m => m.length > 0), s.member].join(', ');
                            const newImportLine = `import { ${newMembers} } from 'round-core';`;
                            item.additionalTextEdits = [vscode.TextEdit.replace(range, newImportLine)];
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        let line = 0;
                        const lines = text.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].trim().startsWith('import ')) {
                                line = i + 1;
                            } else if (line > 0 && lines[i].trim().length > 0) {
                                break;
                            }
                        }
                        item.additionalTextEdits = [
                            vscode.TextEdit.insert(new vscode.Position(line, 0), `import { ${s.member} } from 'round-core';\n`)
                        ];
                    }
                }
                items.push(item);
            }

            return items;
        }
    });

    context.subscriptions.push(provider);
}

function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

module.exports = {
    activate,
    deactivate
};
