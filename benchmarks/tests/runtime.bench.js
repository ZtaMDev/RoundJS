import { bench, describe } from 'vitest';
import { signal, effect, createElement } from 'round-core';
import { signal as preactSignal, effect as preactEffect } from '@preact/signals-core';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactDOMServer from 'react-dom/server';
import { flushSync } from 'react-dom';

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

        ReactDOMServer.renderToString(React.createElement(List));
    });
});

describe('Reactivity (Signal vs Signal vs State)', () => {
    bench('Round: Signal Update (Single)', () => {
        const count = signal(0);
        let dummy;
        const dispose = effect(() => {
            dummy = count();
        });
        count(1);
        dispose();
    });

    bench('Preact: Signal Update (Single)', () => {
        const count = preactSignal(0);
        let dummy;
        const dispose = preactEffect(() => {
            dummy = count.value;
        });
        count.value = 1;
        dispose();
    });

    bench('React: State Update (via Component + flushSync)', () => {
        const container = document.createElement('div');
        let setter;
        function Test() {
            const [val, setVal] = useState(0);
            setter = setVal;
            return React.createElement('div', null, val);
        }

        const root = createRoot(container);
        // Initial render
        flushSync(() => {
            root.render(React.createElement(Test));
        });

        // The actual update we want to measure
        flushSync(() => {
            setter(1);
        });

        root.unmount();
    });
});
