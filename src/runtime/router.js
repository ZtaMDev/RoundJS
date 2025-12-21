import { signal, effect } from './signals.js';
import { createElement } from './dom.js';
import { createContext, readContext } from './context.js';

const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';

const ROUTING_TRAILING_SLASH = (typeof __ROUND_ROUTING_TRAILING_SLASH__ !== 'undefined')
    ? Boolean(__ROUND_ROUTING_TRAILING_SLASH__)
    : true;

const currentPath = signal(hasWindow ? window.location.pathname : '/');
let listenerInitialized = false;

let lastPathEvaluated = null;
let hasMatchForPath = false;

const pathHasMatch = signal(false);
const pathEvalReady = signal(true);

let defaultNotFoundComponent = null;
let autoNotFoundMounted = false;
let userProvidedNotFound = false;

const RoutingContext = createContext('');

function ensureListener() {
    if (!hasWindow || listenerInitialized) return;
    listenerInitialized = true;

    mountAutoNotFound();

    window.addEventListener('popstate', () => {
        currentPath(window.location.pathname);
    });
}

export function getPathname() {
    return normalizePathname(currentPath());
}

export function usePathname() {
    return () => normalizePathname(currentPath());
}

export function getLocation() {
    if (!hasWindow) {
        return { pathname: normalizePathname('/'), search: '', hash: '' };
    }
    return {
        pathname: normalizePathname(window.location.pathname),
        search: window.location.search ?? '',
        hash: window.location.hash ?? ''
    };
}

export function useLocation() {
    return () => {
        const pathname = normalizePathname(currentPath());
        if (!hasWindow) return { pathname, search: '', hash: '' };
        return { pathname, search: window.location.search ?? '', hash: window.location.hash ?? '' };
    };
}

export function getRouteReady() {
    const pathname = normalizePathname(currentPath());
    return Boolean(pathEvalReady()) && lastPathEvaluated === pathname;
}

export function useRouteReady() {
    return () => {
        const pathname = normalizePathname(currentPath());
        return Boolean(pathEvalReady()) && lastPathEvaluated === pathname;
    };
}

export function getIsNotFound() {
    const pathname = normalizePathname(currentPath());
    if (pathname === '/') return false;
    if (!(Boolean(pathEvalReady()) && lastPathEvaluated === pathname)) return false;
    return !Boolean(pathHasMatch());
}

export function useIsNotFound() {
    return () => {
        const pathname = normalizePathname(currentPath());
        if (pathname === '/') return false;
        if (!(Boolean(pathEvalReady()) && lastPathEvaluated === pathname)) return false;
        return !Boolean(pathHasMatch());
    };
}

function mountAutoNotFound() {
    if (!hasWindow || autoNotFoundMounted) return;
    autoNotFoundMounted = true;

    const host = document.getElementById('app') ?? document.body;
    const root = document.createElement('div');
    root.setAttribute('data-round-auto-notfound', '1');
    host.appendChild(root);

    const view = createElement('span', { style: { display: 'contents' } }, () => {
        if (userProvidedNotFound) return null;

        const pathname = normalizePathname(currentPath());
        const ready = pathEvalReady();
        const hasMatch = pathHasMatch();

        if (!ready) return null;
        if (lastPathEvaluated !== pathname) return null;
        if (hasMatch) return null;

        // Skip absolute 404 overlay for the root path if no match found,
        // allowing the base app to render its non-routed content.
        if (pathname === '/') return null;

        const Comp = defaultNotFoundComponent;
        if (typeof Comp === 'function') {
            return createElement(Comp, { pathname });
        }

        return createElement('div', { style: { padding: '16px' } },
            createElement('h1', null, '404'),
            createElement('p', null, 'Page not found: ', pathname)
        );
    });

    root.appendChild(view);
}

/**
 * Navigate to a different path programmatically.
 * @param {string} to The destination URL or path.
 * @param {object} [options] Navigation options (e.g., { replace: true }).
 */
export function navigate(to, options = {}) {
    if (!hasWindow) return;
    ensureListener();

    const normalizedTo = normalizeTo(to);
    const replace = Boolean(options.replace);
    if (replace) window.history.replaceState({}, '', normalizedTo);
    else window.history.pushState({}, '', normalizedTo);

    currentPath(window.location.pathname);
}

