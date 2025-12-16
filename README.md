<h1 align="center">Round Framework</h1>
 
<p align="center">
  <img src="https://raw.githubusercontent.com/ZtaMDev/RoundJS/main/Round.png" alt="Dars Framework Logo" width="200" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/round-core?color=brightgreen" alt="PyPI Version" />
</p>

<p align="center">
  <em>Round is a lightweight frontend framework focused on building <b>single-page applications (SPAs)</b> with <b>fine‑grained reactivity.</b></em>
</p>

```bash
npm install round-core
```

Instead of a Virtual DOM diff, Round updates the UI by subscribing DOM updates directly to reactive primitives (**signals**). This keeps rendering predictable, small, and fast for interactive apps.

## What Round is focused on

- **SPA-first**: client-side navigation and UI updates.
- **Fine-grained reactivity**: update only what depends on the changed signal.
- **Ergonomic bindings**: built-in two-way bindings with `bind:*` directives.
- **A JSX superset**: `.round` files support extra control-flow syntax that compiles to JavaScript.
- **Minimal runtime**: DOM-first runtime (no VDOM diffing).

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

A `.round` file is a JSX-based component module (ESM) compiled by the Round toolchain.

Example `src/app.round`:

```jsx
import { Route } from 'round-core';
import { Counter } from './counter';

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

export function Counter() {
    const count = signal(0);

    return (
        <div>
            <h1>Count: {count()}</h1>
            <button onClick={() => count(count() + 1)}>Increment</button>
        </div>
    );
}
```

### `effect(fn)`

Run `fn` whenever the signals it reads change.

```js
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

### `$pick(path)`

Create a view signal from a signal/bindable that holds an object.

```js
import { bindable } from 'round-core';

const user = bindable({ profile: { bio: 'Hello' } });
const bio = user.$pick('profile.bio');

console.log(bio());
```

### `.transform(fromInput, toOutput)`

Transform a signal/bindable to adapt between DOM values (often strings) and your internal representation.

```jsx
import { bindable } from 'round-core';

export function AgeField() {
    const age = bindable('18')
        .transform(
            (str) => Math.max(0, parseInt(str, 10) || 0),
            (num) => String(num)
        );

    return <input type="number" bind:value={age} />;
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

### `for (... in ...)`

```jsx
{for(item in items){
    <div className="row">{item}</div>
}}
```

This compiles roughly to a `.map(...)` under the hood.

## Rendering model (no VDOM)

Round renders to the DOM directly using a small runtime:

- Elements are created with `document.createElement(...)`.
- Dynamic children and reactive props are updated via `effect()` subscriptions.
- Components are functions returning DOM nodes (or arrays of nodes).

This is a **DOM-first, fine-grained reactive model**, rather than a Virtual DOM diffing renderer.

## Routing

Round includes router primitives intended for SPA navigation.

Typical usage:

```jsx
import { Route } from 'round-core';

export default function App() {
    return (
        <div>
            <Route route="/" title="Home">
                <div>Home</div>
            </Route>
            <Route route="/about" title="About">
                <div>About</div>
            </Route>
        </div>
    );
}
```

## Suspense and lazy loading

Round supports `Suspense` for promise-based rendering and `lazy()` for code splitting.

(These APIs are evolving; expect improvements as Round’s compiler and runtime expand.)

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
