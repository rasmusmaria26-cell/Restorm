/**
 * test/qa/incident-lifecycle.test.js
 *
 * Phase 5 Agent 6 — Incident lifecycle tests (backend).
 *
 * Verifies Open -> Acknowledged -> Resolved transitions, 409 on double-ack /
 * double-resolve, 403 for viewer role, and repeatCount increments on repeated
 * simulation. Runs the real CDS MonitoringService against a private copy of
 * sentinel.db.
 *
 * Runs with: node --test test/qa/incident-lifecycle.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { SELECT } = require('@sap/cds').ql;
const { setupTestDb, teardownTestDb, resetToCleanBaseline } = require('./helpers.js');

describe('Incident lifecycle (Open -> Acknowledged -> Resolved)', () => {
    let ctx;

    before(async () => {
        ctx = await setupTestDb();
        await resetToCleanBaseline(ctx);
    });

    after(async () => {
        await teardownTestDb(ctx.tempDb);
    });

    async function createOpenAlert() {
        const bobTx = ctx.bobTx();
        const iface = (await ctx.adminTx().run(SELECT.from('Interfaces')))[0];
        await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
        const rows = await bobTx.run(SELECT.from('Alerts').where({ status: 'Open' }));
        assert.ok(rows.length > 0, 'Expected an Open alert after simulation');
        return rows[0];
    }

    it('acknowledge moves Open -> Acknowledged', async () => {
        const alert = await createOpenAlert();
        const bobTx = ctx.bobTx();
        const result = await bobTx.send({
            event: 'acknowledge',
            entity: 'Alerts',
            params: [{ ID: alert.ID }]
        });
        assert.equal(result.status, 'Acknowledged');
        assert.ok(result.acknowledgedAt);
        assert.equal(result.acknowledgedBy, 'bob');

        const persisted = await bobTx.run(SELECT.from('Alerts').where({ ID: alert.ID }));
        assert.equal(persisted[0].status, 'Acknowledged');
    });

    it('resolve moves Acknowledged -> Resolved', async () => {
        const alert = await createOpenAlert();
        const bobTx = ctx.bobTx();
        await bobTx.send({
            event: 'acknowledge',
            entity: 'Alerts',
            params: [{ ID: alert.ID }]
        });
        const result = await bobTx.send({
            event: 'resolveAlert',
            entity: 'Alerts',
            params: [{ ID: alert.ID }]
        });
        assert.equal(result.status, 'Resolved');
        assert.ok(result.resolvedAt);
        assert.equal(result.resolvedBy, 'bob');
    });

    it('resolve directly on an Open alert is permitted', async () => {
        const alert = await createOpenAlert();
        const bobTx = ctx.bobTx();
        const result = await bobTx.send({
            event: 'resolveAlert',
            entity: 'Alerts',
            params: [{ ID: alert.ID }],
            data: { resolvedBy: 'Bob' }
        });
        assert.equal(result.status, 'Resolved');
    });

    it('double-acknowledge returns 409', async () => {
        const alert = await createOpenAlert();
        const bobTx = ctx.bobTx();
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

    it('double-resolve returns 409', async () => {
        const alert = await createOpenAlert();
        const bobTx = ctx.bobTx();
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

    it('viewer (alice) cannot acknowledge or resolve (403)', async () => {
        const alert = await createOpenAlert();
        await assert.rejects(
            async () => {
                await ctx.aliceTx().send({
                    event: 'acknowledge',
                    entity: 'Alerts',
                    params: [{ ID: alert.ID }],
                    data: { acknowledgedBy: 'Alice' }
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 403);
                return true;
            }
        );
        await assert.rejects(
            async () => {
                await ctx.aliceTx().send({
                    event: 'resolveAlert',
                    entity: 'Alerts',
                    params: [{ ID: alert.ID }],
                    data: { resolvedBy: 'Alice' }
                });
            },
            (err) => {
                assert.equal(err.code || err.status, 403);
                return true;
            }
        );
    });

    it('repeatCount increments when the same scenario repeats (deduplication)', async () => {
        const bobTx = ctx.bobTx();
        const iface = (await ctx.adminTx().run(SELECT.from('Interfaces')))[0];

        await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
        const alertFirst = await bobTx.run(SELECT.one.from('Alerts').where({
            interface_ID: iface.ID,
            ruleCode: 'EXCESSIVE_RETRIES',
            status: 'Open'
        }));
        assert.ok(alertFirst);
        const countBefore = alertFirst.repeatCount || 1;

        await bobTx.send('triggerSimulation', { scenario: 'RETRY_STORM', interfaceId: iface.ID });
        const alertSecond = await bobTx.run(SELECT.one.from('Alerts').where({
            interface_ID: iface.ID,
            ruleCode: 'EXCESSIVE_RETRIES',
            status: 'Open'
        }));
        assert.equal(alertSecond.repeatCount, countBefore + 1, 'repeatCount must increment on duplicate');
    });
});
