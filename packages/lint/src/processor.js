import { SourceMapper, runPreprocess } from '@round-core/shared';
import { fileState } from './state.js';
import { remapMessages } from './offset-map.js';

export default {
  preprocess(code, filename) {
    const topLevelNames = new Set();
    const declMatches = code.matchAll(/^\s*(?:export\s+)?(?:function|const|let|var|class|import)\s+({[\s\S]*?}|[a-zA-Z0-9_$]+)/gm);
    for (const m of declMatches) {
        const inner = m[1];
        if (inner.startsWith('{')) {
            const innerNames = inner.match(/([a-zA-Z0-9_$]+)/g);
            if (innerNames) innerNames.forEach(n => topLevelNames.add(n));
        } else {
            topLevelNames.add(inner);
        }
    }

    const componentMatches = code.matchAll(/<([A-Z][a-zA-Z0-9_$]*)/g);
    const components = new Set([...componentMatches].map(m => m[1]));
    
    // Dynamic Global Injection for for/catch variables
    const magicVars = new Set(['RoundControlFlow', 'Fragment']);
    const forMatches = code.matchAll(/\{for\s*\(\s*([a-zA-Z0-9_$]+)/g);
    for (const m of forMatches) magicVars.add(m[1]);
    const catchMatches = code.matchAll(/catch\s*\(\s*([a-zA-Z0-9_$]+)/g);
    for (const m of catchMatches) magicVars.add(m[1]);

    const globalsList = Array.from(magicVars).join(', ');
    let magic = `/* globals ${globalsList} */\n(void RoundControlFlow); (void Fragment);`;
    for (const comp of components) {
        if (topLevelNames.has(comp)) {
            magic += ` (void ${comp});`; 
        }
    }
    magic += '\n';

    const mapper = new SourceMapper();
    runPreprocess(code, mapper, 0);
    mapper.add('\n' + magic, code.length);

    fileState.set(filename, {
      source: code,
      mapper: mapper
    });

    return [mapper.code];
  },

  postprocess(messages, filename) {
    const state = fileState.get(filename);
    
    fileState.delete(filename);

    if (!state) return messages[0];

    // Remap messages from the first (and only) part
    return remapMessages(messages[0], state);
  },

  supportsAutofix: false
};
