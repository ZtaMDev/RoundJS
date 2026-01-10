import { createElement, signal, effect, onMount } from 'round-core';
import { marked } from 'marked';
import { createHighlighter } from 'shiki';
import { defaultMarkdownStyles } from './styles.js';

const defaultLoaders = (typeof import.meta !== 'undefined' && typeof import.meta.glob === 'function')
  ? import.meta.glob('/src/**/*.md', { query: '?raw', import: 'default' })
  : {};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLang(lang) {
  const l = String(lang || '').trim().toLowerCase();
  if (!l) return '';
  if (l === 'js') return 'javascript';
  if (l === 'ts') return 'typescript';
  if (l === 'sh') return 'bash';
  return l;
}

function joinClass(...xs) {
  return xs.filter(Boolean).join(' ');
}

let sharedHighlighterPromise = null;
function getSharedHighlighter(options) {
  if (options && options.getHighlighter) return options.getHighlighter;
  if (!sharedHighlighterPromise) {
    sharedHighlighterPromise = createHighlighter({
      themes: ['github-dark'],
      // Load a broad set of common languages explicitly so users get
      // reliable highlighting for typical code samples.
      langs: [
        'javascript', 'typescript', 'jsx', 'tsx',
        'json', 'jsonc',
        'css', 'scss', 'less',
        'html', 'xml',
        'markdown', 'mdx',
        'bash', 'shell', 'sh',
        'yaml', 'toml',
        'python', 'rust', 'go', 'java',
        'c', 'cpp', 'csharp',
        'php', 'ruby', 'swift', 'kotlin', 'dart', 'lua',
        'sql'
      ]
    });
  }
  return async () => sharedHighlighterPromise;
}

/**
 * @typedef {Object} MarkdownProps
 * @property {string} [content] - Markdown string
 * @property {string} [src] - Path or URL to markdown
 * @property {string} [base] - Base folder for ./src resolution
 * @property {string} [className]
 * @property {Object} [options]
 * @property {(path:string)=>Promise<string>} [options.load] - Custom loader for src
 * @property {Record<string, ()=>Promise<string>>} [options.globLoaders] - Vite raw md loaders map
 * @property {boolean} [options.sanitize] - If true, strips HTML by escaping it
 * @property {(html:string)=>string} [options.postprocessHtml]
 * @property {(args:{lang:string, code:string})=>Promise<string>|string} [options.highlight]
 * @property {()=>Promise<any>} [options.getHighlighter] - Custom shiki highlighter getter
 * @property {{
 *   rootClass?: string,
 *   codeBlockClass?: string,
 *   codeHeaderClass?: string,
 *   codeLangClass?: string,
 *   codeCopyClass?: string,
 *   codeBodyClass?: string
 * }} [options.classes]
 * @property {{
 *   enabled?: boolean,
 *   label?: string,
 *   onCopy?: (text:string)=>void|Promise<void>
 * }} [options.copy]
 */

