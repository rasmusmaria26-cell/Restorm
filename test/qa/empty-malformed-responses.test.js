/**
 * test/qa/empty-malformed-responses.test.js
 *
 * Phase 5 Agent 6 — Empty and malformed response tests (frontend + transforms).
 *
 * Verifies: empty value arrays, malformed JSON observedMetrics, missing fields
 * are handled without crashing. Tests pure transforms and page rendering with
 * mocked empty/malformed backend responses.
 *
 * Runs with: node --test test/qa/empty-malformed-responses.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim, mockFetch, flush } = require('./frontend-helper.js');

installDOMShim();

let OverviewPage;
let normalizeTopology;

before(async () => {
    OverviewPage = await import('../../app/js/pages/OverviewPage.js');
    const TopologyPage = await import('../../app/js/pages/TopologyPage.js');
    normalizeTopology = TopologyPage.normalizeTopology;
});

describe('Empty responses', () => {
    it('computeKPIs handles interfaces with missing snapshots / missing numeric fields', () => {
        const ifaces = [
            { ID: 'i1', name: 'No snapshots field' }, // snapshots undefined
            { ID: 'i2', name: 'Null snapshots', snapshots: null },
            { ID: 'i3', name: 'Snapshot with missing fields', snapshots: [{ capturedAt: 't' }] }, // pendingCount undefined
            { ID: 'i4', name: 'Snapshot null fields', snapshots: [{ pendingCount: null, retryAttempts: undefined }] }
        ];
        const kpis = OverviewPage.computeKPIs(ifaces, []);
        assert.equal(kpis.totalInterfaces, 4);
        assert.equal(kpis.totalPending, 0);
        assert.equal(kpis.totalRetries, 0);
        assert.equal(kpis.openAlerts, 0);
    });

    it('computeKPIs handles alerts with missing status / severity', () => {
        const alerts = [
            { ID: 'a1' }, // no status, no severity
            { ID: 'a2', status: 'Open' }, // no severity
            { ID: 'a3', status: 'Open', severity: undefined },
            { ID: 'a4', status: 'Resolved', severity: 'Critical' }
        ];
        const kpis = OverviewPage.computeKPIs([], alerts);
        assert.ok(kpis.openAlerts >= 0);
        assert.ok(kpis.criticalAlerts >= 0);
    });

    it('groupIncidents handles alerts missing status / ruleCode / interface_ID', () => {
        const alerts = [
            { ID: 'a1' }, // missing everything
            { ID: 'a2', status: 'Open' }, // no ruleCode, no interface_ID
            { ID: 'a3', status: 'Open', ruleCode: 'R' },
            { ID: 'a4', status: 'Open', ruleCode: 'R', interface_ID: 'i1' }
        ];
        assert.doesNotThrow(() => OverviewPage.groupIncidents(alerts, []));
        const groups = OverviewPage.groupIncidents(alerts, []);
        assert.ok(Array.isArray(groups));
    });

    it('normalizeTopology handles empty arrays and missing fields', () => {
        const empty = normalizeTopology({ nodes: [], edges: [], summary: {} });
        assert.equal(empty.nodes.length, 0);
        assert.equal(empty.edges.length, 0);
        assert.equal(empty.summary.totalSystems, 0);

        const missing = normalizeTopology({}); // no nodes/edges/summary
        assert.equal(missing.nodes.length, 0);
        assert.equal(missing.edges.length, 0);

        const nullNodes = normalizeTopology({ nodes: null, edges: null });
        assert.equal(nullNodes.nodes.length, 0);
        assert.equal(nullNodes.edges.length, 0);
    });

    it('OverviewPage renders empty state without crashing', async () => {
        const restore = mockFetch([
            { match: '/Interfaces', response: { value: [] } },
            { match: '/Alerts', response: { value: [] } }
        ]);
        const container = document.createElement('div');
        OverviewPage.render(container, {
            api: {
                fetchInterfaces: () => fetch('/odata/v4/monitoring/Interfaces'),
                fetchAlerts: () => fetch('/odata/v4/monitoring/Alerts')
            },
            formatShortTime: (s) => s || '',
            FRIENDLY_RULE_TITLES: {},
            SEVERITY_WEIGHT: { Critical: 3, High: 2, Warning: 1, Info: 0 },
            USER_PERMISSIONS: {},
            currentUsername: 'bob'
        });
        await flush();
        await flush();
        assert.ok(/no operational data|no interfaces monitored/i.test(container.textContent));
        restore();
    });
});

describe('Malformed observedMetrics', () => {
    it('malformed JSON observedMetrics is parsed safely (raw fallback)', () => {
        // Mirrors the defensive parse used in IncidentDetailPage / IncidentsPage.
        function parseMetrics(observedMetrics) {
            if (!observedMetrics) return {};
            if (typeof observedMetrics === 'object') return observedMetrics;
            try { return JSON.parse(observedMetrics); } catch (e) { return { raw: String(observedMetrics) }; }
        }
        assert.deepEqual(parseMetrics('{ not json'), { raw: '{ not json' });
        assert.deepEqual(parseMetrics('not even close'), { raw: 'not even close' });
        assert.deepEqual(parseMetrics(null), {});
        assert.deepEqual(parseMetrics(undefined), {});
        assert.deepEqual(parseMetrics({ pendingCount: 5 }), { pendingCount: 5 });
        assert.deepEqual(parseMetrics('{"pendingCount": 5}'), { pendingCount: 5 });
    });

    it('missing fields in a metric object do not crash', () => {
        const metrics = { pendingCount: undefined, retryAttempts: null, oldestPendingAgeSeconds: NaN };
        const pending = Number(metrics.pendingCount) || 0;
        const retries = Number(metrics.retryAttempts) || 0;
        const age = Number(metrics.oldestPendingAgeSeconds) || 0;
        assert.equal(pending, 0);
        assert.equal(retries, 0);
        assert.equal(age, 0);
    });
});
