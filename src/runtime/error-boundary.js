import { signal } from './signals.js';
import { createElement } from './dom.js';
import { reportError } from './error-store.js';

export function ErrorBoundary(props = {}) {
    const error = signal(null);

    const name = props.name ?? 'ErrorBoundary';
    const fallback = props.fallback;
    const resetKey = props.resetKey;

    let lastResetKey = resetKey;

    return createElement('span', { style: { display: 'contents' } }, () => {
        if (resetKey !== undefined && resetKey !== lastResetKey) {
            lastResetKey = resetKey;
            if (error()) error(null);
        }

        const err = error();
        if (err) {
            if (typeof fallback === 'function') {
                try {
                    return fallback({ error: err });
                } catch (e) {
                    reportError(e, { phase: 'ErrorBoundary.fallback', component: name });
                    return createElement('div', { style: { padding: '16px' } }, 'ErrorBoundary fallback crashed');
                }
            }
            if (fallback !== undefined) return fallback;
            return createElement('div', { style: { padding: '16px' } }, 'Something went wrong.');
        }

        const renderFn = (typeof props.render === 'function')
            ? props.render
            : (typeof props.children === 'function' ? props.children : null);

        if (typeof renderFn !== 'function') return props.children ?? null;

        try {
            return renderFn();
        } catch (e) {
            if (!error() || error() !== e) error(e);
            reportError(e, { phase: 'ErrorBoundary.render', component: name });
            return null;
        }
    });
}
