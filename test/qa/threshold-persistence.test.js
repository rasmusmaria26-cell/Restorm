/**
 * test/qa/threshold-persistence.test.js
 *
 * Phase 5 Agent 6 — Threshold policy persistence tests (backend).
 *
 * Verifies: admin can update thresholds and they persist (read-back matches);
 * viewer/operator get 403; validation rejects out-of-bounds values (400).
 * Runs the real CDS MonitoringService against a private copy of sentinel.db.
 *
 * Runs with: node --test test/qa/threshold-persistence.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { setupTestDb, teardownTestDb, resetToCleanBaseline } = require('./helpers.js');

describe('Threshold policy persistence', () => {
    let ctx;

    before(async () => {
        ctx = await setupTestDb();
        await resetToCleanBaseline(ctx);
    });

    after(async () => {
        await teardownTestDb(ctx.tempDb);
    });

    const thresholds = {
        maxRetryThreshold: 42,
        queueGrowthLimit: 1234,
        oldMessageAgeLimitSeconds: 900,
        recoveryStalledBacklog: 77
    };

    const ifaceFor = async (tx) => (await tx.run(cds.ql.SELECT.from('Interfaces')))[0];

    it('admin can update thresholds and they persist (read-back matches)', async () => {
        const adminTx = ctx.adminTx();
        const iface = await ifaceFor(adminTx);
        const original = {
            maxRetryThreshold: iface.maxRetryThreshold,
            queueGrowthLimit: iface.queueGrowthLimit,
            oldMessageAgeLimitSeconds: iface.oldMessageAgeLimitSeconds,
            recoveryStalledBacklog: iface.recoveryStalledBacklog
        };

        const updated = await adminTx.send('configureThresholds', {
            interfaceId: iface.ID,
            ...thresholds
        });
        assert.ok(updated);
        assert.equal(updated.maxRetryThreshold, thresholds.maxRetryThreshold);
        assert.equal(updated.queueGrowthLimit, thresholds.queueGrowthLimit);
        assert.equal(updated.oldMessageAgeLimitSeconds, thresholds.oldMessageAgeLimitSeconds);
        assert.equal(updated.recoveryStalledBacklog, thresholds.recoveryStalledBacklog);

        // Read back from persistence to confirm durability.
        const persisted = await adminTx.run(cds.ql.SELECT.from('Interfaces').where({ ID: iface.ID }));
        assert.equal(persisted[0].maxRetryThreshold, thresholds.maxRetryThreshold);
        assert.equal(persisted[0].queueGrowthLimit, thresholds.queueGrowthLimit);
        assert.equal(persisted[0].oldMessageAgeLimitSeconds, thresholds.oldMessageAgeLimitSeconds);
        assert.equal(persisted[0].recoveryStalledBacklog, thresholds.recoveryStalledBacklog);

        // Restore original values so later suites see clean defaults.
        await adminTx.send('configureThresholds', { interfaceId: iface.ID, ...original });
        const restored = await adminTx.run(cds.ql.SELECT.from('Interfaces').where({ ID: iface.ID }));
        assert.equal(restored[0].maxRetryThreshold, original.maxRetryThreshold);
    });

    it('operator (bob) cannot configure thresholds (403)', async () => {
        const iface = await ifaceFor(ctx.adminTx());
        await assert.rejects(
            async () => {
                await ctx.bobTx().send('configureThresholds', { interfaceId: iface.ID, ...thresholds });
            },
            (err) => {
                assert.equal(err.code || err.status, 403);
                return true;
            }
        );
    });

    it('viewer (alice) cannot configure thresholds (403)', async () => {
        const iface = await ifaceFor(ctx.adminTx());
        await assert.rejects(
            async () => {
                await ctx.aliceTx().send('configureThresholds', { interfaceId: iface.ID, ...thresholds });
            },
            (err) => {
                assert.equal(err.code || err.status, 403);
                return true;
            }
        );
    });

    it('validation rejects out-of-bounds values (400)', async () => {
        const adminTx = ctx.adminTx();
        const iface = await ifaceFor(adminTx);

        const cases = [
            { field: 'maxRetryThreshold', value: 0 },        // below min 1
            { field: 'maxRetryThreshold', value: 10001 },    // above max 10000
            { field: 'queueGrowthLimit', value: 0 },         // below min 1
            { field: 'queueGrowthLimit', value: 100001 },    // above max 100000
            { field: 'oldMessageAgeLimitSeconds', value: 9 },// below min 10
            { field: 'oldMessageAgeLimitSeconds', value: 2592001 }, // above max 2592000
            { field: 'recoveryStalledBacklog', value: 0 },   // below min 1
            { field: 'recoveryStalledBacklog', value: 100001 } // above max 100000
        ];

        for (const { field, value } of cases) {
            const payload = { interfaceId: iface.ID, maxRetryThreshold: 100, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100 };
            payload[field] = value;
            await assert.rejects(
                async () => {
                    await adminTx.send('configureThresholds', payload);
                },
                (err) => {
                    assert.equal(err.code || err.status, 400, `Expected 400 for ${field}=${value}`);
                    return true;
                }
            );
        }

        // Boundary values that ARE valid must be accepted.
        const valid = await adminTx.send('configureThresholds', {
            interfaceId: iface.ID,
            maxRetryThreshold: 1,
            queueGrowthLimit: 1,
            oldMessageAgeLimitSeconds: 10,
            recoveryStalledBacklog: 1
        });
        assert.ok(valid);
    });

    it('thresholds on unknown interface return 404', async () => {
        const adminTx = ctx.adminTx();
        await assert.rejects(
            async () => {
                await adminTx.send('configureThresholds', {
                    interfaceId: '00000000-0000-0000-0000-000000000000',
                    maxRetryThreshold: 50,
                    queueGrowthLimit: 200,
                    oldMessageAgeLimitSeconds: 600,
                    recoveryStalledBacklog: 100
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 404);
                return true;
            }
        );
    });
});
