const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');

describe('Incident Report Export (Phase 3)', () => {
    let srv;
    let testAlertId;
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

        // Create an alert using simulation
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator'] }) });
        await bobTx.send('triggerSimulation', { interfaceId: targetInterface.ID, scenario: 'RETRY_STORM' });

        const openAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts));
        assert.ok(openAlerts.length > 0, 'Must have at least one alert generated');
        testAlertId = openAlerts[0].ID;

        // Acknowledge and resolve the alert
        await bobTx.send({
            event: 'acknowledge',
            entity: 'Alerts',
            params: [{ ID: testAlertId }],
            data: { acknowledgedBy: 'Incident Commander Bob' }
        });

        await bobTx.send({
            event: 'resolveAlert',
            entity: 'Alerts',
            params: [{ ID: testAlertId }],
            data: { resolvedBy: 'SRE Lead Alice' }
        });
    });

    after(async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');
    });

    it('T1 Markdown Export: Successfully generates structured Markdown postmortem report', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        const report = await aliceTx.send({
            event: 'exportIncidentReport',
            entity: 'Alerts',
            params: [{ ID: testAlertId }],
            data: { format: 'markdown' }
        });

        assert.ok(report, 'Report string must not be empty');
        assert.match(report, /# INCIDENT POSTMORTEM REPORT: EXCESSIVE_RETRIES/);
        assert.match(report, /Executive Summary/);
        assert.match(report, /Incident Timeline & Audit Trail/);
        assert.match(report, /Incident Commander Bob/);
        assert.match(report, /SRE Lead Alice/);
        assert.match(report, /Telemetry Evidence at Incident Peak/);
        assert.match(report, /Root Cause Analysis/);
        assert.match(report, /Prevention & Governance/);
    });

    it('T2 JSON Export: Successfully exports structured audit JSON payload', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator'] }) });
        const jsonStr = await bobTx.send({
            event: 'exportIncidentReport',
            entity: 'Alerts',
            params: [{ ID: testAlertId }],
            data: { format: 'json' }
        });

        const data = JSON.parse(jsonStr);
        assert.equal(data.reportType, 'IncidentPostmortem');
        assert.equal(data.alertId, testAlertId);
        assert.equal(data.ruleCode, 'EXCESSIVE_RETRIES');
        assert.equal(data.status, 'Resolved');
        assert.equal(data.acknowledgedBy, 'Incident Commander Bob');
        assert.equal(data.resolvedBy, 'SRE Lead Alice');
        assert.ok(data.observedMetrics);
        assert.ok(data.interface);
    });

    it('T3 Audit Access: SupportViewer (alice) can export reports without modification roles', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        const report = await aliceTx.send({
            event: 'exportIncidentReport',
            entity: 'Alerts',
            params: [{ ID: testAlertId }],
            data: { format: 'markdown' }
        });

        assert.match(report, /Enterprise Operational Governance/);
    });

    it('T4 Validation: Rejects invalid alert ID with 404', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        await assert.rejects(
            async () => {
                await aliceTx.send({
                    event: 'exportIncidentReport',
                    entity: 'Alerts',
                    params: [{ ID: '99999999-9999-9999-9999-999999999999' }],
                    data: { format: 'markdown' }
                });
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 404);
                return true;
            }
        );
    });
});
