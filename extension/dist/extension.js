var e=require("vscode"),x=require("path"),{LanguageClient:C,TransportKind:g}=require("vscode-languageclient/node"),a;function E(l){let u=e.window.createOutputChannel("Round");u.appendLine("Round Extension Activated (LSP)"),l.subscriptions.push(u);let b=l.asAbsolutePath(x.join("dist","round-lsp","src","server.js")),f={execArgv:["--nolazy","--inspect=6009"]},$={run:{module:b,transport:g.ipc},debug:{module:b,transport:g.ipc,options:f}},y={documentSelector:[{scheme:"file",language:"round"}],synchronize:{fileEvents:e.workspace.createFileSystemWatcher("**/*.round")}};a=new C("roundLSP","Round Language Server",$,y),a.start();let S=e.languages.registerCompletionItemProvider("round",{provideCompletionItems(d,T){let p=[],h=[{label:"round:signal",detail:"Create a signal()",body:"const ${1:name} = signal(${2:initial});$0",member:"signal"},{label:"round:asyncSignal",detail:"Create an asyncSignal()",body:`const \${1:data} = asyncSignal(async () => {
	$0
});`,member:"asyncSignal"},{label:"round:bindable",detail:"Create a bindable()",body:"const ${1:name} = bindable(${2:initial});$0",member:"bindable"},{label:"round:route",detail:"Insert a <Route> block",body:'<Route route="${1:/}" title="${2:Title}">\n	$0\n</Route>',member:"Route"},{label:"round:suspense",detail:"Insert a <Suspense> block",body:`<Suspense fallback={<div>\${1:Loading...}</div>}>
	$0
</Suspense>`,member:"Suspense"},{label:"round:markdown",detail:"Insert a <Markdown> component",body:'<Markdown src="${1:./README.md}" />$0',member:"Markdown"},{label:"round:component",detail:"Create a Round component",body:`export function \${1:ComponentName}() {
	return (
		<div>
			$0
		</div>
	);
}`},{label:"round:if",detail:"Round JSX superset if block",body:`{if(\${1:condition}){
	$0
}}`},{label:"round:ifelse",detail:"Round JSX superset if/else block",body:`{if(\${1:condition}){
	$0
} else {
	
}}`},{label:"round:for",detail:"Round JSX superset for-in block",body:"{for(${1:item} in ${2:list}){\n	$0\n}}"},{label:"round:try",detail:"Round JSX tr6y/catch block",body:`{try {
	$0
} catch(e) {
	
}}`},{label:"round:tryreactive",detail:"Round JSX reactive try(signal) block",body:`{try(\${1:signal()}) {
	$0
} catch(e) {
	
}}`}];for(let n of h){let r=new e.CompletionItem(n.label,e.CompletionItemKind.Snippet);if(r.insertText=new e.SnippetString(n.body),r.detail=n.detail,n.member){let m=d.getText(),v=/import\s*{\s*([^}]*)\s*}\s*from\s*['"]round-core['"]/g,s,c=!1;for(;(s=v.exec(m))!==null;){let i=s[1].split(",").map(t=>t.trim());if(i.includes(n.member)){c=!0;break}else{let t=d.positionAt(s.index),o=d.positionAt(s.index+s[0].length),k=new e.Range(t,o),w=`import { ${[...i.filter(R=>R.length>0),n.member].join(", ")} } from 'round-core';`;r.additionalTextEdits=[e.TextEdit.replace(k,w)],c=!0;break}}if(!c){let i=0,t=m.split(`
`);for(let o=0;o<t.length;o++)if(t[o].trim().startsWith("import "))i=o+1;else if(i>0&&t[o].trim().length>0)break;r.additionalTextEdits=[e.TextEdit.insert(new e.Position(i,0),`import { ${n.member} } from 'round-core';
`)]}}p.push(r)}return p}});l.subscriptions.push(S)}function I(){if(a)return a.stop()}module.exports={activate:E,deactivate:I};
