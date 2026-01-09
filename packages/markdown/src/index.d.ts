/**
 * Highlighter function used to transform code blocks into highlighted HTML.
 *
 * The function receives the language and raw code and must return an HTML
 * string (or a Promise that resolves to it).
 */
export type MarkdownHighlighter = (args: { lang: string; code: string }) => string | Promise<string>;

/**
 * Configuration options for the `Markdown` component.
 */
export interface MarkdownOptions {
  /**
   * Whether to sanitize the generated HTML.
   *
   * When enabled, potentially dangerous HTML will be stripped before
   * being injected into the DOM.
   */
  sanitize?: boolean;

  /**
   * Optional hook to post-process the final HTML string before render.
   */
  postprocessHtml?: (html: string) => string;

  /**
   * Loader used when the `src` prop is provided.
   *
   * Receives a resolved path and must return the markdown content.
   */
  load?: (path: string) => Promise<string>;

  /**
   * Optional map of glob loaders for bundlers that support virtual imports
   * (for example Vite's `import.meta.glob`).
   */
  globLoaders?: Record<string, () => Promise<string>>;

  /**
   * Custom code highlighter implementation.
   *
   * If provided, this overrides the built-in Shiki-based highlighter.
   */
  highlight?: MarkdownHighlighter;

  /**
   * Lazy Shiki highlighter factory.
   *
   * Used internally by the default implementation to create or reuse
   * a Shiki highlighter instance.
   */
  getHighlighter?: () => Promise<any>;

  /**
   * CSS class overrides for the rendered markup.
   */
  classes?: {
    /** Root wrapper element around the rendered markdown. */
    rootClass?: string;

    /** Wrapper for each code block container. */
    codeBlockClass?: string;
    /** Header area above a code block (language label + copy button). */
    codeHeaderClass?: string;
    /** Element that displays the language name. */
    codeLangClass?: string;
    /** Copy button element. */
    codeCopyClass?: string;
    /** The actual `<pre><code>` body container. */
    codeBodyClass?: string;

    /** Heading level 1 (`#`). */
    h1Class?: string;
    /** Heading level 2 (`##`). */
    h2Class?: string;
    /** Heading level 3 (`###`). */
    h3Class?: string;
    /** Heading level 4 (`####`). */
    h4Class?: string;
    /** Heading level 5 (`#####`). */
    h5Class?: string;
    /** Heading level 6 (`######`). */
    h6Class?: string;

    /** Normal paragraph text. */
    paragraphClass?: string;
    /** Ordered and unordered lists (`ul` / `ol`). */
    listClass?: string;
    /** List items (`li`). */
    listItemClass?: string;
    /** Task list items with checkboxes. */
    taskListItemClass?: string;

    /** Blockquote wrapper. */
    blockquoteClass?: string;
    /** Anchor/link elements. */
    linkClass?: string;
    /** Inline code spans. */
    inlineCodeClass?: string;
    /** Horizontal rule (`<hr>`). */
    hrClass?: string;
  };

  /**
   * Behaviour and UI of the copy-to-clipboard button in code blocks.
   */
  copy?: {
    /** Enable or disable the copy button globally. */
    enabled?: boolean;
    /** Text label to show inside the copy button. */
    label?: string;
    /** Optional callback invoked after a successful copy. */
    onCopy?: (text: string) => void | Promise<void>;
  };

  /**
   * Theme values used to generate CSS variables for the default styles.
   */
  theme?: {
    /** Background for the whole markdown container. */
    markdownBackground?: string;
    /** Text color for normal markdown content. */
    markdownText?: string;
    /** Primary accent color (used for headings, etc.). */
    primaryColor?: string;
    /** Secondary accent color (used for links, etc.). */
    secondaryColor?: string;

    /** Background color for code blocks. */
    background?: string;
    /** Background color for the header above each code block. */
    headerBackground?: string;
    /** Border color around the code block container. */
    borderColor?: string;
    /** Default text color for code content. */
    textColor?: string;
    /** Text color for the header area. */
    headerTextColor?: string;
    /** Background for the copy button. */
    copyButtonBackground?: string;
    /** Text color for the copy button. */
    copyButtonTextColor?: string;
    /** Border color for the copy button. */
    copyButtonBorderColor?: string;
    /** Border radius applied to the code block container. */
    radius?: string;

    /** Scrollbar track color inside code blocks. */
    scrollbarTrack?: string;
    /** Scrollbar thumb color inside code blocks. */
    scrollbarThumb?: string;
    /** Scrollbar thumb color on hover. */
    scrollbarThumbHover?: string;
    /** Scrollbar thickness (width/height) for code blocks. */
    scrollbarSize?: string;
  };

  /**
   * If true, the syntax highlighter will be preloaded on mount so that
   * the first highlighted render is faster.
   */
  preloadHighlighter?: boolean;
}

/**
 * Props accepted by the `Markdown` component.
 */
export interface MarkdownProps {
  /**
   * Markdown source to render.
   *
   * Can be a string or a function that returns a string (useful when
   * integrating with reactive signals).
   */
  content?: string | (() => string);

  /**
   * Path to an external markdown file to load and render.
   *
   * When provided, the component will use `options.load`/`globLoaders`
   * to resolve and fetch the content.
   */
  src?: string;

  /**
   * Base path used to resolve relative `src` values.
   */
  base?: string;

  /**
   * Additional CSS class applied to the root wrapper element.
   */
  className?: string;

  /**
   * Advanced configuration for markdown rendering, theming and behaviour.
   */
  options?: MarkdownOptions;
}

/**
 * Renders markdown content to HTML with optional syntax highlighting and
 * a rich code-block UI (header, language label, copy button, theming).
 */
export declare function Markdown(props?: MarkdownProps): any;

/**
 * Default CSS class names used by the `Markdown` component.
 *
 * These values correspond to the selectors defined in `styles.css` and
 * can be reused when composing custom styles.
 */
export declare const defaultMarkdownStyles: {
  rootClass: string;
  codeBlockClass: string;
  codeHeaderClass: string;
  codeLangClass: string;
  codeCopyClass: string;
  codeBodyClass: string;

  h1Class: string;
  h2Class: string;
  h3Class: string;
  h4Class: string;
  h5Class: string;
  h6Class: string;
  paragraphClass: string;
  listClass: string;
  listItemClass: string;
  taskListItemClass: string;
  blockquoteClass: string;
  linkClass: string;
  inlineCodeClass: string;
  hrClass: string;
};
