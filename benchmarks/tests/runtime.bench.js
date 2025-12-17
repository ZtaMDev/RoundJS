import { bench, describe } from 'vitest';
import { signal, effect, createElement } from 'round-core';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

describe('Component Creation (1000 items)', () => {
    bench('Round: Create and Replcae 1000 rows', () => {
        const div = document.createElement('div');
        const items = Array.from({ length: 1000 }, (_, i) => i);

        // Round "Component"
        function List() {
            return createElement('ul', {},
                items.map(i => createElement('li', {}, `Item ${i}`))
            );
        }

        const node = List();
        div.appendChild(node);
    });

    bench('React: RenderToString 1000 rows', () => {
        const items = Array.from({ length: 1000 }, (_, i) => i);

        function List() {
            return React.createElement('ul', null,
                items.map(i => React.createElement('li', { key: i }, `Item ${i}`))
            );
        }

        // Using renderToString because createRoot/flushSync is unstable in this headless bench.
        // This measures pure React rendering/templating overhead.
        ReactDOMServer.renderToString(React.createElement(List));
    });
});

describe('Reactivity (Signal vs State)', () => {
    bench('Round: Signal Update', () => {
        const count = signal(0);
        let dummy;
        const dispose = effect(() => {
            dummy = count();
        });
        count(1);
        count(2);
        dispose();
    });

    // React hooks require a component, so hard to bench pure state speed in isolation
    // without full render cycle overhead.
});
