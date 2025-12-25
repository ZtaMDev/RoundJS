import { pushContext, popContext, contextStack, generateContextId, readContext, SuspenseContext, runInContext } from './context-shared.js';
import { createElement, Fragment } from './dom.js';

export { pushContext, popContext, contextStack, generateContextId, readContext, SuspenseContext, runInContext };

/**
 * Internal logic to create a Provider component for a context.
 */
function createProvider(ctx) {
    const Provider = function Provider(props = {}) {
        const children = props.children;
        const value = props.value;

        // Push context now so that any createElement/appendChild called 
        // during the instantiation of this Provider branch picks it up immediately.
        pushContext({ [ctx.id]: value });
        try {
            // We use a span to handle reactive value updates and dynamic children.
            return createElement('span', { style: { display: 'contents' } }, () => {
                // Read current value (reactive if it's a signal)
                const val = (typeof value === 'function' && value.peek) ? value() : value;

                // Push it during the effect run too!
                pushContext({ [ctx.id]: val });
                try {
                    return typeof children === 'function' ? children() : children;
                } finally {
                    popContext();
                }
            });
        } finally {
            popContext();
        }
    };
    return Provider;
}

/**
 * Create a new Context object for sharing state between components.
 */
export function createContext(defaultValue) {
    const ctx = {
        id: generateContextId(),
        defaultValue,
        Provider: null
    };
    ctx.Provider = createProvider(ctx);
    return ctx;
}

// Attach providers to built-in shared contexts
SuspenseContext.Provider = createProvider(SuspenseContext);

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
