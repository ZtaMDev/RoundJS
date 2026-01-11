const { SourceMapper, runPreprocess } = require('./packages/shared/dist/index.cjs'); // Use dist if available, or just path to local src if using a loader
const fs = require('fs');

// Simple mock for debugging if dist isn't built
function mockDebug() {
    const code = fs.readFileSync('f:/roundTests/BKMAIN/appl/src/test-for.round', 'utf8');
    const mapper = new SourceMapper();
    
    // Simulating processor.js logic
    const magic = `/* globals t, RoundControlFlow, Fragment */\n(void RoundControlFlow); (void Fragment);\n\n`;
    
    // Option A: Prepend magic (mapper.add(magic, 0))
    // Option B: Append magic (mapper.add(magic, code.length))
    
    console.log('--- TEST: PREPEND MAGIC ---');
    const mapperA = new SourceMapper();
    mapperA.add(magic, 0);
    runPreprocess(code, mapperA, 0);
    
    const oopsPos = mapperA.code.indexOf('oops');
    const remappedA = mapperA.remap(oopsPos);
    console.log('Oops in generated:', oopsPos);
    console.log('Remapped to original:', remappedA);
    
    const lines = code.split('\n');
    let acc = 0;
    for(let i=0; i<lines.length; i++) {
        if (remappedA >= acc && remappedA < acc + lines[i].length + 1) {
            console.log(`Original line ${i+1}: ${lines[i]}`);
            break;
        }
        acc += lines[i].length + 1;
    }
}

// Since I am an AI, I can't rely on dist being there. I'll just use the logic directly for the test.
const SourceMapperLogic = class {
    constructor() {
        this.mappings = [];
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
        // Linear search for debugging
        for (const m of this.mappings) {
            if (genOffset >= m.gen[0] && genOffset < m.gen[1]) {
                const offsetInBlock = genOffset - m.gen[0];
                return m.orig + offsetInBlock;
            }
        }
        return genOffset;
    }
};

const code = fs.readFileSync('f:/roundTests/BKMAIN/appl/src/test-for.round', 'utf8');
const mapper = new SourceMapperLogic();
const magic = `/* globals t, RoundControlFlow, Fragment */\n(void RoundControlFlow); (void Fragment);\n\n`;

// TEST APPEND (The one that seemed "better" but might shift)
console.log('--- TEST APPEND ---');
runPreprocess(code, mapper, 0);
mapper.add(magic, code.length);

const oopsGen = mapper.code.indexOf('oops');
const oopsOrig = mapper.remap(oopsGen);
console.log('Oops Gen Offset:', oopsGen);
console.log('Oops Orig Offset:', oopsOrig);

// Check line of oopsOrig
const lines = code.split('\n');
let acc = 0;
for(let i=0; i<lines.length; i++) {
    if (oopsOrig >= acc && oopsOrig < acc + lines[i].length + 1) {
        console.log(`Found oops at LINE ${i+1}: ${lines[i]}`);
    }
    acc += lines[i].length + 1;
}

// AND TEST PREPEND
console.log('--- TEST PREPEND ---');
const mapperP = new SourceMapperLogic();
mapperP.add(magic, 0);
runPreprocess(code, mapperP, 0);

const oopsGenP = mapperP.code.indexOf('oops');
const oopsOrigP = mapperP.remap(oopsGenP);
console.log('Oops Gen Offset (Prepend):', oopsGenP);
console.log('Oops Orig Offset (Prepend):', oopsOrigP);

acc = 0;
for(let i=0; i<lines.length; i++) {
    if (oopsOrigP >= acc && oopsOrigP < acc + lines[i].length + 1) {
        console.log(`Found oops (Prepend) at LINE ${i+1}: ${lines[i]}`);
    }
    acc += lines[i].length + 1;
}

// Function to simulate runPreprocess enough for this test
function runPreprocess(text, mapper, globalOffset) {
    let i = 0;
    while (i < text.length) {
        if (text.startsWith('{for', i)) {
             const end = text.indexOf('}}', i) + 2;
             const content = text.slice(i, end);
             // Simple mock of RoundControlFlow transfo
             mapper.add('<RoundControlFlow kind="for" head={tokens}>', i);
             mapper.add(content.slice(1, -1), i + 1); // Not quite right but for offset test...
             mapper.add('</RoundControlFlow>', end);
             i = end;
             continue;
        }
        mapper.add(text[i], globalOffset + i);
        i++;
    }
}
