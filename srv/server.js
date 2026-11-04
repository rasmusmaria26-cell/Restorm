/**
 * srv/server.js — Custom CAP Express server bootstrap
 *
 * Provides server-side defense-in-depth for SAPUI5 Flexibility (LRep) and
 * SAP Fiori Launchpad (FLP) telemetry requests, and activates security
 * headers middleware on the Express application.
 */

const cds = require('@sap/cds');
const securityHeaders = require('./security-headers');

cds.on('bootstrap', (app) => {
    // 1. Mount security response headers (CSP, X-Content-Type-Options, etc.)
    app.use(securityHeaders);

    // 2. Mock handler for FLP metrics beacon (handles matrix params e.g. ;sap-metrics-only)
    app.post(/^\/sap\/bc\/ui2\/flp.*/, (req, res) => {
        res.status(204).end();
    });

    // 3. Mock handler for SAPUI5 flexibility settings
    app.get(/^\/sap\/bc\/lrep\/flex\/settings$/, (req, res) => {
        res.status(200).json({
            isKeyUser: false,
            isAtoAvailable: false,
            isProductiveSystem: false,
            isContextSharingEnabled: false
        });
    });

    // 4. Mock handler for SAPUI5 flexibility data queries
    app.get(/^\/sap\/bc\/lrep\/flex\/data\/.*$/, (req, res) => {
        res.status(200).json({
            changes: [],
            loadModules: false,
            contexts: []
        });
    });

    // 5. Fallback handler for changes bundle requests
    app.get(/^\/fiori\/webapp\/changes\/.*-bundle\.json$/, (req, res) => {
        res.status(200).json({
            changes: []
        });
    });
});

module.exports = cds.server;
