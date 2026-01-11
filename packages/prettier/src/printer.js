import { printers as estreePrinters } from "prettier/plugins/estree";
import { builders } from "prettier/doc";

const estreePrinter = estreePrinters.estree;
const { group, indent, softline, hardline, join, line } = builders;

function getKind(node) {
    if (node.type !== 'JSXElement') return null;
    if (node.openingElement.name.name !== 'RoundControlFlow') return null;
    const attrs = node.openingElement.attributes;
    for (const attr of attrs) {
        if (attr.name.name === 'kind') return attr.value.value;
    }
    return null;
}

function isContinuation(kind) {
    return ['else', 'else if', 'catch', 'finally'].includes(kind);
}

function hasNextContinuation(path) {
    const node = path.getValue();
    const siblings = path.getParentNode().children;
    if (!siblings) return false;
    let idx = path.getName();
    if (typeof idx !== 'number') return false; 
    
    // Look ahead
    for (let i = idx + 1; i < siblings.length; i++) {
        const sib = siblings[i];
        if (sib.type === 'JSXText' && !sib.value.trim()) continue; 
        
        const kind = getKind(sib);
        if (kind && isContinuation(kind)) return true;
        
        return false;
    }
    return false;
}

export const canAttachComment = estreePrinter.canAttachComment;
export const handleComments = estreePrinter.handleComments;
export const isBlockComment = estreePrinter.isBlockComment;
export const getVisitorKeys = estreePrinter.getVisitorKeys;
export const printComment = estreePrinter.printComment; // Usually exists
// export const embed = estreePrinter.embed; // Careful with embed recursion?

export function print(path, options, print) {
    const node = path.getValue();
    
    // Check if originalText is preprocessed
    if (node.type === 'Program') {
         // console.error('DEBUG ORIGINAL TEXT:', options.originalText.slice(0, 500));
         // console.error('DEBUG ESTREE KEYS:', Object.keys(estreePrinter));
    }
    
    if (node.type === 'JSXElement' && 
        node.openingElement.name.name === 'RoundControlFlow') {
        
        const attrs = node.openingElement.attributes;
        let kind = '';
        let head = '';
        let rawAttrs = '';
        
        for (let i = 0; i < attrs.length; i++) {
            const attr = attrs[i];
            if (attr.name.name === 'kind') kind = attr.value.value;
            if (attr.name.name === 'head') {
                if (attr.value.type === 'JSXExpressionContainer') {
                    head = path.call(print, "openingElement", "attributes", i, "value", "expression");
                } else {
                    head = attr.value.value;
                }
            }
            if (attr.name.name === '_attrs') rawAttrs = attr.value.value;
        }

        if (typeof head === 'string') {
            head = head ? head.replace(/&quot;/g, '"') : '';
        }
        rawAttrs = rawAttrs ? rawAttrs.replace(/&quot;/g, '"') : '';
        
        const parts = [];
        
        // Opening
        if (isContinuation(kind)) {
             parts.push(' ', kind);
        } else {
             parts.push('{', kind);
        }
        
        if (head) {
            parts.push(' (', head, ')'); 
        }
        
        if (rawAttrs) {
            parts.push(' ', rawAttrs);
        }
        
        parts.push(' {');
        
        const childDocs = path.map(print, "children").filter(doc => doc && doc !== "");
        parts.push(indent([hardline, join(hardline, childDocs)]));
        parts.push(hardline, '}'); 
        
        // Closing 
        if (!hasNextContinuation(path)) {
            parts.push('}');
        }
        
        return group(parts);
    }
    
    if (node.type === 'JSXText') {
        const trimmed = node.value.trim();
        if (!trimmed) return ''; 
        return trimmed;
    }

    return estreePrinter.print(path, options, print);
}
