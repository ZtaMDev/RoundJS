/**
 * Round Framework Type Definitions
 */

export interface RoundSignal<T> {
    /**
     * Get or set the current value.
     */
    (newValue?: T): T;

    /**
     * Get the current value (reactive).
     */
    value: T;

    /**
     * Get the current value without tracking dependencies.
     */
    peek(): T;

    /**
     * Creates a transformed view of this signal.
     */
    transform<U>(fromInput: (v: U) => T, toOutput: (v: T) => U): RoundSignal<U>;

    /**
     * Attaches validation logic to the signal.
     */
    validate(validator: (next: T, prev: T) => string | boolean | undefined | null, options?: {
        /** Timing of validation: 'input' (default) or 'blur'. */
        validateOn?: 'input' | 'blur';
        /** Whether to run validation immediately on startup. */
        validateInitial?: boolean;
    }): RoundSignal<T> & {
        /** Signal containing the current validation error message. */
        error: RoundSignal<string | null>;
        /** Manually trigger validation check. Returns true if valid. */
        check(): boolean
    };

    /**
     * Creates a read/write view of a specific property path.
     */
    $pick<K extends keyof T>(path: K): RoundSignal<T[K]>;
    $pick(path: string | string[]): RoundSignal<any>;

    /**
     * Internal: marks the signal as bindable for two-way bindings.
     */
    bind?: boolean;
}

export interface Signal {
    <T>(initialValue?: T): RoundSignal<T>;
    object<T extends object>(initialState: T): { [K in keyof T]: RoundSignal<T[K]> };
}

/**
 * Creates a reactive signal.
 */
export const signal: Signal;

/**
 * Creates a bindable signal intended for two-way DOM bindings.
 */
export interface Bindable {
    <T>(initialValue?: T): RoundSignal<T>;
    object<T extends object>(initialState: T): { [K in keyof T]: RoundSignal<T[K]> };
}

/**
 * Creates a bindable signal intended for two-way DOM bindings.
 */
export const bindable: Bindable;

/**
 * Run a function without tracking any signals it reads.
 * Any signals accessed inside the function will not become dependencies of the current effect.
 */
export function untrack<T>(fn: () => T): T;

/**
 * Create a reactive side-effect that runs whenever its signal dependencies change.
 */
export function effect(fn: () => void | (() => void), options?: {
    /** If false, the effect won't run immediately on creation. Defaults to true. */
    onLoad?: boolean
}): () => void;

/**
 * Create a reactive side-effect with explicit dependencies.
 */
export function effect(deps: any[], fn: () => void | (() => void), options?: {
    /** If false, the effect won't run immediately on creation. Defaults to true. */
    onLoad?: boolean
}): () => void;

/**
 * Create a read-only computed signal derived from other signals.
 */
export function derive<T>(fn: () => T): () => T;

/**
 * Create a read/write view of a specific path within a signal object.
 */
export function pick<T = any>(root: RoundSignal<any>, path: string | string[]): RoundSignal<T>;

/**
 * Store API
 */
export interface RoundStore<T> {
    /**
     * Access a specific key from the store as a bindable signal.
     */
    use<K extends keyof T>(key: K): RoundSignal<T[K]>;

    /**
     * Update a specific key in the store.
     */
    set<K extends keyof T>(key: K, value: T[K]): T[K];

    /**
     * Batch update multiple keys in the store.
     */
    patch(obj: Partial<T>): void;

    /**
     * Get a snapshot of the current state.
     */
    snapshot(options?: {
        /** If true, the returned values will be reactive signals. */
        reactive?: boolean
    }): T;

    /**
     * Enable persistence for the store.
     */
    persist(storageKey: string, options?: {
        /** The storage implementation (defaults to localStorage). */
        storage?: Storage;
        /** Debounce time in milliseconds for writes. */
        debounce?: number;
        /** Array of keys to exclude from persistence. */
        exclude?: string[];
    }): RoundStore<T>;

    /**
     * Action methods defined during store creation.
     */
    actions: Record<string, Function>;
}

/**
 * Create a shared global state store with actions and optional persistence.
 */
export function createStore<T, A extends Record<string, (state: T, ...args: any[]) => Partial<T> | void>>(
    initialState: T,
    actions?: A
): RoundStore<T> & { [K in keyof A]: (...args: Parameters<A[K]> extends [any, ...infer P] ? P : never) => any };

