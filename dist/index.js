var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
let reporter = null;
function setErrorReporter(fn) {
  reporter = typeof fn === "function" ? fn : null;
}
__name(setErrorReporter, "setErrorReporter");
function reportErrorSafe(error, info) {
  if (!reporter) return;
  try {
    reporter(error, info);
  } catch {
  }
}
__name(reportErrorSafe, "reportErrorSafe");
const componentStack = [];
function getCurrentComponent() {
  return componentStack[componentStack.length - 1];
}
__name(getCurrentComponent, "getCurrentComponent");
function runInLifecycle(componentInstance, fn) {
  componentStack.push(componentInstance);
  try {
    return fn();
  } finally {
    componentStack.pop();
  }
}
__name(runInLifecycle, "runInLifecycle");
function createComponentInstance() {
  return {
    mountHooks: [],
    unmountHooks: [],
    updateHooks: [],
    nodes: [],
    isMounted: false,
    mountTimerId: null
  };
}
__name(createComponentInstance, "createComponentInstance");
function onMount(fn) {
  const component = getCurrentComponent();
  if (component) {
    component.mountHooks.push(fn);
  } else {
    try {
      fn();
    } catch (e) {
      reportErrorSafe(e, { phase: "onMount" });
    }
  }
}
__name(onMount, "onMount");
function onUnmount(fn) {
  const component = getCurrentComponent();
  if (component) {
    component.unmountHooks.push(fn);
  }
}
__name(onUnmount, "onUnmount");
const onCleanup = onUnmount;
function onUpdate(fn) {
  const component = getCurrentComponent();
  if (component) {
    component.updateHooks.push(fn);
  }
}
__name(onUpdate, "onUpdate");
function mountComponent(component) {
  if (component.isMounted) return;
  try {
    const root = component?.nodes?.[0];
    if (root && root instanceof Node && root.isConnected === false) {
      return;
    }
  } catch {
  }
  component.isMounted = true;
  component.mountHooks.forEach((hook) => {
    try {
      const cleanup2 = hook();
      if (typeof cleanup2 === "function") {
        component.unmountHooks.push(cleanup2);
      }
    } catch (e) {
      reportErrorSafe(e, { phase: "mount", component: component.name ?? null });
    }
  });
}
__name(mountComponent, "mountComponent");
function unmountComponent(component) {
  if (!component.isMounted) return;
  if (component.mountTimerId != null) {
    try {
      clearTimeout(component.mountTimerId);
    } catch {
    }
    component.mountTimerId = null;
  }
  component.isMounted = false;
  component.unmountHooks.forEach((hook) => {
    try {
      hook();
    } catch (e) {
      reportErrorSafe(e, { phase: "unmount", component: component.name ?? null });
    }
  });
}
__name(unmountComponent, "unmountComponent");
function triggerUpdate(component) {
  if (!component.isMounted) return;
  component.updateHooks.forEach((hook) => {
    try {
      hook();
    } catch (e) {
      reportErrorSafe(e, { phase: "update", component: component.name ?? null });
    }
  });
}
__name(triggerUpdate, "triggerUpdate");
const observer = typeof MutationObserver !== "undefined" ? new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.removedNodes.length > 0) {
      mutation.removedNodes.forEach((node) => {
        if (node._componentInstance) {
          unmountComponent(node._componentInstance);
        }
        cleanupNodeRecursively(node);
      });
    }
  });
}) : null;
function cleanupNodeRecursively(node) {
  if (node._componentInstance) {
    unmountComponent(node._componentInstance);
  }
  node.childNodes.forEach(cleanupNodeRecursively);
}
__name(cleanupNodeRecursively, "cleanupNodeRecursively");
function initLifecycleRoot(rootNode) {
  if (!rootNode) return;
  if (!observer) return;
  observer.observe(rootNode, { childList: true, subtree: true });
}
__name(initLifecycleRoot, "initLifecycleRoot");
const Lifecycle = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createComponentInstance,
  getCurrentComponent,
  initLifecycleRoot,
  mountComponent,
  onCleanup,
  onMount,
  onUnmount,
  onUpdate,
  runInLifecycle,
  triggerUpdate,
  unmountComponent
}, Symbol.toStringTag, { value: "Module" }));
let context = null;
let batchCount = 0;
let pendingEffects = [];
let globalVersion = 0;
function isPromiseLike$2(v) {
  return v && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
}
__name(isPromiseLike$2, "isPromiseLike$2");
function isSignalLike(v) {
  return typeof v === "function" && typeof v.peek === "function" && "value" in v;
}
__name(isSignalLike, "isSignalLike");
function untrack(fn) {
  const prev = context;
  context = null;
  try {
    return typeof fn === "function" ? fn() : void 0;
  } finally {
    context = prev;
  }
}
__name(untrack, "untrack");
function batch(fn) {
  batchCount++;
  try {
    return fn();
  } finally {
    if (--batchCount === 0) {
      const effects = pendingEffects;
      pendingEffects = [];
      for (let i = 0; i < effects.length; i++) {
        effects[i].queued = false;
        effects[i].run();
      }
    }
  }
}
__name(batch, "batch");
function subscribe(sub, dep) {
  let link = sub.deps;
  while (link) {
    if (link.dep === dep) return;
    link = link.nextDep;
  }
  link = {
    sub,
    dep,
    nextSub: dep.subs,
    prevSub: null,
    nextDep: sub.deps,
    prevDep: null
  };
  if (dep.subs) dep.subs.prevSub = link;
  dep.subs = link;
  if (sub.deps) sub.deps.prevDep = link;
  sub.deps = link;
}
__name(subscribe, "subscribe");
function cleanup(sub) {
  let link = sub.deps;
  while (link) {
    const { dep, prevSub, nextSub } = link;
    if (prevSub) prevSub.nextSub = nextSub;
    else dep.subs = nextSub;
    if (nextSub) nextSub.prevSub = prevSub;
    link = link.nextDep;
  }
  sub.deps = null;
}
__name(cleanup, "cleanup");
function notify(dep) {
  let link = dep.subs;
  while (link) {
    const sub = link.sub;
    if (sub.isComputed) {
      sub.version = -1;
      notify(sub);
    } else {
      if (batchCount > 0) {
        if (!sub.queued) {
          sub.queued = true;
          pendingEffects.push(sub);
        }
      } else {
        sub.run();
      }
    }
    link = link.nextSub;
  }
}
__name(notify, "notify");
function effect(arg1, arg2, arg3) {
  let callback, explicitDeps = null, options = { onLoad: true };
  let owner = getCurrentComponent();
  if (typeof arg1 === "function") {
    callback = arg1;
    if (arg2 && typeof arg2 === "object") options = { ...options, ...arg2 };
  } else {
    explicitDeps = arg1;
    callback = arg2;
    if (arg3 && typeof arg3 === "object") options = { ...options, ...arg3 };
  }
  const sub = {
    deps: null,
    queued: false,
    run() {
      if (this._cleanup) {
        try {
          this._cleanup();
        } catch (e) {
          reportErrorSafe(e, { phase: "effect.cleanup", component: owner?.name });
        }
        this._cleanup = null;
      }
      cleanup(this);
      const prev = context;
      context = this;
      try {
        if (explicitDeps) {
          if (Array.isArray(explicitDeps)) {
            for (let i = 0; i < explicitDeps.length; i++) {
              const d = explicitDeps[i];
              if (typeof d === "function") d();
            }
          } else if (typeof explicitDeps === "function") {
            explicitDeps();
          }
        }
        const res = callback();
        if (typeof res === "function") this._cleanup = res;
        if (owner?.isMounted) triggerUpdate(owner);
      } catch (e) {
        if (!isPromiseLike$2(e)) reportErrorSafe(e, { phase: "effect", component: owner?.name });
        else throw e;
      } finally {
        context = prev;
      }
    },
    _cleanup: null
  };
  const dispose = /* @__PURE__ */ __name(() => {
    if (sub._cleanup) {
      try {
        sub._cleanup();
      } catch (e) {
      }
      sub._cleanup = null;
    }
    cleanup(sub);
  }, "dispose");
  if (options.onLoad) {
    onMount(() => sub.run());
  } else {
    sub.run();
  }
  return dispose;
}
__name(effect, "effect");
function defineBindMarkerIfNeeded(source, target) {
  if (source && source.bind === true) {
    try {
      Object.defineProperty(target, "bind", { enumerable: true, value: true, configurable: true });
    } catch {
      target.bind = true;
    }
  }
}
__name(defineBindMarkerIfNeeded, "defineBindMarkerIfNeeded");
function attachHelpers(s) {
  if (!s || typeof s !== "function") return s;
  if (typeof s.transform === "function" && typeof s.validate === "function" && typeof s.$pick === "function") return s;
  s.$pick = (p) => pick(s, p);
  s.transform = (fromInput, toOutput) => {
    const fromFn = typeof fromInput === "function" ? fromInput : (v) => v;
    const toFn = typeof toOutput === "function" ? toOutput : (v) => v;
    const wrapped = /* @__PURE__ */ __name(function(...args) {
      if (args.length > 0) return s(fromFn(args[0]));
      return toFn(s());
    }, "wrapped");
    wrapped.peek = () => toFn(s.peek());
    Object.defineProperty(wrapped, "value", {
      enumerable: true,
      configurable: true,
      get() {
        return wrapped.peek();
      },
      set(v) {
        wrapped(v);
      }
    });
    defineBindMarkerIfNeeded(s, wrapped);
    return attachHelpers(wrapped);
  };
  s.validate = (validator, options = {}) => {
    const validateFn = typeof validator === "function" ? validator : null;
    const error = signal(null);
    const validateOn = options?.validateOn || "input";
    const validateInitial = !!options?.validateInitial;
    const wrapped = /* @__PURE__ */ __name(function(...args) {
      if (args.length > 0) {
        const next = args[0];
        if (validateFn) {
          let res = true;
          try {
            res = validateFn(next, s.peek());
          } catch {
            res = "Invalid value";
          }
          if (res === true || res === void 0 || res === null) {
            error(null);
            return s(next);
          }
          error(typeof res === "string" && res.length ? res : "Invalid value");
          return s.peek();
        }
        error(null);
        return s(next);
      }
      return s();
    }, "wrapped");
    wrapped.check = () => {
      if (!validateFn) {
        error(null);
        return true;
      }
      const cur = s.peek();
      let res = true;
      try {
        res = validateFn(cur, cur);
      } catch {
        res = "Invalid value";
      }
      if (res === true || res === void 0 || res === null) {
        error(null);
        return true;
      }
      error(typeof res === "string" && res.length ? res : "Invalid value");
      return false;
    };
    wrapped.peek = () => s.peek();
    Object.defineProperty(wrapped, "value", {
      enumerable: true,
      configurable: true,
      get() {
        return wrapped.peek();
      },
      set(v) {
        wrapped(v);
      }
    });
    wrapped.error = error;
    wrapped.__round_validateOn = validateOn;
    if (validateInitial) {
      try {
        wrapped.check();
      } catch {
      }
    }
    defineBindMarkerIfNeeded(s, wrapped);
    return attachHelpers(wrapped);
  };
  return s;
}
__name(attachHelpers, "attachHelpers");
function signal(initialValue) {
  const dep = {
    value: initialValue,
    version: 0,
    subs: null
  };
  const s = /* @__PURE__ */ __name(function(newValue) {
    if (arguments.length > 0) {
      if (dep.value !== newValue) {
        dep.value = newValue;
        dep.version = ++globalVersion;
        notify(dep);
      }
      return dep.value;
    }
    if (context) subscribe(context, dep);
    return dep.value;
  }, "s");
  s.peek = () => dep.value;
  Object.defineProperty(s, "value", {
    enumerable: true,
    configurable: true,
    get() {
      return s();
    },
    set(v) {
      s(v);
    }
  });
  return attachHelpers(s);
}
__name(signal, "signal");
function bindable(initialValue) {
  const s = signal(initialValue);
  try {
    Object.defineProperty(s, "bind", { enumerable: true, value: true, configurable: true });
  } catch {
    s.bind = true;
  }
  return attachHelpers(s);
}
__name(bindable, "bindable");
function getIn(obj, path) {
  let cur = obj;
  for (let i = 0; i < path.length; i++) {
    if (cur == null) return void 0;
    cur = cur[path[i]];
  }
  return cur;
}
__name(getIn, "getIn");
function setIn(obj, path, value) {
  if (!Array.isArray(path) || path.length === 0) return value;
  const root = obj && typeof obj === "object" ? obj : {};
  const out = Array.isArray(root) ? root.slice() : { ...root };
  let curOut = out;
  let curIn = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextIn = curIn && typeof curIn === "object" ? curIn[key] : void 0;
    const nextOut = nextIn && typeof nextIn === "object" ? Array.isArray(nextIn) ? nextIn.slice() : { ...nextIn } : {};
    curOut[key] = nextOut;
    curOut = nextOut;
    curIn = nextIn;
  }
  curOut[path[path.length - 1]] = value;
  return out;
}
__name(setIn, "setIn");
function parsePath(path) {
  if (Array.isArray(path)) return path.map((p) => String(p));
  if (typeof path === "string") return path.split(".").filter(Boolean);
  return [String(path)];
}
__name(parsePath, "parsePath");
function pick(root, path) {
  if (!isSignalLike(root)) throw new Error("[round] pick() expects a signal.");
  const pathArr = parsePath(path);
  const view = /* @__PURE__ */ __name(function(...args) {
    if (args.length > 0) {
      const nextRoot = setIn(root.peek(), pathArr, args[0]);
      return root(nextRoot);
    }
    const v = root();
    return getIn(v, pathArr);
  }, "view");
  view.peek = () => getIn(root.peek(), pathArr);
  Object.defineProperty(view, "value", {
    enumerable: true,
    configurable: true,
    get() {
      return view.peek();
    },
    set(v) {
      view(v);
    }
  });
  if (root.bind === true) {
    try {
      Object.defineProperty(view, "bind", { enumerable: true, value: true, configurable: true });
    } catch {
      view.bind = true;
    }
  }
  return view;
}
__name(pick, "pick");
function createBindableObjectProxy(root, basePath) {
  const cache = /* @__PURE__ */ new Map();
  const handler = {
    get(_target, prop) {
      if (prop === Symbol.toStringTag) return "BindableObject";
      if (prop === "peek") return () => basePath.length ? pick(root, basePath).peek() : root.peek();
      if (prop === "value") return basePath.length ? pick(root, basePath).peek() : root.peek();
      if (prop === "bind") return true;
      if (prop === "$pick") {
        return (p) => createBindableObjectProxy(root, basePath.concat(parsePath(p)));
      }
      if (prop === "_root") return root;
      if (prop === "_path") return basePath.slice();
      const key = String(prop);
      const nextPath = basePath.concat(key);
      const cacheKey = nextPath.join(".");
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      try {
        const stored = getIn(root.peek(), nextPath);
        if (isSignalLike(stored)) {
          cache.set(cacheKey, stored);
          return stored;
        }
      } catch {
      }
      const next = createBindableObjectProxy(root, nextPath);
      cache.set(cacheKey, next);
      return next;
    },
    set(_target, prop, value) {
      const key = String(prop);
      const nextPath = basePath.concat(key);
      try {
        const stored = getIn(root.peek(), nextPath);
        if (isSignalLike(stored)) {
          stored(value);
          return true;
        }
      } catch {
      }
      pick(root, nextPath)(value);
      return true;
    },
    has(_target, prop) {
      if (prop === "peek" || prop === "value" || prop === "bind" || prop === "$pick") return true;
      const v = basePath.length ? pick(root, basePath).peek() : root.peek();
      return v != null && Object.prototype.hasOwnProperty.call(v, prop);
    }
  };
  const fn = /* @__PURE__ */ __name(function(...args) {
    if (args.length > 0) return basePath.length ? pick(root, basePath)(args[0]) : root(args[0]);
    return basePath.length ? pick(root, basePath)() : root();
  }, "fn");
  fn.peek = () => basePath.length ? pick(root, basePath).peek() : root.peek();
  Object.defineProperty(fn, "value", { enumerable: true, configurable: true, get() {
    return fn.peek();
  }, set(v) {
    fn(v);
  } });
  try {
    Object.defineProperty(fn, "bind", { enumerable: true, value: true, configurable: true });
  } catch {
    fn.bind = true;
  }
  return new Proxy(fn, handler);
}
__name(createBindableObjectProxy, "createBindableObjectProxy");
bindable.object = function(initialObject = {}) {
  const root = bindable(initialObject && typeof initialObject === "object" ? initialObject : {});
  return createBindableObjectProxy(root, []);
};
function derive(fn) {
  const dep = {
    fn,
    value: void 0,
    version: -1,
    depsVersion: -1,
    subs: null,
    deps: null,
    isComputed: true,
    run() {
      cleanup(this);
      const prev = context;
      context = this;
      try {
        this.value = this.fn();
        this.depsVersion = globalVersion;
        this.version = ++globalVersion;
      } finally {
        context = prev;
      }
    }
  };
  const s = /* @__PURE__ */ __name(function() {
    if (dep.version === -1 || dep.depsVersion < globalVersion) dep.run();
    if (context) subscribe(context, dep);
    return dep.value;
  }, "s");
  s.peek = () => {
    if (dep.version === -1 || dep.depsVersion < globalVersion) dep.run();
    return dep.value;
  };
  Object.defineProperty(s, "value", { enumerable: true, configurable: true, get() {
    return s();
  } });
  return attachHelpers(s);
}
__name(derive, "derive");
const Signals = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  batch,
  bindable,
  derive,
  effect,
  pick,
  signal,
  untrack
}, Symbol.toStringTag, { value: "Module" }));
let nextContextId = 1;
const contextStack = [];
function pushContext(values) {
  contextStack.push(values);
}
__name(pushContext, "pushContext");
function popContext() {
  contextStack.pop();
}
__name(popContext, "popContext");
function readContext(ctx) {
  for (let i = contextStack.length - 1; i >= 0; i--) {
    const layer = contextStack[i];
    if (layer && Object.prototype.hasOwnProperty.call(layer, ctx.id)) {
      return layer[ctx.id];
    }
  }
  return ctx.defaultValue;
}
__name(readContext, "readContext");
function createContext(defaultValue) {
  const ctx = {
    id: nextContextId++,
    defaultValue,
    Provider: null
  };
  function Provider(props = {}) {
    const children = props.children;
    pushContext({ [ctx.id]: props.value });
    try {
      return createElement("span", { style: { display: "contents" } }, () => {
        const val = typeof props.value === "function" && props.value.peek ? props.value() : props.value;
        pushContext({ [ctx.id]: val });
        try {
          return children;
        } finally {
          popContext();
        }
      });
    } finally {
      popContext();
    }
  }
  __name(Provider, "Provider");
  ctx.Provider = Provider;
  return ctx;
}
__name(createContext, "createContext");
function bindContext(ctx) {
  return () => {
    const provided = readContext(ctx);
    if (typeof provided === "function") {
      try {
        return provided();
      } catch {
        return provided;
      }
    }
    return provided;
  };
}
__name(bindContext, "bindContext");
function captureContext() {
  return contextStack.slice();
}
__name(captureContext, "captureContext");
function runInContext(snapshot, fn) {
  const prev = contextStack.slice();
  contextStack.length = 0;
  contextStack.push(...snapshot);
  try {
    return fn();
  } finally {
    contextStack.length = 0;
    contextStack.push(...prev);
  }
}
__name(runInContext, "runInContext");
const Context = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  bindContext,
  captureContext,
  createContext,
  readContext,
  runInContext
}, Symbol.toStringTag, { value: "Module" }));
function isPromiseLike$1(v) {
  return v && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
}
__name(isPromiseLike$1, "isPromiseLike$1");
const SuspenseContext = createContext(null);
function lazy(loader) {
  if (typeof loader !== "function") {
    throw new Error("lazy(loader) expects a function that returns a Promise");
  }
  let status = "uninitialized";
  let promise = null;
  let component = null;
  let error = null;
  function pickComponent(mod) {
    if (!mod) return null;
    if (typeof mod === "function") return mod;
    if (typeof mod.default === "function") return mod.default;
    if (typeof mod.Counter === "function") return mod.Counter;
    const fns = [];
    for (const k of Object.keys(mod)) {
      if (typeof mod[k] === "function") fns.push(mod[k]);
    }
    if (fns.length === 1) return fns[0];
    return null;
  }
  __name(pickComponent, "pickComponent");
  return /* @__PURE__ */ __name(function LazyComponent(props = {}) {
    if (status === "resolved") {
      return createElement(component, props);
    }
    if (status === "rejected") {
      throw error;
    }
    if (!promise) {
      status = "pending";
      try {
        promise = Promise.resolve(loader()).then((mod) => {
          const resolved = pickComponent(mod);
          if (typeof resolved !== "function") {
            throw new Error("lazy() loaded module does not export a component");
          }
          component = resolved;
          status = "resolved";
        }).catch((e) => {
          error = e instanceof Error ? e : new Error(String(e));
          status = "rejected";
        });
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
        status = "rejected";
        throw error;
      }
    }
    throw promise;
  }, "LazyComponent");
}
__name(lazy, "lazy");
function Suspense(props = {}) {
  const tick = signal(0);
  const pending = /* @__PURE__ */ new Set();
  const waiting = /* @__PURE__ */ new Set();
  const child = Array.isArray(props.children) ? props.children[0] : props.children;
  const childFn = typeof child === "function" ? child : () => child;
  const register = /* @__PURE__ */ __name((promise) => {
    if (!waiting.has(promise)) {
      waiting.add(promise);
      pending.add(promise);
      promise.then(
        () => {
          waiting.delete(promise);
          pending.delete(promise);
          tick(tick.peek() + 1);
        },
        () => {
          waiting.delete(promise);
          pending.delete(promise);
          tick(tick.peek() + 1);
        }
      );
    }
  }, "register");
  return createElement(SuspenseContext.Provider, {
    value: { register }
  }, () => {
    tick();
    if (pending.size > 0) {
      return props.fallback ?? null;
    }
    try {
      const res = childFn();
      if (isPromiseLike$1(res)) {
        register(res);
        return props.fallback ?? null;
      }
      return res ?? null;
    } catch (e) {
      if (isPromiseLike$1(e)) {
        register(e);
        return props.fallback ?? null;
      }
      throw e;
    }
  });
}
__name(Suspense, "Suspense");
const Suspense$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Suspense,
  SuspenseContext,
  lazy
}, Symbol.toStringTag, { value: "Module" }));
const warnedSignals = /* @__PURE__ */ new Set();
function isPromiseLike(v) {
  return v && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
}
__name(isPromiseLike, "isPromiseLike");
function warnSignalDirectUsage(fn, kind) {
  try {
    if (typeof fn !== "function") return;
    if (typeof fn.peek !== "function") return;
    if (!("value" in fn)) return;
    if (kind === "child") return;
    if (typeof kind === "string" && kind.startsWith("prop:")) return;
    const key = `${kind}:${fn.name ?? "signal"}`;
    if (warnedSignals.has(key)) return;
    warnedSignals.add(key);
    console.warn(`[round] Prefer {signal()} (reactive) or {signal.value} (static). Direct {signal} usage is allowed but discouraged.`);
  } catch {
  }
}
__name(warnSignalDirectUsage, "warnSignalDirectUsage");
function createElement(tag, props = {}, ...children) {
  if (typeof tag === "function") {
    const componentInstance = createComponentInstance();
    const componentName = tag?.name ?? "Anonymous";
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
        reportErrorSafe(e, { phase: "component.render", component: componentName });
        return createElement("div", { style: { padding: "16px" } }, `Error in ${componentName}`);
      }
    });
    if (Array.isArray(node)) {
      const wrapper = document.createElement("span");
      wrapper.style.display = "contents";
      node.forEach((n) => appendChild(wrapper, n));
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
  if (typeof tag === "string") {
    const isCustomElement = tag.includes("-");
    const isStandard = /^(a|abbr|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|param|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|small|source|span|strong|style|sub|summary|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr|menu|animate|animateMotion|animateTransform|circle|clipPath|defs|desc|ellipse|feBlend|feColorMatrix|feComponentTransfer|feComposite|feConvolveMatrix|feDiffuseLighting|feDisplacementMap|feDistantLight|feDropShadow|feFlood|feFuncA|feFuncB|feFuncG|feFuncR|feGaussianBlur|feImage|feMerge|feMergeNode|feMorphology|feOffset|fePointLight|feSpecularLighting|feSpotLight|feTile|feTurbulence|filter|foreignObject|g|image|line|linearGradient|marker|mask|metadata|mpath|path|pattern|polygon|polyline|radialGradient|rect|set|stop|switch|symbol|text|textPath|tspan|use|view)$/.test(tag);
    const isCustomConfigured = typeof __ROUND_CUSTOM_TAGS__ !== "undefined" && __ROUND_CUSTOM_TAGS__.includes(tag);
    if (!isCustomElement && !isStandard && !isCustomConfigured && /^[a-z]/.test(tag)) {
      throw new Error(`Component names must start with an uppercase letter: <${tag} />`);
    }
  }
  const element = document.createElement(tag);
  if (props) {
    Object.entries(props).forEach(([key, value]) => {
      if (key === "bind:value" || key === "bind:checked") {
        const isSignalLike2 = typeof value === "function" && typeof value.peek === "function" && "value" in value;
        const isBindable = isSignalLike2 && value.bind === true;
        if (!isSignalLike2) {
          try {
            console.warn("[round] bind:* expects a signal/bindable. Example: const name = bindable(''); <input bind:value={name} />");
          } catch {
          }
          return;
        }
        if (!isBindable) {
          try {
            console.warn("[round] bind:* is intended to be used with bindable(). Plain signal() is accepted but discouraged.");
          } catch {
          }
        }
        const isValueBinding = key === "bind:value";
        const isCheckedBinding = key === "bind:checked";
        const el = element;
        const tagName = String(el.tagName ?? "").toLowerCase();
        const type = String(el.getAttribute?.("type") ?? "").toLowerCase();
        const isInput = tagName === "input";
        const isTextarea = tagName === "textarea";
        const isSelect = tagName === "select";
        if (isCheckedBinding && !(isInput && (type === "checkbox" || type === "radio"))) {
          try {
            console.warn(`[round] bind:checked is only supported on <input type="checkbox|radio">. Got <${tagName}${type ? ` type="${type}"` : ""}>.`);
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
        const coerceFromDom = /* @__PURE__ */ __name(() => {
          if (isCheckedBinding) {
            if (type === "radio") {
              return Boolean(el.checked);
            }
            return Boolean(el.checked);
          }
          if (isInput && type === "number") {
            const raw = el.value;
            if (raw === "") return "";
            const n = Number(raw);
            return Number.isFinite(n) ? n : raw;
          }
          if (isSelect && el.multiple) {
            try {
              return Array.from(el.selectedOptions ?? []).map((o) => o.value);
            } catch {
              return [];
            }
          }
          return el.value;
        }, "coerceFromDom");
        const writeToDom = /* @__PURE__ */ __name((v) => {
          if (isCheckedBinding) {
            const b = Boolean(v);
            if (type === "radio") {
              el.checked = b;
            } else {
              el.checked = b;
            }
            return;
          }
          if (isSelect && el.multiple) {
            const arr = Array.isArray(v) ? v.map((x) => String(x)) : [];
            try {
              Array.from(el.options ?? []).forEach((opt) => {
                opt.selected = arr.includes(opt.value);
              });
            } catch {
            }
            return;
          }
          el.value = v ?? "";
        }, "writeToDom");
        const warnTypeMismatch = /* @__PURE__ */ __name((next) => {
          try {
            if (isCheckedBinding && typeof next !== "boolean") {
              console.warn("[round] bind:checked expects a boolean signal value.");
            }
            if (isValueBinding && isSelect && el.multiple && !Array.isArray(next)) {
              console.warn("[round] bind:value on <select multiple> expects an array signal value.");
            }
            if (isValueBinding && isInput && type === "number" && !(typeof next === "number" || typeof next === "string")) {
              console.warn('[round] bind:value on <input type="number"> expects number|string (empty string allowed).');
            }
          } catch {
          }
        }, "warnTypeMismatch");
        effect(() => {
          const v = value();
          warnTypeMismatch(v);
          writeToDom(v);
        }, { onLoad: false });
        const validateOn = isValueBinding && value && typeof value === "function" ? value.__round_validateOn : null;
        const valueEvent = validateOn === "blur" ? "blur" : isSelect ? "change" : "input";
        const eventName = isCheckedBinding ? "change" : valueEvent;
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
      if (key.startsWith("on") && typeof value === "function") {
        element.addEventListener(key.toLowerCase().substring(2), value);
        return;
      }
      if (key === "dangerouslySetInnerHTML") {
        if (typeof value === "function") {
          effect(() => {
            const v = value();
            if (v && typeof v === "object" && "__html" in v) {
              element.innerHTML = v.__html ?? "";
            }
          }, { onLoad: false });
        } else if (value && typeof value === "object" && "__html" in value) {
          element.innerHTML = value.__html ?? "";
        }
        return;
      }
      if (key === "style") {
        if (typeof value === "function") {
          effect(() => {
            const v = value();
            if (v && typeof v === "object") {
              Object.assign(element.style, v);
            }
          }, { onLoad: false });
          return;
        }
        if (value && typeof value === "object") {
          Object.assign(element.style, value);
          return;
        }
      }
      if (typeof value === "function") {
        warnSignalDirectUsage(value, `prop:${key}`);
        effect(() => {
          const val = value();
          if (key === "className") element.className = val;
          else if (key === "value") element.value = val;
          else if (key === "checked") element.checked = Boolean(val);
          else element.setAttribute(key, val);
        }, { onLoad: false });
        return;
      }
      if (key === "classList") {
        if (value && typeof value === "object") {
          Object.entries(value).forEach(([className, condition]) => {
            if (typeof condition === "function") {
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
      if (key === "className") element.className = value;
      else if (key === "value") element.value = value;
      else if (key === "checked") element.checked = Boolean(value);
      else element.setAttribute(key, value);
    });
  }
  children.forEach((child) => appendChild(element, child));
  return element;
}
__name(createElement, "createElement");
function appendChild(parent, child) {
  if (child === null || child === void 0) return;
  if (Array.isArray(child)) {
    child.forEach((c) => appendChild(parent, c));
    return;
  }
  if (typeof child === "string" || typeof child === "number") {
    parent.appendChild(document.createTextNode(child));
    return;
  }
  if (typeof child === "function") {
    warnSignalDirectUsage(child, "child");
    const placeholder = document.createTextNode("");
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
            if (suspense && typeof suspense.register === "function") {
              suspense.register(e);
              return;
            }
            throw new Error("cannot instance a lazy component outside a suspense");
          }
          reportErrorSafe(e, { phase: "child.dynamic" });
          val = createElement("div", { style: { padding: "16px" } }, "Error");
        }
        if (Array.isArray(val)) {
          if (!(currentNode instanceof Element) || !currentNode._roundArrayWrapper) {
            const wrapper = document.createElement("span");
            wrapper.style.display = "contents";
            wrapper._roundArrayWrapper = true;
            if (currentNode.parentNode) {
              currentNode.parentNode.replaceChild(wrapper, currentNode);
              currentNode = wrapper;
            }
          }
          while (currentNode.firstChild) currentNode.removeChild(currentNode.firstChild);
          val.forEach((v) => appendChild(currentNode, v));
          return;
        }
        if (val instanceof Node) {
          if (currentNode !== val) {
            if (currentNode.parentNode) {
              currentNode.parentNode.replaceChild(val, currentNode);
              currentNode = val;
            }
          }
        } else {
          const textContent = val === null || val === void 0 ? "" : val;
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
__name(appendChild, "appendChild");
function Fragment(props) {
  return props.children;
}
__name(Fragment, "Fragment");
const DOM = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Fragment,
  createElement
}, Symbol.toStringTag, { value: "Module" }));
const hasWindow$1 = typeof window !== "undefined" && typeof document !== "undefined";
const ROUTING_TRAILING_SLASH = typeof __ROUND_ROUTING_TRAILING_SLASH__ !== "undefined" ? Boolean(__ROUND_ROUTING_TRAILING_SLASH__) : true;
const currentPath = signal(hasWindow$1 ? window.location.pathname : "/");
let listenerInitialized = false;
let lastPathEvaluated = null;
const pathHasMatch = signal(false);
const pathEvalReady = signal(true);
let defaultNotFoundComponent = null;
let autoNotFoundMounted = false;
let userProvidedNotFound = false;
const RoutingContext = createContext("");
function ensureListener() {
  if (!hasWindow$1 || listenerInitialized) return;
  listenerInitialized = true;
  mountAutoNotFound();
  window.addEventListener("popstate", () => {
    currentPath(window.location.pathname);
  });
}
__name(ensureListener, "ensureListener");
function getPathname() {
  return normalizePathname(currentPath());
}
__name(getPathname, "getPathname");
function usePathname() {
  return () => normalizePathname(currentPath());
}
__name(usePathname, "usePathname");
function getLocation() {
  if (!hasWindow$1) {
    return { pathname: normalizePathname("/"), search: "", hash: "" };
  }
  return {
    pathname: normalizePathname(window.location.pathname),
    search: window.location.search ?? "",
    hash: window.location.hash ?? ""
  };
}
__name(getLocation, "getLocation");
function useLocation() {
  return () => {
    const pathname = normalizePathname(currentPath());
    if (!hasWindow$1) return { pathname, search: "", hash: "" };
    return { pathname, search: window.location.search ?? "", hash: window.location.hash ?? "" };
  };
}
__name(useLocation, "useLocation");
function getRouteReady() {
  const pathname = normalizePathname(currentPath());
  return Boolean(pathEvalReady()) && lastPathEvaluated === pathname;
}
__name(getRouteReady, "getRouteReady");
function useRouteReady() {
  return () => {
    const pathname = normalizePathname(currentPath());
    return Boolean(pathEvalReady()) && lastPathEvaluated === pathname;
  };
}
__name(useRouteReady, "useRouteReady");
function getIsNotFound() {
  const pathname = normalizePathname(currentPath());
  if (pathname === "/") return false;
  if (!(Boolean(pathEvalReady()) && lastPathEvaluated === pathname)) return false;
  return !Boolean(pathHasMatch());
}
__name(getIsNotFound, "getIsNotFound");
function useIsNotFound() {
  return () => {
    const pathname = normalizePathname(currentPath());
    if (pathname === "/") return false;
    if (!(Boolean(pathEvalReady()) && lastPathEvaluated === pathname)) return false;
    return !Boolean(pathHasMatch());
  };
}
__name(useIsNotFound, "useIsNotFound");
function mountAutoNotFound() {
  if (!hasWindow$1 || autoNotFoundMounted) return;
  autoNotFoundMounted = true;
  const host = document.getElementById("app") ?? document.body;
  const root = document.createElement("div");
  root.setAttribute("data-round-auto-notfound", "1");
  host.appendChild(root);
  const view = createElement("span", { style: { display: "contents" } }, () => {
    if (userProvidedNotFound) return null;
    const pathname = normalizePathname(currentPath());
    const ready = pathEvalReady();
    const hasMatch = pathHasMatch();
    if (!ready) return null;
    if (lastPathEvaluated !== pathname) return null;
    if (hasMatch) return null;
    if (pathname === "/") return null;
    const Comp = defaultNotFoundComponent;
    if (typeof Comp === "function") {
      return createElement(Comp, { pathname });
    }
    return createElement(
      "div",
      { style: { padding: "16px" } },
      createElement("h1", null, "404"),
      createElement("p", null, "Page not found: ", pathname)
    );
  });
  root.appendChild(view);
}
__name(mountAutoNotFound, "mountAutoNotFound");
function navigate(to, options = {}) {
  if (!hasWindow$1) return;
  ensureListener();
  const normalizedTo = normalizeTo(to);
  const replace = Boolean(options.replace);
  if (replace) window.history.replaceState({}, "", normalizedTo);
  else window.history.pushState({}, "", normalizedTo);
  currentPath(window.location.pathname);
}
__name(navigate, "navigate");
function applyHead({ title, meta, links, icon, favicon }) {
  if (!hasWindow$1) return;
  if (typeof title === "string") {
    document.title = title;
  }
  document.querySelectorAll('[data-round-head="1"]').forEach((n) => n.remove());
  const iconHref = icon ?? favicon;
  if (typeof iconHref === "string" && iconHref.length) {
    const el = document.createElement("link");
    el.setAttribute("data-round-head", "1");
    el.setAttribute("rel", "icon");
    el.setAttribute("href", iconHref);
    document.head.appendChild(el);
  }
  if (Array.isArray(links)) {
    links.forEach((l) => {
      if (!l || typeof l !== "object") return;
      const el = document.createElement("link");
      el.setAttribute("data-round-head", "1");
      Object.entries(l).forEach(([k, v]) => {
        if (v === null || v === void 0) return;
        el.setAttribute(k, String(v));
      });
      document.head.appendChild(el);
    });
  }
  if (Array.isArray(meta)) {
    meta.forEach((entry) => {
      if (!entry) return;
      const el = document.createElement("meta");
      el.setAttribute("data-round-head", "1");
      if (Array.isArray(entry) && entry.length >= 2) {
        const [name, content] = entry;
        if (typeof name === "string") el.setAttribute("name", name);
        el.setAttribute("content", String(content ?? ""));
      } else if (typeof entry === "object") {
        Object.entries(entry).forEach(([k, v]) => {
          if (v === null || v === void 0) return;
          el.setAttribute(k, String(v));
        });
      } else {
        return;
      }
      document.head.appendChild(el);
    });
  } else if (meta && typeof meta === "object") {
    Object.entries(meta).forEach(([name, content]) => {
      if (typeof name !== "string") return;
      const el = document.createElement("meta");
      el.setAttribute("data-round-head", "1");
      el.setAttribute("name", name);
      el.setAttribute("content", String(content ?? ""));
      document.head.appendChild(el);
    });
  }
}
__name(applyHead, "applyHead");
function startHead(_head) {
  return _head;
}
__name(startHead, "startHead");
function splitUrl(url) {
  const str = String(url ?? "");
  const hashIdx = str.indexOf("#");
  const queryIdx = str.indexOf("?");
  const cutIdx = hashIdx === -1 ? queryIdx : queryIdx === -1 ? hashIdx : Math.min(hashIdx, queryIdx);
  if (cutIdx === -1) return { path: str, suffix: "" };
  return { path: str.slice(0, cutIdx), suffix: str.slice(cutIdx) };
}
__name(splitUrl, "splitUrl");
function normalizePathname(p) {
  let pathname = String(p ?? "/");
  if (!pathname.startsWith("/")) pathname = "/" + pathname;
  if (pathname.length > 1) {
    if (ROUTING_TRAILING_SLASH) {
      if (!pathname.endsWith("/")) pathname += "/";
    } else {
      if (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    }
  }
  return pathname;
}
__name(normalizePathname, "normalizePathname");
function normalizeTo(to) {
  const { path, suffix } = splitUrl(to);
  if (!path.startsWith("/")) return String(to ?? "");
  return normalizePathname(path) + suffix;
}
__name(normalizeTo, "normalizeTo");
function matchRoute(route, pathname, exact = true) {
  const r = normalizePathname(route);
  const p = normalizePathname(pathname);
  if (exact) return r === p;
  return p === r || p.startsWith(r.endsWith("/") ? r : r + "/");
}
__name(matchRoute, "matchRoute");
function beginPathEvaluation(pathname) {
  if (pathname !== lastPathEvaluated) {
    lastPathEvaluated = pathname;
    pathHasMatch(false);
    pathEvalReady(false);
    setTimeout(() => {
      if (lastPathEvaluated !== pathname) return;
      pathEvalReady(true);
    }, 0);
  }
}
__name(beginPathEvaluation, "beginPathEvaluation");
function setNotFound(Component) {
  defaultNotFoundComponent = Component;
}
__name(setNotFound, "setNotFound");
function Route(props = {}) {
  ensureListener();
  return createElement("span", { style: { display: "contents" } }, () => {
    const parentPath = readContext(RoutingContext) || "";
    const pathname = normalizePathname(currentPath());
    beginPathEvaluation(pathname);
    const routeProp = props.route ?? "/";
    if (typeof routeProp === "string" && !routeProp.startsWith("/")) {
      throw new Error(`Invalid route: "${routeProp}". All routes must start with a forward slash "/". (Nested under: "${parentPath || "root"}")`);
    }
    let fullRoute = "";
    if (parentPath && parentPath !== "/") {
      const cleanParent = parentPath.endsWith("/") ? parentPath.slice(0, -1) : parentPath;
      const cleanChild = routeProp.startsWith("/") ? routeProp : "/" + routeProp;
      if (cleanChild.startsWith(cleanParent + "/") || cleanChild === cleanParent) {
        fullRoute = normalizePathname(cleanChild);
      } else {
        fullRoute = normalizePathname(cleanParent + cleanChild);
      }
    } else {
      fullRoute = normalizePathname(routeProp);
    }
    const isRoot = fullRoute === "/";
    const exact = props.exact !== void 0 ? Boolean(props.exact) : isRoot;
    if (!matchRoute(fullRoute, pathname, exact)) return null;
    if (matchRoute(fullRoute, pathname, true)) {
      pathHasMatch(true);
    }
    const mergedHead = props.head && typeof props.head === "object" ? props.head : {};
    const meta = props.description ? [{ name: "description", content: String(props.description) }].concat(mergedHead.meta ?? props.meta ?? []) : mergedHead.meta ?? props.meta;
    const links = mergedHead.links ?? props.links;
    const title = mergedHead.title ?? props.title;
    const icon = mergedHead.icon ?? props.icon;
    const favicon = mergedHead.favicon ?? props.favicon;
    applyHead({ title, meta, links, icon, favicon });
    return createElement(RoutingContext.Provider, { value: fullRoute }, props.children);
  });
}
__name(Route, "Route");
function Page(props = {}) {
  ensureListener();
  return createElement("span", { style: { display: "contents" } }, () => {
    const parentPath = readContext(RoutingContext) || "";
    const pathname = normalizePathname(currentPath());
    beginPathEvaluation(pathname);
    const routeProp = props.route ?? "/";
    if (typeof routeProp === "string" && !routeProp.startsWith("/")) {
      throw new Error(`Invalid route: "${routeProp}". All routes must start with a forward slash "/". (Nested under: "${parentPath || "root"}")`);
    }
    let fullRoute = "";
    if (parentPath && parentPath !== "/") {
      const cleanParent = parentPath.endsWith("/") ? parentPath.slice(0, -1) : parentPath;
      const cleanChild = routeProp.startsWith("/") ? routeProp : "/" + routeProp;
      if (cleanChild.startsWith(cleanParent + "/") || cleanChild === cleanParent) {
        fullRoute = normalizePathname(cleanChild);
      } else {
        fullRoute = normalizePathname(cleanParent + cleanChild);
      }
    } else {
      fullRoute = normalizePathname(routeProp);
    }
    const isRoot = fullRoute === "/";
    const exact = props.exact !== void 0 ? Boolean(props.exact) : isRoot;
    if (!matchRoute(fullRoute, pathname, exact)) return null;
    if (matchRoute(fullRoute, pathname, true)) {
      pathHasMatch(true);
    }
    const mergedHead = props.head && typeof props.head === "object" ? props.head : {};
    const meta = props.description ? [{ name: "description", content: String(props.description) }].concat(mergedHead.meta ?? props.meta ?? []) : mergedHead.meta ?? props.meta;
    const links = mergedHead.links ?? props.links;
    const title = mergedHead.title ?? props.title;
    const icon = mergedHead.icon ?? props.icon;
    const favicon = mergedHead.favicon ?? props.favicon;
    applyHead({ title, meta, links, icon, favicon });
    return createElement(RoutingContext.Provider, { value: fullRoute }, props.children);
  });
}
__name(Page, "Page");
function NotFound(props = {}) {
  ensureListener();
  userProvidedNotFound = true;
  return createElement("span", { style: { display: "contents" } }, () => {
    const pathname = normalizePathname(currentPath());
    beginPathEvaluation(pathname);
    const ready = pathEvalReady();
    const hasMatch = pathHasMatch();
    if (!ready) return null;
    if (lastPathEvaluated !== pathname) return null;
    if (hasMatch) return null;
    if (pathname === "/") return null;
    const Comp = props.component ?? defaultNotFoundComponent;
    if (typeof Comp === "function") {
      return createElement(Comp, { pathname });
    }
    if (props.children !== void 0) return props.children;
    return createElement(
      "div",
      { style: { padding: "16px" } },
      createElement("h1", null, "404"),
      createElement("p", null, "Page not found: ", pathname)
    );
  });
}
__name(NotFound, "NotFound");
function Link(props = {}) {
  ensureListener();
  const rawHref = props.href ?? props.to ?? "#";
  const href = spaNormalizeHref(rawHref);
  const spa = props.spa !== void 0 ? Boolean(props.spa) : true;
  const reload = Boolean(props.reload);
  const onClick = /* @__PURE__ */ __name((e) => {
    if (typeof props.onClick === "function") props.onClick(e);
    if (e.defaultPrevented) return;
    if (props.target === "_blank") return;
    const strHref = String(href);
    if (strHref.includes("://") || strHref.startsWith("mailto:") || strHref.startsWith("tel:")) return;
    if (!spa || reload) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  }, "onClick");
  const { children, to, ...rest } = props;
  const normalizedChildren = Array.isArray(children) ? children : children === void 0 || children === null ? [] : [children];
  return createElement("a", { ...rest, href, onClick }, ...normalizedChildren);
}
__name(Link, "Link");
function spaNormalizeHref(href) {
  const str = String(href ?? "#");
  if (!str.startsWith("/")) return str;
  return normalizeTo(str);
}
__name(spaNormalizeHref, "spaNormalizeHref");
const Router = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Link,
  NotFound,
  Page,
  Route,
  getIsNotFound,
  getLocation,
  getPathname,
  getRouteReady,
  navigate,
  setNotFound,
  startHead,
  useIsNotFound,
  useLocation,
  usePathname,
  useRouteReady
}, Symbol.toStringTag, { value: "Module" }));
const errors = signal([]);
let lastSentKey = null;
let lastSentAt = 0;
let lastStoredKey = null;
let lastStoredAt = 0;
function reportError(error, info = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  const stack = err.stack ? String(err.stack) : "";
  const message = err.message;
  const phase = info.phase ?? null;
  const component = info.component ?? null;
  const key = `${message}|${component ?? ""}|${phase ?? ""}|${stack}`;
  const now = Date.now();
  if (lastStoredKey === key && now - lastStoredAt < 1500) {
    return;
  }
  lastStoredKey = key;
  lastStoredAt = now;
  const entry = {
    error: err,
    message,
    stack,
    phase,
    component,
    time: now
  };
  const current = typeof errors.peek === "function" ? errors.peek() : errors();
  errors([entry, ...Array.isArray(current) ? current : []]);
  try {
    const where = entry.component ? ` in ${entry.component}` : "";
    const phase2 = entry.phase ? ` (${entry.phase})` : "";
    const label = `[round] Runtime error${where}${phase2}`;
    if (typeof console.groupCollapsed === "function") {
      console.groupCollapsed(label);
      console.error(entry.error);
      if (entry.stack) console.log(entry.stack);
      if (info && Object.keys(info).length) console.log("info:", info);
      console.groupEnd();
    } else {
      console.error(label);
      console.error(entry.error);
      if (entry.stack) console.log(entry.stack);
      if (info && Object.keys(info).length) console.log("info:", info);
    }
  } catch {
  }
  try {
    if (void 0) ;
  } catch {
  }
}
__name(reportError, "reportError");
function clearErrors() {
  errors([]);
}
__name(clearErrors, "clearErrors");
function useErrors() {
  return errors;
}
__name(useErrors, "useErrors");
setErrorReporter(reportError);
function ErrorProvider(props = {}) {
  return createElement("span", { style: { display: "contents" } }, () => {
    const list = useErrors()();
    if (!Array.isArray(list) || list.length === 0) return props.children ?? null;
    const first = list[0];
    return createElement(
      "div",
      {
        style: {
          position: "fixed",
          inset: "0",
          zIndex: 2147483647,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "rgba(17, 24, 39, 0.72)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)"
        }
      },
      createElement(
        "div",
        {
          style: {
            width: "min(900px, 100%)",
            borderRadius: "14px",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.55)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
            color: "#fff",
            overflow: "hidden"
          }
        },
        createElement(
          "div",
          {
            style: {
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              borderBottom: "1px solid rgba(255,255,255,0.10)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0))"
            }
          },
          createElement("div", {
            style: {
              width: "10px",
              height: "10px",
              borderRadius: "999px",
              background: "#ef4444",
              boxShadow: "0 0 0 4px rgba(239,68,68,0.18)"
            }
          }),
          createElement("strong", { style: { fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial" } }, "Round Error"),
          createElement("span", { style: { opacity: 0.75, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial", fontSize: "12px" } }, new Date(first.time).toLocaleString()),
          createElement("button", {
            style: {
              marginLeft: "auto",
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              padding: "8px 10px",
              borderRadius: "10px",
              cursor: "pointer"
            },
            onMouseOver: /* @__PURE__ */ __name((e) => {
              try {
                e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              } catch {
              }
            }, "onMouseOver"),
            onMouseOut: /* @__PURE__ */ __name((e) => {
              try {
                e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              } catch {
              }
            }, "onMouseOut"),
            onClick: /* @__PURE__ */ __name(() => clearErrors(), "onClick")
          }, "Dismiss")
        ),
        createElement(
          "div",
          {
            style: {
              padding: "16px",
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            }
          },
          createElement("div", { style: { fontSize: "14px", fontWeight: "700" } }, String(first.message ?? "Error")),
          createElement(
            "div",
            { style: { marginTop: "10px", opacity: 0.85, fontSize: "12px", lineHeight: "18px" } },
            first.component ? createElement("div", null, createElement("span", { style: { opacity: 0.75 } }, "Component: "), String(first.component)) : null,
            first.phase ? createElement("div", null, createElement("span", { style: { opacity: 0.75 } }, "Phase: "), String(first.phase)) : null
          ),
          first.stack ? createElement("pre", {
            style: {
              marginTop: "12px",
              padding: "12px",
              borderRadius: "12px",
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.10)",
              whiteSpace: "pre-wrap",
              fontSize: "12px",
              lineHeight: "18px",
              overflow: "auto",
              maxHeight: "55vh"
            }
          }, String(first.stack)) : null
        )
      )
    );
  });
}
__name(ErrorProvider, "ErrorProvider");
function initErrorHandling(container) {
  if (typeof document === "undefined") return;
  if (!container || !(container instanceof Element)) return;
  if (!document.querySelector('[data-round-error-style="1"]')) {
    const style = document.createElement("style");
    style.setAttribute("data-round-error-style", "1");
    style.textContent = `
[data-round-error-root="1"] pre{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.28) rgba(255,255,255,0.06);}
[data-round-error-root="1"] pre::-webkit-scrollbar{width:10px;height:10px;}
[data-round-error-root="1"] pre::-webkit-scrollbar-track{background:rgba(255,255,255,0.06);border-radius:999px;}
[data-round-error-root="1"] pre::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.22);border-radius:999px;border:2px solid rgba(0,0,0,0.35);}
[data-round-error-root="1"] pre::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.32);}
        `.trim();
    document.head.appendChild(style);
  }
  if (!document.querySelector('[data-round-error-root="1"]')) {
    const root = document.createElement("div");
    root.setAttribute("data-round-error-root", "1");
    container.appendChild(root);
    root.appendChild(createElement(ErrorProvider, null));
  }
  if (!window.__round_error_handlers_installed) {
    window.__round_error_handlers_installed = true;
    window.addEventListener("error", (e) => {
      reportError(e?.error ?? e?.message ?? e, { phase: "window.error" });
    });
    window.addEventListener("unhandledrejection", (e) => {
      reportError(e?.reason ?? e, { phase: "window.unhandledrejection" });
    });
  }
}
__name(initErrorHandling, "initErrorHandling");
const Errors = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorProvider,
  initErrorHandling,
  reportError
}, Symbol.toStringTag, { value: "Module" }));
function ErrorBoundary(props = {}) {
  const error = signal(null);
  const name = props.name ?? "ErrorBoundary";
  const fallback = props.fallback;
  const resetKey = props.resetKey;
  let lastResetKey = resetKey;
  return createElement("span", { style: { display: "contents" } }, () => {
    if (resetKey !== void 0 && resetKey !== lastResetKey) {
      lastResetKey = resetKey;
      if (error()) error(null);
    }
    const err = error();
    if (err) {
      if (typeof fallback === "function") {
        try {
          return fallback({ error: err });
        } catch (e) {
          reportError(e, { phase: "ErrorBoundary.fallback", component: name });
          return createElement("div", { style: { padding: "16px" } }, "ErrorBoundary fallback crashed");
        }
      }
      if (fallback !== void 0) return fallback;
      return createElement("div", { style: { padding: "16px" } }, "Something went wrong.");
    }
    const renderFn = typeof props.render === "function" ? props.render : typeof props.children === "function" ? props.children : null;
    if (typeof renderFn !== "function") return props.children ?? null;
    try {
      return renderFn();
    } catch (e) {
      if (!error() || error() !== e) error(e);
      reportError(e, { phase: "ErrorBoundary.render", component: name });
      return null;
    }
  });
}
__name(ErrorBoundary, "ErrorBoundary");
function hasWindow() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
__name(hasWindow, "hasWindow");
function createStore(initialState = {}, actions = null) {
  const state = initialState && typeof initialState === "object" ? initialState : {};
  const signals = /* @__PURE__ */ Object.create(null);
  const persistState = {
    enabled: false,
    key: null,
    storage: null,
    persisting: false,
    persistNow: null,
    watchers: /* @__PURE__ */ new Set()
  };
  for (const k of Object.keys(state)) {
    signals[k] = bindable(state[k]);
  }
  function setKey(k, v) {
    const key = String(k);
    if (!Object.prototype.hasOwnProperty.call(signals, key)) {
      signals[key] = bindable(state[key]);
    }
    state[key] = v;
    signals[key](v);
    if (persistState.enabled && typeof persistState.persistNow === "function") {
      persistState.persistNow();
    }
    return v;
  }
  __name(setKey, "setKey");
  function patch(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      setKey(k, v);
    }
  }
  __name(patch, "patch");
  function getSnapshot(reactive = false) {
    const out = {};
    for (const k of Object.keys(signals)) {
      out[k] = reactive ? signals[k]() : signals[k].peek();
    }
    return out;
  }
  __name(getSnapshot, "getSnapshot");
  const store = {
    use(key) {
      const k = String(key);
      if (!Object.prototype.hasOwnProperty.call(signals, k)) {
        signals[k] = bindable(state[k]);
        if (!Object.prototype.hasOwnProperty.call(state, k)) {
          try {
            reportErrorSafe(new Error(`Store key not found: ${k}`), { phase: "store.use", component: "createStore" });
          } catch {
          }
        }
      }
      if (persistState.enabled) {
        const sig = signals[k];
        if (sig && typeof sig === "function" && !persistState.watchers.has(k)) {
          persistState.watchers.add(k);
          effect(() => {
            sig();
            if (persistState.persisting) return;
            if (typeof persistState.persistNow === "function") persistState.persistNow();
          }, { onLoad: false });
        }
      }
      return signals[k];
    },
    set(key, value) {
      return setKey(key, value);
    },
    patch,
    snapshot(options = {}) {
      const reactive = options && typeof options === "object" && options.reactive === true;
      return getSnapshot(reactive);
    },
    actions: {}
  };
  if (actions && typeof actions === "object") {
    Object.entries(actions).forEach(([name, reducer]) => {
      if (typeof reducer !== "function") return;
      const fn = /* @__PURE__ */ __name((...args) => {
        try {
          const next = reducer(getSnapshot(false), ...args);
          if (next && typeof next === "object") {
            patch(next);
          }
          return next;
        } catch (e) {
          reportErrorSafe(e, { phase: "store.action", component: String(name) });
        }
      }, "fn");
      store.actions[name] = fn;
      store[name] = fn;
    });
  }
  store.persist = (storageKey, optionsOrStorage) => {
    if (typeof storageKey !== "string" || !storageKey.length) return store;
    const isStorageLike = optionsOrStorage && typeof optionsOrStorage.getItem === "function" && typeof optionsOrStorage.setItem === "function";
    const opts = !isStorageLike && optionsOrStorage && typeof optionsOrStorage === "object" ? optionsOrStorage : {};
    const st = isStorageLike ? optionsOrStorage : opts.storage ?? (hasWindow() ? window.localStorage : null);
    if (!st || typeof st.getItem !== "function" || typeof st.setItem !== "function") return store;
    const debounceMs = Number.isFinite(Number(opts.debounce)) ? Number(opts.debounce) : 0;
    const exclude = Array.isArray(opts.exclude) ? opts.exclude.map(String) : [];
    try {
      const raw = st.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const filtered = exclude.length ? Object.fromEntries(Object.entries(parsed).filter(([k]) => !exclude.includes(String(k)))) : parsed;
          patch(filtered);
        }
      }
    } catch {
    }
    const persistNow = /* @__PURE__ */ __name(() => {
      try {
        persistState.persisting = true;
        const snap = getSnapshot(false);
        const out = exclude.length ? Object.fromEntries(Object.entries(snap).filter(([k]) => !exclude.includes(String(k)))) : snap;
        st.setItem(storageKey, JSON.stringify(out));
      } catch {
      } finally {
        persistState.persisting = false;
      }
    }, "persistNow");
    let debounceId = null;
    const schedulePersist = /* @__PURE__ */ __name(() => {
      if (debounceMs <= 0) return persistNow();
      try {
        if (debounceId != null) clearTimeout(debounceId);
      } catch {
      }
      debounceId = setTimeout(() => {
        debounceId = null;
        persistNow();
      }, debounceMs);
    }, "schedulePersist");
    persistState.enabled = true;
    persistState.key = storageKey;
    persistState.storage = st;
    persistState.persistNow = schedulePersist;
    const origSet = store.set;
    store.set = (k, v) => {
      const res = origSet(k, v);
      schedulePersist();
      return res;
    };
    const origPatch = store.patch;
    store.patch = (obj) => {
      origPatch(obj);
      schedulePersist();
    };
    Object.keys(store.actions).forEach((name) => {
      const orig = store.actions[name];
      if (typeof orig !== "function") return;
      store.actions[name] = (...args) => {
        const res = orig(...args);
        schedulePersist();
        return res;
      };
      store[name] = store.actions[name];
    });
    Object.keys(signals).forEach((k) => {
      try {
        store.use(k);
      } catch {
      }
    });
    schedulePersist();
    return store;
  };
  return store;
}
__name(createStore, "createStore");
const Store = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createStore
}, Symbol.toStringTag, { value: "Module" }));
function render(Component, container) {
  initLifecycleRoot(container);
  initErrorHandling(container);
  try {
    const root = createElement(Component);
    container.appendChild(root);
  } catch (e) {
    reportError(e, { phase: "render", component: Component?.name ?? "App" });
  }
}
__name(render, "render");
const index = {
  ...Signals,
  ...DOM,
  ...Lifecycle,
  ...Router,
  ...Errors,
  ...Suspense$1,
  ...Context,
  ...Store,
  render
};
export {
  ErrorBoundary,
  ErrorProvider,
  Fragment,
  Link,
  NotFound,
  Page,
  Route,
  Suspense,
  SuspenseContext,
  batch,
  bindContext,
  bindable,
  captureContext,
  clearErrors,
  createComponentInstance,
  createContext,
  createElement,
  createStore,
  index as default,
  derive,
  effect,
  getCurrentComponent,
  getIsNotFound,
  getLocation,
  getPathname,
  getRouteReady,
  initErrorHandling,
  initLifecycleRoot,
  lazy,
  mountComponent,
  navigate,
  onCleanup,
  onMount,
  onUnmount,
  onUpdate,
  pick,
  readContext,
  render,
  reportError,
  runInContext,
  runInLifecycle,
  setNotFound,
  signal,
  startHead,
  triggerUpdate,
  unmountComponent,
  untrack,
  useErrors,
  useIsNotFound,
  useLocation,
  usePathname,
  useRouteReady
};
