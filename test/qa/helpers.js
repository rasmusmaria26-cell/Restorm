/**
 * test/qa/helpers.js — Shared helpers for Phase 5 QA (Agent 6) test suites.
 *
 * Test-only module; production code is unchanged.
 *
 * Backend tests run the real CDS MonitoringService against a private COPY of
 * sentinel.db placed in the opencode temp directory. The original sentinel.db
 * is never opened or modified by these helpers. Each suite gets its own throw-away
 * database, is reset to a clean baseline via resetToCleanSeed(), and the temp file
 * is deleted in after().
 *
 * Role model (matches package.json cds.auth.users):
 *   admin  -> SimulatorAdmin, SupportOperator, SupportViewer  (full access)
 *   bob    -> SupportOperator, SupportViewer                  (ack/resolve/simulate/ingest)
 *   alice  -> SupportViewer                                   (read-only)
 *   anonymous -> no user                                      (401 everywhere)
 */

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');

const TEMP_DIR = 'C:\\Users\\lumaa\\AppData\\Local\\Temp\\opencode';
const SEED_DB = path.resolve('sentinel.db');

const ROLES = {
    admin: ['SimulatorAdmin', 'SupportOperator', 'SupportViewer'],
    bob: ['SupportOperator', 'SupportViewer'],
    alice: ['SupportViewer']
};

function makeTempDbPath() {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    return path.join(
        TEMP_DIR,
        `restorm-qa-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.db`
    );
}

/**
 * Spin up the MonitoringService against a private copy of sentinel.db.
 *
 * @returns {Object} { srv, tempDb, adminTx, bobTx, aliceTx, tx(userId, roles) }
 */
async function setupTestDb() {
    const tempDb = makeTempDbPath();
    // Copy the seeded development database; never modify sentinel.db itself.
    fs.copyFileSync(SEED_DB, tempDb);

    cds.env.requires.db = { kind: 'sqlite', credentials: { url: tempDb } };
    const csn = await cds.load('srv/monitoring-service.cds');
    cds.model = csn;
    await cds.connect.to('db');
    const srv = await cds.serve('MonitoringService').from('srv/monitoring-service.cds');

    const ctx = {
        srv,
        tempDb,
        adminTx: () =>
            srv.tx({ user: new cds.User({ id: 'admin', roles: ROLES.admin }) }),
        bobTx: () =>
            srv.tx({ user: new cds.User({ id: 'bob', roles: ROLES.bob }) }),
        aliceTx: () =>
            srv.tx({ user: new cds.User({ id: 'alice', roles: ROLES.alice }) }),
        // Anonymous access: no tx / no user -> service rejects with 401.
        tx: (userId, roles) => {
            if (userId === undefined || userId === null) return null;
            return srv.tx({ user: new cds.User({ id: userId, roles: roles || [] }) });
        }
    };
    return ctx;
}

/**
 * Delete the throw-away temp database for a suite.
 */
async function teardownTestDb(tempDb) {
    try {
        fs.unlinkSync(tempDb);
    } catch (e) {
        // Best-effort cleanup; temp files are harmless if left behind.
    }
}

/**
 * Convenience: reset the suite database to a clean baseline and return it.
 */
async function resetToCleanBaseline(ctx) {
    return await ctx.adminTx().send('resetToCleanSeed');
}

module.exports = {
    setupTestDb,
    teardownTestDb,
    resetToCleanBaseline,
    ROLES
};
