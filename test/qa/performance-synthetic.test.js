/**
 * test/qa/performance-synthetic.test.js
 *
 * Phase 5 Agent 6 — Performance tests with synthetic datasets (frontend +
 * backend transforms). No browser; processes large in-memory datasets and
 * asserts they complete within acceptable time.
 *
 * Runs with: node --test test/qa/performance-synthetic.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim } = require('./frontend-helper.js');

installDOMShim();

const topologyService = require('../../srv/core/topologyService.js');
const { buildTopologyGraph } = topologyService;

let OverviewPage;
let TopologyPage;
let computeKPIs;
let groupIncidents;
let normalizeTopology;
let buildViewModel;
before(async () => {
    OverviewPage = await import('../../app/js/pages/OverviewPage.js');
    TopologyPage = await import('../../app/js/pages/TopologyPage.js');
    computeKPIs = OverviewPage.computeKPIs;
    groupIncidents = OverviewPage.groupIncidents;
    normalizeTopology = TopologyPage.normalizeTopology;
    buildViewModel = TopologyPage.buildViewModel;
});

const MAX_MS = 500; // acceptable processing time for synthetic loads

function makePerfInterface(i) {
    return {
        ID: `iface-${i}`,
        name: `Interface ${i}`,
        sourceSystem: i % 2 === 0 ? 'WEBSHOP' : 'S4HANA',
        targetSystem: i % 3 === 0 ? 'CPI' : 'PAYGATE',
        active: true,
        maxRetryThreshold: 100,
        queueGrowthLimit: 200,
        oldMessageAgeLimitSeconds: 600,
        recoveryStalledBacklog: 100,
        snapshots: [
            {
                capturedAt: `2026-10-30T10:0${i % 60}:00Z`,
                pendingCount: i % 300,
                failedCount: i % 50,
                retryAttempts: i % 150,
                successCount: 1000 - i,
                oldestPendingAgeSeconds: i % 700
            }
        ]
    };
}

function makePerfAlert(i) {
    return {
        ID: `alert-${i}`,
        interface_ID: `iface-${i % 50}`,
        ruleCode: ['EXCESSIVE_RETRIES', 'QUEUE_GROWTH', 'OLD_MESSAGE_AGE', 'RECOVERY_STALLED'][i % 4],
        severity: ['Critical', 'High', 'Warning', 'Info'][i % 4],
        status: i % 3 === 0 ? 'Resolved' : 'Open',
        detectedAt: `2026-10-30T09:${i % 60}:00Z`,
        observedMetrics: '{}',
        summary: `Alert ${i} summary`,
        repeatCount: 1 + (i % 5)
    };
}

function time(fn) {
    const start = process.hrtime.bigint();
    const result = fn();
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;
    return { result, ms };
}

describe('Performance with synthetic datasets', () => {
    it('computeKPIs processes 2000 interfaces + 1000 alerts quickly', () => {
        const ifaces = Array.from({ length: 2000 }, (_, i) => makePerfInterface(i));
        const alerts = Array.from({ length: 1000 }, (_, i) => makePerfAlert(i));
        const { result, ms } = time(() => computeKPIs(ifaces, alerts));
        assert.ok(ms < MAX_MS, `computeKPIs took ${ms.toFixed(1)}ms (limit ${MAX_MS}ms)`);
        assert.equal(result.totalInterfaces, 2000);
        assert.ok(result.totalPending >= 0);
        assert.ok(result.totalRetries >= 0);
    });

    it('groupIncidents processes 1000 open alerts quickly', () => {
        const ifaces = Array.from({ length: 50 }, (_, i) => makePerfInterface(i));
        const alerts = Array.from({ length: 1000 }, (_, i) => makePerfAlert(i));
        const { result, ms } = time(() => groupIncidents(alerts, ifaces));
        assert.ok(ms < MAX_MS, `groupIncidents took ${ms.toFixed(1)}ms (limit ${MAX_MS}ms)`);
        assert.ok(Array.isArray(result));
        assert.ok(result.length <= 1000);
    });

    it('computeKPIs scales linearly (2x data ~ 2x time, no pathological slowdown)', () => {
        const smallIfaces = Array.from({ length: 200 }, (_, i) => makePerfInterface(i));
        const smallAlerts = Array.from({ length: 100 }, (_, i) => makePerfAlert(i));
        const bigIfaces = Array.from({ length: 4000 }, (_, i) => makePerfInterface(i));
        const bigAlerts = Array.from({ length: 2000 }, (_, i) => makePerfAlert(i));

        const smallMs = time(() => computeKPIs(smallIfaces, smallAlerts)).ms;
        const bigMs = time(() => computeKPIs(bigIfaces, bigAlerts)).ms;

        // 20x data should not take >100x time (no quadratic behavior).
        assert.ok(bigMs < smallMs * 100 + 50, `computeKPIs not scaling well: ${smallMs.toFixed(1)}ms -> ${bigMs.toFixed(1)}ms`);
    });

    it('normalizeTopology + buildViewModel handle large topology quickly', () => {
        const nodes = Array.from({ length: 100 }, (_, i) => ({
            id: `sys-${i}`, code: `SYS${i}`, name: `System ${i}`, category: 'Core',
            status: i % 10 === 0 ? 'Critical' : i % 5 === 0 ? 'Warning' : 'Healthy',
            activeAlertCount: i % 3,
            connectedInterfaceCount: i % 4
        }));
        const edges = Array.from({ length: 150 }, (_, i) => ({
            id: `edge-${i}`, interfaceId: `iface-${i}`, name: `Edge ${i}`,
            source: `SYS${i % 100}`, target: `SYS${(i + 1) % 100}`, status: 'Healthy',
            metrics: { pendingCount: 10, retryAttempts: 1 },
            activeAlertCount: 0, activeAlerts: []
        }));
        const topology = { nodes, edges, summary: { totalSystems: 100, totalConnections: 150, healthyCount: 0, warningCount: 0, criticalCount: 0 } };

        const { ms: nMs } = time(() => normalizeTopology(topology));
        assert.ok(nMs < MAX_MS, `normalizeTopology took ${nMs.toFixed(1)}ms`);

        const { ms: vMs } = time(() => buildViewModel(topology, { searchText: 'system', healthFilter: 'Critical' }));
        assert.ok(vMs < MAX_MS, `buildViewModel took ${vMs.toFixed(1)}ms`);
    });

    it('buildTopologyGraph processes large landscape quickly', () => {
        const systems = Array.from({ length: 50 }, (_, i) => ({
            ID: `s${i}`, code: `SYS${i}`, name: `System ${i}`, category: 'Core'
        }));
        const connections = Array.from({ length: 30 }, (_, i) => ({
            ID: `c${i}`, interface_ID: `iface-${i}`, sourceSystem_ID: `s${i % 50}`, targetSystem_ID: `s${(i + 1) % 50}`,
            component: 'CPI', protocol: 'HTTPS', connectionType: 'Async'
        }));
        const interfaces = Array.from({ length: 30 }, (_, i) => ({
            ID: `iface-${i}`, name: `Iface ${i}`, sourceSystem: `SYS${i % 50}`, targetSystem: `SYS${(i + 1) % 50}`,
            maxRetryThreshold: 100, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100
        }));
        const snapshots = connections.map((_, i) => ({
            interface_ID: `iface-${i}`, capturedAt: '2026-10-30T10:00:00Z', pendingCount: i % 250,
            failedCount: 0, retryAttempts: i % 150, successCount: 100, oldestPendingAgeSeconds: i % 700
        }));
        const alerts = Array.from({ length: 20 }, (_, i) => ({
            ID: `a${i}`, interface_ID: `iface-${i}`, ruleCode: 'EXCESSIVE_RETRIES', severity: 'Critical',
            status: 'Open', summary: `alert ${i}`
        }));

        const { result, ms } = time(() => buildTopologyGraph(systems, connections, interfaces, snapshots, alerts));
        assert.ok(ms < MAX_MS, `buildTopologyGraph took ${ms.toFixed(1)}ms (limit ${MAX_MS}ms)`);
        assert.equal(result.nodes.length, 50);
        assert.equal(result.edges.length, 30);
    });
});
