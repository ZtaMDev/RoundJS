import { onMount, triggerUpdate, getCurrentComponent } from './lifecycle.js';
import { reportErrorSafe } from './error-reporter.js';

let context = null;
let batchCount = 0;
let pendingEffects = [];
let globalVersion = 0;

function isPromiseLike(v) {
    return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

function isSignalLike(v) {
    return typeof v === 'function' && typeof v.peek === 'function' && ('value' in v);
}

/**
 * Run a function without tracking any signals it reads.
 */
export function untrack(fn) {
    const prev = context;
    context = null;
    try {
        return typeof fn === 'function' ? fn() : undefined;
    } finally {
        context = prev;
    }
}

/**
 * Batches multiple signal updates into a single effect run.
 */
export function batch(fn) {
    batchCount++;
    try {
        return fn();
    } finally {
        if (--batchCount === 0) {
            const effects = pendingEffects;
            pendingEffects = [];
            for (let i = 0; i < effects.length; i++) {
                effects[i].queued = false;
                effects[i].run();
            }
        }
    }
}

function subscribe(sub, dep) {
    let link = sub.deps;
    while (link) {
        if (link.dep === dep) return;
        link = link.nextDep;
    }

    link = {
        sub,
        dep,
        nextSub: dep.subs,
        prevSub: null,
        nextDep: sub.deps,
        prevDep: null
    };

    if (dep.subs) dep.subs.prevSub = link;
    dep.subs = link;

    if (sub.deps) sub.deps.prevDep = link;
    sub.deps = link;
}

function cleanup(sub) {
    let link = sub.deps;
    while (link) {
        const { dep, prevSub, nextSub } = link;
        if (prevSub) prevSub.nextSub = nextSub;
        else dep.subs = nextSub;
        if (nextSub) nextSub.prevSub = prevSub;
        link = link.nextDep;
    }
    sub.deps = null;
}

function notify(dep) {
    let link = dep.subs;
    while (link) {
        const sub = link.sub;
        if (sub.isComputed) {
            sub.version = -1;
            notify(sub);
        } else {
            if (batchCount > 0) {
                if (!sub.queued) {
                    sub.queued = true;
                    pendingEffects.push(sub);
                }
            } else {
                sub.run();
            }
        }
        link = link.nextSub;
    }
}

/**
 * Create a reactive side-effect.
 */
export function effect(arg1, arg2, arg3) {
    let callback, explicitDeps = null, options = { onLoad: true };
    let owner = getCurrentComponent();

    if (typeof arg1 === 'function') {
        callback = arg1;
        if (arg2 && typeof arg2 === 'object') options = { ...options, ...arg2 };
    } else {
        explicitDeps = arg1; callback = arg2;
        if (arg3 && typeof arg3 === 'object') options = { ...options, ...arg3 };
    }

    const sub = {
        deps: null,
        queued: false,
        run() {
            if (this._cleanup) {
                try { this._cleanup(); } catch (e) {
                    reportErrorSafe(e, { phase: 'effect.cleanup', component: owner?.name });
                }
                this._cleanup = null;
            }
            cleanup(this);
            const prev = context;
            context = this;
            try {
                if (explicitDeps) {
                    if (Array.isArray(explicitDeps)) {
                        for (let i = 0; i < explicitDeps.length; i++) {
                            const d = explicitDeps[i];
                            if (typeof d === 'function') d();
                        }
                    } else if (typeof explicitDeps === 'function') {
                        explicitDeps();
                    }
                }
                const res = callback();
                if (typeof res === 'function') this._cleanup = res;
                if (owner?.isMounted) triggerUpdate(owner);
            } catch (e) {
                if (!isPromiseLike(e)) reportErrorSafe(e, { phase: 'effect', component: owner?.name });
                else throw e;
            } finally {
                context = prev;
            }
        },
        _cleanup: null
    };

    const dispose = () => {
        if (sub._cleanup) {
            try { sub._cleanup(); } catch (e) { }
            sub._cleanup = null;
        }
        cleanup(sub);
    };

    if (options.onLoad) {
        onMount(() => sub.run());
    } else {
        sub.run();
    }

    return dispose;
}

function defineBindMarkerIfNeeded(source, target) {
    if (source && source.bind === true) {
        try {
            Object.defineProperty(target, 'bind', { enumerable: true, value: true, configurable: true });
        } catch {
            target.bind = true;
        }
    }
}

function attachHelpers(s) {
    if (!s || typeof s !== 'function') return s;
    if (typeof s.transform === 'function' && typeof s.validate === 'function' && typeof s.$pick === 'function') return s;

    s.$pick = (p) => pick(s, p);

    s.transform = (fromInput, toOutput) => {
        const fromFn = typeof fromInput === 'function' ? fromInput : (v) => v;
        const toFn = typeof toOutput === 'function' ? toOutput : (v) => v;

        const wrapped = function (...args) {
            if (args.length > 0) return s(fromFn(args[0]));
            return toFn(s());
        };

        wrapped.peek = () => toFn(s.peek());
        Object.defineProperty(wrapped, 'value', {
            enumerable: true,
            configurable: true,
            get() { return wrapped.peek(); },
            set(v) { wrapped(v); }
        });

        defineBindMarkerIfNeeded(s, wrapped);
        return attachHelpers(wrapped);
    };

    s.validate = (validator, options = {}) => {
        const validateFn = typeof validator === 'function' ? validator : null;
        const error = signal(null);
        const validateOn = options?.validateOn || 'input';
        const validateInitial = !!options?.validateInitial;

        const wrapped = function (...args) {
            if (args.length > 0) {
                const next = args[0];
                if (validateFn) {
                    let res = true;
                    try { res = validateFn(next, s.peek()); } catch { res = 'Invalid value'; }

                    if (res === true || res === undefined || res === null) {
                        error(null);
                        return s(next);
                    }
                    error(typeof res === 'string' && res.length ? res : 'Invalid value');
                    return s.peek();
                }
                error(null);
                return s(next);
            }
            return s();
        };

        wrapped.check = () => {
            if (!validateFn) { error(null); return true; }
            const cur = s.peek();
            let res = true;
            try { res = validateFn(cur, cur); } catch { res = 'Invalid value'; }
            if (res === true || res === undefined || res === null) {
                error(null); return true;
            }
            error(typeof res === 'string' && res.length ? res : 'Invalid value');
            return false;
        };

        wrapped.peek = () => s.peek();
        Object.defineProperty(wrapped, 'value', {
            enumerable: true,
            configurable: true,
            get() { return wrapped.peek(); },
            set(v) { wrapped(v); }
        });

        wrapped.error = error;
        wrapped.__round_validateOn = validateOn;
        if (validateInitial) { try { wrapped.check(); } catch { } }
        defineBindMarkerIfNeeded(s, wrapped);
        return attachHelpers(wrapped);
    };

    return s;
}

/**
 * Create a reactive signal.
 */
export function signal(initialValue) {
    const dep = {
        value: initialValue,
        version: 0,
        subs: null
    };

    const s = function (newValue) {
        if (arguments.length > 0) {
            if (dep.value !== newValue) {
                dep.value = newValue;
                dep.version = ++globalVersion;
                notify(dep);
            }
            return dep.value;
        }
        if (context) subscribe(context, dep);
        return dep.value;
    };

    s.peek = () => dep.value;
    Object.defineProperty(s, 'value', {
        enumerable: true,
        configurable: true,
        get() { return s(); },
        set(v) { s(v); }
    });

    return attachHelpers(s);
}

/**
 * Create a bindable signal.
 */
export function bindable(initialValue) {
    const s = signal(initialValue);
    try {
        Object.defineProperty(s, 'bind', { enumerable: true, value: true, configurable: true });
    } catch {
        s.bind = true;
    }
    return attachHelpers(s);
}

/**
 * Create an async signal that loads data from an async function.
 * Provides pending, error, and refetch capabilities.
 * @param {Function} asyncFn - Async function that returns a promise
 * @param {Object} options - Options: { immediate: true }
 */
export function asyncSignal(asyncFn, options = {}) {
    if (typeof asyncFn !== 'function') {
        throw new Error('[round] asyncSignal() expects an async function.');
    }

    const immediate = options.immediate !== false;
    const data = signal(undefined);
    const pending = signal(immediate);
    const error = signal(null);

    let currentPromise = null;

    async function execute() {
        pending(true);
        error(null);

        try {
            const promise = asyncFn();
            currentPromise = promise;

            if (!isPromiseLike(promise)) {
                // Sync result
                data(promise);
                pending(false);
                return promise;
            }

            const result = await promise;

            // Only update if this is still the current request
            if (currentPromise === promise) {
                data(result);
                pending(false);
            }

            return result;
        } catch (e) {
            if (currentPromise !== null) {
                error(e);
                pending(false);
            }
            return undefined;
        }
    }

    // The main signal function - returns current data value
    const s = function (newValue) {
        if (arguments.length > 0) {
            return data(newValue);
        }
        if (context) {
            // Subscribe to all three signals for reactivity
            data();
        }
        return data.peek();
    };

    s.peek = () => data.peek();

    Object.defineProperty(s, 'value', {
        enumerable: true,
        configurable: true,
        get() { return s(); },
        set(v) { data(v); }
    });

    // Expose pending and error as signals
    s.pending = pending;
    s.error = error;

    // Refetch function
    s.refetch = execute;

    // Mark as async signal
    s.__asyncSignal = true;

    // Execute immediately if requested
    if (immediate) {
        execute();
    }

    return s;
}

function getIn(obj, path) {
    let cur = obj;
    for (let i = 0; i < path.length; i++) {
        if (cur == null) return undefined;
        cur = cur[path[i]];
    }
    return cur;
}

function setIn(obj, path, value) {
    if (!Array.isArray(path) || path.length === 0) return value;
    const root = (obj && typeof obj === 'object') ? obj : {};
    const out = Array.isArray(root) ? root.slice() : { ...root };
    let curOut = out;
    let curIn = root;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        const nextIn = (curIn && typeof curIn === 'object') ? curIn[key] : undefined;
        const nextOut = (nextIn && typeof nextIn === 'object')
            ? (Array.isArray(nextIn) ? nextIn.slice() : { ...nextIn })
            : {};
        curOut[key] = nextOut;
        curOut = nextOut;
        curIn = nextIn;
    }
    curOut[path[path.length - 1]] = value;
    return out;
}

