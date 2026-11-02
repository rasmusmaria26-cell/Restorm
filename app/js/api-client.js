/**
 * Centralized OData API client for Retry Storm Sentinel.
 *
 * All backend interaction goes through this module. No hardcoded metrics;
 * all data comes from the backend OData service.
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

/**
 * Returns a Basic auth header for development (mocked auth) only.
 *
 * In production (XSUAA), identity is established by the SAP BTP platform
 * through the authenticated session / OAuth token. The frontend must NOT
 * send a client-chosen username, as that would allow any visitor to
 * impersonate any role (including admin) simply by changing the dropdown.
 *
 * `getAuthHeader()` is kept for backward compatibility with direct fetch
 * callers (e.g. IncidentDetailPage.fetchRunbooks). The centralized
 * `apiRequest()` no longer uses it — it uses a retry-on-401 strategy that
 * works for both localhost and BAS preview without hostname checks.
 *
 * @returns {string} Basic auth header value, or empty string if no userSelect exists.
 */
export function getAuthHeader() {
    const userSelect = document.getElementById('userSelect');
    const username = userSelect ? String(userSelect.value || '').trim() : 'bob';
    return 'Basic ' + btoa(username + ':');
}

/**
 * Builds fetch headers with optional Basic auth.
 *
 * @param {boolean} useMockAuth - When true, adds a Basic auth header using the
 *   dropdown-selected username. Used only in development mocked-auth mode.
 * @returns {object} Headers object.
 */
function buildHeaders(useMockAuth = false) {
    const headers = {
        'Accept': 'application/json',
        ...(useMockAuth ? { 'Authorization': getAuthHeader() } : {})
    };
    return headers;
}

/**
 * Fetch wrapper with retry-on-401 authentication strategy.
 *
 * Strategy:
 *   1. First attempt: no Authorization header. Works in production XSUAA where
 *      the SAP BTP platform (App Router / XSUAA) establishes the session via
 *      cookies/tokens. Also works if the endpoint is publicly accessible.
 *   2. On 401: retry with Basic auth (dropdown-selected username). Works in
 *      development mocked-auth mode (localhost and BAS preview running
 *      `cds watch` with the development profile).
 *
 * This avoids hostname-based detection (e.g. checking for
 * "applicationstudio.cloud.sap") and works transparently across localhost,
 * BAS preview, and production XSUAA.
 *
 * Mock Basic authentication is never enabled in production: the [production]
 * CDS profile uses auth.kind = "xsuaa", so mocked users don't exist and the
 * retry Basic auth is rejected. The frontend role selector therefore cannot
 * grant production privileges.
 *
 * Throws an Error carrying `.status` and a `.message` so callers can map
 * status codes to friendly messages.
 */
export async function apiRequest(path, options = {}) {
    const headers = buildHeaders(false);
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    // First attempt: no Authorization header (production XSUAA session)
    let res = await fetch(BASE_URL + path, {
        ...options,
        headers
    });

    if (res.ok) {
        return await readResponseBody(res);
    }

    // Second attempt: retry with Basic auth (development mocked mode)
    if (res.status === 401) {
        const mockHeaders = buildHeaders(true);
        if (options.body && !mockHeaders['Content-Type']) {
            mockHeaders['Content-Type'] = 'application/json';
        }
        res = await fetch(BASE_URL + path, {
            ...options,
            headers: mockHeaders
        });
        if (res.ok) {
            return await readResponseBody(res);
        }
    }

    throw Object.assign(new Error(`Request failed (${res.status})`), { status: res.status });
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
