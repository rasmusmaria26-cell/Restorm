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
 * @returns {string} Basic auth header value in development, empty string in production.
 */
export function getAuthHeader() {
    // Development: mocked auth via CAP. Send Basic auth with dropdown-selected username.
    // Production (XSUAA): identity comes from the platform session; do not send
    // a client-chosen username. Detect production by non-localhost hostname.
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    if (!isLocalhost) {
        return '';
    }

    const userSelect = document.getElementById('userSelect');
    const username = userSelect ? userSelect.value : 'bob';
    return 'Basic ' + btoa(username + ':');
}

/**
 * Fetch wrapper with auth header, Content-Type, and error normalization.
 * Throws an Error carrying `.status` and a `.message` so callers can map
 * status codes to friendly messages.
 */
export async function apiRequest(path, options = {}) {
    const headers = {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
        ...options.headers
    };

    // Only set Content-Type when a body is present (avoid overriding for GETs)
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(BASE_URL + path, {
        ...options,
        headers
    });

    if (!res.ok) {
        let errorBodyText = '';
        try {
            errorBodyText = await res.text();
        } catch (e) {
            errorBodyText = res.statusText;
        }
        const errorObj = new Error(`Request failed (${res.status})`);
        errorObj.status = res.status;
        throw errorObj;
    }

    // Some endpoints (e.g. explain) return empty body; guard against that.
    // read the body ONCE as text then parse — calling res.text() and res.json()
    // on the same stream throws "body stream already read".
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
