import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

function App() {
    const [count, setCount] = useState(0);
    const [items] = useState(Array.from({ length: 1000 }, (_, i) => i));

    useEffect(() => {
        console.log('React App Mounted');
    }, []);

    return (
        <div>
            <h1>React Benchmark</h1>
            <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
            <ul>
                {items.map(i => (
                    <li key={i}>Item {i}</li>
                ))}
            </ul>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
