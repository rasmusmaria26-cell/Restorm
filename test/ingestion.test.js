const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { INSERT } = cds.ql;
const { randomUUID } = require('crypto');

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

    // Direct DB insert helper (bypasses @readonly OData service layer)
    async function insertSnapshotDirectly(ifaceId, fields = {}) {
        const defaults = {
            interface_ID: ifaceId,
            capturedAt: new Date().toISOString(),
            pendingCount: 0,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 0,
            oldestPendingAgeSeconds: 0,
            ...fields
        };
        await cds.db.run(INSERT.into(srv.entities.QueueSnapshots).entries(defaults));
    }

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

    // --- Focused tests for deterministic snapshot ordering (Task 2) ---

    const { processSnapshotAndEvaluate } = require('../srv/core/ingestionPipeline');

    it('T9 Deterministic ordering: later capturedAt wins as predecessor', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const earlierTime = new Date('2026-10-29T10:00:00.000Z').toISOString();
        const laterTime = new Date('2026-10-29T10:01:00.000Z').toISOString();
        const ingestTime = new Date('2026-10-29T10:05:00.000Z').toISOString();

        // Insert two snapshots with different capturedAt values.
        // The one with later capturedAt should be selected as predecessor.
        await insertSnapshotDirectly(targetInterfaceId, {
            capturedAt: earlierTime,
            pendingCount: 100,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        await new Promise(r => setTimeout(r, 10));

        await insertSnapshotDirectly(targetInterfaceId, {
            capturedAt: laterTime,
            pendingCount: 300,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        // Ingest a new snapshot with later capturedAt.
        // Use pendingCount=150 so Rule B (QUEUE_GROWTH, threshold=200) does NOT fire.
        // Rule D outcome depends on predecessor selection:
        //   predecessor.pendingCount=300 → 150>=300=false → no alert
        //   predecessor.pendingCount=100 → 150>=100=true → Rule D fires
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: ingestTime,
            pendingCount: 150,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        // Rule D should NOT fire because the correct predecessor (pendingCount=300)
        // means 150 >= 300 is false, and successCount=100 is not < 30.
        assert.equal(res.alertTriggered, false, 'Rule D should not fire when predecessor has higher pendingCount');
    });

    it('T10 Late-arriving observation: predecessor capturedAt <= current, never future', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const oldTime = new Date('2026-10-29T09:00:00.000Z').toISOString();
        const newTime = new Date('2026-10-29T10:00:00.000Z').toISOString();
        const lateTime = new Date('2026-10-29T09:30:00.000Z').toISOString();

        // Insert an old snapshot (capturedAt=09:00)
        await insertSnapshotDirectly(targetInterfaceId, {
            capturedAt: oldTime,
            pendingCount: 100,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        // Insert a newer snapshot (capturedAt=10:00)
        await new Promise(r => setTimeout(r, 10));
        await insertSnapshotDirectly(targetInterfaceId, {
            capturedAt: newTime,
            pendingCount: 50,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        // Ingest a late-arriving snapshot (capturedAt=09:30, between old and new)
        // The predecessor query filters capturedAt <= 09:30, so only the 09:00 snapshot
        // qualifies. The 10:00 snapshot must NOT be selected as predecessor.
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: lateTime,
            pendingCount: 200,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        // Rule D: predecessor is the 09:00 snapshot (pendingCount=100).
        // Current pendingCount=200 >= 100 → drain stalled → Rule D fires.
        assert.equal(res.alertTriggered, true);
        assert.equal(res.ruleCode, 'RECOVERY_STALLED');
        assert.equal(res.alertAction, 'Created');
    });

    it('T11 Current snapshot exclusion: ID != prevents self-selection as predecessor', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const snapTime = new Date('2026-10-29T10:00:00.000Z').toISOString();

        // Insert one snapshot via ingestTelemetry (goes through service layer, gets proper UUID)
        await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: snapTime,
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        // Query back the inserted snapshot's ID
        const insertedSnap = await bobTx.run(
            SELECT.one.from(srv.entities.QueueSnapshots)
                .where({ interface_ID: targetInterfaceId, capturedAt: snapTime })
                .orderBy('capturedAt desc')
        );
        const insertedId = insertedSnap.ID;

        // Call processSnapshotAndEvaluate with snapshotData that has NO ID
        // (normal case - ID is auto-generated on INSERT).
        // The ID != filter with undefined ID must not exclude any rows,
        // and the predecessor query must work normally.
        const entities = {
            QueueSnapshots: srv.entities.QueueSnapshots,
            Alerts: srv.entities.Alerts,
            Interfaces: srv.entities.Interfaces
        };

        const result = await processSnapshotAndEvaluate(
            entities,
            targetInterfaceId,
            {
                // No ID set - auto-generated on INSERT
                interface_ID: targetInterfaceId,
                capturedAt: new Date('2026-10-29T10:05:00.000Z').toISOString(),
                pendingCount: 200,
                failedCount: 0,
                retryAttempts: 1,
                successCount: 100,
                oldestPendingAgeSeconds: 10
            },
            'Direct call test'
        );

        assert.equal(result.status, 'Accepted');
        // With one prior snapshot (pendingCount=10, capturedAt=10:00),
        // Rule D: retryAttempts=1<=5, failedCount=0<=0 (recovered),
        // pendingCount=200>=100 (backlog elevated),
        // successCount=100>=30 but pendingCount=200 >= predecessor.pendingCount=10 (drain stalled)
        // → Rule D fires before Rule B.
        assert.equal(result.alertTriggered, true);
        assert.equal(result.ruleCode, 'RECOVERY_STALLED');
    });

    it('T12 Normal in-order ingestion and Rule D behavior', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const t1 = new Date('2026-10-29T10:00:00.000Z').toISOString();
        const t2 = new Date('2026-10-29T10:05:00.000Z').toISOString();

        // First snapshot: healthy (low pending, low retries)
        await insertSnapshotDirectly(targetInterfaceId, {
            capturedAt: t1,
            pendingCount: 50,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        await new Promise(r => setTimeout(r, 10));

        // Second snapshot: recovered destination (low retries, zero failures) but
        // queue not draining (pendingCount same or higher, low successCount)
        await insertSnapshotDirectly(targetInterfaceId, {
            capturedAt: t2,
            pendingCount: 50,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 10, // < 30 → drain stalled
            oldestPendingAgeSeconds: 10
        });

        // Verify Rule D fires on the second snapshot
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: new Date('2026-10-29T10:10:00.000Z').toISOString(),
            pendingCount: 150,
            failedCount: 0,
            retryAttempts: 2,
            successCount: 15,
            oldestPendingAgeSeconds: 20
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        assert.equal(res.alertTriggered, true);
        // Rule D: retryAttempts=2<=5, failedCount=0<=0 → recovered.
        // pendingCount=150>=100 → backlog elevated.
        // successCount=15<30 → drain stalled.
        // Rule D fires.
        assert.equal(res.ruleCode, 'RECOVERY_STALLED');
        assert.equal(res.severity, 'High');
    });

    it('T13 Incident states consistent when stale telemetry arrives', async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });

        // First, trigger an EXCESSIVE_RETRIES alert via normal ingestion
        await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: new Date('2026-10-29T10:00:00.000Z').toISOString(),
            pendingCount: 450,
            failedCount: 190,
            retryAttempts: 320,
            successCount: 4,
            oldestPendingAgeSeconds: 780
        });

        // Verify the alert exists and is Open
        const alertBefore = await bobTx.run(
            SELECT.one.from(srv.entities.Alerts)
                .where({ interface_ID: targetInterfaceId, ruleCode: 'EXCESSIVE_RETRIES', status: 'Open' })
        );
        assert.ok(alertBefore, 'EXCESSIVE_RETRIES alert should be Open');
        assert.equal(alertBefore.repeatCount, 1);

        // Now ingest stale telemetry (lower retry count, earlier capturedAt)
        // This should NOT modify the existing Open alert
        await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: new Date('2026-10-29T09:30:00.000Z').toISOString(), // earlier
            pendingCount: 50,
            failedCount: 0,
            retryAttempts: 5,
            successCount: 100,
            oldestPendingAgeSeconds: 30
        });

        // Verify the alert state is unchanged
        const alertAfter = await bobTx.run(
            SELECT.one.from(srv.entities.Alerts)
                .where({ interface_ID: targetInterfaceId, ruleCode: 'EXCESSIVE_RETRIES', status: 'Open' })
        );
        assert.ok(alertAfter, 'EXCESSIVE_RETRIES alert should still be Open');
        assert.equal(alertAfter.repeatCount, 1, 'repeatCount should not change from stale telemetry');

        // Verify no new alert was created for this interface
        const allAlerts = await bobTx.run(
            SELECT.from(srv.entities.Alerts)
                .where({ interface_ID: targetInterfaceId })
        );
        const openAlerts = allAlerts.filter(a => a.status === 'Open');
        assert.equal(openAlerts.length, 1, 'Should have exactly 1 open alert');
    });
});
