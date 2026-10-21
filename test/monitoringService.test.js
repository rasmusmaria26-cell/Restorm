const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');

describe('MonitoringService - Integration, Authorization & Deduplication Tests', () => {
    let srv;
    let targetInterface;

    before(async () => {
        cds.env.requires.db = { kind: 'sqlite', credentials: { url: 'sentinel.db' } };
        const csn = await cds.load('srv/monitoring-service.cds');
        cds.model = csn;
        await cds.connect.to('db');
        srv = await cds.serve('MonitoringService').from('srv/monitoring-service.cds');

        const adminTx = srv.tx({ 
            user: new cds.User({ id: 'admin', roles: ['SupportViewer', 'SupportOperator', 'SimulatorAdmin'] }) 
        });
        const ifaces = await adminTx.run(SELECT.from(srv.entities.Interfaces));
        targetInterface = ifaces[0];
        assert.ok(targetInterface, 'Initial interfaces must be present in database');
    });

    it('T7 Unauthenticated Request: Anonymous client is rejected with 401', async () => {
        await assert.rejects(
            async () => {
                await srv.run(SELECT.from(srv.entities.Interfaces));
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 401, `Expected 401 Unauthorized, received ${code}`);
                return true;
            }
        );
    });

    it('T7 Authenticated Read: Viewer role (alice) can read interfaces', async () => {
        const aliceTx = srv.tx({ 
            user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) 
        });
        const ifaces = await aliceTx.run(SELECT.from(srv.entities.Interfaces));
        assert.ok(Array.isArray(ifaces));
        assert.ok(ifaces.length > 0);
    });

    it('T7 Authorization Check: Viewer role (alice) is forbidden from triggering simulations (403)', async () => {
        const aliceTx = srv.tx({ 
            user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) 
        });
        await assert.rejects(
            async () => {
                await aliceTx.send('triggerSimulation', { scenario: 'NORMAL' });
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 403, `Expected 403 Forbidden, received ${code}`);
                return true;
            }
        );
    });

    it('T2 Simulation & Alert Creation: Operator (bob) triggers RETRY_STORM and generates Critical alert', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        const simRes = await bobTx.send('triggerSimulation', {
            scenario: 'RETRY_STORM',
            interfaceId: targetInterface.ID
        });

        assert.ok(typeof simRes === 'string');
        assert.match(simRes, /EXCESSIVE_RETRIES/);

        // Verify alert in persistence layer
        const alerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({
            interface_ID: targetInterface.ID,
            ruleCode: 'EXCESSIVE_RETRIES',
            status: 'Open'
        }));

        assert.ok(alerts.length >= 1);
        assert.equal(alerts[0].severity, 'Critical');
    });

    it('T6 Alert Deduplication: Consecutive RETRY_STORM triggers update existing alert instead of creating duplicate', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        // Count open alerts before second trigger
        const beforeAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({
            interface_ID: targetInterface.ID,
            ruleCode: 'EXCESSIVE_RETRIES',
            status: 'Open'
        }));
        const countBefore = beforeAlerts.length;
        assert.ok(countBefore >= 1);

        // Trigger simulation again with same scenario on same interface
        const simRes = await bobTx.send('triggerSimulation', {
            scenario: 'RETRY_STORM',
            interfaceId: targetInterface.ID
        });

        assert.match(simRes, /deduplicated/);

        // Count must remain identical (deduplicated)
        const afterAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({
            interface_ID: targetInterface.ID,
            ruleCode: 'EXCESSIVE_RETRIES',
            status: 'Open'
        }));
        assert.equal(afterAlerts.length, countBefore, 'Alert deduplication failed: new row was inserted!');
    });

    it('T5 Recovery Stalled (Rule D): Operator triggers RECOVERY_STALLED and verifies High alert', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        const simRes = await bobTx.send('triggerSimulation', {
            scenario: 'RECOVERY_STALLED',
            interfaceId: targetInterface.ID
        });

        assert.match(simRes, /RECOVERY_STALLED/);

        const stalledAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({
            interface_ID: targetInterface.ID,
            ruleCode: 'RECOVERY_STALLED',
            status: 'Open'
        }));
        assert.ok(stalledAlerts.length >= 1);
        assert.equal(stalledAlerts[0].severity, 'High');
    });

    it('T8 Grounded Explanation: Operator invokes explain() and verifies grounded runbook structure', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        const openAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({ status: 'Open' }));
        assert.ok(openAlerts.length > 0);
        const alertToExplain = openAlerts[0];

        // Call explain action bound to Alert entity with operator context
        const explanationStr = await bobTx.send({
            event: 'explain',
            entity: 'Alerts',
            params: [{ ID: alertToExplain.ID }]
        });

        assert.ok(explanationStr);
        const parsed = typeof explanationStr === 'string' ? JSON.parse(explanationStr) : explanationStr;

        assert.ok(parsed.summary);
        assert.ok(Array.isArray(parsed.possibleHypotheses));
        assert.ok(Array.isArray(parsed.recommendedChecks));
        assert.ok(parsed.limitations);
        assert.ok(Array.isArray(parsed.citedRunbookIds));
    });

    it('Alert Acknowledgment: Operator acknowledges alert and verifies status update', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        const openAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({ status: 'Open' }));
        assert.ok(openAlerts.length > 0);
        const alertToAck = openAlerts[0];

        const ackResult = await bobTx.send({
            event: 'acknowledge',
            entity: 'Alerts',
            params: [{ ID: alertToAck.ID }],
            data: { acknowledgedBy: 'Operator Bob' }
        });

        assert.equal(ackResult.status, 'Acknowledged');
        assert.equal(ackResult.acknowledgedBy, 'Operator Bob');
        assert.ok(ackResult.acknowledgedAt);
    });

    it('Input Validation: Rejects invalid scenario with 400', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        await assert.rejects(
            async () => {
                await bobTx.send('triggerSimulation', { scenario: 'INVALID_ATTACK_SCENARIO' });
            },
            (err) => {
                assert.equal(err.code || err.status, 400);
                assert.match(err.message, /Invalid scenario/);
                return true;
            }
        );
    });

    it('Security Fix: Direct entity insertion on Alerts is rejected (Entity is @readonly)', async () => {
        const aliceTx = srv.tx({ 
            user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) 
        });

        await assert.rejects(
            async () => {
                await aliceTx.run(INSERT.into(srv.entities.Alerts).entries({ ruleCode: 'FORGED_ALERT' }));
            },
            (err) => {
                const code = err.code || err.status;
                assert.ok([403, 405, 400].includes(code) || /readonly|forbidden|not allowed/i.test(err.message), `Expected readonly rejection, got ${code}: ${err.message}`);
                return true;
            }
        );
    });

    it('Audit Protection: Acknowledging an already acknowledged alert is rejected with 409', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        // Find an already acknowledged alert
        const ackedAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({ status: 'Acknowledged' }));
        assert.ok(ackedAlerts.length > 0, 'Must have at least one acknowledged alert');
        const targetAlert = ackedAlerts[0];

        await assert.rejects(
            async () => {
                await bobTx.send({
                    event: 'acknowledge',
                    entity: 'Alerts',
                    params: [{ ID: targetAlert.ID }],
                    data: { acknowledgedBy: 'Malicious Attacker' }
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 409);
                assert.match(err.message, /already in status 'Acknowledged'/);
                return true;
            }
        );
    });

    it('Incident Tracking: Deduplication increments repeatCount', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        // Trigger storm once
        await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: targetInterface.ID });
        const alertFirst = await bobTx.run(SELECT.one.from(srv.entities.Alerts).where({
            interface_ID: targetInterface.ID,
            ruleCode: 'EXCESSIVE_RETRIES',
            status: 'Open'
        }));
        assert.ok(alertFirst);
        const countBefore = alertFirst.repeatCount || 1;

        // Trigger storm second time (deduplicated)
        await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: targetInterface.ID });
        const alertSecond = await bobTx.run(SELECT.one.from(srv.entities.Alerts).where({
            interface_ID: targetInterface.ID,
            ruleCode: 'EXCESSIVE_RETRIES',
            status: 'Open'
        }));
        assert.equal(alertSecond.repeatCount, countBefore + 1);
    });

    it('Deterministic Detection: PERSISTENT_BACKLOG triggers Rule C (OLD_MESSAGE_AGE)', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        // Select an interface that is not targetInterface to test independently
        const ifaces = await bobTx.run(SELECT.from(srv.entities.Interfaces));
        const testIface = ifaces.find(i => i.ID !== targetInterface.ID) || targetInterface;

        await bobTx.send('triggerSimulation', { scenario: 'PERSISTENT_BACKLOG', interfaceId: testIface.ID });
        const alert = await bobTx.run(SELECT.one.from(srv.entities.Alerts).where({
            interface_ID: testIface.ID,
            ruleCode: 'OLD_MESSAGE_AGE',
            status: 'Open'
        }));
        assert.ok(alert, 'Expected OLD_MESSAGE_AGE alert for PERSISTENT_BACKLOG');
        assert.equal(alert.severity, 'High');
    });

    it('Lifecycle Action: Operator (bob) can resolve an acknowledged alert', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        // Find or create an alert and acknowledge it first
        const openAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({ status: 'Acknowledged' }));
        assert.ok(openAlerts.length > 0, 'Must have an acknowledged alert to resolve');
        const targetAlert = openAlerts[0];

        const resolveRes = await bobTx.send({
            event: 'resolveAlert',
            entity: 'Alerts',
            params: [{ ID: targetAlert.ID }],
            data: { resolvedBy: 'Operator Bob' }
        });

        assert.equal(resolveRes.status, 'Resolved');
        assert.equal(resolveRes.resolvedBy, 'Operator Bob');
        assert.ok(resolveRes.resolvedAt);
    });

    it('Lifecycle Protection: Resolving an already resolved alert returns 409', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        const resolvedAlerts = await bobTx.run(SELECT.from(srv.entities.Alerts).where({ status: 'Resolved' }));
        assert.ok(resolvedAlerts.length > 0);
        const targetAlert = resolvedAlerts[0];

        await assert.rejects(
            async () => {
                await bobTx.send({
                    event: 'resolveAlert',
                    entity: 'Alerts',
                    params: [{ ID: targetAlert.ID }],
                    data: { resolvedBy: 'Operator Bob' }
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 409);
                assert.match(err.message, /already in status 'Resolved'/);
                return true;
            }
        );
    });

    it('Authorization Check: Viewer (alice) is forbidden from resolving an alert (403)', async () => {
        const aliceTx = srv.tx({ 
            user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) 
        });

        const allAlerts = await aliceTx.run(SELECT.from(srv.entities.Alerts));
        assert.ok(allAlerts.length > 0);

        await assert.rejects(
            async () => {
                await aliceTx.send({
                    event: 'resolveAlert',
                    entity: 'Alerts',
                    params: [{ ID: allAlerts[0].ID }],
                    data: { resolvedBy: 'Alice' }
                });
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 403);
                return true;
            }
        );
    });

    it('Administrative Action: Admin can reset database to clean baseline seed', async () => {
        const adminTx = srv.tx({ 
            user: new cds.User({ id: 'admin', roles: ['SupportViewer', 'SupportOperator', 'SimulatorAdmin'] }) 
        });

        const resetRes = await adminTx.send('resetToCleanSeed');
        assert.match(resetRes, /Database reset to clean baseline/);

        // Verify all alerts are cleared
        const alertsAfter = await adminTx.run(SELECT.from(srv.entities.Alerts));
        assert.equal(alertsAfter.length, 0);

        // Verify interfaces are initialized with baseline snapshots
        const snapshotsAfter = await adminTx.run(SELECT.from(srv.entities.QueueSnapshots));
        assert.ok(snapshotsAfter.length >= 3);
        assert.equal(snapshotsAfter[0].pendingCount, 8);
        assert.equal(snapshotsAfter[0].failedCount, 0);
    });

    it('Authorization Check: Operator (bob) cannot invoke resetToCleanSeed (403)', async () => {
        const bobTx = srv.tx({ 
            user: new cds.User({ id: 'bob', roles: ['SupportOperator', 'SupportViewer'] }) 
        });

        await assert.rejects(
            async () => {
                await bobTx.send('resetToCleanSeed');
            },
            (err) => {
                const code = err.code || err.status;
                assert.equal(code, 403);
                return true;
            }
        );
    });
});
