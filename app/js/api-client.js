/**
 * Centralized OData API client for Retry Storm Sentinel.
 *
 * All backend interaction goes through this module. No hardcoded metrics;
 * all data comes from the backend OData service.
 *
 * Authentication model:
 *   • Development (CAP mocked auth): The frontend collects username/password
 *     via the login screen, stores them in memory (never localStorage), and
 *     sends them as a Basic auth header on every request. The backend CDS
 *     mocked auth validates the credentials and sets req.user.
 *   • Production (XSUAA): The SAP BTP platform / AppRouter establishes the
 *     session. The frontend sends no client-chosen credentials.
 *
 * Credentials are held in memory only. They are cleared on logout and on
 * page refresh. No credentials are ever written to localStorage/sessionStorage.
 */

export const BASE_URL = '/odata/v4/monitoring';

export const ENDPOINTS = {
    interfaces: () => '/Interfaces?$expand=snapshots($orderby=capturedAt asc)',
    alerts: () => '/Alerts?$expand=interface&$orderby=detectedAt desc',
    runbooks: () => '/RunbookEntries',
    topology: () => '/getTopology()',
    acknowledgeAlert: (id) => `/Alerts(${encodeURIComponent(id)})/MonitoringService.acknowledge`,
    resolveAlert: (id) => `/Alerts(${encodeURIComponent(id)})/MonitoringService.resolveAlert`,
    explainAlert: (id) => `/Alerts(${encodeURIComponent(id)})/MonitoringService.explain`,
    exportIncidentReport: (id) => `/Alerts(${encodeURIComponent(id)})/MonitoringService.exportIncidentReport`,
    triggerSimulation: () => '/triggerSimulation',
    configureThresholds: () => '/configureThresholds',
    resetToCleanSeed: () => '/resetToCleanSeed'
};

/* ------------------------------------------------------------------ */
/* In-memory credential store                                         */
/* ------------------------------------------------------------------ */

/**
 * Current development credentials, held in memory only.
 * Never persisted to disk. Cleared on logout or page refresh.
 */
let _storedUsername = null;
let _storedPassword = null;

/**
 * Set development credentials after a successful login.
 * Password is NOT stored in plaintext — only used to build the Basic auth
 * header for subsequent requests while the page session lives.
 */
export function setCredentials(username, password) {
    _storedUsername = String(username || '').trim();
    _storedPassword = String(password || '');
}

/**
 * Clear stored credentials (logout). Subsequent requests are unauthenticated.
 */
export function clearCredentials() {
    _storedUsername = null;
    _storedPassword = null;
}

/**
 * Returns true if development credentials are currently stored.
 */
export function hasCredentials() {
    return _storedUsername !== null && _storedUsername.length > 0;
}

/**
 * Builds the Basic auth header value from stored credentials.
 * Returns null if no credentials are stored.
 */
export function getAuthHeader() {
    if (!_storedUsername) return null;
    return 'Basic ' + btoa(`${_storedUsername}:${_storedPassword}`);
}

/**
 * Builds fetch headers. In development, attaches Basic auth if credentials
 * are stored. In production (XSUAA), no client-chosen credentials are sent;
 * the platform session authenticates via cookies/tokens.
 *
 * @param {object} extra - Additional headers to merge.
 * @returns {object} Headers object.
 */
function buildHeaders(extra = {}) {
    const headers = {
        'Accept': 'application/json',
        ...extra
    };
    const auth = getAuthHeader();
    if (auth) {
        headers['Authorization'] = auth;
    }
    return headers;
}

/* ------------------------------------------------------------------ */
/* Fetch wrapper                                                      */
/* ------------------------------------------------------------------ */

/**
 * Fetch wrapper with auth header, Content-Type, and error normalization.
 *
 * In development, Basic auth is sent on every request (no retry-on-401).
 * In production, no Authorization header is sent — XSUAA authenticates via
 * the platform session.
 *
 * Throws an Error carrying `.status` and a `.message`.
 */
