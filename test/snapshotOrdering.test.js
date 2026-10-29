const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');

describe('Deterministic Snapshot Ordering & Incident Lifecycle Protection', () => {
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
        targetInterfaceId = ifaces[0].ID;
    });

    after(async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');
    });

    it('T1 Identical Timestamps: Ingests two snapshots with identical capturedAt deterministically', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });
        const sharedTimestamp = new Date().toISOString();

        // First snapshot
        await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: sharedTimestamp,
            pendingCount: 50,
            failedCount: 0,
            retryAttempts: 2,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        });

        // Second snapshot with identical capturedAt and simulated identical createdAt tie-breaking test
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: sharedTimestamp,
            pendingCount: 60,
            failedCount: 0,
            retryAttempts: 3,
            successCount: 105,
            oldestPendingAgeSeconds: 12
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');

        // Verify both snapshots exist and are ordered deterministically by capturedAt desc, createdAt desc, ID desc
        const snapshots = await bobTx.run(
            SELECT.from(srv.entities.QueueSnapshots)
                .where({ interface_ID: targetInterfaceId })
                .orderBy('capturedAt desc', 'createdAt desc', 'ID desc')
        );
        assert.ok(snapshots.length >= 2);
        // Ensure newest (highest ID or later createdAt) comes first
        assert.equal(snapshots[0].pendingCount, 60);
        assert.equal(snapshots[1].pendingCount, 50);
    });

    it('T2 Repeated Ingestion: Deduplicates or handles repeated ingestion safely without corruption', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });

        // Trigger alert condition
        await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            pendingCount: 300,
            failedCount: 50,
            retryAttempts: 250, // Rule A Critical
            successCount: 0,
            oldestPendingAgeSeconds: 800
        });

        const alert1 = await bobTx.run(SELECT.one.from(srv.entities.Alerts).where({ interface_ID: targetInterfaceId, status: 'Open' }));
        assert.ok(alert1);

        // Repeat identical ingestion
        await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            pendingCount: 300,
            failedCount: 50,
            retryAttempts: 250,
            successCount: 0,
            oldestPendingAgeSeconds: 800
        });

        const alert2 = await bobTx.run(SELECT.one.from(srv.entities.Alerts).where({ interface_ID: targetInterfaceId, status: 'Open' }));
        assert.equal(alert2.repeatCount, (alert1.repeatCount || 1) + 1);
    });

    it('T3 Late-Arriving Older Snapshot: Stale telemetry does not corrupt current active alert state', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) });

        // Reset database seed to clean baseline
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');

        // Ingest normal telemetry first
        const nowIso = new Date().toISOString();
        await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: nowIso,
            pendingCount: 5,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 200,
            oldestPendingAgeSeconds: 2
        });

        // Ingest an older late telemetry snapshot from 2 hours ago containing an alert condition
        const pastIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const resStr = await bobTx.send('ingestTelemetry', {
            interfaceId: targetInterfaceId,
            capturedAt: pastIso,
            pendingCount: 400,
            failedCount: 100,
            retryAttempts: 350,
            successCount: 0,
            oldestPendingAgeSeconds: 1500
        });

        const res = JSON.parse(resStr);
        assert.equal(res.status, 'Accepted');
        // Because the older snapshot's capturedAt is in the past, when evaluated with previousSnapshot
        // it creates a historical alert, but does not interfere with the latest observation's non-alerting state.
        // Let's verify latest snapshot remains the normal one.
        const latestSnap = await bobTx.run(SELECT.one.from(srv.entities.QueueSnapshots).where({ interface_ID: targetInterfaceId }).orderBy('capturedAt desc'));
        assert.equal(latestSnap.pendingCount, 5);
    });
});
