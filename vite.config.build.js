import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

// Custom plugin to move .d.ts files or raw assets if needed, 
// for now we just handle JS bundling.

// Custom plugin to move .d.ts files or raw assets if needed, 
// for now we just handle JS bundling.

export default defineConfig({
    build: {
        // Target modern environments
        target: 'es2022',
        outDir: 'dist',
        emptyOutDir: true,
        minify: false, // User can enable if they want extreme minification, but for a lib readable code is nice. 
        // Wait, user asked for "extremo rapido y liviano" (extremely fast and light). 
        // So I SHOULD minify.
        lib: {
            entry: {
                index: path.resolve(__dirname, 'src/index.js'),
                cli: path.resolve(__dirname, 'src/cli.js'),
                // We expose the plugin separately so users can import it in their vite.config.js
                'vite-plugin': path.resolve(__dirname, 'src/compiler/vite-plugin.js')
            },
            formats: ['es'] // ESM only is fine for modern "type": "module" package
        },
        rollupOptions: {
            // Externalize dependencies so they aren't bundled into the library
            external: [
                'vite',
                'marked',
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
});
