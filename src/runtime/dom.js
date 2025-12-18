import { effect, untrack } from './signals.js';
import { runInLifecycle, createComponentInstance, mountComponent, initLifecycleRoot } from './lifecycle.js';
import { reportErrorSafe } from './error-reporter.js';
import { captureContext, runInContext, readContext } from './context.js';
import { SuspenseContext } from './suspense.js';


let isObserverInitialized = false;

const warnedSignals = new Set();

function isPromiseLike(v) {
    return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

function warnSignalDirectUsage(fn, kind) {
    try {
        if (typeof fn !== 'function') return;
        if (typeof fn.peek !== 'function') return;
        if (!('value' in fn)) return;
        // Using signals as dynamic children/props is a supported pattern.
        if (kind === 'child') return;
        if (typeof kind === 'string' && kind.startsWith('prop:')) return;
        const key = `${kind}:${fn.name ?? 'signal'}`;
        if (warnedSignals.has(key)) return;
        warnedSignals.add(key);
        console.warn(`[round] Prefer {signal()} (reactive) or {signal.value} (static). Direct {signal} usage is allowed but discouraged.`);
    } catch {
    }
}

/**
 * Create a DOM element or instance a component.
 * @param {string | Function} tag HTML tag name or Component function.
 * @param {object} [props] Element attributes or component props.
 * @param {...any} children Child nodes.
 * @returns {Node} The resulting DOM node.
 */
export function createElement(tag, props = {}, ...children) {
    if (typeof tag === 'function') {
        const componentInstance = createComponentInstance();
        const componentName = tag?.name ?? 'Anonymous';
        componentInstance.name = componentName;

        let node = runInLifecycle(componentInstance, () => {
            const componentProps = { ...props, children };
            try {
                const res = untrack(() => tag(componentProps));
                if (isPromiseLike(res)) throw res;
                return res;
            } catch (e) {
                if (isPromiseLike(e)) {
                    const suspense = readContext(SuspenseContext);
                    if (!suspense) {
                        throw new Error("cannot instance a lazy component outside a suspense");
                    }
                    throw e;
                }
                reportErrorSafe(e, { phase: 'component.render', component: componentName });
                return createElement('div', { style: { padding: '16px' } }, `Error in ${componentName}`);
            }
        });

        if (Array.isArray(node)) {
            const wrapper = document.createElement('span');
            wrapper.style.display = 'contents';
            node.forEach(n => appendChild(wrapper, n));
            node = wrapper;
        }

        if (node instanceof Node) {
            node._componentInstance = componentInstance;
            componentInstance.nodes.push(node);

            componentInstance.mountTimerId = setTimeout(() => {
                componentInstance.mountTimerId = null;
                mountComponent(componentInstance);
            }, 0);
        }

        return node;
    }

    if (typeof tag === 'string') {
        const isCustomElement = tag.includes('-');

        const isStandard = /^(a|abbr|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|param|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|small|source|span|strong|style|sub|summary|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr|menu|animate|animateMotion|animateTransform|circle|clipPath|defs|desc|ellipse|feBlend|feColorMatrix|feComponentTransfer|feComposite|feConvolveMatrix|feDiffuseLighting|feDisplacementMap|feDistantLight|feDropShadow|feFlood|feFuncA|feFuncB|feFuncG|feFuncR|feGaussianBlur|feImage|feMerge|feMergeNode|feMorphology|feOffset|fePointLight|feSpecularLighting|feSpotLight|feTile|feTurbulence|filter|foreignObject|g|image|line|linearGradient|marker|mask|metadata|mpath|path|pattern|polygon|polyline|radialGradient|rect|set|stop|switch|symbol|text|textPath|tspan|use|view)$/.test(tag);

        // __ROUND_CUSTOM_TAGS__ is injected by the vite plugin from round.config.json
        const isCustomConfigured = typeof __ROUND_CUSTOM_TAGS__ !== 'undefined' && __ROUND_CUSTOM_TAGS__.includes(tag);

        if (!isCustomElement && !isStandard && !isCustomConfigured && /^[a-z]/.test(tag)) {
            throw new Error(`Component names must start with an uppercase letter: <${tag} />`);
        }
    }

    const element = document.createElement(tag);

    if (props) {
        Object.entries(props).forEach(([key, value]) => {
            if (key === 'bind:value' || key === 'bind:checked') {
                const isSignalLike = typeof value === 'function' && typeof value.peek === 'function' && ('value' in value);
                const isBindable = isSignalLike && value.bind === true;

                if (!isSignalLike) {
                    try {
                        console.warn('[round] bind:* expects a signal/bindable. Example: const name = bindable(\'\'); <input bind:value={name} />');
                    } catch {
                    }
                    return;
                }

                if (!isBindable) {
                    try {
                        console.warn('[round] bind:* is intended to be used with bindable(). Plain signal() is accepted but discouraged.');
                    } catch {
                    }
                }

                const isValueBinding = key === 'bind:value';
                const isCheckedBinding = key === 'bind:checked';
                const el = element;
                const tagName = String(el.tagName ?? '').toLowerCase();
                const type = String(el.getAttribute?.('type') ?? '').toLowerCase();

                const isInput = tagName === 'input';
                const isTextarea = tagName === 'textarea';
                const isSelect = tagName === 'select';

                if (isCheckedBinding && !(isInput && (type === 'checkbox' || type === 'radio'))) {
                    try {
                        console.warn(`[round] bind:checked is only supported on <input type="checkbox|radio">. Got <${tagName}${type ? ` type=\"${type}\"` : ''}>.`);
                    } catch {
                    }
                    return;
                }

                if (isValueBinding && !(isInput || isTextarea || isSelect)) {
                    try {
                        console.warn(`[round] bind:value is only supported on <input>, <textarea>, and <select>. Got <${tagName}>.`);
                    } catch {
                    }
                    return;
                }

                const coerceFromDom = () => {
                    if (isCheckedBinding) {
                        if (type === 'radio') {
                            return Boolean(el.checked);
                        }
                        return Boolean(el.checked);
                    }

                    if (isInput && type === 'number') {
                        const raw = el.value;
                        if (raw === '') return '';
                        const n = Number(raw);
                        return Number.isFinite(n) ? n : raw;
                    }

                    if (isSelect && el.multiple) {
                        try {
                            return Array.from(el.selectedOptions ?? []).map(o => o.value);
                        } catch {
                            return [];
                        }
                    }

                    return el.value;
                };

                const writeToDom = (v) => {
                    if (isCheckedBinding) {
                        const b = Boolean(v);
                        if (type === 'radio') {
                            el.checked = b;
                        } else {
                            el.checked = b;
                        }
                        return;
                    }

                    if (isSelect && el.multiple) {
                        const arr = Array.isArray(v) ? v.map(x => String(x)) : [];
                        try {
                            Array.from(el.options ?? []).forEach(opt => {
                                opt.selected = arr.includes(opt.value);
                            });
                        } catch {
                        }
                        return;
                    }

                    el.value = v ?? '';
                };

                const warnTypeMismatch = (next) => {
                    try {
                        if (isCheckedBinding && typeof next !== 'boolean') {
                            console.warn('[round] bind:checked expects a boolean signal value.');
                        }
                        if (isValueBinding && isSelect && el.multiple && !Array.isArray(next)) {
                            console.warn('[round] bind:value on <select multiple> expects an array signal value.');
                        }
                        if (isValueBinding && isInput && type === 'number' && !(typeof next === 'number' || typeof next === 'string')) {
                            console.warn('[round] bind:value on <input type="number"> expects number|string (empty string allowed).');
                        }
                    } catch {
                    }
                };

                effect(() => {
                    const v = value();
                    warnTypeMismatch(v);
                    writeToDom(v);
                }, { onLoad: false });

                const validateOn = isValueBinding && value && typeof value === 'function'
                    ? value.__round_validateOn
                    : null;
                const valueEvent = (validateOn === 'blur') ? 'blur' : (isSelect ? 'change' : 'input');
                const eventName = isCheckedBinding ? 'change' : valueEvent;
                el.addEventListener(eventName, (e) => {
                    try {
                        const target = e.currentTarget;
                        if (!target) return;
                        const next = coerceFromDom();
                        value(next);
                    } catch {
                    }
                });
                return;
            }

            if (key.startsWith('on') && typeof value === 'function') {
                element.addEventListener(key.toLowerCase().substring(2), value);
                return;
            }

            if (key === 'dangerouslySetInnerHTML') {
                if (typeof value === 'function') {
                    effect(() => {
                        const v = value();
                        if (v && typeof v === 'object' && '__html' in v) {
                            element.innerHTML = v.__html ?? '';
                        }
                    }, { onLoad: false });
                } else if (value && typeof value === 'object' && '__html' in value) {
                    element.innerHTML = value.__html ?? '';
                }
                return;
            }

            if (key === 'style') {
                if (typeof value === 'function') {
                    effect(() => {
                        const v = value();
                        if (v && typeof v === 'object') {
                            Object.assign(element.style, v);
                        }
                    }, { onLoad: false });
                    return;
                }
                if (value && typeof value === 'object') {
                    Object.assign(element.style, value);
                    return;
                }
            }

            if (typeof value === 'function') {
                warnSignalDirectUsage(value, `prop:${key}`);
                effect(() => {
                    const val = value();
                    if (key === 'className') element.className = val;
                    else if (key === 'value') element.value = val;
                    else if (key === 'checked') element.checked = Boolean(val);
                    else element.setAttribute(key, val);
                }, { onLoad: false });
                return;
            }

            if (key === 'classList') {
                if (value && typeof value === 'object') {
                    Object.entries(value).forEach(([className, condition]) => {
                        if (typeof condition === 'function') {
                            effect(() => {
                                element.classList.toggle(className, !!condition());
                            }, { onLoad: false });
                        } else {
                            element.classList.toggle(className, !!condition);
                        }
                    });
                }
                return;
            }

            if (key === 'className') element.className = value;
            else if (key === 'value') element.value = value;
            else if (key === 'checked') element.checked = Boolean(value);
            else element.setAttribute(key, value);
        });
    }

    children.forEach(child => appendChild(element, child));

    return element;
}

function appendChild(parent, child) {
    if (child === null || child === undefined) return;

    if (Array.isArray(child)) {
        child.forEach(c => appendChild(parent, c));
        return;
    }

    if (typeof child === 'string' || typeof child === 'number') {
        parent.appendChild(document.createTextNode(child));
        return;
    }

    if (typeof child === 'function') {
        warnSignalDirectUsage(child, 'child');
        const placeholder = document.createTextNode('');
        parent.appendChild(placeholder);

        let currentNode = placeholder;

        const ctxSnapshot = captureContext();

        effect(() => {
            runInContext(ctxSnapshot, () => {
                let val;
                try {
                    val = child();
                    if (isPromiseLike(val)) throw val;
                } catch (e) {
                    if (isPromiseLike(e)) {
                        const suspense = readContext(SuspenseContext);
                        if (suspense && typeof suspense.register === 'function') {
                            suspense.register(e);
                            return;
                        }
                        throw new Error("cannot instance a lazy component outside a suspense");
                    }
                    reportErrorSafe(e, { phase: 'child.dynamic' });
                    val = createElement('div', { style: { padding: '16px' } }, 'Error');
                }

                if (Array.isArray(val)) {
                    if (!(currentNode instanceof Element) || !currentNode._roundArrayWrapper) {
                        const wrapper = document.createElement('span');
                        wrapper.style.display = 'contents';
                        wrapper._roundArrayWrapper = true;
                        if (currentNode.parentNode) {
                            currentNode.parentNode.replaceChild(wrapper, currentNode);
                            currentNode = wrapper;
                        }
                    }

                    while (currentNode.firstChild) currentNode.removeChild(currentNode.firstChild);
                    val.forEach(v => appendChild(currentNode, v));
                    return;
                }

                if (val instanceof Node) {
                    if (currentNode !== val) {
                        if (currentNode.parentNode) {
                            currentNode.parentNode.replaceChild(val, currentNode);
                            currentNode = val;
                        }
                    }
                }
                else {
                    const textContent = (val === null || val === undefined) ? '' : val;

                    if (currentNode instanceof Element) {
                        const newText = document.createTextNode(textContent);
                        if (currentNode.parentNode) {
                            currentNode.parentNode.replaceChild(newText, currentNode);
                            currentNode = newText;
                        }
                    } else {
                        currentNode.textContent = textContent;
                    }
                }
            });
        }, { onLoad: false });
        return;
    }

    if (child instanceof Node) {
        parent.appendChild(child);
        return;
    }
}

/**
 * A grouping component that returns its children without a wrapper element.
 */
export function Fragment(props) {
    return props.children;
}
