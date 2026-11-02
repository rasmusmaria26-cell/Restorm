/**
 * Global observable state store for Retry Storm Sentinel.
 *
 * Holds all application state (interfaces, alerts, topology, UI mode,
 * auth, loading/error). Components and pages subscribe to state changes
 * and re-render when notified.
 */

// Initial state
const state = {
    interfaces: [],
    alerts: [],
    topology: null,
    currentUser: 'bob',
    viewMode: 'cards',           // 'cards' | 'topology'
    topologyFilter: null,        // { type, id, name, interfaceId? }
    explainAlertId: null,
    liveStreamActive: false,
    lastUpdated: null,
    error: null,
    loading: false
};

const subscribers = new Set();

/**
 * Subscribe to state changes. Callback receives the new state.
 * Returns an unsubscribe function.
 */
export function subscribe(callback) {
    subscribers.add(callback);
    return function unsubscribe() {
        subscribers.delete(callback);
    };
}

/**
 * Notify all subscribers with a shallow copy of the current state.
 */
function notify() {
    const snapshot = getState();
    subscribers.forEach((cb) => {
        try {
            cb(snapshot);
        } catch (err) {
            console.error('[Store] Subscriber error:', err);
        }
    });
}

/**
 * Returns a shallow copy of the current state.
 */
export function getState() {
    return { ...state };
}

/**
 * Set multiple state fields at once and notify subscribers.
 */
export function setState(partial) {
    Object.assign(state, partial);
    notify();
}

/* ------------------------------------------------------------------ */
/* Typed setters                                                      */
/* ------------------------------------------------------------------ */

export function setInterfaces(interfaces) {
    state.interfaces = interfaces || [];
    state.lastUpdated = new Date();
    notify();
}

export function setAlerts(alerts) {
    state.alerts = alerts || [];
    state.lastUpdated = new Date();
    notify();
}

export function setTopology(topology) {
    state.topology = topology;
    notify();
}

export function setCurrentUser(username) {
    state.currentUser = username;
    notify();
}

export function setViewMode(mode) {
    state.viewMode = mode;
    notify();
}

export function setTopologyFilter(filter) {
    state.topologyFilter = filter;
    notify();
}

export function setExplainAlertId(id) {
    state.explainAlertId = id;
    notify();
}

export function setLiveStreamActive(active) {
    state.liveStreamActive = active;
    notify();
}

export function setError(message) {
    state.error = message;
    state.loading = false;
    notify();
}

export function setLoading(loading) {
    state.loading = loading;
    notify();
}

export function clearError() {
    state.error = null;
    notify();
}
