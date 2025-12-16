import { createElement } from './dom.js';

let nextContextId = 1;
const contextStack = [];

function pushContext(values) {
    contextStack.push(values);
}

function popContext() {
    contextStack.pop();
}

function readContext(ctx) {
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
        const value = props.value;
        const child = Array.isArray(props.children) ? props.children[0] : props.children;
        const childFn = typeof child === 'function' ? child : () => child;

        return createElement('span', { style: { display: 'contents' } }, () => {
            pushContext({ [ctx.id]: value });
            try {
                return childFn();
            } finally {
                popContext();
            }
        });
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
