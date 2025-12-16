import { createElement } from './dom.js';
import { clearErrors, useErrors, reportError } from './error-store.js';

export { reportError } from './error-store.js';

export function ErrorProvider(props = {}) {
    return createElement('span', { style: { display: 'contents' } }, () => {
        const list = useErrors()();
        if (!Array.isArray(list) || list.length === 0) return props.children ?? null;

        const first = list[0];

        return createElement(
            'div',
            {
                style: {
                    position: 'fixed',
                    inset: '0',
                    zIndex: 2147483647,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px',
                    background: 'rgba(17, 24, 39, 0.72)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)'
                }
            },
            createElement(
                'div',
                {
                    style: {
                        width: 'min(900px, 100%)',
                        borderRadius: '14px',
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(0,0,0,0.55)',
                        boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
                        color: '#fff',
                        overflow: 'hidden'
                    }
                },
                createElement(
                    'div',
                    {
                        style: {
                            padding: '14px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            borderBottom: '1px solid rgba(255,255,255,0.10)',
                            background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0))'
                        }
                    },
                    createElement('div', {
                        style: {
                            width: '10px',
                            height: '10px',
                            borderRadius: '999px',
                            background: '#ef4444',
                            boxShadow: '0 0 0 4px rgba(239,68,68,0.18)'
                        }
                    }),
                    createElement('strong', { style: { fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' } }, 'Round Error'),
                    createElement('span', { style: { opacity: 0.75, fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial', fontSize: '12px' } }, new Date(first.time).toLocaleString()),
                    createElement('button', {
                        style: {
                            marginLeft: 'auto',
                            border: '1px solid rgba(255,255,255,0.16)',
                            background: 'rgba(255,255,255,0.08)',
                            color: '#fff',
                            padding: '8px 10px',
                            borderRadius: '10px',
                            cursor: 'pointer'
                        },
                        onMouseOver: (e) => { try { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; } catch { } },
                        onMouseOut: (e) => { try { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; } catch { } },
                        onClick: () => clearErrors()
                    }, 'Dismiss')
                ),
                createElement(
                    'div',
                    {
                        style: {
                            padding: '16px',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                        }
                    },
                    createElement('div', { style: { fontSize: '14px', fontWeight: '700' } }, String(first.message ?? 'Error')),
                    createElement(
                        'div',
                        { style: { marginTop: '10px', opacity: 0.85, fontSize: '12px', lineHeight: '18px' } },
                        first.component ? createElement('div', null, createElement('span', { style: { opacity: 0.75 } }, 'Component: '), String(first.component)) : null,
                        first.phase ? createElement('div', null, createElement('span', { style: { opacity: 0.75 } }, 'Phase: '), String(first.phase)) : null
                    ),
                    first.stack
                        ? createElement('pre', {
                            style: {
                                marginTop: '12px',
                                padding: '12px',
                                borderRadius: '12px',
                                background: 'rgba(0,0,0,0.55)',
                                border: '1px solid rgba(255,255,255,0.10)',
                                whiteSpace: 'pre-wrap',
                                fontSize: '12px',
                                lineHeight: '18px',
                                overflow: 'auto',
                                maxHeight: '55vh'
                            }
                        }, String(first.stack))
                        : null
                )
            )
        );
    });
}

export function initErrorHandling(container) {
    if (typeof document === 'undefined') return;
    if (!container || !(container instanceof Element)) return;

    if (!document.querySelector('[data-round-error-style="1"]')) {
        const style = document.createElement('style');
        style.setAttribute('data-round-error-style', '1');
        style.textContent = `
[data-round-error-root="1"] pre{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.28) rgba(255,255,255,0.06);}
[data-round-error-root="1"] pre::-webkit-scrollbar{width:10px;height:10px;}
[data-round-error-root="1"] pre::-webkit-scrollbar-track{background:rgba(255,255,255,0.06);border-radius:999px;}
[data-round-error-root="1"] pre::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.22);border-radius:999px;border:2px solid rgba(0,0,0,0.35);}
[data-round-error-root="1"] pre::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.32);}
        `.trim();
        document.head.appendChild(style);
    }

    if (!document.querySelector('[data-round-error-root="1"]')) {
        const root = document.createElement('div');
        root.setAttribute('data-round-error-root', '1');
        container.appendChild(root);
        root.appendChild(createElement(ErrorProvider, null));
    }

    if (!window.__round_error_handlers_installed) {
        window.__round_error_handlers_installed = true;

        window.addEventListener('error', (e) => {
            reportError(e?.error ?? e?.message ?? e, { phase: 'window.error' });
        });

        window.addEventListener('unhandledrejection', (e) => {
            reportError(e?.reason ?? e, { phase: 'window.unhandledrejection' });
        });
    }
}
