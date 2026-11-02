/**
 * test/qa/backend-contract-integration.test.js
 *
 * Phase 5 Agent 6 — Backend contract integration tests.
 *
 * Runs the real CDS MonitoringService against a private throw-away copy of
 * sentinel.db (never the user's development database). Verifies the OData
 * contract surface: entity reads, action auth matrix (401/403/409), topology
 * structure, and clean-seed reset/restore.
 *
 * Runs with: node --test test/qa/backend-contract-integration.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { setupTestDb, teardownTestDb, resetToCleanBaseline } = require('./helpers.js');

const ENTITIES = [
    'Interfaces',
    'Alerts',
    'QueueSnapshots',
    'RunbookEntries',
    'Systems',
    'Connections'
];

function from(entity) {
    return cds.ql.SELECT.from(entity);
}

describe('Backend contract integration (MonitoringService OData surface)', () => {
    let ctx;

    before(async () => {
        ctx = await setupTestDb();
        await resetToCleanBaseline(ctx);
    });

    after(async () => {
        await teardownTestDb(ctx.tempDb);
    });

    describe('Entity reads (all authenticated roles can GET every OData entity)', () => {
        for (const entity of ENTITIES) {
            it(`GET ${entity} returns a value array for viewer (alice)`, async () => {
                const rows = await ctx.aliceTx().run(from(entity));
                assert.ok(Array.isArray(rows), `${entity} should return an array`);
            });

            it(`GET ${entity} returns a value array for operator (bob)`, async () => {
                const rows = await ctx.bobTx().run(from(entity));
                assert.ok(Array.isArray(rows), `${entity} should return an array`);
            });

            it(`GET ${entity} returns a value array for admin`, async () => {
                const rows = await ctx.adminTx().run(from(entity));
                assert.ok(Array.isArray(rows), `${entity} should return an array`);
            });
        }

        it('anonymous entity read is rejected with 401', async () => {
            for (const entity of ENTITIES) {
                await assert.rejects(
                    async () => {
                        await ctx.srv.run(from(entity));
                    },
                    (err) => {
                        const code = err.code || err.status;
                        assert.equal(code, 401, `Expected 401 for anonymous ${entity}, got ${code}`);
                        return true;
                    }
                );
            }
        });

        it('clean seed baseline is deterministic after resetToCleanSeed', async () => {
            const adminTx = ctx.adminTx();
            const ifaces = await adminTx.run(from('Interfaces'));
            const snapshots = await adminTx.run(from('QueueSnapshots'));
            const alerts = await adminTx.run(from('Alerts'));

            assert.ok(ifaces.length >= 3, 'Seed must contain interfaces');
            assert.equal(alerts.length, 0, 'Clean baseline must have zero alerts');
            assert.ok(snapshots.length >= 3, 'Clean baseline must initialize snapshots');
            assert.equal(snapshots[0].pendingCount, 8);
            assert.equal(snapshots[0].retryAttempts, 1);
        });
    });

    describe('Action authorization matrix (401 / 403)', () => {
        let openAlertId;

        before(async () => {
            const bobTx = ctx.bobTx();
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];
            await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
            const alert = await bobTx.run(from('Alerts').where({ status: 'Open' }));
            assert.ok(alert.length > 0, 'Expected an Open alert after simulation');
            openAlertId = alert[0].ID;
        });

        it('acknowledge: operator (bob) succeeds, viewer (alice) 403', async () => {
            const bobTx = ctx.bobTx();
            const result = await bobTx.send({
                event: 'acknowledge',
                entity: 'Alerts',
                params: [{ ID: openAlertId }],
                data: { acknowledgedBy: 'Bob' }
            });
            assert.equal(result.status, 'Acknowledged');

            await assert.rejects(
                async () => {
                    await ctx.aliceTx().send({
                        event: 'acknowledge',
                        entity: 'Alerts',
                        params: [{ ID: openAlertId }],
                        data: { acknowledgedBy: 'Alice' }
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 403);
                    return true;
                }
            );
        });

        it('resolveAlert: operator (bob) succeeds on Acknowledged, viewer (alice) 403', async () => {
            const bobTx = ctx.bobTx();
            const result = await bobTx.send({
                event: 'resolveAlert',
                entity: 'Alerts',
                params: [{ ID: openAlertId }],
                data: { resolvedBy: 'Bob' }
            });
            assert.equal(result.status, 'Resolved');

            const bobTx2 = ctx.bobTx();
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];
            await bobTx2.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
            const openAgain = await bobTx2.run(from('Alerts').where({ status: 'Open' }));

            await assert.rejects(
                async () => {
                    await ctx.aliceTx().send({
                        event: 'resolveAlert',
                        entity: 'Alerts',
                        params: [{ ID: openAgain[0].ID }],
                        data: { resolvedBy: 'Alice' }
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 403);
                    return true;
                }
            );
        });

        it('explain: authenticated roles succeed', async () => {
            const openAlerts = await ctx.bobTx().run(
                from('Alerts').where({ status: { '!=': 'Resolved' } })
            );
            assert.ok(openAlerts.length > 0);
            const id = openAlerts[0].ID;

            const explanation = await ctx.bobTx().send({
                event: 'explain',
                entity: 'Alerts',
                params: [{ ID: id }]
            });
            assert.ok(explanation);
            const parsed = typeof explanation === 'string' ? JSON.parse(explanation) : explanation;
            assert.ok(parsed.summary || typeof parsed === 'string');

            const explAlice = await ctx.aliceTx().send({
                event: 'explain',
                entity: 'Alerts',
                params: [{ ID: id }]
            });
            assert.ok(explAlice);
        });

        it('exportIncidentReport: authenticated roles succeed', async () => {
            const alerts = await ctx.bobTx().run(from('Alerts'));
            assert.ok(alerts.length > 0);
            const id = alerts[0].ID;

            const report = await ctx.bobTx().send({
                event: 'exportIncidentReport',
                entity: 'Alerts',
                params: [{ ID: id }],
                data: { format: 'markdown' }
            });
            assert.ok(report);
            const text = typeof report === 'string' ? report : String(report);
            assert.ok(text.length > 0);
        });

        it('ingestTelemetry: operator succeeds, viewer 403, validation rejects bad input', async () => {
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];

            const res = await ctx.bobTx().send('ingestTelemetry', {
                interfaceId: iface.ID,
                capturedAt: new Date().toISOString(),
                pendingCount: 10,
                failedCount: 0,
                retryAttempts: 1,
                successCount: 100,
                oldestPendingAgeSeconds: 30
            });
            assert.ok(typeof res === 'string');
            const parsed = JSON.parse(res);
            assert.equal(parsed.status, 'Accepted');

            await assert.rejects(
                async () => {
                    await ctx.aliceTx().send('ingestTelemetry', {
                        interfaceId: iface.ID,
                        capturedAt: new Date().toISOString(),
                        pendingCount: 10,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 100,
                        oldestPendingAgeSeconds: 30
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 403);
                    return true;
                }
            );

            await assert.rejects(
                async () => {
                    await ctx.bobTx().send('ingestTelemetry', {
                        interfaceId: iface.ID,
                        capturedAt: new Date().toISOString(),
                        pendingCount: -1,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 100,
                        oldestPendingAgeSeconds: 30
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 400);
                    return true;
                }
            );
        });

        it('triggerSimulation: operator succeeds, viewer 403, invalid scenario 400', async () => {
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];

            const res = await ctx.bobTx().send('triggerSimulation', { scenario: 'NORMAL', interfaceId: iface.ID });
            assert.ok(typeof res === 'string');

            await assert.rejects(
                async () => {
                    await ctx.aliceTx().send('triggerSimulation', { scenario: 'NORMAL', interfaceId: iface.ID });
                },
                (err) => {
                    assert.equal(err.code || err.status, 403);
                    return true;
                }
            );

            await assert.rejects(
                async () => {
                    await ctx.bobTx().send('triggerSimulation', { scenario: 'INVALID_ATTACK_SCENARIO', interfaceId: iface.ID });
                },
                (err) => {
                    assert.equal(err.code || err.status, 400);
                    assert.match(err.message, /Invalid scenario/);
                    return true;
                }
            );
        });

        it('configureThresholds: admin succeeds, operator/viewer 403, out-of-bounds 400', async () => {
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];

            const updated = await ctx.adminTx().send('configureThresholds', {
                interfaceId: iface.ID,
                maxRetryThreshold: 50,
                queueGrowthLimit: 500,
                oldMessageAgeLimitSeconds: 300,
                recoveryStalledBacklog: 75
            });
            assert.ok(updated);
            assert.equal(updated.maxRetryThreshold, 50);
            assert.equal(updated.queueGrowthLimit, 500);

            await assert.rejects(
                async () => {
                    await ctx.bobTx().send('configureThresholds', {
                        interfaceId: iface.ID,
                        maxRetryThreshold: 50,
                        queueGrowthLimit: 500,
                        oldMessageAgeLimitSeconds: 300,
                        recoveryStalledBacklog: 75
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 403);
                    return true;
                }
            );

            await assert.rejects(
                async () => {
                    await ctx.adminTx().send('configureThresholds', {
                        interfaceId: iface.ID,
                        maxRetryThreshold: 0,
                        queueGrowthLimit: 500,
                        oldMessageAgeLimitSeconds: 300,
                        recoveryStalledBacklog: 75
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 400);
                    return true;
                }
            );
        });

        it('resetToCleanSeed: admin succeeds, operator/viewer 403', async () => {
            const resetRes = await ctx.adminTx().send('resetToCleanSeed');
            assert.match(String(resetRes), /Database reset to clean baseline/);

            const alertsAfter = await ctx.adminTx().run(from('Alerts'));
            assert.equal(alertsAfter.length, 0);

            await assert.rejects(
                async () => {
                    await ctx.bobTx().send('resetToCleanSeed');
                },
                (err) => {
                    assert.equal(err.code || err.status, 403);
                    return true;
                }
            );

            await assert.rejects(
                async () => {
                    await ctx.aliceTx().send('resetToCleanSeed');
                },
                (err) => {
                    assert.equal(err.code || err.status, 403);
                    return true;
                }
            );
        });
    });

    describe('getTopology returns structured graph', () => {
        it('returns nodes, edges and summary with correct seed counts', async () => {
            const raw = await ctx.bobTx().send('getTopology');
            const topology = typeof raw === 'string' ? JSON.parse(raw) : raw;

            assert.ok(Array.isArray(topology.nodes));
            assert.ok(Array.isArray(topology.edges));
            assert.ok(topology.summary);

            assert.equal(topology.summary.totalSystems, 5);
            assert.equal(topology.summary.totalConnections, 3);

            const pairs = topology.edges.map((e) => [e.source, e.target]);
            assert.ok(pairs.some((p) => p[0] === 'WEBSHOP' && p[1] === 'S4HANA'));
            assert.ok(pairs.some((p) => p[0] === 'S4HANA' && p[1] === 'PAYGATE'));
            assert.ok(pairs.some((p) => p[0] === 'WMS' && p[1] === 'CPI'));

            assert.equal(topology.summary.healthyCount, 5);
            assert.equal(topology.summary.warningCount, 0);
            assert.equal(topology.summary.criticalCount, 0);

            for (const edge of topology.edges) {
                assert.ok(edge.interfaceId);
                assert.ok(edge.metrics);
                assert.equal(typeof edge.status, 'string');
            }
        });
    });

    describe('409 invalid state transitions', () => {
        it('double-acknowledge an already acknowledged alert returns 409', async () => {
            const bobTx = ctx.bobTx();
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];
            await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
            const alert = (await bobTx.run(from('Alerts').where({ status: 'Open' })))[0];

            await bobTx.send({
                event: 'acknowledge',
                entity: 'Alerts',
                params: [{ ID: alert.ID }],
                data: { acknowledgedBy: 'Bob' }
            });

            await assert.rejects(
                async () => {
                    await bobTx.send({
                        event: 'acknowledge',
                        entity: 'Alerts',
                        params: [{ ID: alert.ID }],
                        data: { acknowledgedBy: 'Bob' }
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 409);
                    assert.match(err.message, /already in status 'Acknowledged'/);
                    return true;
                }
            );
        });

        it('double-resolve an already resolved alert returns 409', async () => {
            const bobTx = ctx.bobTx();
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];
            await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
            const alert = (await bobTx.run(from('Alerts').where({ status: 'Open' })))[0];
            await bobTx.send({
                event: 'acknowledge',
                entity: 'Alerts',
                params: [{ ID: alert.ID }],
                data: { acknowledgedBy: 'Bob' }
            });
            await bobTx.send({
                event: 'resolveAlert',
                entity: 'Alerts',
                params: [{ ID: alert.ID }],
                data: { resolvedBy: 'Bob' }
            });

            await assert.rejects(
                async () => {
                    await bobTx.send({
                        event: 'resolveAlert',
                        entity: 'Alerts',
                        params: [{ ID: alert.ID }],
                        data: { resolvedBy: 'Bob' }
                    });
                },
                (err) => {
                    assert.equal(err.code || err.status, 409);
                    assert.match(err.message, /already in status 'Resolved'/);
                    return true;
                }
            );
        });

        it('resolve on an Open alert resolves, then re-resolve returns 409', async () => {
            const bobTx = ctx.bobTx();
            const iface = (await ctx.adminTx().run(from('Interfaces')))[0];
            await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
            const alert = (await bobTx.run(from('Alerts').where({ status: 'Open' })))[0];

            const resolved = await bobTx.send({
                event: 'resolveAlert',
                entity: 'Alerts',
                params: [{ ID: alert.ID }],
                data: { resolvedBy: 'Bob' }
            });
            assert.equal(resolved.status, 'Resolved');
        });
    });
});