function parsePath(path) {
    if (Array.isArray(path)) return path.map(p => String(p));
    if (typeof path === 'string') return path.split('.').filter(Boolean);
    return [String(path)];
}

/**
 * Create a read/write view of a specific path within a signal object.
 */
export function pick(root, path) {
    if (!isSignalLike(root)) throw new Error('[round] pick() expects a signal.');
    const pathArr = parsePath(path);

    const view = function (...args) {
        if (args.length > 0) {
            const nextRoot = setIn(root.peek(), pathArr, args[0]);
            return root(nextRoot);
        }
        const v = root();
        return getIn(v, pathArr);
    };

    view.peek = () => getIn(root.peek(), pathArr);
    Object.defineProperty(view, 'value', {
        enumerable: true,
        configurable: true,
        get() { return view.peek(); },
        set(v) { view(v); }
    });

    if (root.bind === true) {
        try { Object.defineProperty(view, 'bind', { enumerable: true, value: true, configurable: true }); }
        catch { view.bind = true; }
    }

    return view;
}

function createBindableObjectProxy(root, basePath) {
    const cache = new Map();
    const handler = {
        get(_target, prop) {
            if (prop === Symbol.toStringTag) return 'BindableObject';
            if (prop === 'peek') return () => (basePath.length ? pick(root, basePath).peek() : root.peek());
            if (prop === 'value') return (basePath.length ? pick(root, basePath).peek() : root.peek());
            if (prop === 'bind') return true;
            if (prop === '$pick') {
                return (p) => createBindableObjectProxy(root, basePath.concat(parsePath(p)));
            }
            if (prop === '_root') return root;
            if (prop === '_path') return basePath.slice();

            const key = String(prop);
            const nextPath = basePath.concat(key);
            const cacheKey = nextPath.join('.');
            if (cache.has(cacheKey)) return cache.get(cacheKey);

            try {
                const stored = getIn(root.peek(), nextPath);
                if (isSignalLike(stored)) { cache.set(cacheKey, stored); return stored; }
            } catch { }

            const next = createBindableObjectProxy(root, nextPath);
            cache.set(cacheKey, next);
            return next;
        },
        set(_target, prop, value) {
            const key = String(prop);
            const nextPath = basePath.concat(key);
            try {
                const stored = getIn(root.peek(), nextPath);
                if (isSignalLike(stored)) { stored(value); return true; }
            } catch { }
            pick(root, nextPath)(value);
            return true;
        },
        has(_target, prop) {
            if (prop === 'peek' || prop === 'value' || prop === 'bind' || prop === '$pick') return true;
            const v = basePath.length ? pick(root, basePath).peek() : root.peek();
            return v != null && Object.prototype.hasOwnProperty.call(v, prop);
        }
    };

    const fn = function (...args) {
        if (args.length > 0) return (basePath.length ? pick(root, basePath)(args[0]) : root(args[0]));
        return (basePath.length ? pick(root, basePath)() : root());
    };

    fn.peek = () => (basePath.length ? pick(root, basePath).peek() : root.peek());
    Object.defineProperty(fn, 'value', { enumerable: true, configurable: true, get() { return fn.peek(); }, set(v) { fn(v); } });
    try { Object.defineProperty(fn, 'bind', { enumerable: true, value: true, configurable: true }); }
    catch { fn.bind = true; }

    return new Proxy(fn, handler);
}

bindable.object = function (initialObject = {}) {
    const root = bindable((initialObject && typeof initialObject === 'object') ? initialObject : {});
    return createBindableObjectProxy(root, []);
};

/**
 * Create a read-only computed signal.
 */
export function derive(fn) {
    const dep = {
        fn,
        value: undefined,
        version: -1,
        depsVersion: -1,
        subs: null,
        deps: null,
        isComputed: true,
        run() {
            cleanup(this);
            const prev = context;
            context = this;
            try {
                this.value = this.fn();
                this.depsVersion = globalVersion;
                this.version = ++globalVersion;
            } finally {
                context = prev;
            }
        }
    };

    const s = function () {
        if (dep.version === -1 || dep.depsVersion < globalVersion) dep.run();
        if (context) subscribe(context, dep);
        return dep.value;
    };

    s.peek = () => {
        if (dep.version === -1 || dep.depsVersion < globalVersion) dep.run();
        return dep.value;
    };

    Object.defineProperty(s, 'value', { enumerable: true, configurable: true, get() { return s(); } });

    return attachHelpers(s);
}
