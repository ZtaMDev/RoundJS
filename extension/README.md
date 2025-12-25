<h1 align="center">Round for VS Code</h1>

<p align="center">
  <img src="Round.png" alt="Round Logo" width="128" />
</p>

<p align="center">
  <em>The official VS Code extension for the <b>Round Framework</b>.</em>
</p>

---

## Features

### Intelligent LSP
Complete Language Server support for `.round` files, powered by a high-performance **On-Demand Architecture**.
- **On-Demand Loading**: The extension only processes the files you are actually working on, making it ultra-light and near-instant on startup.
- **No-Wait Hovers**: Synchronous on-demand transformation eliminates "Loading" glitches. Get instant type information for signals, bindables, and props.
- **Precision Mapping**: Error squiggles, hovers, and definitions align perfectly with your source code, even inside complex `if`, `switch`, `for`, and **reactive `try/catch`** blocks.
- **Go to Definition**: Navigate your signals and components with a single click.
- **Throttled Diagnostics**: Real-time error reporting that respects your CPU, debounced for maximum responsiveness.

### Hybrid Syntax Highlighting
A custom TextMate grammar designed specifically for Round's hybrid format.
- Context-aware highlighting for HTML tags and JSX expressions.
- Support for Round's custom control-flow: `{if(...){...}}`, `{switch(...){...}}`, and `{for(... in ...){...}}`.
- Special highlighting for the `bind:*` directive.

### Smart Snippets
Boost your productivity with built-in snippets for common Round patterns:
- `round:component`: Scaffold a new component.
- `round:signal`: Create a reactive signal.
- `round:asyncSignal`: Create a signal for async data fetching.
- `round:bindable`: Create a two-way binding.
- `round:if` / `round:for` / `round:try`: Fast control-flow blocks.

---

## Getting Started

1. Install this extension from the VS Code Marketplace.
2. Open any `.round` file in your workspace.
3. If the language is not automatically detected, click on the language selector in the status bar (bottom right) and select **Round**.

## Requirements

The extension works best when your project contains a `package.json` with `round-core` installed, but it can also resolve types from a local `src/index.d.ts` if you are working on the framework itself.

## License

MIT © [ZtaMDev](https://github.com/ZtaMDev)
