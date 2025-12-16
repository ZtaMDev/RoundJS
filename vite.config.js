import { defineConfig } from 'vite';
import RoundPlugin from './src/compiler/vite-plugin.js';

export default defineConfig({
    plugins: [RoundPlugin({ configPath: './start_exmpl/round.config.json' })],
    root: './', // Serve from root
    server: {
        port: 3000
    }
});
