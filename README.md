<h1 align="center">Round Framework</h1>
 
<p align="center">
  <img src="https://raw.githubusercontent.com/ZtaMDev/RoundJS/main/Round.png" alt="Round Framework Logo" width="200" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/round-core?color=brightgreen" alt="NPM Version" />
</p>

<p align="center">
  <em>Round is a lightweight frontend framework focused on building <b>single-page applications (SPAs)</b> with <b>fine‑grained reactivity.</b></em>
</p>

<div align="center">
 
Extension for VSCode [here](https://marketplace.visualstudio.com/items?itemName=ZtaMDev.round) and OpenVSX version [here](https://open-vsx.org/extension/ztamdev/round)

</div>


```bash
npm install round-core
```

Instead of a Virtual DOM diff, Round updates the UI by subscribing DOM updates directly to reactive primitives (**signals**) and **bindables**. This keeps rendering predictable, small, and fast for interactive apps.

## What Round is focused on

- **SPA-first**: client-side navigation and UI updates.
- **Fine-grained reactivity**: update only what depends on the changed signal.
- **Ergonomic bindings**: built-in two-way bindings with `bind:*` directives.
- **A JSX superset**: `.round` files support extra control-flow syntax that compiles to JavaScript.
- **Minimal runtime**: DOM-first runtime (no VDOM diffing).

## Architecture

Round is a **No-VDOM** framework.

1.  **Direct DOM Manipulation**: Components run once. They return real DOM nodes (via `document.createElement`).
2.  **Fine-Grained Reactivity**: Use of `signal`, `effect`, and `bindable` creates a dependency graph.
3.  **Surgical Updates**: When a signal changes, only the specific text node, attribute, or property subscribed to that signal is updated. The component function does not re-run.

This avoids the overhead of Virtual DOM diffing and reconciliation entirely.

## Concepts

### SPA

A **Single Page Application (SPA)** loads one HTML page and then updates the UI dynamically as the user navigates and interacts—without full page reloads.

### Fine-grained reactivity (signals)

A **signal** is a small reactive container.

- Reading a signal inside an `effect()` tracks a dependency.
- Writing to a signal triggers only the subscribed computations.


## Normal Installation

Simply install the `round-core` package

```bash
bun add round-core
```

Or:

```bash
npm install round-core
```

## Repo Installation

> Round is currently in active development. If you are using the repository directly, install dependencies and run the CLI locally.

```bash
bun install
```

Or:

```bash
npm install
```

## Quick start (create a new app)

Round includes a CLI with a project initializer.

```bash
round init myapp
cd myapp
npm install
npm run dev
```

This scaffolds a minimal Round app with `src/app.round` and an example `src/counter.round`.

## `.round` files

A `.round` file is a JSX-based component module (ESM) compiled by the Round toolchain. you can also use .jsx files but you wont get the round JSX superset features like conditional rendering and other features.

Example `src/app.round`:

```jsx
import { Route } from 'round-core';
import { Counter } from './counter.round';

export default function App() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Route route="/" title="Home">
                <Counter />
            </Route>
        </div>
    );
}
```

## Core API

### `signal(initialValue)`

Create a reactive signal.

- Call with no arguments to **read**.
- Call with one argument to **write**.
- Use `.value` to read/write the current value in a non-subscribing way (static access).

```jsx
import { signal } from 'round-core';

export default function Counter() {
    const count = signal(0);

    return (
        <div>
            <h1>Count: {count()}</h1>
            <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => count(count() + 1)}>Increment</button>
                <button onClick={() => count(count() - 1)}>Decrement</button>
            </div>
        </div>
    );
}
```

### `derive(fn)`

Create a computed signal that updates automatically when its dependencies change.

```javascript
import { signal, derive } from 'round-core';

const count = signal(1);
const double = derive(() => count() * 2);

console.log(double()); // 2
count(5);
console.log(double()); // 10
```

### `effect(fn)`

Run `fn` whenever the signals it reads change.

```javascript
import { signal, effect } from 'round-core';

const name = signal('Ada');

effect(() => {
    console.log('Name changed:', name());
});

name('Grace');
```

### `bindable(initialValue)`

`bindable()` creates a signal intended for **two-way DOM bindings**.

```jsx
import { bindable } from 'round-core';

export function Example() {
    const email = bindable('');

    return (
        <div>
            <input bind:value={email} placeholder="Email" />
            <div>Typed: {email()}</div>
        </div>
    );
}
```

### `createStore(initialState, actions)`

Create a shared global state store with actions and optional persistence.

```javascript
import { createStore } from 'round-core';

// 1. Define Store
const store = createStore({
    todos: [],
    filter: 'all'
}, {
    addTodo: (state, text) => ({ 
        ...state, 
        todos: [...state.todos, { text, done: false }] 
    })
});

// 2. Use in Component
export function TodoList() {
    const todos = store.use('todos'); // Returns a bindable signal
    
    return (
        <div>
            {todos().map(todo => <div>{todo.text}</div>)}
            <button onClick={() => store.addTodo('Buy Milk')}>Add</button>
        </div>
    );
}

// 3. Persistence (Optional)
store.persist('my-app-store'); 
```

### `bindable.object(initialObject)` and deep binding

Round supports object-shaped state with ergonomic deep bindings via proxies.

```jsx
import { bindable } from 'round-core';

export function Profile() {
    const user = bindable.object({
        profile: { bio: '' },
        flags: { newsletter: false }
    });

    return (
        <div>
            <textarea bind:value={user.profile.bio} />
            <label>
                <input type="checkbox" bind:checked={user.flags.newsletter} />
                Subscribe
            </label>
        </div>
    );
}
```

### `.validate(validator, options)`

Attach validation to a signal/bindable.

- Invalid writes do not update the underlying value.
- `signal.error` is itself a signal (reactive) containing the current error message or `null`.
- `options.validateOn` can be `'input'` (default) or `'blur'`.
- `options.validateInitial` can trigger validation on startup.

```jsx
import { bindable } from 'round-core';

export function EmailField() {
    const email = bindable('')
        .validate(
            (v) => v.includes('@') || 'Invalid email',
            { validateOn: 'blur' }
        );

    return (
        <div>
            <input bind:value={email} placeholder="name@example.com" />
            <div style={() => ({ color: email.error() ? 'crimson' : '#666' })}>
                {email.error}
            </div>
        </div>
    );
}
```

## DOM binding directives

Round supports two-way bindings via props:

- `bind:value={someBindable}` for text-like inputs, `<textarea>`, and `<select>`.
- `bind:checked={someBindable}` for `<input type="checkbox">` and `<input type="radio">`.

Round will warn if the value is not signal-like, and will warn if you bind a plain `signal()` instead of a `bindable()`.

## JSX superset control flow

Round extends JSX inside `.round` files with a control-flow syntax that compiles to JavaScript.

### `if / else if / else`

```jsx
{if(user.loggedIn){
    <Dashboard />
} else if(user.loading){
    <div>Loading...</div>
} else {
    <Login />
}}
```

Notes:

- Conditions may be normal JS expressions.
- For *simple paths* like `flags.showCounter` (identifier/member paths), Round will auto-unwrap signal-like values (call them) so the condition behaves as expected.
- Multiple elements inside a block are automatically wrapped in a Fragment.

### `for (... in ...)`

```jsx
{for(item in items){
    <div className="row">{item}</div>
}}
```

This compiles roughly to a `.map(...)` under the hood.

## Routing

Round includes router primitives intended for SPA navigation. All route paths must start with a forward slash `/`.

### Basic Usage

```jsx
import { Route, Link } from 'round-core';

export default function App() {
    return (
        <div>
            <nav>
                <Link href="/">Home</Link>
                <Link href="/about">About</Link>
            </nav>

            <Route route="/" title="Home" exact>
                <div>Welcome Home</div>
            </Route>
            <Route route="/about" title="About">
                <div>About Us Content</div>
            </Route>
        </div>
    );
}
```

### Nested Routing and Layouts

Routes can be nested to create hierarchical layouts. Child routes automatically inherit and combine paths with their parents.

- **Prefix Matching**: By default, routes use prefix matching (except for the root `/`). This allows a parent route to stay rendered as a "shell" or layout while its children are visited.
- **Exact Matching**: Use the `exact` prop to ensure a route only renders when the path matches precisely (default for root `/`).

```jsx
<Route route="/dashboard" title="Dashboard">
    <h1>Dashboard Shell</h1>

    {/* This route matches /dashboard/profile */}
    <Route route="/dashboard/profile">
        <h2>User Profile</h2>
    </Route>

    {/* This route matches /dashboard/settings */}
    <Route route="/dashboard/settings">
        <h2>Settings</h2>
    </Route>
</Route>
```

## Suspense and lazy loading

Round supports `Suspense` for promise-based rendering and `lazy()` for code splitting.

```jsx
import { Suspense, lazy } from 'round-core';
const LazyWidget = lazy(() => import('./Widget'));

<Suspense fallback={<div>Loading...</div>}>
    <LazyWidget />
</Suspense>
```


## Error handling

Round aims to provide strong developer feedback:

- Runtime error reporting with safe boundaries.
- `ErrorBoundary` to catch render-time errors and show a fallback.

## CLI

The CLI is intended for day-to-day development:

- `round dev`
- `round build`
- `round preview`
- `round init <name>`

Run `round -h` to see available commands.

## Status

Round is under active development and the API is still stabilizing. The README is currently the primary documentation; a dedicated documentation site will be built later using Round itself.

## License

MIT
