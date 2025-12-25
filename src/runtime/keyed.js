import { effect } from './signals.js';

/**
 * ForKeyed Component
 * Performs keyed reconciliation for lists to maintain DOM identity.
 * 
 * @template T
 * @param {{ 
 *   each: T[] | (() => T[]), 
 *   key: (item: T) => any, 
 *   children: (item: T) => any 
 * }} props
 */
export function ForKeyed(props) {
    const { each, key: keyFn, children } = props;
    const renderFn = Array.isArray(children) ? children[0] : children;

    if (typeof renderFn !== 'function') {
        return null;
    }

    const container = document.createElement('span');
    container.style.display = 'contents';

    // Map of key -> Node
    const cache = new Map();

    effect(() => {
        const list = typeof each === 'function' ? each() : each;
        const items = Array.isArray(list) ? list : [];

        // 1. Generate new keys and nodes
        const newNodes = items.map(item => {
            const k = keyFn(item);
            if (cache.has(k)) {
                return cache.get(k);
            }
            // Create new node if key doesn't exist
            let node = renderFn(item);

            // Handle Fragments (Arrays)
            if (Array.isArray(node)) {
                if (node.length === 1) {
                    node = node[0];
                } else {
                    const wrapper = document.createElement('span');
                    wrapper.style.display = 'contents';
                    node.forEach(n => {
                        if (n instanceof Node) wrapper.appendChild(n);
                        else wrapper.appendChild(document.createTextNode(String(n)));
                    });
                    node = wrapper;
                }
            }

            cache.set(k, node);
            return node;
        });

        // 2. Remove nodes that are no longer in the list
        const newNodesSet = new Set(newNodes);
        for (const [k, node] of cache.entries()) {
            if (!newNodesSet.has(node)) {
                if (node.parentNode === container) {
                    container.removeChild(node);
                }
                cache.delete(k);
            }
        }

        // 3. Reorder/Append nodes (Minimal Move)
        // Iterate specifically up to the length of the new list.
        newNodes.forEach((node, i) => {
            const currentAtPos = container.childNodes[i];
            if (currentAtPos !== node) {
                // insertBefore moves the node if it's already in the DOM
                container.insertBefore(node, currentAtPos || null);
            }
        });
    });

    return container;
}
