<h1 align="center">Round JS</h1>
 
<p align="center">
  <img src="https://raw.githubusercontent.com/ZtaMDev/RoundJS/main/Round.png" alt="Round Framework Logo" width="200" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/round-core?color=brightgreen" alt="NPM Version" />
</p>

<h3 align="center">
  <em><b>Round</b> is a lightweight, DOM-first framework for building SPAs with fine-grained reactivity, and fast, predictable updates powered by signals and bindables</em>
</h3>


<div align="center">
 
Extension for [VSCode](https://marketplace.visualstudio.com/items?itemName=ZtaMDev.round) and [OpenVSX](https://open-vsx.org/extension/ztamdev/round)

</div>

--- 

Instead of a Virtual DOM diff, Round updates the UI by subscribing DOM updates directly to reactive primitives **signals** and **bindables**. This keeps rendering predictable, small, and fast for interactive apps.

The `round-core` package is the **foundation of RoundJS**.

You can think of `round-core` as:
- A **framework-level runtime**, not just a state library
- Comparable in scope to React + Router + Signals, but significantly smaller
- Suitable for fast SPAs and simple SSR setups without heavy infrastructure

## Installation

To use Round JS today, install the core package:

```bash
npm install round-core
```

Or with Bun:

```bash
bun add round-core
```

## What Round is focused on

Round is a **No-VDOM** framework.

1.  **Direct DOM Manipulation**: Components run once. They return real DOM nodes (via `document.createElement`).
2.  **Fine-Grained Reactivity**: Use of `signal`, `effect`, and `bindable` creates a dependency graph.
3.  **Ergonomic bindings**: built-in two-way bindings with `bind:*` directives.
4.  **Surgical Updates**: When a signal changes, only the specific text node, attribute, or property subscribed to that signal is updated. The component function does not re-run.
5.  **A JSX superset**: `.round` files support extra control-flow syntax that compiles to JavaScript.

This avoids the overhead of Virtual DOM diffing and reconciliation entirely.

## Concepts

### SPA

A **Single Page Application (SPA)** loads one HTML page and then updates the UI dynamically as the user navigates and interacts—without full page reloads.

### Fine-grained reactivity (signals)

A **signal** is a small reactive container.

- Reading a signal inside an `effect()` tracks a dependency.
- Writing to a signal triggers only the subscribed computations.

## Quick start (create a new app)

Round includes a CLI with a project initializer.

```bash
# Install the CLI
bun add round-core

# Create a new app
round init myapp

# Navigate to the app directory
cd myapp

# Install dependencies
npm install

# Run the app
npm run dev
```

This scaffolds a minimal Round app with `src/app.round` and an example `src/counter.round`.

## `.round` files

A `.round` file is a JSX-based component module (ESM) compiled by the Round toolchain.
You can also use `.jsx` files, but you will not get the Round JSX superset features
such as extended control flow.

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

### Signals Internals

RoundJS utilizes a high-performance reactivity engine designed for efficiency and minimal memory overhead:

- **Doubly-Linked List Dependency Tracking**: Instead of using heavy `Set` objects, RoundJS uses a linked-list of subscription nodes. This eliminates array spreads and object allocations during signal updates, providing constant-time performance for adding/removing dependencies.
- **Global Versioning (Clock)**: Every signal write increments a global version counter. Computed signals (`derive`) track the version of their dependencies and only recompute if they are "dirty" (out of date). This ensures true lazyness and avoids redundant calculations.
- **Automatic Batching**: Multiple signal updates within the same execution cycle are batched. Effects and DOM updates only trigger once at the end of the batch, preventing "glitches" and unnecessary re-renders.


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

### `asyncSignal(fetcher)`

Create a signal that manages asynchronous data fetching.

- It returns a signal that resolves to the data once fetched.
- **`.pending`**: A reactive signal (boolean) indicating if the fetch is in progress.
- **`.error`**: A reactive signal containing any error that occurred during fetching.
- **`.refetch()`**: A method to manually trigger a re-fetch.

```jsx
import { asyncSignal } from 'round-core';

const user = asyncSignal(async () => {
    const res = await fetch('/api/user');
    return res.json();
});

export function UserProfile() {
    return (
        <div>
            {if(user.pending()){
                <div>Loading...</div>
            } else if(user.error()){
                <div>Error: {user.error().message}</div>
            } else {
                <div>Welcome, {user().name}</div>
            }}
            <button onClick={() => user.refetch()}>Reload</button>
        </div>
    );
}
```

### `untrack(fn)`

Run a function without tracking any signals it reads.

```javascript
import { signal, untrack, effect } from 'round-core';

const count = signal(0);
effect(() => {
    console.log('Count is:', count());
    untrack(() => {
        // This read won't trigger the effect if it changes elsewhere
        console.log('Static value:', count());
    });
});
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

## DOM binding directives

Round supports two-way bindings via props:

- `bind:value={someBindable}` for text-like inputs, `<textarea>`, and `<select>`.
- `bind:checked={someBindable}` for `<input type="checkbox">` and `<input type="radio">`.

Round will warn if the value is not signal-like, and will warn if you bind a plain `signal()` instead of a `bindable()`.

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
            {for(todo in todos()){
                <div>{todo.text}</div>
            }}
            <button onClick={() => store.addTodo('Buy Milk')}>Add</button>
        </div>
    );
}

// 3. Persistence (Optional)
store.persist('my-app-store', { 
    debounce: 100, // ms
    exclude: ['someSecretKey'] 
}); 

// 4. Advanced Methods
store.patch({ filter: 'completed' }); // Update multiple keys at once
const data = store.snapshot({ reactive: false }); // Get static JSON of state
store.set('todos', []); // Direct set
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

## Lifecycle Hooks

Round provides hooks to tap into the lifecycle of components. These must be called during the synchronous execution of your component function.

### `onMount(fn)`
Runs after the component is first created and its elements are added to the DOM. If `fn` returns a function, it's used as a cleanup (equivalent to `onUnmount`).

### `onUnmount(fn)`
Runs when the component's elements are removed from the DOM.

### `onUpdate(fn)`
Runs whenever any signal read during the component's *initial* render is updated.

### `onCleanup(fn)`
Alias for `onUnmount`.

```jsx
import { onMount, onUnmount } from 'round-core';

export function MyComponent() {
    onMount(() => {
        console.log('Mounted!');
        const timer = setInterval(() => {}, 1000);
        return () => clearInterval(timer); // Cleanup
    });

    onUnmount(() => console.log('Goodbye!'));

    return <div>Hello</div>;
}
```

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
{for(item in items()) key=item.id {
    <div className="row">{item.name}</div>
}}
```

This compiles to efficient **keyed reconciliation** using the `ForKeyed` runtime component. 

#### Keyed vs Unkeyed
- **Keyed (Recommended)**: By providing `key=expr`, Round maintains the identity of DOM nodes. If the list reorders, Round moves the existing nodes instead of recreating them. This preserves local state (like input focus, cursor position, or CSS animations).
- **Unkeyed**: If no key is provided, Round simply maps over the list. Reordering the list will cause nodes to be reused based on their index, which might lead to state issues in complex lists.

### `switch(...)`

```jsx
{switch(status()){
    case 'loading': return <Spinner />;
    case 'error':   return <ErrorMessage />;
    default:        return <DataView />;
}}
```

Notes:
- The `switch` expression is automatically wrapped in a reactive tracker, ensuring that the view updates surgically when the condition (e.g., a signal) changes.
- Each case handles its own rendering without re-running the parent component.

### `try / catch`

Round supports both static and **reactive** `try/catch` blocks inside JSX.

- **Static**: Just like standard JS, but renders fragments.
- **Reactive**: By passing a signal to `try(signal)`, the block will **automatically re-run** if the signal (or its dependencies) update. This is perfect for handling transient errors in async data.

```jsx
{try(user()) {
    {if(user() && user().name) {
        <div>Hello {user().name}</div>
    } else if(user.pending()) {
        <div>⏳ Loading...</div>
    }}
} catch(e) {
    <div className="error"> Failed to load user: {e.message} </div>
}}
```

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

Round JS favors individual error control and standard browser debugging:

1.  **Explict `try/catch`**: Use the JSX `try/catch` syntax to handle local component failures gracefully.
2.  **Console-First Reporting**: Unhandled errors in component rendering or reactive effects are logged to the browser console with descriptive metadata (component name, render phase) and then allowed to propagate.
3.  **No Intrusive Overlays**: Round has removed conflicting global error boundaries to ensure that your local handling logic always takes precedence and the developer experience remains clean.

Example of a descriptive console log:
`[round] Error in phase "component.render" of component <UserProfile />: TypeError: Cannot read property 'avatar' of undefined`

## CLI

The CLI is intended for day-to-day development:

- `round dev`
- `round build`
- `round preview`
- `round init <name>`

Run `round -h` to see available commands.

## Performance

RoundJS sits in a powerful "middle ground" of performance:

- **vs React**: Round's fine-grained reactivity is **massively faster** (>30x in micro-benchmarks) than React's component-level reconciliation. DOM updates are surgical and don't require diffing a virtual tree.
- **vs Preact Signals**: While highly optimized, RoundJS signals are currently slightly slower than Preact Signals (~10x difference in raw signal-to-signal updates), as Preact utilizes more aggressive internal optimizations. However, for most real-world applications, RoundJS provides more than enough performance.

## Status

Round is under active development and the API is still stabilizing. The README is currently the primary documentation; a dedicated documentation site will be built later using Round itself.

## License

MIT