/**
 * Router API
 */
export interface RouteProps {
    /** The path to match. Must start with a forward slash. */
    route?: string;
    /** If true, only matches if the path is exactly the same. */
    exact?: boolean;
    /** Page title to set in the document header when active. */
    title?: string;
    /** Meta description to set in the document header when active. */
    description?: string;
    /** Advanced head configuration including links and meta tags. */
    head?: any;
    /** Fragment or elements to render when matched. */
    children?: any;
}

/**
 * Define a route that renders its children when the path matches.
 */
export function Route(props: RouteProps): any;

/**
 * An alias for Route, typically used for top-level pages.
 */
export function Page(props: RouteProps): any;

export interface LinkProps {
    /** The destination path. */
    href: string;
    /** Alias for href. */
    to?: string;
    /** Use SPA navigation (prevents full page reloads). Defaults to true. */
    spa?: boolean;
    /** Force a full page reload on navigation. */
    reload?: boolean;
    /** Custom click event handler. */
    onClick?: (e: MouseEvent) => void;
    /** Link content (text or elements). */
    children?: any;
    [key: string]: any;
}

/**
 * A standard link component that performs SPA navigation.
 */
export function Link(props: LinkProps): any;

/**
 * Define a fallback component or content for when no routes match.
 */
export function NotFound(props: {
    /** Optional component to render for the 404 state. */
    component?: any;
    /** Fallback content. ignored if 'component' is provided. */
    children?: any
}): any;

/**
 * Navigate to a different path programmatically.
 */
export function navigate(to: string, options?: {
    /** If true, replaces the current history entry instead of pushing. */
    replace?: boolean
}): void;

/**
 * Hook to get a reactive function returning the current normalized pathname.
 */
export function usePathname(): () => string;

/**
 * Get the current normalized pathname.
 */
export function getPathname(): string;

/**
 * Hook to get a reactive function returning the current location object.
 */
export function useLocation(): () => { pathname: string; search: string; hash: string };

/**
 * Get the current location object (pathname, search, hash).
 */
export function getLocation(): { pathname: string; search: string; hash: string };

/**
 * Hook to get a reactive function returning whether the current path has no matches.
 */
export function useIsNotFound(): () => boolean;

/**
 * Get whether the current path is NOT matched by any defined route.
 */
export function getIsNotFound(): boolean;

/**
 * DOM & Context API
 */

/**
 * Create a DOM element or instance a component.
 */
export function createElement(tag: any, props?: any, ...children: any[]): any;

/**
 * A grouping component that returns its children without a wrapper element.
 */
export function Fragment(props: { children?: any }): any;

export interface Context<T> {
    /** Internal identifier for the context. */
    id: number;
    /** Default value used when no Provider is found in the tree. */
    defaultValue: T;
    /** Component that provides a value to all its descendants. */
    Provider: (props: { value: T; children?: any }) => any;
}

/**
 * Create a new Context object for sharing state between components.
 */
export function createContext<T>(defaultValue?: T): Context<T>;

/**
 * Read the current value of a context from the component tree.
 */
export function readContext<T>(ctx: Context<T>): T;

/**
 * Returns a reactive function that reads the current context value.
 */
export function bindContext<T>(ctx: Context<T>): () => T;

/**
 * Async & Code Splitting
 */

/**
 * Mark a component for lazy loading (code-splitting).
 * Expects a function returning a dynamic import promise.
 */
export function lazy<T>(fn: () => Promise<{ default: T } | T>): any;

declare module "*.round";

export interface SuspenseProps {
    /** Content to show while children (e.g. lazy components) are loading. */
    fallback: any;
    /** Content that might trigger a loading state. */
    children?: any;
}

/**
 * Component that boundaries async operations and renders a fallback while loading.
 */
export function Suspense(props: SuspenseProps): any;

/**
 * Head Management
 */

/**
 * Define static head metadata (titles, meta tags, favicons, etc.).
 */
export function startHead(head: any): any;

/**
 * Markdown
 */

/**
 * Component that renders Markdown content into HTML.
 */
export function Markdown(props: {
    /** The markdown string or a function returning it. */
    content: string | (() => string);
    /** Remark/Rehype configuration options. */
    options?: any
}): any;
