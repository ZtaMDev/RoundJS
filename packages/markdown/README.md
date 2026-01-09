# @round-core/markdown

Markdown component for Round.

## Install

```bash
npm i @round-core/markdown
```

## Usage

```js
import { Markdown, defaultMarkdownStyles as markdown } from '@round-core/markdown';
import '@round-core/markdown/styles.css';

export default function App() {
  return (
    <div>
      {/* Simple markdown render */}
      <Markdown content="# Hello" />

      {/* Load markdown from file */}
      <Markdown src="./docs/readme.md" base="/src" />

      {/* Use exported classes in your own markup */}
      <h1 className={markdown.h1Class}>Custom title styled like markdown H1</h1>

      {/* Override classes for headings & text */}
      <Markdown
        content={"# Styled title\n\nSome body text."}
        options={{
          classes: {
            h1Class: 'markdownTitle',
            paragraphClass: 'markdownBody',
          },
        }}
      />
    </div>
  );
}
```

## Props

- `content?: string | (() => string)`
- `src?: string`
- `base?: string`
- `className?: string`
- `options?: object`
  - `sanitize?: boolean`
  - `postprocessHtml?: (html:string) => string`
  - `load?: (path:string) => Promise<string>`
  - `globLoaders?: Record<string, () => Promise<string>>`
  - `highlight?: ({lang, code}) => string | Promise<string>`
  - `getHighlighter?: () => Promise<import('shiki').Highlighter>`
  - `classes?: { 
      rootClass?, 
      codeBlockClass?, 
      codeHeaderClass?, 
      codeLangClass?, 
      codeCopyClass?, 
      codeBodyClass?, 
      h1Class?, 
      paragraphClass?, 
      listClass?, 
      listItemClass?, 
      taskListItemClass?, 
      blockquoteClass?, 
      linkClass?, 
      inlineCodeClass?, 
      hrClass? 
    }`
  - `copy?: { 
      enabled?: boolean, 
      label?: string, 
      onCopy?: (text:string)=>void|Promise<void> 
    }`
  - `theme?: {
      markdownBackground?, 
      markdownText?, 
      primaryColor?, 
      secondaryColor?,
      background?, 
      headerBackground?, 
      borderColor?, 
      textColor?, 
      headerTextColor?,
      copyButtonBackground?, 
      copyButtonTextColor?, 
      copyButtonBorderColor?, 
      radius?,
      scrollbarTrack?, 
      scrollbarThumb?, 
      scrollbarThumbHover?, 
      scrollbarSize?
    }`

## Theming examples

```jsx
// Dark surface (default-like)
<Markdown
  content={content}
  options={{
    theme: {
      markdownBackground: '#020617',
      markdownText: '#e5e7eb',
      primaryColor: '#e5e7eb',
      secondaryColor: '#38bdf8',
    },
  }}
/>

// Light mode
<Markdown
  content={content}
  options={{
    theme: {
      markdownBackground: '#ffffff',
      markdownText: '#0f172a',
      primaryColor: '#0f172a',
      secondaryColor: '#2563eb',
      background: '#0f172a',      // code block background
      textColor: '#e5e7eb',
    },
  }}
/>
