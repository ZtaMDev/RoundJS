import { onMount, triggerUpdate, getCurrentComponent } from './lifecycle.js';
import { reportErrorSafe } from './error-reporter.js';

let context = [];

function isPromiseLike(v) {
    return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

function subscribe(running, subscriptions) {
    subscriptions.add(running);
    running.dependencies.add(subscriptions);
}

export function untrack(fn) {
    context.push(null);
    try {
        return typeof fn === 'function' ? fn() : undefined;
    } finally {
        context.pop();
    }
}

export function effect(arg1, arg2, arg3) {
    let callback;
    let explicitDeps = null;
    let options = { onLoad: true };

    let owner = getCurrentComponent();

    if (typeof arg1 === 'function') {
        callback = arg1;
        if (arg2 && typeof arg2 === 'object') {
            options = { ...options, ...arg2 };
        }
    } else {
        explicitDeps = arg1;
        callback = arg2;
        if (arg3 && typeof arg3 === 'object') {
            options = { ...options, ...arg3 };
        }
    }

    const execute = () => {
        if (typeof execute._cleanup === 'function') {
            try {
                execute._cleanup();
            } catch (e) {
                const name = owner ? (owner.name ?? 'Anonymous') : null;
                reportErrorSafe(e, { phase: 'effect.cleanup', component: name });
            }
            execute._cleanup = null;
        }

        cleanup(execute);
        context.push(execute);
        try {
            if (explicitDeps) {
                if (Array.isArray(explicitDeps)) {
                    explicitDeps.forEach(dep => {
                        if (typeof dep === 'function') dep();
                    });
                } else if (typeof explicitDeps === 'function') {
                    explicitDeps();
                }
            }
            if (typeof callback === 'function') {
                const res = callback();
                if (typeof res === 'function') {
                    execute._cleanup = res;
                }
            }

            if (owner && owner.isMounted) triggerUpdate(owner);

        } catch (e) {
            if (isPromiseLike(e)) throw e;
            const name = owner ? (owner.name ?? 'Anonymous') : null;
            reportErrorSafe(e, { phase: 'effect', component: name });
        } finally {
            context.pop();
        }
    };

    execute.dependencies = new Set();
    execute._cleanup = null;

    if (options.onLoad) {
        onMount(execute);
    } else {
        execute();
    }

    return () => {
        if (typeof execute._cleanup === 'function') {
            try {
                execute._cleanup();
            } catch (e) {
                const name = owner ? (owner.name ?? 'Anonymous') : null;
                reportErrorSafe(e, { phase: 'effect.cleanup', component: name });
            }
        }
        execute._cleanup = null;
        cleanup(execute);
    };
}

function cleanup(running) {
    running.dependencies.forEach(dep => dep.delete(running));
    running.dependencies.clear();
}

function defineBindMarkerIfNeeded(source, target) {
    if (source && source.bind === true) {
        try {
            Object.defineProperty(target, 'bind', {
                enumerable: true,
                configurable: false,
                writable: false,
                value: true
            });
        } catch {
            try { target.bind = true; } catch { }
        }
    }
}

function attachHelpers(s) {
    if (!s || typeof s !== 'function') return s;
    if (typeof s.transform === 'function' && typeof s.validate === 'function' && typeof s.$pick === 'function') return s;

    s.$pick = (p) => {
        return pick(s, p);
    };

    s.transform = (fromInput, toOutput) => {
        const fromFn = typeof fromInput === 'function' ? fromInput : (v) => v;
        const toFn = typeof toOutput === 'function' ? toOutput : (v) => v;

        const wrapped = function (...args) {
            if (args.length > 0) {
                return s(fromFn(args[0]));
            }
            return toFn(s());
        };

        wrapped.peek = () => toFn(s.peek());
        Object.defineProperty(wrapped, 'value', {
            enumerable: true,
            get() {
                return wrapped.peek();
            },
            set(v) {
                wrapped(v);
            }
        });

        defineBindMarkerIfNeeded(s, wrapped);
        return attachHelpers(wrapped);
    };

    s.validate = (validator, options = {}) => {
        const validateFn = typeof validator === 'function' ? validator : null;
        const error = signal(null);
        const validateOn = (options && typeof options === 'object' && typeof options.validateOn === 'string')
            ? options.validateOn
            : 'input';
        const validateInitial = Boolean(options && typeof options === 'object' && options.validateInitial);

        const wrapped = function (...args) {
            if (args.length > 0) {
                const next = args[0];
                if (validateFn) {
                    let res = true;
                    try {
                        res = validateFn(next, s.peek());
                    } catch {
                        res = 'Invalid value';
                    }

                    if (res === true || res === undefined || res === null) {
                        error(null);
                        return s(next);
                    }

                    if (typeof res === 'string' && res.length) {
                        error(res);
                    } else {
                        error('Invalid value');
                    }
                    return s.peek();
                }

                error(null);
                return s(next);
            }
            return s();
        };

        wrapped.check = () => {
            if (!validateFn) {
                error(null);
                return true;
            }
            const cur = s.peek();
            let res = true;
            try {
                res = validateFn(cur, cur);
            } catch {
                res = 'Invalid value';
            }
            if (res === true || res === undefined || res === null) {
                error(null);
                return true;
            }
            if (typeof res === 'string' && res.length) error(res);
            else error('Invalid value');
            return false;
        };

        wrapped.peek = () => s.peek();
        Object.defineProperty(wrapped, 'value', {
            enumerable: true,
            get() {
                return wrapped.peek();
            },
            set(v) {
                wrapped(v);
            }
        });

        wrapped.error = error;
        wrapped.__round_validateOn = validateOn;
        if (validateInitial) {
            try { wrapped.check(); } catch { }
        }
        defineBindMarkerIfNeeded(s, wrapped);
        return attachHelpers(wrapped);
    };

    return s;
}

export function signal(initialValue) {
    let value = initialValue;
    const subscriptions = new Set();

    const read = () => {
        const running = context[context.length - 1];
        if (running) {
            subscribe(running, subscriptions);
        }
        return value;
    };

    const peek = () => value;

    const write = (newValue) => {
        if (value !== newValue) {
            value = newValue;
            [...subscriptions].forEach(sub => sub());
        }
        return value;
    };

    const signal = function (...args) {
        if (args.length > 0) {
            return write(args[0]);
        }
        return read();
    };

    Object.defineProperty(signal, 'value', {
        enumerable: true,
        get() {
            return peek();
        },
        set(v) {
            write(v);
        }
    });

    signal.peek = peek;

    return attachHelpers(signal);
}

export function bindable(initialValue) {
    const s = signal(initialValue);
    try {
        Object.defineProperty(s, 'bind', {
            enumerable: true,
            configurable: false,
            writable: false,
            value: true
        });
    } catch {
        // Fallback if defineProperty fails
        try { s.bind = true; } catch { }
    }
    return attachHelpers(s);
}

function isSignalLike(v) {
    return typeof v === 'function' && typeof v.peek === 'function' && ('value' in v);
}

function getIn(obj, path) {
    let cur = obj;
    for (const key of path) {
        if (cur == null) return undefined;
        cur = cur[key];
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

export function pick(root, path) {
    if (!isSignalLike(root)) {
        throw new Error('[round] pick(root, path) expects root to be a signal (use bindable.object(...) or signal({...})).');
    }
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
        get() {
            return view.peek();
        },
        set(v) {
            view(v);
        }
    });

    if (root.bind === true) {
        try {
            Object.defineProperty(view, 'bind', {
                enumerable: true,
                configurable: false,
                writable: false,
                value: true
            });
        } catch {
            try { view.bind = true; } catch { }
        }
    }

    return view;
}

function createBindableObjectProxy(root, basePath) {
    const cache = new Map();

    const handler = {
        get(_target, prop) {
            if (prop === Symbol.toStringTag) return 'BindableObject';
            if (prop === Symbol.iterator) return undefined;
            if (prop === 'peek') return () => (basePath.length ? pick(root, basePath).peek() : root.peek());
            if (prop === 'value') return (basePath.length ? pick(root, basePath).peek() : root.peek());
            if (prop === 'bind') return true;
            if (prop === '$pick') {
                return (p) => {
                    const nextPath = basePath.concat(parsePath(p));
                    return createBindableObjectProxy(root, nextPath);
                };
            }
            if (prop === '_root') return root;
            if (prop === '_path') return basePath.slice();

            // Allow calling the proxy (it's a function proxy below)
            if (prop === 'call' || prop === 'apply') {
                return Reflect.get(_target, prop);
            }

            const key = String(prop);
            const nextPath = basePath.concat(key);
            const cacheKey = nextPath.join('.');
            if (cache.has(cacheKey)) return cache.get(cacheKey);

            // If the stored value at this path is itself a signal/bindable, return it directly.
            // This enables bindable.object({ email: bindable('').validate(...) }) patterns.
            try {
                const stored = getIn(root.peek(), nextPath);
                if (isSignalLike(stored)) {
                    cache.set(cacheKey, stored);
                    return stored;
                }
            } catch {
            }

            const next = createBindableObjectProxy(root, nextPath);
            cache.set(cacheKey, next);
            return next;
        },
        set(_target, prop, value) {
            const key = String(prop);
            const nextPath = basePath.concat(key);
            try {
                const stored = getIn(root.peek(), nextPath);
                if (isSignalLike(stored)) {
                    stored(value);
                    return true;
                }
            } catch {
            }
            pick(root, nextPath)(value);
            return true;
        },
        has(_target, prop) {
            // IMPORTANT: Proxy invariants require that if the target has a non-configurable
            // property, the `has` trap must return true.
            try {
                if (Reflect.has(_target, prop)) return true;
            } catch {
            }

            const v = basePath.length ? pick(root, basePath).peek() : root.peek();
            return v != null && Object.prototype.hasOwnProperty.call(v, prop);
        }
    };

    // Function proxy so you can do user() / user.name() etc.
    const fn = function (...args) {
        if (args.length > 0) {
            if (basePath.length) return pick(root, basePath)(args[0]);
            return root(args[0]);
        }
        if (basePath.length) return pick(root, basePath)();
        return root();
    };

    // Make it signal-like
    fn.peek = () => (basePath.length ? pick(root, basePath).peek() : root.peek());
    Object.defineProperty(fn, 'value', {
        enumerable: true,
        get() {
            return fn.peek();
        },
        set(v) {
            fn(v);
        }
    });

    try {
        Object.defineProperty(fn, 'bind', {
            enumerable: true,
            configurable: false,
            writable: false,
            value: true
        });
    } catch {
        try { fn.bind = true; } catch { }
    }

    return new Proxy(fn, handler);
}

bindable.object = function (initialObject = {}) {
    const root = bindable((initialObject && typeof initialObject === 'object') ? initialObject : {});
    return createBindableObjectProxy(root, []);
};

export function derive(fn) {
    const derived = signal();

    effect(() => {
        derived(fn());
    }, { onLoad: false });

    return () => derived();
}