export function Markdown(props = /** @type {MarkdownProps} */({})) {
  const html = signal('');
  let renderVersion = 0;

  const classes = { ...defaultMarkdownStyles, ...(props.options?.classes || {}) };
  const copyCfg = {
    enabled: props.options?.copy?.enabled !== false,
    label: typeof props.options?.copy?.label === 'string' ? props.options.copy.label : 'Copy',
    onCopy: props.options?.copy?.onCopy
  };

  const theme = props.options?.theme || {};
  const style = {
    // Root surface
    markdownBackground: theme.markdownBackground,
    markdownText: theme.markdownText,
    primaryColor: theme.primaryColor,
    secondaryColor: theme.secondaryColor,

    // Code block UI
    background: theme.background,
    headerBackground: theme.headerBackground,
    borderColor: theme.borderColor,
    textColor: theme.textColor,
    headerTextColor: theme.headerTextColor,
    copyButtonBackground: theme.copyButtonBackground,
    copyButtonTextColor: theme.copyButtonTextColor,
    copyButtonBorderColor: theme.copyButtonBorderColor,
    radius: theme.radius,
    scrollbarTrack: theme.scrollbarTrack,
    scrollbarThumb: theme.scrollbarThumb,
    scrollbarThumbHover: theme.scrollbarThumbHover,
    scrollbarSize: theme.scrollbarSize
  };

  const makeRenderer = () => {
    const renderer = new marked.Renderer();

    // Custom rendering only for fenced code blocks (to add header, copy button, etc.).
    // For all other markdown elements we use the default marked renderer so that
    // inline formatting (**bold**, links, etc.) works correctly without
    // introducing [object Object] issues with token objects.
    renderer.code = (code, infostring) => {
      let rawCode = code;
      let rawInfo = infostring;

      if (code && typeof code === 'object') {
        rawCode = code.text ?? code.code ?? '';
        rawInfo = code.lang ?? code.infostring ?? '';
      }

      const lang = normalizeLang(String(rawInfo || '').split(/\s+/)[0]);
      const safeCode = escapeHtml(rawCode);
      const safeLang = escapeHtml(lang || 'text');

      // placeholders - highlighted html will be filled in later
      const raw =
        `<div class="${escapeHtml(classes.codeBlockClass)}" data-round-md-code="1" data-lang="${safeLang}">` +
        `<div class="${escapeHtml(classes.codeHeaderClass)}">` +
        `<span class="${escapeHtml(classes.codeLangClass)}">${safeLang}</span>` +
        (copyCfg.enabled
          ? `<button type="button" class="${escapeHtml(classes.codeCopyClass)}" data-round-md-copy="1">${escapeHtml(copyCfg.label)}</button>`
          : '') +
        `</div>` +
        `<div class="${escapeHtml(classes.codeBodyClass)}">` +
        `<pre><code data-round-md-raw="1" data-lang="${safeLang}">${safeCode}</code></pre>` +
        `</div>` +
        `</div>`;

      return raw;
    };

    return renderer;
  };

  async function renderMarkdown(md) {
    const currentVersion = ++renderVersion;
    const sanitize = !!props.options?.sanitize;
    const post = props.options?.postprocessHtml;

    const renderer = makeRenderer();

    marked.setOptions({
      gfm: true,
      breaks: false,
      renderer
    });

    let out = '';
    try {
      if (sanitize) {
        out = marked.parse(escapeHtml(md ?? ''));
      } else {
        out = marked.parse(md ?? '');
      }
    } catch {
      out = '';
    }

    if (typeof post === 'function') {
      try {
        out = post(out);
      } catch {
      }
    }

    // First paint: set raw markdown HTML without syntax highlighting
    html(out);

    // Then, in the background, try to apply syntax highlighting.
    // Use a render version so only the latest render wins.
    (async () => {
      try {
        const highlighted = await applyHighlighting(out, props.options);
        if (renderVersion === currentVersion) {
          html(highlighted);
        }
      } catch {
      }
    })();
  }

  async function loadSrc() {
    if (typeof props.src !== 'string') return;

    const base = typeof props.base === 'string' ? props.base : '/src';
    const resolved = props.src.startsWith('./') ? (base + props.src.slice(1)) : props.src;

    const customLoad = props.options?.load;
    if (typeof customLoad === 'function') {
      const text = await customLoad(resolved);
      await renderMarkdown(text ?? '');
      return;
    }

    const loaders = props.options?.globLoaders || defaultLoaders;
    const loader = loaders[resolved];
    if (typeof loader === 'function') {
      const text = await loader();
      await renderMarkdown(text ?? '');
      return;
    }

    const r = await fetch(resolved);
    if (!r.ok) {
      html('');
      return;
    }
    const text = await r.text();
    await renderMarkdown(text ?? '');
  }

  if (typeof props.content === 'string') {
    // immediate render for content
    renderMarkdown(props.content);
  }

  // If user passes a signal as content
  if (typeof props.content === 'function') {
    effect(() => {
      const v = props.content();
      if (typeof v === 'string') renderMarkdown(v);
    }, { onLoad: true });
  }

  onMount(async () => {
    // Optional: warm up the highlighter early so first highlight is faster.
    if (props.options?.preloadHighlighter) {
      try {
        const getH = getSharedHighlighter(props.options);
        // fire-and-forget
        getH().catch(() => {});
      } catch {
      }
    }

    try {
      await loadSrc();
    } catch {
      html('');
    }
  });

  const onClick = async (e) => {
    try {
      const t = e?.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest('[data-round-md-copy="1"]');
      if (!btn) return;

      const block = btn.closest('[data-round-md-code="1"]');
      if (!block) return;
      const codeEl = block.querySelector('code');
      const text = codeEl ? codeEl.textContent || '' : '';

      if (typeof copyCfg.onCopy === 'function') {
        await copyCfg.onCopy(text);
        return;
      }

      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
    }
  };

  const className = joinClass(classes.rootClass, props.className);

  const root = createElement('div', {
    className,
    onClick,
    dangerouslySetInnerHTML: () => ({ __html: html() })
  });

  // Apply theme reliably.
  // - Use direct style properties for background/text so the effect is visible immediately.
  // - Use style.setProperty for CSS variables (custom properties).
  try {
    if (root && root.style) {
      if (style.markdownBackground) root.style.background = style.markdownBackground;
      if (style.markdownText) root.style.color = style.markdownText;

      if (style.markdownBackground) root.style.setProperty('--round-md-bg', style.markdownBackground);
      if (style.markdownText) root.style.setProperty('--round-md-text', style.markdownText);
      if (style.primaryColor) root.style.setProperty('--round-md-primary', style.primaryColor);
      if (style.secondaryColor) root.style.setProperty('--round-md-secondary', style.secondaryColor);

      if (style.background) root.style.setProperty('--round-md-code-bg', style.background);
      if (style.headerBackground) root.style.setProperty('--round-md-code-header-bg', style.headerBackground);
      if (style.borderColor) root.style.setProperty('--round-md-code-border', style.borderColor);
      if (style.textColor) root.style.setProperty('--round-md-code-text', style.textColor);
      if (style.headerTextColor) root.style.setProperty('--round-md-code-header-text', style.headerTextColor);
      if (style.copyButtonBackground) root.style.setProperty('--round-md-code-copy-bg', style.copyButtonBackground);
      if (style.copyButtonTextColor) root.style.setProperty('--round-md-code-copy-text', style.copyButtonTextColor);
      if (style.copyButtonBorderColor) root.style.setProperty('--round-md-code-copy-border', style.copyButtonBorderColor);
      if (style.radius) root.style.setProperty('--round-md-code-radius', style.radius);
      if (style.scrollbarTrack) root.style.setProperty('--round-md-scrollbar-track', style.scrollbarTrack);
      if (style.scrollbarThumb) root.style.setProperty('--round-md-scrollbar-thumb', style.scrollbarThumb);
      if (style.scrollbarThumbHover) root.style.setProperty('--round-md-scrollbar-thumb-hover', style.scrollbarThumbHover);
      if (style.scrollbarSize) root.style.setProperty('--round-md-scrollbar-size', style.scrollbarSize);
    }
  } catch {
  }

  return root;
}

