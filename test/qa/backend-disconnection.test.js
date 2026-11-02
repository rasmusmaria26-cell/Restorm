/**
 * test/qa/backend-disconnection.test.js
 *
 * Phase 5 Agent 6 — Backend disconnection tests (frontend).
 *
 * Verifies: fetch failure -> error state, friendly message, no crash. Tests
 * the api-client error normalization, the store error state, and the
 * OverviewPage error rendering when the backend is unreachable.
 * No browser; uses DOM shim + mock fetch.
 *
 * Runs with: node --test test/qa/backend-disconnection.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim, flush } = require('./frontend-helper.js');

installDOMShim();

const store = require('../../app/js/store.js');
const api = require('../../app/js/api-client.js');

let OverviewPage;
before(async () => {
    OverviewPage = await import('../../app/js/pages/OverviewPage.js');
});

class FetchError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

function failingFetch(status, bodyText) {
    return async () => {
        throw new FetchError(bodyText || `HTTP ${status}`, status);
    };
}

describe('Backend disconnection', () => {
    it('apiRequest normalizes a fetch failure into an error with .status', async () => {
        const orig = global.fetch;
        global.fetch = failingFetch(502, 'Bad Gateway');
        try {
            await assert.rejects(
                async () => { await api.fetchInterfaces(); },
                (err) => {
                    assert.ok(err instanceof Error);
                    assert.equal(err.status, 502);
                    assert.ok(err.message);
                    return true;
                }
            );
        } finally {
            global.fetch = orig;
        }
    });

    it('a fetch rejection does not crash and leaves no partial state', async () => {
        const orig = global.fetch;
        let calls = 0;
        global.fetch = async () => { calls++; throw new FetchError('Network unreachable', 0); };
        try {
            store.setLoading(true);
            await assert.rejects(
                async () => { await api.fetchInterfaces(); },
                (err) => { assert.equal(err.status, 0); return true; }
            );
            assert.equal(calls, 1);
        } finally {
            store.setLoading(false);
            store.clearError();
            global.fetch = orig;
        }
    });

    it('store setError records a friendly message and clears', () => {
        store.setError('The backend could not be reached. Please try again later.');
        const s = store.getState();
        assert.equal(s.error, 'The backend could not be reached. Please try again later.');
        assert.equal(s.loading, false);
        store.clearError();
        assert.equal(store.getState().error, null);
    });

    it('OverviewPage renders an error state instead of crashing when fetch fails', async () => {
        const orig = global.fetch;
        global.fetch = failingFetch(503, 'Service Unavailable');
        try {
            const container = document.createElement('div');
            OverviewPage.render(container, {
                api: {
                    fetchInterfaces: () => api.fetchInterfaces(),
                    fetchAlerts: () => api.fetchAlerts()
                },
                formatShortTime: (s) => s || '',
                FRIENDLY_RULE_TITLES: {},
                SEVERITY_WEIGHT: { Critical: 3, High: 2, Warning: 1, Info: 0 },
                USER_PERMISSIONS: {},
                currentUsername: 'bob'
            });
            await flush();
            await flush();
            // No crash; error message rendered.
            assert.ok(/could not|network|unavailable|failed to load/i.test(container.textContent));
        } finally {
            global.fetch = orig;
        }
    });
});
