const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');

describe('External Telemetry Ingestion API (Phase 1)', () => {
    let srv;
    let targetInterfaceId;

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
        targetInterfaceId = ifaces[0].ID;
    });

    after(async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');
    });

    it('T1 Authentication: Anonymous client is rejected with 401', async () => {
        const anonTx = srv.tx({ user: new cds.User.Anonymous() });
        await assert.rejects(
            async () => {
                await anonTx.send('ingestTelemetry', {
                    interfaceId: targetInterfaceId,
                    pendingCount: 10,
                    failedCount: 0,
                    retryAttempts: 2,
                    successCount: 100,
                    oldestPendingAgeSeconds: 5
                });
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 401);
                return true;
            }
        );
    });

    it('T2 Authorization: SupportViewer (alice) is forbidden from ingesting metrics (403)', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        await assert.rejects(
            async () => {
                await aliceTx.send('ingestTelemetry', {
                    interfaceId: targetInterfaceId,
                    pendingCount: 10,
                    failedCount: 0,
                    retryAttempts: 2,
                    successCount: 100,
                    oldestPendingAgeSeconds: 5
                });
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 403);
                return true;
            }
        );
    });

    it('T3 Normal Ingestion: SupportOperator (bob) ingests normal telemetry, saves snapshot, no alert raised', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            pendingCount: 15,
            failedCount: 0,
            retryAttempts: 2,
            successCount: 150,
            oldestPendingAgeSeconds: 20
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        assert.equal(res.alertTriggered, false);
        assert.equal(res.alertAction, 'None');

        // Confirm snapshot in database
        const snapshots = await bobTx.run(
            SELECT.from(srv.entities.QueueSnapshots)
                .where({ interface_ID: targetInterfaceId })
                .orderBy('capturedAt desc')
        );
        assert.ok(snapshots.length > 0);
        assert.equal(snapshots[0].pendingCount, 15);
    });

    it('T4 Incident Ingestion: Ingesting high retry attempts triggers Critical EXCESSIVE_RETRIES alert', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            pendingCount: 180,
            failedCount: 20,
            retryAttempts: 350, // Breaches THRESHOLDS.EXCESSIVE_RETRIES (100)
            successCount: 10,
            oldestPendingAgeSeconds: 120
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        assert.equal(res.alertTriggered, true);
        assert.equal(res.alertAction, 'Created');
        assert.equal(res.ruleCode, 'EXCESSIVE_RETRIES');
        assert.equal(res.severity, 'Critical');
        assert.equal(res.repeatCount, 1);

        const activeAlert = await bobTx.run(
            SELECT.one.from(srv.entities.Alerts).where({
                interface_ID: targetInterfaceId,
                ruleCode: 'EXCESSIVE_RETRIES',
                status: 'Open'
            })
        );
        assert.ok(activeAlert);
        assert.equal(activeAlert.repeatCount, 1);
    });

    it('T5 Deduplication: Consecutive high-retry ingestion updates existing alert instead of creating duplicate', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            pendingCount: 250,
            failedCount: 40,
            retryAttempts: 410,
            successCount: 5,
            oldestPendingAgeSeconds: 190
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        assert.equal(res.alertTriggered, true);
        assert.equal(res.alertAction, 'Updated');
        assert.equal(res.repeatCount, 2);

        // Verify only ONE open alert exists for this interface & rule
        const allAlerts = await bobTx.run(
            SELECT.from(srv.entities.Alerts).where({
                interface_ID: targetInterfaceId,
                ruleCode: 'EXCESSIVE_RETRIES',
                status: 'Open'
            })
        );
        assert.equal(allAlerts.length, 1, 'Expected exactly 1 deduplicated open alert');
        assert.equal(allAlerts[0].repeatCount, 2);
    });

    it('T6 Validation: Rejects missing or non-existent interfaceId with 400/404', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });

        // Missing interfaceId
        await assert.rejects(
            async () => {
                await bobTx.send('ingestTelemetry', {
                    pendingCount: 10,
                    failedCount: 0,
                    retryAttempts: 0,
                    successCount: 10,
                    oldestPendingAgeSeconds: 0
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /interfaceId/i);
                return true;
            }
        );

        // Non-existent interfaceId
        await assert.rejects(
            async () => {
                await bobTx.send('ingestTelemetry', {
                    interfaceId: '99999999-9999-9999-9999-999999999999',
                    pendingCount: 10,
                    failedCount: 0,
                    retryAttempts: 0,
                    successCount: 10,
                    oldestPendingAgeSeconds: 0
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 404);
                return true;
            }
        );
    });

    it('T7 Validation: Rejects negative, floating-point, or out-of-bounds numbers with 400', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });

        // Negative pendingCount
        await assert.rejects(
            async () => {
                await bobTx.send('ingestTelemetry', {
                    interfaceId: targetInterfaceId,
                    pendingCount: -5,
                    failedCount: 0,
                    retryAttempts: 0,
                    successCount: 10,
                    oldestPendingAgeSeconds: 0
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /pendingCount/);
                return true;
            }
        );

        // Float retryAttempts
        await assert.rejects(
            async () => {
                await bobTx.send('ingestTelemetry', {
                    interfaceId: targetInterfaceId,
                    pendingCount: 10,
                    failedCount: 0,
                    retryAttempts: 15.5,
                    successCount: 10,
                    oldestPendingAgeSeconds: 0
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /must be an integer/);
                return true;
            }
        );

        // Out of bounds (> 1,000,000)
        await assert.rejects(
            async () => {
                await bobTx.send('ingestTelemetry', {
                    interfaceId: targetInterfaceId,
                    pendingCount: 2000000,
                    failedCount: 0,
                    retryAttempts: 0,
                    successCount: 10,
                    oldestPendingAgeSeconds: 0
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /bounds/);
                return true;
            }
        );
    });

    it('T8 Validation: Rejects invalid or future-skewed timestamps with 400', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });

        // Invalid date string
        await assert.rejects(
            async () => {
                await bobTx.send('ingestTelemetry', {
                    interfaceId: targetInterfaceId,
                    capturedAt: 'not-a-valid-date-string',
                    pendingCount: 10,
                    failedCount: 0,
                    retryAttempts: 0,
                    successCount: 10,
                    oldestPendingAgeSeconds: 0
                });
            },
            (err) => {
                const status = err.status || err.statusCode || (err.code === 'ASSERT_DATA_TYPE' ? 400 : err.code);
                assert.equal(status, 400);
                return true;
            }
        );

        // Timestamp 1 hour in the future
        const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await assert.rejects(
            async () => {
                await bobTx.send('ingestTelemetry', {
                    interfaceId: targetInterfaceId,
                    capturedAt: farFuture,
                    pendingCount: 10,
                    failedCount: 0,
                    retryAttempts: 0,
                    successCount: 10,
                    oldestPendingAgeSeconds: 0
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /future/);
                return true;
            }
        );
    });
});