function applyHead({ title, meta, links, icon, favicon }) {
    if (!hasWindow) return;

    if (typeof title === 'string') {
        document.title = title;
    }

    document.querySelectorAll('[data-round-head="1"]').forEach((n) => n.remove());

    const iconHref = icon ?? favicon;
    if (typeof iconHref === 'string' && iconHref.length) {
        const el = document.createElement('link');
        el.setAttribute('data-round-head', '1');
        el.setAttribute('rel', 'icon');
        el.setAttribute('href', iconHref);
        document.head.appendChild(el);
    }

    if (Array.isArray(links)) {
        links.forEach((l) => {
            if (!l || typeof l !== 'object') return;
            const el = document.createElement('link');
            el.setAttribute('data-round-head', '1');
            Object.entries(l).forEach(([k, v]) => {
                if (v === null || v === undefined) return;
                el.setAttribute(k, String(v));
            });
            document.head.appendChild(el);
        });
    }

    if (Array.isArray(meta)) {
        meta.forEach((entry) => {
            if (!entry) return;
            const el = document.createElement('meta');
            el.setAttribute('data-round-head', '1');

            if (Array.isArray(entry) && entry.length >= 2) {
                const [name, content] = entry;
                if (typeof name === 'string') el.setAttribute('name', name);
                el.setAttribute('content', String(content ?? ''));
            } else if (typeof entry === 'object') {
                Object.entries(entry).forEach(([k, v]) => {
                    if (v === null || v === undefined) return;
                    el.setAttribute(k, String(v));
                });
            } else {
                return;
            }

            document.head.appendChild(el);
        });
    } else if (meta && typeof meta === 'object') {
        Object.entries(meta).forEach(([name, content]) => {
            if (typeof name !== 'string') return;
            const el = document.createElement('meta');
            el.setAttribute('data-round-head', '1');
            el.setAttribute('name', name);
            el.setAttribute('content', String(content ?? ''));
            document.head.appendChild(el);
        });
    }
}

export function startHead(_head) {
    return _head;
}

function splitUrl(url) {
    const str = String(url ?? '');
    const hashIdx = str.indexOf('#');
    const queryIdx = str.indexOf('?');
    const cutIdx = (hashIdx === -1)
        ? queryIdx
        : (queryIdx === -1 ? hashIdx : Math.min(hashIdx, queryIdx));

    if (cutIdx === -1) return { path: str, suffix: '' };
    return { path: str.slice(0, cutIdx), suffix: str.slice(cutIdx) };
}

function normalizePathname(p) {
    let pathname = String(p ?? '/');
    if (!pathname.startsWith('/')) pathname = '/' + pathname;
    if (pathname.length > 1) {
        if (ROUTING_TRAILING_SLASH) {
            if (!pathname.endsWith('/')) pathname += '/';
        } else {
            if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
        }
    }
    return pathname;
}

function normalizeTo(to) {
    const { path, suffix } = splitUrl(to);
    if (!path.startsWith('/')) return String(to ?? '');
    return normalizePathname(path) + suffix;
}

function matchRoute(route, pathname, exact = true) {
    const r = normalizePathname(route);
    const p = normalizePathname(pathname);
    if (exact) return r === p;
    // Prefix match: either exactly the same, or p starts with r plus a slash
    return p === r || p.startsWith(r.endsWith('/') ? r : r + '/');
}

function beginPathEvaluation(pathname) {
    if (pathname !== lastPathEvaluated) {
        lastPathEvaluated = pathname;
        hasMatchForPath = false;
        pathHasMatch(false);

        pathEvalReady(false);
        setTimeout(() => {
            if (lastPathEvaluated !== pathname) return;
            pathEvalReady(true);
        }, 0);
    }
}

export function setNotFound(Component) {
    defaultNotFoundComponent = Component;
}

/**
 * Define a route that renders its children when the path matches.
 * @param {object} props Route properties.
 * @param {string} [props.route='/'] The path to match.
 * @param {boolean} [props.exact] Whether to use exact matching.
 * @param {string} [props.title] Page title to set when active.
 * @param {string} [props.description] Meta description to set when active.
 * @param {any} [props.children] Content to render.
 */
export function Route(props = {}) {
    ensureListener();

    return createElement('span', { style: { display: 'contents' } }, () => {
        const parentPath = readContext(RoutingContext) || '';
        const pathname = normalizePathname(currentPath());
        beginPathEvaluation(pathname);

        const routeProp = props.route ?? '/';
        if (typeof routeProp === 'string' && !routeProp.startsWith('/')) {
            throw new Error(`Invalid route: "${routeProp}". All routes must start with a forward slash "/". (Nested under: "${parentPath || 'root'}")`);
        }

        let fullRoute = '';
        if (parentPath && parentPath !== '/') {
            const cleanParent = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
            const cleanChild = routeProp.startsWith('/') ? routeProp : '/' + routeProp;

            if (cleanChild.startsWith(cleanParent + '/') || cleanChild === cleanParent) {
                fullRoute = normalizePathname(cleanChild);
            } else {
                fullRoute = normalizePathname(cleanParent + cleanChild);
            }
        } else {
            fullRoute = normalizePathname(routeProp);
        }

        const isRoot = fullRoute === '/';
        const exact = props.exact !== undefined ? Boolean(props.exact) : isRoot;

        // For nested routing, we match as a prefix so parents stay rendered while children are active
        if (!matchRoute(fullRoute, pathname, exact)) return null;

        // If it's an exact match of the FULL segments, mark as matched for 404 purposes
        if (matchRoute(fullRoute, pathname, true)) {
            hasMatchForPath = true;
            pathHasMatch(true);
        }

        const mergedHead = (props.head && typeof props.head === 'object') ? props.head : {};
        const meta = props.description
            ? ([{ name: 'description', content: String(props.description) }].concat(mergedHead.meta ?? props.meta ?? []))
            : (mergedHead.meta ?? props.meta);
        const links = mergedHead.links ?? props.links;
        const title = mergedHead.title ?? props.title;
        const icon = mergedHead.icon ?? props.icon;
        const favicon = mergedHead.favicon ?? props.favicon;

        applyHead({ title, meta, links, icon, favicon });

        // Provide the current full path to nested routes
        return createElement(RoutingContext.Provider, { value: fullRoute }, props.children);
    });
}

