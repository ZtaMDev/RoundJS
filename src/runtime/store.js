import { bindable, effect } from './signals.js';
import { reportErrorSafe } from './error-reporter.js';

function hasWindow() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Create a shared global state store with actions and optional persistence.
 * @template T
 * @param {T} [initialState={}] Initial state object.
 * @param {Record<string, (state: T, ...args: any[]) => any>} [actions] Action reducers.
 * @returns {RoundStore<T>} The store object.
 */
export function createStore(initialState = {}, actions = null) {
    const state = (initialState && typeof initialState === 'object') ? initialState : {};
    const signals = Object.create(null);
    const persistState = {
        enabled: false,
        key: null,
        storage: null,
        persisting: false,
        persistNow: null,
        watchers: new Set()
    };

    for (const k of Object.keys(state)) {
        signals[k] = bindable(state[k]);
    }

    function setKey(k, v) {
        const key = String(k);
        if (!Object.prototype.hasOwnProperty.call(signals, key)) {
            signals[key] = bindable(state[key]);
        }
        state[key] = v;
        signals[key](v);
        if (persistState.enabled && typeof persistState.persistNow === 'function') {
            persistState.persistNow();
        }
        return v;
    }

    function patch(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
            setKey(k, v);
        }
    }

    function getSnapshot(reactive = false) {
        const out = {};
        for (const k of Object.keys(signals)) {
            out[k] = reactive ? signals[k]() : signals[k].peek();
        }
        return out;
    }

    const store = {
        use(key) {
            const k = String(key);
            if (!Object.prototype.hasOwnProperty.call(signals, k)) {
                signals[k] = bindable(state[k]);
                if (!Object.prototype.hasOwnProperty.call(state, k)) {
                    try {
                        reportErrorSafe(new Error(`Store key not found: ${k}`), { phase: 'store.use', component: 'createStore' });
                    } catch {
                    }
                }
            }

            if (persistState.enabled) {
                const sig = signals[k];
                if (sig && typeof sig === 'function' && !persistState.watchers.has(k)) {
                    persistState.watchers.add(k);
                    effect(() => {
                        sig();
                        if (persistState.persisting) return;
                        if (typeof persistState.persistNow === 'function') persistState.persistNow();
                    }, { onLoad: false });
                }
            }

            return signals[k];
        },
        set(key, value) {
            return setKey(key, value);
        },
        patch,
        snapshot(options = {}) {
            const reactive = options && typeof options === 'object' && options.reactive === true;
            return getSnapshot(reactive);
        },
        actions: {}
    };

    if (actions && typeof actions === 'object') {
        Object.entries(actions).forEach(([name, reducer]) => {
            if (typeof reducer !== 'function') return;
            const fn = (...args) => {
                try {
                    const next = reducer(getSnapshot(false), ...args);
                    if (next && typeof next === 'object') {
                        patch(next);
                    }
                    return next;
                } catch (e) {
                    reportErrorSafe(e, { phase: 'store.action', component: String(name) });
                }
            };
            store.actions[name] = fn;
            store[name] = fn;
        });
    }

    store.persist = (storageKey, optionsOrStorage) => {
        if (typeof storageKey !== 'string' || !storageKey.length) return store;

        const isStorageLike = optionsOrStorage
            && (typeof optionsOrStorage.getItem === 'function')
            && (typeof optionsOrStorage.setItem === 'function');

        const opts = (!isStorageLike && optionsOrStorage && typeof optionsOrStorage === 'object')
            ? optionsOrStorage
            : {};

        const st = isStorageLike
            ? optionsOrStorage
            : (opts.storage ?? (hasWindow() ? window.localStorage : null));

        if (!st || typeof st.getItem !== 'function' || typeof st.setItem !== 'function') return store;

        const debounceMs = Number.isFinite(Number(opts.debounce)) ? Number(opts.debounce) : 0;
        const exclude = Array.isArray(opts.exclude) ? opts.exclude.map(String) : [];

        try {
            const raw = st.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    const filtered = exclude.length
                        ? Object.fromEntries(Object.entries(parsed).filter(([k]) => !exclude.includes(String(k))))
                        : parsed;
                    patch(filtered);
                }
            }
        } catch {
        }

        const persistNow = () => {
            try {
                persistState.persisting = true;
                const snap = getSnapshot(false);
                const out = exclude.length
                    ? Object.fromEntries(Object.entries(snap).filter(([k]) => !exclude.includes(String(k))))
                    : snap;
                st.setItem(storageKey, JSON.stringify(out));
            } catch {
            } finally {
                persistState.persisting = false;
            }
        };

        let debounceId = null;
        const schedulePersist = () => {
            if (debounceMs <= 0) return persistNow();
            try {
                if (debounceId != null) clearTimeout(debounceId);
            } catch {
            }
            debounceId = setTimeout(() => {
                debounceId = null;
                persistNow();
            }, debounceMs);
        };

        persistState.enabled = true;
        persistState.key = storageKey;
        persistState.storage = st;
        persistState.persistNow = schedulePersist;

        const origSet = store.set;
        store.set = (k, v) => {
            const res = origSet(k, v);
            schedulePersist();
            return res;
        };

        const origPatch = store.patch;
        store.patch = (obj) => {
            origPatch(obj);
            schedulePersist();
        };

        Object.keys(store.actions).forEach((name) => {
            const orig = store.actions[name];
            if (typeof orig !== 'function') return;
            store.actions[name] = (...args) => {
                const res = orig(...args);
                schedulePersist();
                return res;
            };
            store[name] = store.actions[name];
        });

        Object.keys(signals).forEach((k) => {
            try { store.use(k); } catch { }
        });

        schedulePersist();
        return store;
    };

    return store;
}
