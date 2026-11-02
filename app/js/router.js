/**
 * Minimal hash-based client router for Retry Storm Sentinel.
 *
 * Routes:
 *   ''                 -> overview
 *   #interfaces        -> interface-inventory
 *   #interface/:id     -> interface-detail
 *   #topology          -> topology
 *   #incidents         -> incidents
 *   #incident/:id      -> incident-detail
 *   #thresholds        -> thresholds
 *
 * Usage:
 *   import { navigate, onRouteChange, start } from './router.js';
 *   onRouteChange((route, params) => { ... });
 *   start();
 */

const ROUTES = {
    '': 'overview',
    interfaces: 'interface-inventory',
    topology: 'topology',
    incidents: 'incidents',
    thresholds: 'thresholds'
};

let currentRoute = { name: 'overview', params: {} };
const listeners = new Set();
let started = false;

/**
 * Parse the current hash into a route name and params.
 */
function parseRoute(hash) {
    let raw = hash.replace(/^#/, '');
    if (raw === '' || raw === '/') {
        return { name: 'overview', params: {} };
    }

    const [path, queryPart] = raw.split('?');
    const queryParams = {};
    if (queryPart) {
        try {
            const usp = new URLSearchParams(queryPart);
            for (const [k, v] of usp.entries()) {
                queryParams[k] = v;
            }
        } catch (e) {
            console.warn('[Router] Failed to parse query params', e);
        }
    }

    // Split into segments, ignore empty
    const segments = path.split('/').filter(Boolean);
    const first = segments[0];

    // Parameterized routes
    if (first === 'interface' && segments[1]) {
        return { name: 'interface-detail', params: { id: segments[1], ...queryParams } };
    }
    if (first === 'incident' && segments[1]) {
        return { name: 'incident-detail', params: { id: segments[1], ...queryParams } };
    }

    if (ROUTES[first]) {
        return { name: ROUTES[first], params: { ...queryParams } };
    }

    // Unknown route falls back to overview
    return { name: 'overview', params: { ...queryParams } };
}

/**
 * Get the current resolved route.
 */
export function getCurrentRoute() {
    return { ...currentRoute };
}

/**
 * Navigate to a path (with or without leading '#'). Updates hash and
 * notifies route change listeners.
 */
export function navigate(path) {
    const hash = path.startsWith('#') ? path : '#' + path;
    if (window.location.hash === hash) {
        // Same hash: still re-resolve and notify so idempotent navigations work
        const route = parseRoute(hash);
        currentRoute = route;
        listeners.forEach((cb) => {
            try { cb(currentRoute.name, currentRoute.params); } catch (err) {
                console.error('[Router] Listener error:', err);
            }
        });
        return;
    }
    window.location.hash = hash;
}

/**
 * Resolve and dispatch the current hash-based route to listeners.
 */
function dispatch() {
    const route = parseRoute(window.location.hash);
    currentRoute = route;
    listeners.forEach((cb) => {
        try { cb(currentRoute.name, currentRoute.params); } catch (err) {
            console.error('[Router] Listener error:', err);
        }
    });
}

/**
 * Register a route-change listener. Receives (route, params).
 * Returns an unsubscribe function.
 */
export function onRouteChange(callback) {
    listeners.add(callback);
    // Immediately invoke with current route
    try { callback(currentRoute.name, currentRoute.params); } catch (err) {
        console.error('[Router] Initial listener error:', err);
    }
    return function unsubscribe() {
        listeners.delete(callback);
    };
}

/**
 * Start listening to hashchange events and dispatch the initial route.
 */
export function start() {
    if (started) return;
    started = true;
    window.addEventListener('hashchange', dispatch);
    dispatch();
}
