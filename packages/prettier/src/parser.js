import { parsers as babelParsers } from "prettier/plugins/babel";
import { SourceMapper, runPreprocess } from "@round-core/shared";

function traverseAndRemap(node, mapper) {
    if (!node) return;
    
    if (node.type === 'File') {
         // console.error('DEBUG ROOT KEYS:', Object.keys(node));
    }

    // Remap location
    if (typeof node.start === 'number') {
        const oldStart = node.start;
        node.start = mapper.remap(node.start);
        if (node.type === 'CommentLine') {
             // console.error(`DEBUG COMMENT REMAP: ${oldStart} -> ${node.start}`);
        }
    }
    if (typeof node.end === 'number') node.end = mapper.remap(node.end);
    // if (node.loc) delete node.loc; // Force calc
    
    for (const key in node) {
        if (key === 'loc') continue;
        const val = node[key];
        if (Array.isArray(val)) {
            val.forEach(child => traverseAndRemap(child, mapper));
        } else if (val && typeof val === 'object' && typeof val.type === 'string') {
            traverseAndRemap(val, mapper);
        }
    }
}

export function parse(text, parsers, options) {
    const mapper = new SourceMapper();
    runPreprocess(text, mapper, 0);
    
    // Explicitly request tokens
    const ast = babelParsers.babel.parse(mapper.code, parsers, { ...options, tokens: true });
    traverseAndRemap(ast, mapper);
    
    // Debug AST comments
    // if (ast.comments && ast.comments.length > 0) {
    //    console.error('DEBUG AST COMMENTS:', JSON.stringify(ast.comments.map(c => ({ 
    //        val: c.value, start: c.start, end: c.end, loc: c.loc 
    //    })), null, 2));
    // }
    
    return ast;
}
