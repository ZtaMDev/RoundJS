# @round-core/prettier

Prettier plugin for RoundJS. Keeps your code clean, consistent, and always in its native syntax.

## Features

- **Native Syntax**: Unlike other preprocessors, this plugin ensures your loops and conditionals keep their native RoundJS syntax: `{for (item in list) { ... }}`.
- **Hybrid Formatting**: Uses the Babel parser internally for JS/JSX content while reconstructing RoundJS control structures to ensure the final output is always pure and readable RoundJS.
- **VS Code Integration**: Works automatically on save when the Prettier plugin is configured for `.round` files.

## Usage

Add `"plugins": ["@round-core/prettier"]` to your `.prettierrc` file.
