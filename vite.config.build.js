import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

export default defineConfig({
    build: {
        target: 'es2022',
        outDir: 'dist',
        emptyOutDir: true,
        minify: false,
        lib: {
            entry: {
                index: path.resolve(__dirname, 'src/index.js'),
                cli: path.resolve(__dirname, 'src/cli.js'),
                'vite-plugin': path.resolve(__dirname, 'src/compiler/vite-plugin.js')
            },
            formats: ['es']
        },
        rollupOptions: {
            external: [
                'vite',
                'node:fs', 'node:path', 'node:process', 'node:url', 'node:vm', 'node:util',
                'fs', 'path', 'process', 'url', 'vm', 'util'
            ],
            output: {
                banner: (chunk) => {
                    if (chunk.name === 'cli' || chunk.fileName === 'cli.js') {
                        return '#!/usr/bin/env node';
                    }
                    return '';
                }
            }
        },
    },
    esbuild: {
        keepNames: true
    },
    plugins: [
        {
            name: 'copy-dts',
            closeBundle() {
                const src = path.resolve(__dirname, 'src/index.d.ts');
                const dest = path.resolve(__dirname, 'dist/index.d.ts');
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, dest);
                }
            }
        }
    ]
});
