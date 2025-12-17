import { createElement, signal, onMount } from 'round-core';

export default function App() {
    const count = signal(0);
    const items = signal(Array.from({ length: 1000 }, (_, i) => i));

    onMount(() => {
        console.log('Round App Mounted');
    });

    return (
        <div>
            <h1>Round Benchmark</h1>
            <button onClick={() => count(count() + 1)}>Count: {count}</button>
            <ul>
                {() => items().map(i => (
                    <li key={i}>Item {i}</li>
                ))}
            </ul>
        </div>
    );
}
