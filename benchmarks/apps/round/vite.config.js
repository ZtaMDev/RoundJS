import { defineConfig } from 'vite';
import RoundPlugin from 'round-core/vite-plugin'; // Use package export
import path from 'path';

export default defineConfig({
    root: __dirname,
    plugins: [
        RoundPlugin()
    ],
    build: {
        outDir: '../../dist-bench/round',
        emptyOutDir: true,
        minify: true
    }
});
