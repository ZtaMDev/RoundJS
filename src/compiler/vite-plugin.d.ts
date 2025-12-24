import { Plugin } from 'vite';

export interface RoundPluginOptions {
    configPath?: string;
    restartOnConfigChange?: boolean;
}

export default function RoundPlugin(options?: RoundPluginOptions): Plugin;
