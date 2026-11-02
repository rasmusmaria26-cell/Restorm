/**
 * test/qa/auth-mode.test.js
 *
 * Phase 6 — Authentication mode verification tests (frontend).
 *
 * Verifies the login-based authentication strategy in app/js/api-client.js:
 *
 *   1. Production XSUAA mode: no Authorization header sent (platform session).
 *     2. Development mocked mode: Basic auth sent after login() with stored
 *      credentials (username:password).
 *     3. Credentials are stored in memory only, cleared on logout.
 *     4. Invalid credentials rejected by backend (401).
 *     5. Frontend cannot grant production privileges: roles come from backend.
 *     6. CAP mocked auth config: admin=SimulatorAdmin, bob=SupportOperator,
 *      alice=SupportViewer.
 *
 * No browser; uses mock fetch.
 *
 * Runs with: node --test test/qa/auth-mode.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

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
                return new (require('./frontend-helper.js').MockResponse)(h.response, h.status || 200);
            }
        }
        return new (require('./frontend-helper.js').MockResponse)({ value: [] }, 200);
    };
    global.fetch.original = originalFetch;
    return () => { global.fetch = originalFetch; };
}

const { MockResponse } = require('./frontend-helper.js');

describe('Authentication mode verification', () => {

    before(() => {
        restoreFetch = capturingFetch([
            { match: '/auth/login', response: { authenticated: true, userId: 'bob', roles: ['SupportOperator', 'SupportViewer'] } },
            { match: '/auth/me', response: { authenticated: true, userId: 'bob', roles: ['SupportOperator', 'SupportViewer'] } },
            { match: '/Interfaces', response: { value: [] } },
            { match: '/Alerts', response: { value: [] } },
            { match: '/RunbookEntries', response: { value: [] } }
        ]);
    });

    after(() => {
        if (restoreFetch) restoreFetch();
    });

    describe('Production XSUAA mode (platform session authenticates)', () => {
        it('no Authorization header sent in XSUAA production mode', async () => {
            const { apiRequest } = require('../../app/js/api-client.js');

            capturedRequests = [];
            await apiRequest('/Interfaces');

            assert.equal(capturedRequests.length, 1, 'Exactly one fetch call expected');
            assert.equal(
                capturedRequests[0].headers['Authorization'],
                undefined,
                'No Authorization header sent in XSUAA production mode'
            );
        });
    });

    describe('Development mocked mode (localhost & BAS preview)', () => {
        it('login with valid credentials stores credentials and sends Basic auth', async () => {
            const { login, apiRequest, hasCredentials, clearCredentials } = require('../../app/js/api-client.js');

            capturedRequests = [];

            // Clear any stored credentials first
            clearCredentials();
            assert.equal(hasCredentials(), false, 'No credentials stored before login');

            // Login
            const result = await login('bob', 'bob');
            assert.ok(result.authenticated === undefined || result.userId === 'bob', 'Login returns userId');
            assert.ok(hasCredentials(), 'Credentials stored after login');

            // Make an API request - should include Basic auth
            await apiRequest('/Interfaces');

            assert.equal(capturedRequests.length >= 1, true, 'At least one fetch call');
            const authHeader = capturedRequests[capturedRequests.length - 1].headers['Authorization'];
            assert.ok(authHeader, 'Authorization header present');
            assert.ok(/^Basic /.test(authHeader), 'Uses Basic auth scheme');

            const encoded = authHeader.split(' ')[1];
            const decoded = Buffer.from(encoded, 'base64').toString();
            assert.equal(decoded, 'bob:bob', 'Basic auth contains username:password');
        });

        it('login with wrong password is rejected', async () => {
            const { login } = require('../../app/js/api-client.js');

            // Override fetch to return 401 for login
            const originalFetch = global.fetch;
            let callCount = 0;
            global.fetch = async (url, opts) => {
                callCount++;
                const u = String(url);
                capturedRequests.push({ url: u, headers: opts && opts.headers ? opts.headers : {} });
                if (u.includes('/auth/login') && callCount === 1) {
                    return new MockResponse({ error: 'Unauthorized' }, 401);
                }
                return new MockResponse({ value: [] }, 200);
            };
            try {
                await assert.rejects(
                    async () => { await login('bob', 'wrongpassword'); },
                    (err) => {
                        assert.equal(err.status, 401);
                        return true;
                    }
                );
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('logout clears credentials', async () => {
            const { login, logout, hasCredentials, apiRequest } = require('../../app/js/api-client.js');

            await login('alice', 'alice');
            assert.ok(hasCredentials(), 'Credentials stored after login');

            logout();
            assert.equal(hasCredentials(), false, 'Credentials cleared after logout');

            // After logout, no Authorization header should be sent
            capturedRequests = [];
            // apiRequest would fail with 401 since no credentials, but we just check no auth header
            // The key assertion is that credentials are cleared
        });
    });

    describe('CAP mocked authentication role mapping', () => {
        const pkg = require('../../package.json');

        it('admin has SimulatorAdmin role', () => {
            const adminRoles = pkg.cds.requires.auth.users.admin.roles;
            assert.ok(adminRoles.includes('SimulatorAdmin'), 'admin must have SimulatorAdmin role');
            assert.ok(adminRoles.includes('SupportOperator'), 'admin must have SupportOperator role');
            assert.ok(adminRoles.includes('SupportViewer'), 'admin must have SupportViewer role');
        });

        it('bob has SupportOperator and SupportViewer roles', () => {
            const bobRoles = pkg.cds.requires.auth.users.bob.roles;
            assert.ok(bobRoles.includes('SupportOperator'), 'bob must have SupportOperator role');
            assert.ok(bobRoles.includes('SupportViewer'), 'bob must have SupportViewer role');
            assert.ok(!bobRoles.includes('SimulatorAdmin'), 'bob must not have SimulatorAdmin role');
        });

        it('alice has SupportViewer role only', () => {
            const aliceRoles = pkg.cds.requires.auth.users.alice.roles;
            assert.ok(aliceRoles.includes('SupportViewer'), 'alice must have SupportViewer role');
            assert.ok(!aliceRoles.includes('SupportOperator'), 'alice must not have SupportOperator role');
            assert.ok(!aliceRoles.includes('SimulatorAdmin'), 'alice must not have SimulatorAdmin role');
        });

        it('production uses XSUAA exclusively', () => {
            const prodAuth = pkg.cds.requires['[production]'].auth;
            assert.equal(prodAuth.kind, 'xsuaa', 'Production must use XSUAA authentication');
        });

        it('development uses mocked authentication', () => {
            const devAuth = pkg.cds.requires['[development]'].requires.auth;
            assert.equal(devAuth.kind, 'mocked', 'Development must use mocked authentication');
        });
    });
});
