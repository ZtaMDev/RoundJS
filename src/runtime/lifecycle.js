import { reportErrorSafe } from './error-reporter.js';

const componentStack = [];

export function getCurrentComponent() {
    return componentStack[componentStack.length - 1];
}

export function runInLifecycle(componentInstance, fn) {
    componentStack.push(componentInstance);
    try {
        return fn();
    } finally {
        componentStack.pop();
    }
}

export function createComponentInstance() {
    return {
        mountHooks: [],
        unmountHooks: [],
        updateHooks: [],
        nodes: [],
        isMounted: false,
        mountTimerId: null
    };
}

export function onMount(fn) {
    const component = getCurrentComponent();
    if (component) {
        component.mountHooks.push(fn);
    } else {
        try {
            fn();
        } catch (e) {
            reportErrorSafe(e, { phase: 'onMount' });
        }
    }
}

export function onUnmount(fn) {
    const component = getCurrentComponent();
    if (component) {
        component.unmountHooks.push(fn);
    }
}

export const onCleanup = onUnmount;

export function onUpdate(fn) {
    const component = getCurrentComponent();
    if (component) {
        component.updateHooks.push(fn);
    }
}

export function mountComponent(component) {
    if (component.isMounted) return;

    try {
        const root = component?.nodes?.[0];
        if (root && root instanceof Node && root.isConnected === false) {
            return;
        }
    } catch {
    }

    component.isMounted = true;
    component.mountHooks.forEach(hook => {
        try {
            const cleanup = hook();
            if (typeof cleanup === 'function') {
                component.unmountHooks.push(cleanup);
            }
        } catch (e) {
            reportErrorSafe(e, { phase: 'mount', component: component.name ?? null });
        }
    });
}

export function unmountComponent(component) {
    if (!component.isMounted) return;

    if (component.mountTimerId != null) {
        try {
            clearTimeout(component.mountTimerId);
        } catch {
        }
        component.mountTimerId = null;
    }

    component.isMounted = false;
    component.unmountHooks.forEach(hook => {
        try {
            hook();
        } catch (e) {
            reportErrorSafe(e, { phase: 'unmount', component: component.name ?? null });
        }
    });
}

export function triggerUpdate(component) {
    if (!component.isMounted) return;
    component.updateHooks.forEach(hook => {
        try {
            hook();
        } catch (e) {
            reportErrorSafe(e, { phase: 'update', component: component.name ?? null });
        }
    });
}

const observer = (typeof MutationObserver !== 'undefined')
    ? new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.removedNodes.length > 0) {
                mutation.removedNodes.forEach(node => {
                    if (node._componentInstance) {
                        unmountComponent(node._componentInstance);
                    }
                    cleanupNodeRecursively(node);
                });
            }
        });
    })
    : null;

function cleanupNodeRecursively(node) {
    if (node._componentInstance) {
        unmountComponent(node._componentInstance);
    }
    node.childNodes.forEach(cleanupNodeRecursively);
}

export function initLifecycleRoot(rootNode) {
    if (!rootNode) return;
    if (!observer) return;
    observer.observe(rootNode, { childList: true, subtree: true });
}
