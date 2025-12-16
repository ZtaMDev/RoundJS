export * from './runtime/signals.js';
export * from './runtime/dom.js';
export * from './runtime/lifecycle.js';
export * from './runtime/router.js';
export * from './runtime/markdown.js';
export * from './runtime/errors.js';
export * from './runtime/error-store.js';
export * from './runtime/error-boundary.js';
export * from './runtime/suspense.js';
export * from './runtime/context.js';
export * from './runtime/store.js';

import * as Signals from './runtime/signals.js';
import * as DOM from './runtime/dom.js';
import * as Lifecycle from './runtime/lifecycle.js';
import * as Router from './runtime/router.js';
import * as Markdown from './runtime/markdown.js';
import * as Errors from './runtime/errors.js';
import * as Suspense from './runtime/suspense.js';
import * as Context from './runtime/context.js';
import * as Store from './runtime/store.js';

export function render(Component, container) {
    Lifecycle.initLifecycleRoot(container);
    Errors.initErrorHandling(container);
    try {
        const root = DOM.createElement(Component);
        container.appendChild(root);
    } catch (e) {
        Errors.reportError(e, { phase: 'render', component: Component?.name ?? 'App' });
    }
}

export default {
    ...Signals,
    ...DOM,
    ...Lifecycle,
    ...Router,
    ...Markdown,
    ...Errors,
    ...Suspense,
    ...Context,
    ...Store,
    render
};
