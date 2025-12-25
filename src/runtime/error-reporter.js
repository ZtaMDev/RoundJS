
let reporter = null;

export function setErrorReporter(fn) {
    reporter = typeof fn === 'function' ? fn : null;
}

export function reportErrorSafe(error, info) {
    if (reporter) {
        try {
            reporter(error, info);
            return;
        } catch {
        }
    }

    // Default: Descriptive console logging
    const phase = info?.phase ? ` in phase "${info.phase}"` : "";
    const component = info?.component ? ` of component <${info.component} />` : "";
    console.error(`[round] Error${phase}${component}:`, error);
}
