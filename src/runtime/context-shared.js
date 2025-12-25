
let nextContextId = 1;
export const contextStack = [];

/**
 * Internal helper to push context layers.
 */
export function pushContext(values) {
    contextStack.push(values);
}

/**
 * Internal helper to pop context layers.
 */
export function popContext() {
    contextStack.pop();
}

/**
 * Capture current context stack.
 */
export function captureContext() {
    return contextStack.slice();
}

/**
 * Read context value from the stack.
 */
export function readContext(ctx) {
    for (let i = contextStack.length - 1; i >= 0; i--) {
        const layer = contextStack[i];
        if (layer && Object.prototype.hasOwnProperty.call(layer, ctx.id)) {
            return layer[ctx.id];
        }
    }
    return ctx.defaultValue;
}

/**
 * Generate a new context ID.
 */
export function generateContextId() {
    return nextContextId++;
}


export const SuspenseContext = {
    id: generateContextId(),
    defaultValue: null,
    Provider: null
};

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
