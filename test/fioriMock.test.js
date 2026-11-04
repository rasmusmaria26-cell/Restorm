const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cds = require('@sap/cds');

describe('SAP Fiori Mock Handlers & Security Headers (Milestone 2)', () => {
    let serverExport;
    let expressApp;
    let testServer;
    let baseUrl;

    before(async () => {
        // Require the custom server module
        serverExport = require('../srv/server');

        // Create an Express application and fire CAP bootstrap event
        expressApp = express();
        cds.emit('bootstrap', expressApp);

        // Start listening on an ephemeral port
        await new Promise((resolve) => {
            testServer = expressApp.listen(0, '127.0.0.1', () => {
                const port = testServer.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (testServer && testServer.close) {
            await new Promise((resolve) => testServer.close(resolve));
        }
    });

    // -------------------------------------------------------------------------
    // 1. CAP Server Export Verification
    // -------------------------------------------------------------------------
    describe('CAP Server Export Contract', () => {
        it('SRV1: srv/server.js exports the CAP server function', () => {
            assert.equal(typeof serverExport, 'function', 'srv/server.js must export a function');
            assert.strictEqual(serverExport, cds.server, 'srv/server.js must re-export cds.server');
        });
    });

    // -------------------------------------------------------------------------
    // 2. Express Mock Endpoints Verification
    // -------------------------------------------------------------------------
    describe('Express Mock Handlers for SAPUI5 & FLP', () => {
        it('MCK1: POST /sap/bc/ui2/flp;sap-metrics-only returns HTTP 204 No Content', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/ui2/flp;sap-metrics-only`, {
                method: 'POST'
            });
            assert.equal(res.status, 204);
            const text = await res.text();
            assert.equal(text, '', 'HTTP 204 response body must be empty');
        });

        it('MCK2: POST /sap/bc/ui2/flp returns HTTP 204 No Content', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/ui2/flp`, {
                method: 'POST'
            });
            assert.equal(res.status, 204);
        });

        it('MCK3: GET /sap/bc/lrep/flex/settings returns HTTP 200 with valid settings JSON', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/lrep/flex/settings`);
            assert.equal(res.status, 200);
            assert.equal(res.headers.get('content-type')?.includes('application/json'), true);

            const data = await res.json();
            assert.deepEqual(data, {
                isKeyUser: false,
                isAtoAvailable: false,
                isProductiveSystem: false,
                isContextSharingEnabled: false
            });
        });

        it('MCK4: GET /sap/bc/lrep/flex/settings preserves JSON response when query parameters are supplied', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/lrep/flex/settings?sap-language=EN&sap-client=100`);
            assert.equal(res.status, 200);

            const data = await res.json();
            assert.equal(data.isKeyUser, false);
            assert.equal(data.isAtoAvailable, false);
            assert.equal(data.isProductiveSystem, false);
            assert.equal(data.isContextSharingEnabled, false);
        });

        it('MCK5: GET /sap/bc/lrep/flex/data/* returns HTTP 200 with empty changes array and metadata', async () => {
            const path = '/sap/bc/lrep/flex/data/sap.retrysentinel.interfaces?lazyLoadingViewsEnabled=true&sap-language=EN';
            const res = await fetch(`${baseUrl}${path}`);
            assert.equal(res.status, 200);
            assert.equal(res.headers.get('content-type')?.includes('application/json'), true);

            const data = await res.json();
            assert.deepEqual(data, {
                changes: [],
                loadModules: false,
                contexts: []
            });
        });

        it('MCK6: GET /fiori/webapp/changes/changes-bundle.json fallback returns HTTP 200 with empty changes', async () => {
            const res = await fetch(`${baseUrl}/fiori/webapp/changes/changes-bundle.json`);
            assert.equal(res.status, 200);

            const data = await res.json();
            assert.deepEqual(data, {
                changes: []
            });
        });

        it('MCK7: GET /fiori/webapp/changes/flexibility-bundle.json fallback returns HTTP 200 with empty changes', async () => {
            const res = await fetch(`${baseUrl}/fiori/webapp/changes/flexibility-bundle.json`);
            assert.equal(res.status, 200);

            const data = await res.json();
            assert.deepEqual(data, {
                changes: []
            });
        });

        it('MCK8: Unregistered routes are not matched by mock handlers and return 404', async () => {
            const res = await fetch(`${baseUrl}/unregistered/test/path`);
            assert.equal(res.status, 404);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Security Headers Middleware Activation
    // -------------------------------------------------------------------------
    describe('Security Headers Middleware Activation', () => {
        it('SEC1: Responses include X-Content-Type-Options: nosniff header', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/lrep/flex/settings`);
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        });

        it('SEC2: Responses include Referrer-Policy header', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/lrep/flex/settings`);
            assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        });

        it('SEC3: Responses include Content-Security-Policy header with expected directives', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/lrep/flex/settings`);
            const csp = res.headers.get('content-security-policy');
            assert.ok(csp, 'Content-Security-Policy header must be present');
            assert.ok(csp.includes("default-src 'self'"), 'CSP must include default-src');
            assert.ok(csp.includes("frame-ancestors 'self'"), 'CSP must enforce frame-ancestors via HTTP header');
        });

        it('SEC4: Security headers are present on 204 No Content responses as well', async () => {
            const res = await fetch(`${baseUrl}/sap/bc/ui2/flp;sap-metrics-only`, { method: 'POST' });
            assert.equal(res.status, 204);
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
            assert.ok(res.headers.get('content-security-policy'));
        });

        it('SEC5: Fiori routes include UI5 CDN origin in Content-Security-Policy', async () => {
            const res = await fetch(`${baseUrl}/fiori/webapp/changes/changes-bundle.json`);
            const csp = res.headers.get('content-security-policy') || '';
            assert.ok(csp.includes('https://ui5.sap.com'), 'Fiori CSP must allow https://ui5.sap.com');
            assert.ok(csp.includes("'unsafe-inline'"), 'Fiori CSP must allow inline styles/scripts for UI5');
        });
    });

    // -------------------------------------------------------------------------
    // 4. Live CAP Server Integration
    // -------------------------------------------------------------------------
    describe('Live CAP Server Integration', () => {
        let liveCdsServer;
        let liveBaseUrl;

        before(async () => {
            cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } };
            liveCdsServer = await serverExport({ port: 0, from: 'srv/monitoring-service.cds' });
            const port = liveCdsServer.address().port;
            liveBaseUrl = `http://127.0.0.1:${port}`;
        });

        after(async () => {
            if (liveCdsServer && liveCdsServer.close) {
                await new Promise((resolve) => liveCdsServer.close(resolve));
            }
        });

        it('CAP1: Live CAP server mounts security headers on OData service requests', async () => {
            const res = await fetch(`${liveBaseUrl}/health`);
            // Security headers should be present on responses from the server
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        });

        it('CAP2: Live CAP server responds to flexibility endpoints', async () => {
            const res = await fetch(`${liveBaseUrl}/sap/bc/lrep/flex/settings`);
            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.isKeyUser, false);
            assert.equal(data.isProductiveSystem, false);
        });

        it('CAP3: Live CAP server responds to FLP metrics POST with 204', async () => {
            const res = await fetch(`${liveBaseUrl}/sap/bc/ui2/flp;sap-metrics-only`, { method: 'POST' });
            assert.equal(res.status, 204);
        });

        it('CAP4: Live CAP server serves Fiori index.html with Fiori CSP policy', async () => {
            const res = await fetch(`${liveBaseUrl}/fiori/webapp/index.html`);
            assert.equal(res.status, 200);
            const csp = res.headers.get('content-security-policy') || '';
            assert.ok(csp.includes('https://ui5.sap.com'), 'Must allow ui5.sap.com in CSP');
            assert.ok(csp.includes("'unsafe-inline'"), 'Must allow unsafe-inline in Fiori CSP');
        });
    });
});
