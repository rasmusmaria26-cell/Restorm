/**
 * test/qa/auth-mode.test.js
 *
 * Phase 6 — Authentication mode verification tests (frontend).
 *
 * Verifies the retry-on-401 authentication strategy in app/js/api-client.js:
 *
 *   1. Production XSUAA mode: first request without Authorization header
 *      succeeds (200) — platform session authenticates. No Basic auth sent.
 *   2. Development mocked mode (localhost & BAS preview): first request
 *      returns 401, retry with Basic auth succeeds (200).
 *   3. Frontend role selector cannot grant production privileges: in XSUAA
 *      mode, mocked Basic auth credentials are rejected by the backend.
 *   4. Unauthenticated production requests remain rejected: no session,
 *      no mock users → 401 on both attempts.
 *
 * No browser; uses DOM shim + mock fetch.
 *
 * Runs with: node --test test/qa/auth-mode.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim, MockResponse } = require('./frontend-helper.js');

installDOMShim();

const api = require('../../app/js/api-client.js');

let restoreFetch;
let capturedRequests = [];

function capturingFetch(handlers) {
    const originalFetch = global.fetch;
    capturedRequests = [];
    global.fetch = async (url, opts) => {
        const u = String(url);
        const headers = opts && opts.headers ? opts.headers : {};
        capturedRequests.push({ url: u, headers: headers, opts: opts });
        for (const h of handlers) {
            if (h.match && u.includes(h.match)) {
                return new MockResponse(h.response, h.status || 200);
            }
        }
        return new MockResponse({ value: [] }, 200);
    };
    global.fetch.original = originalFetch;
    return () => { global.fetch = originalFetch; };
}

describe('Authentication mode verification', () => {

    before(() => {
        restoreFetch = capturingFetch([
            { match: '/Interfaces', response: { value: [] } },
            { match: '/Alerts', response: { value: [] } },
            { match: '/RunbookEntries', response: { value: [] } }
        ]);
    });

    after(() => {
        if (restoreFetch) restoreFetch();
    });

    describe('Production XSUAA mode (platform session authenticates)', () => {
        it('first request without Authorization header succeeds (200), no Basic auth sent', async () => {
            capturedRequests = [];
            await api.fetchInterfaces();

            assert.equal(capturedRequests.length, 1, 'Exactly one fetch call expected');
            assert.equal(
                capturedRequests[0].headers['Authorization'],
                undefined,
                'No Authorization header sent in XSUAA production mode'
            );
        });

        it('runbooks endpoint also works without Basic auth in XSUAA mode', async () => {
            capturedRequests = [];
            await api.fetchRunbooks();

            assert.equal(capturedRequests.length, 1);
            assert.equal(
                capturedRequests[0].headers['Authorization'],
                undefined,
                'No Authorization header for runbooks in XSUAA mode'
            );
        });
    });

    describe('Development mocked mode (localhost & BAS preview)', () => {
        it('first request 401, retry with Basic auth succeeds (200)', async () => {
            capturedRequests = [];

            let callCount = 0;
            const origFetch = global.fetch;
            global.fetch = async (url, opts) => {
                callCount++;
                const u = String(url);
                capturedRequests.push({ url: u, headers: opts && opts.headers ? opts.headers : {} });
                if (callCount === 1) {
                    return new MockResponse({ error: 'Unauthorized' }, 401);
                }
                return new MockResponse({ value: [] }, 200);
            };
            try {
                await api.fetchInterfaces();

                assert.equal(callCount, 2, 'Two fetch calls: initial + retry');
                assert.equal(
                    capturedRequests[0].headers['Authorization'],
                    undefined,
                    'First request has no Authorization header'
                );
                assert.ok(
                    capturedRequests[1].headers['Authorization'],
                    'Second request has Authorization header (Basic auth retry)'
                );
                assert.ok(
                    /^Basic /.test(capturedRequests[1].headers['Authorization']),
                    'Retry uses Basic auth scheme'
                );
            } finally {
                global.fetch = origFetch;
            }
        });

        it('Basic auth uses dropdown-selected username (defaults to bob)', async () => {
            capturedRequests = [];

            let callCount = 0;
            const origFetch = global.fetch;
            global.fetch = async (url, opts) => {
                callCount++;
                const u = String(url);
                capturedRequests.push({ url: u, headers: opts && opts.headers ? opts.headers : {} });
                if (callCount === 1) {
                    return new MockResponse({ error: 'Unauthorized' }, 401);
                }
                return new MockResponse({ value: [] }, 200);
            };
            try {
                await api.fetchInterfaces();

                const authHeader = capturedRequests[1].headers['Authorization'];
                assert.ok(authHeader, 'Authorization header present on retry');
                const encoded = authHeader.split(' ')[1];
                const decoded = Buffer.from(encoded, 'base64').toString();
                assert.equal(decoded, 'bob:', 'Default username bob with empty password');
            } finally {
                global.fetch = origFetch;
            }
        });
    });

    describe('Frontend role selector cannot grant production privileges', () => {
        it('mocked Basic auth credentials are rejected in production XSUAA mode', async () => {
            capturedRequests = [];

            let callCount = 0;
            const origFetch = global.fetch;
            global.fetch = async (url, opts) => {
                callCount++;
                const u = String(url);
                capturedRequests.push({ url: u, headers: opts && opts.headers ? opts.headers : {} });
                return new MockResponse({ error: 'Unauthorized' }, 401);
            };
            try {
                await assert.rejects(
                    async () => { await api.fetchInterfaces(); },
                    (err) => {
                        assert.equal(err.status, 401);
                        return true;
                    }
                );

                assert.equal(callCount, 2, 'Two attempts: without auth + with Basic auth');
                assert.equal(
                    capturedRequests[0].headers['Authorization'],
                    undefined,
                    'First request: no Authorization header'
                );
                assert.ok(
                    /^Basic /.test(capturedRequests[1].headers['Authorization']),
                    'Second request: Basic auth retry attempted but rejected'
                );
            } finally {
                global.fetch = origFetch;
            }
        });
    });

    describe('Unauthenticated production requests remain rejected', () => {
        it('no session and no mock users → 401 on both attempts', async () => {
            capturedRequests = [];

            let callCount = 0;
            const origFetch = global.fetch;
            global.fetch = async () => {
                callCount++;
                return new MockResponse({ error: 'Unauthorized' }, 401);
            };
            try {
                await assert.rejects(
                    async () => { await api.fetchInterfaces(); },
                    (err) => {
                        assert.equal(err.status, 401);
                        return true;
                    }
                );

                assert.equal(callCount, 2, 'Both attempts return 401');
            } finally {
                global.fetch = origFetch;
            }
        });
    });

    describe('getAuthHeader() backward compatibility', () => {
        it('returns Basic auth string', () => {
            const header = api.getAuthHeader();
            assert.ok(header, 'getAuthHeader returns a value');
            assert.ok(/^Basic /.test(header), 'Returns Basic auth scheme');
            const encoded = header.split(' ')[1];
            const decoded = Buffer.from(encoded, 'base64').toString();
            assert.equal(decoded, 'bob:', 'Default username bob with empty password');
        });
    });

});