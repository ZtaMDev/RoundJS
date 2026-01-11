# @round-core/shared

Shared utilities for the RoundJS ecosystem.

## Features

- **SourceMapper**: A lightweight utility for mapping positions between the original RoundJS code and preprocessed JSX/JS. Essential for ESLint and IDEs to display errors on the correct lines.
- **runPreprocess**: The core preprocessor that transforms RoundJS declarative syntax (`{if}`, `{for}`, etc.) into `<RoundControlFlow />` components compatible with standard JS tools.

## Usage

This package is used internally by `@round-core/lint` and `@round-core/prettier` to ensure transformations are consistent and reversible.
