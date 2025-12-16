import { signal } from './signals.js';
import { setErrorReporter } from './error-reporter.js';

const errors = signal([]);

let lastSentKey = null;
let lastSentAt = 0;

let lastStoredKey = null;
let lastStoredAt = 0;

export function reportError(error, info = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    const stack = err.stack ? String(err.stack) : '';
    const message = err.message;
    const phase = info.phase ?? null;
    const component = info.component ?? null;
    const key = `${message}|${component ?? ''}|${phase ?? ''}|${stack}`;
    const now = Date.now();

    if (lastStoredKey === key && (now - lastStoredAt) < 1500) {
        return;
    }
    lastStoredKey = key;
    lastStoredAt = now;

    const entry = {
        error: err,
        message,
        stack,
        phase,
        component,
        time: now
    };

    const current = typeof errors.peek === 'function' ? errors.peek() : errors();
    errors([entry, ...(Array.isArray(current) ? current : [])]);

    try {
        const where = entry.component ? ` in ${entry.component}` : '';
        const phase = entry.phase ? ` (${entry.phase})` : '';
        const label = `[round] Runtime error${where}${phase}`;

        if (typeof console.groupCollapsed === 'function') {
            console.groupCollapsed(label);
            console.error(entry.error);
            if (entry.stack) console.log(entry.stack);
            if (info && Object.keys(info).length) console.log('info:', info);
            console.groupEnd();
        } else {
            console.error(label);
            console.error(entry.error);
            if (entry.stack) console.log(entry.stack);
            if (info && Object.keys(info).length) console.log('info:', info);
        }
    } catch {
    }

    try {
        if (import.meta?.hot && typeof import.meta.hot.send === 'function') {
            if (lastSentKey !== key || (now - lastSentAt) > 1500) {
                lastSentKey = key;
                lastSentAt = now;
                import.meta.hot.send('round:runtime-error', {
                    message: entry.message,
                    stack: entry.stack ? String(entry.stack) : '',
                    phase: entry.phase,
                    component: entry.component,
                    time: entry.time
                });
            }
        }
    } catch {
    }
}

export function clearErrors() {
    errors([]);
}

export function useErrors() {
    return errors;
}

setErrorReporter(reportError);
