import { createElement } from './dom.js';

let nextContextId = 1;
const contextStack = [];

function pushContext(values) {
    contextStack.push(values);
}

function popContext() {
    contextStack.pop();
}

export function readContext(ctx) {
    for (let i = contextStack.length - 1; i >= 0; i--) {
        const layer = contextStack[i];
        if (layer && Object.prototype.hasOwnProperty.call(layer, ctx.id)) {
            return layer[ctx.id];
        }
    }
    return ctx.defaultValue;
}

export function createContext(defaultValue) {
    const ctx = {
        id: nextContextId++,
        defaultValue,
        Provider: null
    };

    function Provider(props = {}) {
        const children = props.children;

        // Push context now so that any createElement/appendChild called 
        // during the instantiation of this Provider branch picks it up immediately.
        pushContext({ [ctx.id]: props.value });
        try {
            // We use a span to handle reactive value updates and dynamic children.
            return createElement('span', { style: { display: 'contents' } }, () => {
                // Read current value (reactive if it's a signal)
                const val = (typeof props.value === 'function' && props.value.peek) ? props.value() : props.value;

                // Push it during the effect run too! This ensures that anything returned 
                // from this callback (which might trigger more appendChild calls) sees the context.
                pushContext({ [ctx.id]: val });
                try {
                    return children;
                } finally {
                    popContext();
                }
            });
        } finally {
            popContext();
        }
    }

    ctx.Provider = Provider;
    return ctx;
}

export function bindContext(ctx) {
    return () => {
        const provided = readContext(ctx);
        if (typeof provided === 'function') {
            try {
                return provided();
            } catch {
                return provided;
            }
        }
        return provided;
    };
}

export function captureContext() {
    return contextStack.slice();
}

export function runInContext(snapshot, fn) {
    const prev = contextStack.slice();
    contextStack.length = 0;
    contextStack.push(...snapshot);
    try {
        return fn();
    } finally {
        contextStack.length = 0;
        contextStack.push(...prev);
    }
}
