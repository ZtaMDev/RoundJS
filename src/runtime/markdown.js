import { signal } from './signals.js';
import { onMount } from './lifecycle.js';
import { createElement } from './dom.js';
import { marked } from 'marked';
import { reportErrorSafe } from './error-reporter.js';

const mdLoaders = (typeof import.meta !== 'undefined' && typeof import.meta.glob === 'function')
    ? import.meta.glob('/src/**/*.md', { query: '?raw', import: 'default' })
    : {};

export function Markdown(props = {}) {
    const html = signal('');

    const parse = (md) => {
        try {
            return marked.parse(md ?? '');
        } catch {
            return '';
        }
    };

    if (typeof props.content === 'string') {
        html(parse(props.content));
    }

    onMount(async () => {
        if (typeof props.src !== 'string') return;

        const base = typeof props.base === 'string' ? props.base : '/src';
        const resolved = props.src.startsWith('./') ? (base + props.src.slice(1)) : props.src;

        const loader = mdLoaders[resolved];
        if (typeof loader === 'function') {
            try {
                const text = await loader();
                html(parse(text ?? ''));
                return;
            } catch (e) {
                reportErrorSafe(e instanceof Error ? e : new Error(`Failed to load markdown: ${resolved}`), { phase: 'markdown.load', component: 'Markdown' });
                html('');
                return;
            }
        }

        try {
            const r = await fetch(resolved);
            if (!r.ok) {
                reportErrorSafe(new Error(`Markdown not found: ${resolved} (HTTP ${r.status})`), { phase: 'markdown.fetch', component: 'Markdown' });
                html('');
                return;
            }
            const text = await r.text();

            const looksLikeHtml = /^\s*<!doctype\s+html\b|^\s*<html\b/i.test(text);
            if (looksLikeHtml) {
                reportErrorSafe(new Error(`Markdown not found (served HTML fallback): ${resolved}`), { phase: 'markdown.fetch', component: 'Markdown' });
                html('');
                return;
            }
            html(parse(text));
        } catch (e) {
            reportErrorSafe(e instanceof Error ? e : new Error(`Failed to fetch markdown: ${resolved}`), { phase: 'markdown.fetch', component: 'Markdown' });
            html('');
        }
    });

    const className = props.className ?? props.theme ?? '';
    return createElement('div', {
        className,
        dangerouslySetInnerHTML: () => ({ __html: html() })
    });
}