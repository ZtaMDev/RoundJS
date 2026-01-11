// Helper: Source Mapper
export class SourceMapper {
    constructor() {
        this.mappings = []; // [{ gen, orig }]
        this.code = '';
    }

    add(generatedText, originalOffset) {
        const genStart = this.code.length;
        this.code += generatedText;
        this.mappings.push({
            gen: [genStart, this.code.length],
            orig: originalOffset
        });
    }

    remap(genOffset) {
        for (const m of this.mappings) {
            if (genOffset >= m.gen[0] && genOffset < m.gen[1]) {
                const offsetInBlock = genOffset - m.gen[0];
                return m.orig + offsetInBlock;
            }
        }
        // If exactly at the end of the last block
        if (this.mappings.length > 0) {
            const last = this.mappings[this.mappings.length - 1];
            if (genOffset === last.gen[1]) {
                 return last.orig + (last.gen[1] - last.gen[0]);
            }
        }
        return genOffset;
    }
}

export function findBlockEnd(text, startIndex) {
    let depth = 0;
    let i = startIndex;
    if (text[i] !== '{') return -1;
    
    let inString = false;
    let quote = '';
    let inLineComment = false;
    let inBlockComment = false;

    while (i < text.length) {
        const c = text[i];
        const next = text[i+1] || '';

        if (inLineComment) {
            if (c === '\n') inLineComment = false;
        } else if (inBlockComment) {
            if (c === '*' && next === '/') { inBlockComment = false; i++; }
        } else if (inString) {
            if (c === quote && text[i-1] !== '\\') inString = false;
            else if ((quote === '"' || quote === "'") && c === '\n') inString = false;
        } else {
            if (c === '/' && next === '/') inLineComment = true;
            else if (c === '/' && next === '*') inBlockComment = true;
            else if (c === '"' || c === "'" || c === '`') { inString = true; quote = c; }
            else if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return i + 1;
            }
        }
        i++;
    }
    return -1;
}

// Preprocess: Updates mapper and returns processed code (via mapper.code)
export function runPreprocess(text, mapper, globalOffset) {
    let i = 0;
    
    let inString = false;
    let quote = '';
    let inLineComment = false;
    let inBlockComment = false;

    while (i < text.length) {
        const c = text[i];
        const next = text[i+1] || '';

        if (inLineComment) {
            if (c === '\n') inLineComment = false;
        } else if (inBlockComment) {
            if (c === '*' && next === '/') { inBlockComment = false; mapper.add('*/', globalOffset + i); i+=2; continue; }
        } else if (inString) {
            if (c === quote && text[i-1] !== '\\') inString = false;
            else if ((quote === '"' || quote === "'") && c === '\n') inString = false;
        } else {
            if (c === '/' && next === '/') { inLineComment = true; }
            else if (c === '/' && next === '*') { inBlockComment = true; }
            else if (c === '"' || c === "'" || c === '`') { inString = true; quote = c; }
            else if (c === '{') {
                const match = text.slice(i).match(/^\{\s*(if|else\s+if|else-if|else|for|switch|try|catch|finally)\b/);
                if (match) {
                    const end = findBlockEnd(text, i);
                    if (end !== -1) {
                        const content = text.slice(i + 1, end - 1);
                        
                        let p = 0;
                        let validChain = true;
                        
                        const chainSegments = []; 
                        
                        // Parse Chain Loop
                        while (p < content.length) {
                             while (p < content.length && /\s/.test(content[p])) p++;
                             if (p >= content.length) break;
                             
                             const sub = content.slice(p);
                             const keyMatch = sub.match(/^(if|else\s+if|else-if|else|for|switch|try|catch|finally)\b/);
                             
                             if (!keyMatch) { validChain = false; break; }
                             
                             const keyword = keyMatch[1].replace('-', ' '); 
                             const partStart = p;
                             p += keyMatch[0].length;
                             
                             let head = ''; 
                             let attrs = ''; 
                             let bodyContent = '';
                             let bodyStartI = -1;
                             let bodyEndI = -1;
                             
                             // Head
                             while (p < content.length && /\s/.test(content[p])) p++;
                             if (p < content.length && content[p] === '(') {
                                 const headStart = p;
                                 let pDepth = 1, h = p + 1;
                                 let inS=false, qt='';
                                 while(h < content.length && pDepth > 0) {
                                      if (inS) { if(content[h]===qt && content[h-1]!=='\\') inS=false; }
                                      else if ('"\''.includes(content[h])) { inS=true; qt=content[h]; }
                                      else if (content[h] === '(') pDepth++;
                                      else if (content[h] === ')') pDepth--;
                                      h++;
                                 }
                                 if (pDepth === 0) { head = content.slice(headStart, h); p = h; }
                             }
                             
                             // Attrs
                             const attrStart = p;
                             while (p < content.length) {
                                 if (content[p] === '{') {
                                     let back = p - 1;
                                     while (back >= attrStart && /\s/.test(content[back])) back--;
                                     if (back >= attrStart && content[back] === '=') {
                                         const bEnd = findBlockEnd(content, p);
                                         if (bEnd !== -1) { p = bEnd; continue; }
                                     } else { break; }
                                 }
                                 p++;
                             }
                             attrs = content.slice(attrStart, p).trim();
                             
                             const guard = /\b(return|throw|function|const|let|var|if|for|while|class|import|export|raise)\b/;
                             if (guard.test(attrs) || attrs.includes(';')) { validChain=false; break; }
                             
                             // Body
                             if (p < content.length && content[p] === '{') {
                                 const bEnd = findBlockEnd(content, p);
                                 if (bEnd !== -1) {
                                     bodyContent = content.slice(p + 1, bEnd - 1); 
                                     bodyStartI = p + 1; 
                                     bodyEndI = bEnd - 1;
                                     p = bEnd;
                                 } else { validChain=false; break; }
                             } else { validChain=false; break; }
                             
                             chainSegments.push({ keyword, head, attrs, bodyContent, origStart: partStart,
                                                  bodyRef: { start: bodyStartI, end: bodyEndI } });
                        }
                        
                        if (validChain) {
                            chainSegments.forEach((seg) => {
                                let headPart = '';
                                if (seg.head) {
                                    const cleanHead = seg.head.trim().replace(/^\(|\)$/g, '').trim();
                                    headPart = `head={${cleanHead}}`;
                                }

                                const safeAttrs = seg.attrs.replace(/"/g, '&quot;');
                                const normKind = seg.keyword; 
                                
                                const openTag = `<RoundControlFlow kind="${normKind}" ${headPart} _attrs="${safeAttrs}">`;
                                const segOrigStart = globalOffset + i + 1 + (seg.origStart || 0); 
                                
                                mapper.add(openTag, segOrigStart);
                                
                                const bodyOrigOffset = globalOffset + i + 1 + seg.bodyRef.start;
                                runPreprocess(seg.bodyContent, mapper, bodyOrigOffset);
                                
                                mapper.add('</RoundControlFlow>', bodyOrigOffset + seg.bodyContent.length); 
                            });
                            
                            i = end;
                            continue;
                        }
                    }
                }
            }
        }
        
        mapper.add(text[i], globalOffset + i);
        i++;
    }
}