/**
 * An alias for Route, typically used for top-level pages.
 * @param {object} props Page properties (same as Route).
 */
export function Page(props = {}) {
    ensureListener();

    return createElement('span', { style: { display: 'contents' } }, () => {
        const parentPath = readContext(RoutingContext) || '';
        const pathname = normalizePathname(currentPath());
        beginPathEvaluation(pathname);

        const routeProp = props.route ?? '/';
        if (typeof routeProp === 'string' && !routeProp.startsWith('/')) {
            throw new Error(`Invalid route: "${routeProp}". All routes must start with a forward slash "/". (Nested under: "${parentPath || 'root'}")`);
        }

        let fullRoute = '';
        if (parentPath && parentPath !== '/') {
            const cleanParent = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
            const cleanChild = routeProp.startsWith('/') ? routeProp : '/' + routeProp;

            if (cleanChild.startsWith(cleanParent + '/') || cleanChild === cleanParent) {
                fullRoute = normalizePathname(cleanChild);
            } else {
                fullRoute = normalizePathname(cleanParent + cleanChild);
            }
        } else {
            fullRoute = normalizePathname(routeProp);
        }

        const isRoot = fullRoute === '/';
        const exact = props.exact !== undefined ? Boolean(props.exact) : isRoot;

        if (!matchRoute(fullRoute, pathname, exact)) return null;

        if (matchRoute(fullRoute, pathname, true)) {
            hasMatchForPath = true;
            pathHasMatch(true);
        }

        const mergedHead = (props.head && typeof props.head === 'object') ? props.head : {};
        const meta = props.description
            ? ([{ name: 'description', content: String(props.description) }].concat(mergedHead.meta ?? props.meta ?? []))
            : (mergedHead.meta ?? props.meta);
        const links = mergedHead.links ?? props.links;
        const title = mergedHead.title ?? props.title;
        const icon = mergedHead.icon ?? props.icon;
        const favicon = mergedHead.favicon ?? props.favicon;

        applyHead({ title, meta, links, icon, favicon });

        return createElement(RoutingContext.Provider, { value: fullRoute }, props.children);
    });
}

/**
 * Define a fallback component or content for when no routes match.
 */
export function NotFound(props = {}) {
    ensureListener();

    userProvidedNotFound = true;

    return createElement('span', { style: { display: 'contents' } }, () => {
        const pathname = normalizePathname(currentPath());
        beginPathEvaluation(pathname);

        const ready = pathEvalReady();
        const hasMatch = pathHasMatch();
        if (!ready) return null;
        if (lastPathEvaluated !== pathname) return null;

        if (hasMatch) return null;
        if (pathname === '/') return null;

        const Comp = props.component ?? defaultNotFoundComponent;
        if (typeof Comp === 'function') {
            return createElement(Comp, { pathname });
        }

        if (props.children !== undefined) return props.children;

        return createElement('div', { style: { padding: '16px' } },
            createElement('h1', null, '404'),
            createElement('p', null, 'Page not found: ', pathname)
        );
    });
}

/**
 * A standard link component that performs SPA navigation.
 * @param {object} props Link properties.
 * @param {string} [props.href] The destination path.
 * @param {boolean} [props.spa=true] Use SPA navigation (prevents reload).
 * @param {any} [props.children] Link content.
 */
export function Link(props = {}) {
    ensureListener();

    const rawHref = props.href ?? props.to ?? '#';
    const href = spaNormalizeHref(rawHref);

    const spa = props.spa !== undefined ? Boolean(props.spa) : true;
    const reload = Boolean(props.reload);

    const onClick = (e) => {
        if (typeof props.onClick === 'function') props.onClick(e);
        if (e.defaultPrevented) return;

        // Allow target="_blank" to work naturally
        if (props.target === '_blank') return;

        // Allow absolute/external URLs to work naturally
        const strHref = String(href);
        if (strHref.includes('://') || strHref.startsWith('mailto:') || strHref.startsWith('tel:')) return;

        // Classic navigation: allow the browser to reload.
        if (!spa || reload) return;

        if (e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        e.preventDefault();
        navigate(href);
    };

    const { children, to, ...rest } = props;
    const normalizedChildren = Array.isArray(children)
        ? children
        : (children === undefined || children === null ? [] : [children]);

    return createElement('a', { ...rest, href, onClick }, ...normalizedChildren);
}

function spaNormalizeHref(href) {
    const str = String(href ?? '#');
    if (!str.startsWith('/')) return str;
    return normalizeTo(str);
}
