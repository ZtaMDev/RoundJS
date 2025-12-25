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
 * Creates a reactive side-effect that runs whenever its signal dependencies change.
 * Returns a function to manually stop the effect.
 */
export function effect(fn: () => void | (() => void), options?: {
    /** If false, the effect won't run immediately on creation. Defaults to true. */
    onLoad?: boolean
}): () => void;

/**
 * Creates a reactive side-effect with explicit dependencies.
 */
export function effect(deps: any[], fn: () => void | (() => void), options?: {
    /** If false, the effect won't run immediately on creation. Defaults to true. */
    onLoad?: boolean
}): () => void;

/**
 * Creates a read-only computed signal derived from other signals.
 */
export function derive<T>(fn: () => T): () => T;

/**
 * Async signal that loads data from an async function.
 * Provides reactive pending/error states and refetch capability.
 */
export interface AsyncSignal<T> {
    /**
     * Get the current resolved value, or set a new value.
     * Returns undefined while pending or if an error occurred.
     */
    (newValue?: T): T | undefined;

    /**
     * Get the current value (reactive).
     */
    value: T | undefined;

    /**
     * Get the current value without tracking dependencies.
     */
    peek(): T | undefined;

    /**
     * Signal indicating whether the async function is currently executing.
     * @example
     * if (user.pending()) {
     *   return <Spinner />;
     * }
     */
    pending: RoundSignal<boolean>;

    /**
     * Signal containing the error if the async function rejected.
     * Returns null if no error occurred.
     * @example
     * if (user.error()) {
     *   return <div>Error: {user.error().message}</div>;
     * }
     */
    error: RoundSignal<Error | null>;

    /**
     * Re-execute the async function to refresh the data.
     * Resets pending to true and clears any previous error.
     * @returns Promise that resolves to the new value
     * @example
     * <button onClick={() => user.refetch()}>Refresh</button>
     */
    refetch(): Promise<T | undefined>;
}

/**
 * Options for asyncSignal.
 */
export interface AsyncSignalOptions {
    /**
     * If true (default), executes the async function immediately on creation.
     * If false, you must call refetch() to start loading.
     */
    immediate?: boolean;
}

/**
 * Creates an async signal that loads data from an async function.
 * The signal provides reactive pending and error states, plus a refetch method.
 * 
 * @param asyncFn - Async function that returns a promise
 * @param options - Configuration options
 * @returns AsyncSignal with pending, error, and refetch properties
 * 
 * @example
 * const user = asyncSignal(() => fetch('/api/user').then(r => r.json()));
 * 
 * // In component:
 * {if(user.pending()) {
 *     <Spinner />
 * } else if(user.error()) {
 *     <Error message={user.error().message} />
 * } else {
 *     <Profile user={user()} />
 * }}
 * 
 * // Refetch on demand:
 * <button onClick={() => user.refetch()}>Refresh</button>
 */
export function asyncSignal<T>(asyncFn: () => Promise<T>, options?: AsyncSignalOptions): AsyncSignal<T>;

/**
 * Creates a read/write view of a specific path within a signal object.
 */
export function pick<T = any>(root: RoundSignal<any>, path: string | string[]): RoundSignal<T>;

/**
 * Lifecycle Hooks
 */

/**
 * Runs a function when the component is mounted to the DOM.
 * If the function returns another function, it will be used as an unmount cleanup.
 */
export function onMount(fn: () => void | (() => void)): void;

/**
 * Runs a function when the component is removed from the DOM.
 */
export function onUnmount(fn: () => void): void;

/**
 * Alias for onUnmount. Runs cleanup logic when the component is destroyed.
 */
export function onCleanup(fn: () => void): void;

/**
 * Runs a function after the component updates its DOM nodes.
 */
export function onUpdate(fn: () => void): void;

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
        /** The storage provider (defaults to localStorage). */
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
    /** Component or elements to render when matched. */
    children?: any;
}

/**
 * Defines a route that renders its children when the path matches.
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
 * A link component that performs SPA navigation.
 */
export function Link(props: LinkProps): any;

/**
 * Defines a fallback component for when no routes match.
 */
export function NotFound(props: {
    /** Component to render for the 404 state. */
    component?: any;
    /** Fallback content. Ignored if 'component' is provided. */
    children?: any
}): any;

/**
 * Navigates to a different path programmatically.
 */
export function navigate(to: string, options?: {
    /** If true, replaces the current history entry. */
    replace?: boolean
}): void;

/**
 * Returns a reactive function that returns the current normalized pathname.
 */
export function usePathname(): () => string;

/**
 * Gets the current normalized pathname.
 */
export function getPathname(): string;

/**
 * Returns a reactive function that returns the current location object.
 */
export function useLocation(): () => { pathname: string; search: string; hash: string };

/**
 * Gets the current location object (pathname, search, hash).
 */
export function getLocation(): { pathname: string; search: string; hash: string };

/**
 * Returns a reactive function that returns whether the current path has no matches.
 */
export function useIsNotFound(): () => boolean;

/**
 * Gets whether the current path is NOT matched by any defined route.
 */
export function getIsNotFound(): boolean;

/**
 * DOM & Context API
 */

/**
 * Creates a DOM element or instances a component.
 */
export function createElement(tag: any, props?: any, ...children: any[]): any;

/**
 * A grouping component that returns its children without a wrapper element.
 */
export function Fragment(props: { children?: any }): any;

export interface Context<T> {
    /** Internal identifier for the context. */
    id: number;
    /** Default value if no Provider is found. */
    defaultValue: T;
    /** Component that provides a value to descendants. */
    Provider: (props: { value: T; children?: any }) => any;
}

/**
 * Creates a new Context for sharing state between components.
 */
export function createContext<T>(defaultValue?: T): Context<T>;

/**
 * Reads the current context value from the component tree.
 */
export function readContext<T>(ctx: Context<T>): T;

/**
 * Returns a reactive function that reads the current context value.
 */
export function bindContext<T>(ctx: Context<T>): () => T;

/**
 * Error Handling
 */

export interface ErrorBoundaryProps {
    /** Content to render if an error occurs. Can be a signal or function. */
    fallback?: any | ((props: { error: any }) => any);
    /** Optional identifier for the boundary. */
    name?: string;
    /** Optional key that, when changed, resets the boundary error state. */
    resetKey?: any;
    /** Content that might throw an error. */
    children?: any;
}

/**
 * Component that catches runtime errors in its child tree and displays a fallback UI.
 */
export function ErrorBoundary(props: ErrorBoundaryProps): any;

/**
 * Async & Code Splitting
 */

/**
 * Marks a component for lazy loading (code-splitting).
 */
export function lazy<T>(fn: () => Promise<{ default: T } | T>): any;

declare module "*.round";

export interface SuspenseProps {
    /** Content to show while children are loading. */
    fallback: any;
    /** Content that might trigger a loading state. */
    children?: any;
}

/**
 * Component that renders a fallback UI while its children are loading.
 */
export function Suspense(props: SuspenseProps): any;

/**
 * Head Management
 */

/**
 * Defines static head metadata (titles, meta tags, etc.).
 */
export function startHead(head: any): any;