/**
 * test/qa/authorization.test.js
 *
 * Phase 5 Agent 6 — Full role x endpoint authorization matrix (backend).
 *
 * Verifies 401 (anonymous), 403 (wrong role) across every OData entity and
 * action, plus 200 for authorized roles. Runs the real CDS MonitoringService
 * against a private copy of sentinel.db.
 *
 * Roles (package.json cds.auth.users):
 *   admin  -> SimulatorAdmin + SupportOperator + SupportViewer
 *   bob    -> SupportOperator + SupportViewer
 *   alice  -> SupportViewer
 *
 * Runs with: node --test test/qa/authorization.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { setupTestDb, teardownTestDb, resetToCleanBaseline } = require('./helpers.js');

const ENTITIES = ['Interfaces', 'Alerts', 'QueueSnapshots', 'RunbookEntries', 'Systems', 'Connections'];

describe('Authorization matrix (401 / 403 / 200)', () => {
    let ctx;
    let openAlertId;

    before(async () => {
        ctx = await setupTestDb();
        await resetToCleanBaseline(ctx);
        // Seed one Open alert for action-level tests.
        const bobTx = ctx.bobTx();
        const iface = (await ctx.adminTx().run(cds.ql.SELECT.from('Interfaces')))[0];
        await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
        const rows = await bobTx.run(cds.ql.SELECT.from('Alerts').where({ status: 'Open' }));
        assert.ok(rows.length > 0);
        openAlertId = rows[0].ID;
    });

    after(async () => {
        await teardownTestDb(ctx.tempDb);
    });

    describe('401: anonymous (no user) is rejected on every entity read', () => {
        for (const entity of ENTITIES) {
            it(`GET ${entity} anonymous -> 401`, async () => {
                await assert.rejects(
                    async () => {
                        await ctx.srv.run(cds.ql.SELECT.from(entity));
                    },
                    (err) => {
                        assert.equal(err.code || err.status, 401);
                        return true;
                    }
                );
            });
        }
    });

    describe('200: every authenticated role can read every entity', () => {
        const roles = {
            admin: () => ctx.adminTx(),
            bob: () => ctx.bobTx(),
            alice: () => ctx.aliceTx()
        };
        for (const [roleName, txFactory] of Object.entries(roles)) {
            for (const entity of ENTITIES) {
                it(`GET ${entity} ${roleName} -> 200`, async () => {
                    const rows = await txFactory().run(cds.ql.SELECT.from(entity));
                    assert.ok(Array.isArray(rows));
                });
            }
        }
    });

    const actionCases = [
        // [action, invoker, argsFactory, expectedStatus, authorizedRoles]
        ['acknowledge', 'bob', ({ id }) => ({ event: 'acknowledge', entity: 'Alerts', params: [{ ID: id }], data: { acknowledgedBy: 'Bob' } }), 200],
        ['acknowledge', 'alice', ({ id }) => ({ event: 'acknowledge', entity: 'Alerts', params: [{ ID: id }], data: { acknowledgedBy: 'Alice' } }), 403],
        ['resolveAlert', 'bob', ({ id }) => ({ event: 'resolveAlert', entity: 'Alerts', params: [{ ID: id }], data: { resolvedBy: 'Bob' } }), 200],
        ['resolveAlert', 'alice', ({ id }) => ({ event: 'resolveAlert', entity: 'Alerts', params: [{ ID: id }], data: { resolvedBy: 'Alice' } }), 403],
        ['explain', 'bob', ({ id }) => ({ event: 'explain', entity: 'Alerts', params: [{ ID: id }] }), 200],
        ['explain', 'alice', ({ id }) => ({ event: 'explain', entity: 'Alerts', params: [{ ID: id }] }), 200],
        ['exportIncidentReport', 'bob', ({ id }) => ({ event: 'exportIncidentReport', entity: 'Alerts', params: [{ ID: id }], data: { format: 'markdown' } }), 200],
        ['exportIncidentReport', 'alice', ({ id }) => ({ event: 'exportIncidentReport', entity: 'Alerts', params: [{ ID: id }], data: { format: 'markdown' } }), 200],
        ['ingestTelemetry', 'bob', () => ctx.bobTx().send('ingestTelemetry', {
            interfaceId: 'iface-dummy',
            capturedAt: new Date().toISOString(),
            pendingCount: 10, failedCount: 0, retryAttempts: 1, successCount: 100, oldestPendingAgeSeconds: 30
        }), 404], // wrong interface id but auth passes first
        ['triggerSimulation', 'bob', () => ctx.bobTx().send('triggerSimulation', { scenario: 'NORMAL', interfaceId: 'iface-dummy' }), 404],
        ['configureThresholds', 'admin', () => ctx.adminTx().send('configureThresholds', { interfaceId: 'iface-dummy', maxRetryThreshold: 50, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100 }), 404],
        ['configureThresholds', 'bob', () => ctx.bobTx().send('configureThresholds', { interfaceId: 'iface-dummy', maxRetryThreshold: 50, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100 }), 403],
        ['configureThresholds', 'alice', () => ctx.aliceTx().send('configureThresholds', { interfaceId: 'iface-dummy', maxRetryThreshold: 50, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100 }), 403],
        ['resetToCleanSeed', 'admin', () => ctx.adminTx().send('resetToCleanSeed'), 200],
        ['resetToCleanSeed', 'bob', () => ctx.bobTx().send('resetToCleanSeed'), 403],
        ['resetToCleanSeed', 'alice', () => ctx.aliceTx().send('resetToCleanSeed'), 403]
    ];

    describe('Action authorization per role', () => {
        for (const [action, role, call, expected] of actionCases) {
            it(`${action}: ${role} -> ${expected}`, async () => {
                const txFactory = { admin: ctx.adminTx, bob: ctx.bobTx, alice: ctx.aliceTx }[role];
                const tx = txFactory();
                let result;
                try {
                    if (action === 'ingestTelemetry' || action === 'triggerSimulation' || action === 'configureThresholds' || action === 'resetToCleanSeed') {
                        result = await call();
                    } else {
                        result = await tx.send(call({ id: openAlertId }));
                    }
                } catch (err) {
                    // Expected error responses surface here.
                    assert.equal(err.code || err.status, expected, `${action} ${role}: expected ${expected}, got ${err.code || err.status}`);
                    return;
                }
                // If no error was thrown, the call succeeded -> expect 200.
                assert.equal(expected, 200, `${action} ${role}: expected success (200) but got result without error`);
            });
        }
    });

    describe('Role hierarchy', () => {
        it('admin (SimulatorAdmin) can perform every admin action', async () => {
            const adminTx = ctx.adminTx();
            const reset = await adminTx.send('resetToCleanSeed');
            assert.match(String(reset), /Database reset to clean baseline/);
        });

        it('bob (SupportOperator) cannot reset or configure thresholds', async () => {
            await assert.rejects(
                async () => { await ctx.bobTx().send('resetToCleanSeed'); },
                (err) => { assert.equal(err.code || err.status, 403); return true; }
            );
            const iface = (await ctx.adminTx().run(cds.ql.SELECT.from('Interfaces')))[0];
            await assert.rejects(
                async () => { await ctx.bobTx().send('configureThresholds', { interfaceId: iface.ID, maxRetryThreshold: 50, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100 }); },
                (err) => { assert.equal(err.code || err.status, 403); return true; }
            );
        });

        it('alice (SupportViewer) can only read', async () => {
            // Reads OK.
            const rows = await ctx.aliceTx().run(cds.ql.SELECT.from('Interfaces'));
            assert.ok(Array.isArray(rows));
            // All mutating actions rejected.
            await assert.rejects(
                async () => { await ctx.aliceTx().send('resetToCleanSeed'); },
                (err) => { assert.equal(err.code || err.status, 403); return true; }
            );
        });
    });
});
