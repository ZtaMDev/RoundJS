let reporter = null;

export function setErrorReporter(fn) {
    reporter = typeof fn === 'function' ? fn : null;
}

export function reportErrorSafe(error, info) {
    if (!reporter) return;
    try {
        reporter(error, info);
    } catch {
    }
}
