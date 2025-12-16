import { signal } from './signals.js';
import { createElement, Fragment } from './dom.js';

function isPromiseLike(v) {
    return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

export function lazy(loader) {
    if (typeof loader !== 'function') {
        throw new Error('lazy(loader) expects a function that returns a Promise');
    }

    let status = 'uninitialized';
    let promise = null;
    let component = null;
    let error = null;

    function pickComponent(mod) {
        if (!mod) return null;
        if (typeof mod === 'function') return mod;
        if (typeof mod.default === 'function') return mod.default;
        if (typeof mod.Counter === 'function') return mod.Counter;

        const fns = [];
        for (const k of Object.keys(mod)) {
            if (typeof mod[k] === 'function') fns.push(mod[k]);
        }
        if (fns.length === 1) return fns[0];
        return null;
    }

    return function LazyComponent(props = {}) {
        if (status === 'resolved') {
            return createElement(component, props);
        }

        if (status === 'rejected') {
            throw error;
        }

        if (!promise) {
            status = 'pending';
            try {
                promise = Promise.resolve(loader())
                    .then((mod) => {
                        const resolved = pickComponent(mod);
                        if (typeof resolved !== 'function') {
                            throw new Error('lazy() loaded module does not export a component');
                        }
                        component = resolved;
                        status = 'resolved';
                    })
                    .catch((e) => {
                        error = e instanceof Error ? e : new Error(String(e));
                        status = 'rejected';
                    });
            } catch (e) {
                error = e instanceof Error ? e : new Error(String(e));
                status = 'rejected';
                throw error;
            }
        }

        throw promise;
    };
}

export function Suspense(props = {}) {
    const tick = signal(0);
    let lastPromise = null;

    const child = Array.isArray(props.children) ? props.children[0] : props.children;
    const childFn = typeof child === 'function' ? child : () => child;

    return createElement('span', { style: { display: 'contents' } }, () => {
        tick();

        try {
            const res = childFn();
            if (isPromiseLike(res)) {
                if (lastPromise !== res) {
                    lastPromise = res;
                    res.then(
                        () => tick(tick.peek() + 1),
                        () => tick(tick.peek() + 1)
                    );
                }
                return props.fallback ?? null;
            }
            lastPromise = null;
            return res ?? null;
        } catch (e) {
            if (isPromiseLike(e)) {
                if (lastPromise !== e) {
                    lastPromise = e;
                    e.then(
                        () => tick(tick.peek() + 1),
                        () => tick(tick.peek() + 1)
                    );
                }
                return props.fallback ?? null;
            }
            throw e;
        }
    });
}