async function applyHighlighting(rawHtml, options) {
  const customHighlight = options?.highlight;

  // Very small and robust HTML transform: highlight the <code data-round-md-raw>
  // content and replace it with highlighted HTML.
  // Since we already escaped code content into text nodes, we can safely use innerText from DOMParser.
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const codeNodes = doc.querySelectorAll('code[data-round-md-raw="1"]');

  if (!codeNodes.length) return rawHtml;

  let highlighter = null;
  if (!customHighlight) {
    try {
      const getH = getSharedHighlighter(options);
      highlighter = await getH();
    } catch {
      highlighter = null;
    }
  }

  for (const codeEl of codeNodes) {
    const lang = normalizeLang(codeEl.getAttribute('data-lang') || '');
    const code = codeEl.textContent || '';

    let highlighted = '';

    if (typeof customHighlight === 'function') {
      const res = await customHighlight({ lang, code });
      highlighted = String(res ?? '');
    } else if (highlighter && typeof highlighter.codeToHtml === 'function') {
      try {
        highlighted = highlighter.codeToHtml(code, {
          lang: lang || 'text',
          theme: 'github-dark'
        });
      } catch {
        highlighted = '';
      }
    }

    if (highlighted) {
      const pre = codeEl.closest('pre');
      if (pre) {
        const tmp = parser.parseFromString(highlighted, 'text/html');
        const shikiPre = tmp.querySelector('pre');
        if (shikiPre) {
          // keep our pre element but replace its children
          while (pre.firstChild) pre.removeChild(pre.firstChild);
          // shiki pre contains <code>
          Array.from(shikiPre.childNodes).forEach(n => pre.appendChild(n));
          continue;
        }
      }

      // fallback: replace code element content as HTML
      codeEl.innerHTML = highlighted;
      codeEl.removeAttribute('data-round-md-raw');
    }
  }

  return doc.body.innerHTML;
}
