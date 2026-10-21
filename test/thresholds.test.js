const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');

describe('Per-Interface Threshold Policies (Phase 2)', () => {
    let srv;
    let targetInterface;

    before(async () => {
        cds.env.requires.db = { kind: 'sqlite', credentials: { url: 'sentinel.db' } };
        const csn = await cds.load('srv/monitoring-service.cds');
        cds.model = csn;
        await cds.connect.to('db');
        srv = await cds.serve('MonitoringService').from('srv/monitoring-service.cds');

        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');

        const ifaces = await adminTx.run(SELECT.from(srv.entities.Interfaces).where({ active: true }));
        assert.ok(ifaces.length > 0, 'Seed interfaces must exist');
        targetInterface = ifaces[0];
    });

    after(async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');
    });

    it('T1 Safe Defaults: Seed interfaces have expected safe default threshold values', async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        const iface = await adminTx.run(SELECT.one.from(srv.entities.Interfaces).where({ ID: targetInterface.ID }));

        assert.equal(iface.maxRetryThreshold, 100);
        assert.equal(iface.queueGrowthLimit, 200);
        assert.equal(iface.oldMessageAgeLimitSeconds, 600);
        assert.equal(iface.recoveryStalledBacklog, 100);
    });

    it('T2 Authorization: SupportViewer (alice) is forbidden from configuring thresholds (403)', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        await assert.rejects(
            async () => {
                await aliceTx.send('configureThresholds', {
                    interfaceId: targetInterface.ID,
                    maxRetryThreshold: 50,
                    queueGrowthLimit: 150,
                    oldMessageAgeLimitSeconds: 300,
                    recoveryStalledBacklog: 80
                });
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 403);
                return true;
            }
        );
    });

    it('T3 Authorization: SupportOperator (bob) is forbidden from configuring thresholds (403)', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        await assert.rejects(
            async () => {
                await bobTx.send('configureThresholds', {
                    interfaceId: targetInterface.ID,
                    maxRetryThreshold: 50,
                    queueGrowthLimit: 150,
                    oldMessageAgeLimitSeconds: 300,
                    recoveryStalledBacklog: 80
                });
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 403);
                return true;
            }
        );
    });

    it('T4 Administrative Configuration: SimulatorAdmin (admin) can update threshold policies', async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        const updated = await adminTx.send('configureThresholds', {
            interfaceId: targetInterface.ID,
            maxRetryThreshold: 30, // Custom tight threshold
            queueGrowthLimit: 90,
            oldMessageAgeLimitSeconds: 180,
            recoveryStalledBacklog: 40
        });

        assert.equal(updated.maxRetryThreshold, 30);
        assert.equal(updated.queueGrowthLimit, 90);
        assert.equal(updated.oldMessageAgeLimitSeconds, 180);
        assert.equal(updated.recoveryStalledBacklog, 40);

        // Verify persisted state in database
        const persisted = await adminTx.run(SELECT.one.from(srv.entities.Interfaces).where({ ID: targetInterface.ID }));
        assert.equal(persisted.maxRetryThreshold, 30);
        assert.equal(persisted.queueGrowthLimit, 90);
    });

    it('T5 Custom Sensitivity: Ingestion triggers alert based on customized interface threshold', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });

        // Target interface now has maxRetryThreshold = 30.
        // Ingesting retryAttempts: 35 would NOT trigger under default (100), but triggers under custom (30)!
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterface.ID,
            pendingCount: 25,
            failedCount: 2,
            retryAttempts: 35,
            successCount: 100,
            oldestPendingAgeSeconds: 30
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        assert.equal(res.alertTriggered, true);
        assert.equal(res.ruleCode, 'EXCESSIVE_RETRIES');
        assert.match(res.summary, /35 attempts >= limit 30/);
    });

    it('T6 Validation: Rejects negative, zero, float, or out-of-bounds thresholds with 400', async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });

        // Zero maxRetryThreshold (minimum is 1)
        await assert.rejects(
            async () => {
                await adminTx.send('configureThresholds', {
                    interfaceId: targetInterface.ID,
                    maxRetryThreshold: 0,
                    queueGrowthLimit: 100,
                    oldMessageAgeLimitSeconds: 300,
                    recoveryStalledBacklog: 50
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /maxRetryThreshold/);
                return true;
            }
        );

        // Float queueGrowthLimit
        await assert.rejects(
            async () => {
                await adminTx.send('configureThresholds', {
                    interfaceId: targetInterface.ID,
                    maxRetryThreshold: 50,
                    queueGrowthLimit: 100.5,
                    oldMessageAgeLimitSeconds: 300,
                    recoveryStalledBacklog: 50
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /must be an integer/);
                return true;
            }
        );

        // Out of bounds (> 10,000 for maxRetryThreshold)
        await assert.rejects(
            async () => {
                await adminTx.send('configureThresholds', {
                    interfaceId: targetInterface.ID,
                    maxRetryThreshold: 99999,
                    queueGrowthLimit: 100,
                    oldMessageAgeLimitSeconds: 300,
                    recoveryStalledBacklog: 50
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /bounds/);
                return true;
            }
        );
    });
});
