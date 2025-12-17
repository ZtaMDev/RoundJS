import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function getDirSize(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    const files = fs.readdirSync(dirPath);
    let size = 0;
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            size += getDirSize(filePath);
        } else {
            size += stats.size;
        }
    }
    return size;
}

function runBenchmark(name, configPath) {
    console.log(`\nStarting build benchmark for ${name}...`);
    const start = performance.now();
    try {
        execSync(`npx vite build -c ${configPath}`, { stdio: 'inherit', cwd: rootDir });
    } catch (e) {
        console.error(`Build failed for ${name}`);
        return null;
    }
    const end = performance.now();
    const duration = (end - start).toFixed(2);

    // Check dist size
    const distPath = path.resolve(rootDir, `dist-bench/${name}`);
    const sizeBytes = getDirSize(distPath);
    const sizeKB = (sizeBytes / 1024).toFixed(2);

    console.log(`${name} Build Time: ${duration}ms`);
    console.log(`${name} Bundle Size: ${sizeKB} KB`);

    return { name, duration: parseFloat(duration), size: parseFloat(sizeKB) };
}

const roundResult = runBenchmark('round', './apps/round/vite.config.js');
const reactResult = runBenchmark('react', './apps/react/vite.config.js');

if (roundResult && reactResult) {
    console.log('\n--- Final Comparison ---');
    console.log(`Build Speed: Round is ${(reactResult.duration / roundResult.duration).toFixed(2)}x faster`);
    console.log(`Bundle Size: Round is ${(reactResult.size / roundResult.size).toFixed(2)}x smaller`);

    // Save report
    const report = {
        timestamp: new Date().toISOString(),
        round: roundResult,
        react: reactResult
    };
    if (!fs.existsSync('./reports')) fs.mkdirSync('./reports');
    fs.writeFileSync('./reports/build-bench.json', JSON.stringify(report, null, 2));
}