export async function apiRequest(path, options = {}) {
    const headers = buildHeaders(options.headers);
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(BASE_URL + path, {
        ...options,
        headers
    });

    if (!res.ok) {
        throw Object.assign(new Error(`Request failed (${res.status})`), { status: res.status });
    }

    return await readResponseBody(res);
}

/**
 * Read response body once as text then parse JSON.
 * Guard against empty bodies (e.g. explain endpoint).
 */
async function readResponseBody(res) {
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
}

/* ------------------------------------------------------------------ */
/* Login / Logout                                                     */
/* ------------------------------------------------------------------ */

/**
 * Authenticate against the development mocked auth backend.
 * Sends Basic auth credentials; the backend validates them and returns
 * the authenticated user's id and roles.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ userId: string, roles: string[] }>}
 */
export async function login(username, password) {
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${String(username || '').trim()}:${String(password || '')}`)
    };

    const res = await fetch(`${BASE_URL}/../auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: String(username || '').trim(), password: String(password || '') })
    });

    if (!res.ok) {
        throw Object.assign(new Error(`Login failed (${res.status})`), { status: res.status });
    }

    const data = await readResponseBody(res);
    if (!data || !data.authenticated || !data.userId) {
        throw Object.assign(new Error('Login failed: invalid response'), { status: 401 });
    }

    // Store credentials for subsequent requests.
    setCredentials(data.userId, password);

    return {
        userId: data.userId,
        roles: data.roles || []
    };
}

/**
 * Logout: clear in-memory credentials. Subsequent API requests are
 * unauthenticated (401 in development).
 */
export function logout() {
    clearCredentials();
}

/* ------------------------------------------------------------------ */
/* Typed API functions                                                */
/* ------------------------------------------------------------------ */

/** Fetch monitored interfaces with expanded snapshots (chronological). */
export function fetchInterfaces() {
    return apiRequest(ENDPOINTS.interfaces());
}

/** Fetch runbook entries (read-only catalog). */
export function fetchRunbooks() {
    return apiRequest(ENDPOINTS.runbooks());
}

/** Fetch alerts ordered newest first, expanded with interface. */
export function fetchAlerts() {
    return apiRequest(ENDPOINTS.alerts());
}

/** Fetch landscape topology graph. */
export function fetchTopology() {
    return apiRequest(ENDPOINTS.topology());
}

/** Acknowledge an alert. `by` is the operator identity string. */
export function acknowledgeAlert(id, by) {
    return apiRequest(ENDPOINTS.acknowledgeAlert(id), {
        method: 'POST',
        body: JSON.stringify({ acknowledgedBy: by })
    });
}

/** Resolve an incident alert. `by` is the operator identity string. */
export function resolveAlert(id, by) {
    return apiRequest(ENDPOINTS.resolveAlert(id), {
        method: 'POST',
        body: JSON.stringify({ resolvedBy: by })
    });
}

/** Request a grounded incident explanation. */
export function explainAlert(id) {
    return apiRequest(ENDPOINTS.explainAlert(id), {
        method: 'POST',
        body: JSON.stringify({})
    });
}

/** Export an incident postmortem report. `format` e.g. 'markdown'. */
export function exportIncidentReport(id, format = 'markdown') {
    return apiRequest(ENDPOINTS.exportIncidentReport(id), {
        method: 'POST',
        body: JSON.stringify({ format })
    });
}

/** Trigger a simulation scenario on an interface (or all). */
export function triggerSimulation(scenario, interfaceId) {
    return apiRequest(ENDPOINTS.triggerSimulation(), {
        method: 'POST',
        body: JSON.stringify({ scenario, interfaceId })
    });
}

/** Configure per-interface SLA threshold policy. */
export function configureThresholds(data) {
    return apiRequest(ENDPOINTS.configureThresholds(), {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

/** Reset database queues and alerts to clean factory baseline. */
export function resetToCleanSeed() {
    return apiRequest(ENDPOINTS.resetToCleanSeed(), {
        method: 'POST',
        body: JSON.stringify({})
    });
}