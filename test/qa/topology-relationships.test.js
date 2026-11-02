/**
 * test/qa/topology-relationships.test.js
 *
 * Phase 5 Agent 6 — Topology relationship tests.
 *
 * Verifies: 5 systems, 3 connections, correct source/target mapping, and
 * health propagation from edge to node. Uses the real normalizeTopology /
 * buildViewModel transforms and the backend buildTopologyGraph with synthetic
 * data.
 *
 * Runs with: node --test test/qa/topology-relationships.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim } = require('./frontend-helper.js');

installDOMShim();

const topologyService = require('../../srv/core/topologyService.js');
const { buildTopologyGraph, computeEdgeHealth, computeNodeHealth } = topologyService;

let TopologyPage;
let normalizeTopology;
let buildViewModel;
before(async () => {
    TopologyPage = await import('../../app/js/pages/TopologyPage.js');
    normalizeTopology = TopologyPage.normalizeTopology;
    buildViewModel = TopologyPage.buildViewModel;
});

function makeNode(overrides = {}) {
    return {
        id: 'WEBSHOP',
        code: 'WEBSHOP',
        name: 'E-Commerce Webshop',
        category: 'Source',
        environment: 'Synthetic',
        tier: 'Core',
        status: 'Healthy',
        activeAlertCount: 0,
        connectedInterfaceCount: 1,
        ...overrides
    };
}

function makeEdge(overrides = {}) {
    return {
        id: 'edge-1',
        interfaceId: 'iface-1',
        name: 'Order Inbound',
        source: 'WEBSHOP',
        target: 'S4HANA',
        component: 'SAP Cloud Integration (CPI)',
        protocol: 'HTTPS / OData V4',
        connectionType: 'Asynchronous Queue',
        status: 'Healthy',
        metrics: { pendingCount: 5, failedCount: 0, retryAttempts: 1, successCount: 100, oldestPendingAgeSeconds: 30 },
        activeAlertCount: 0,
        activeAlerts: [],
        ...overrides
    };
}

const fiveSystemTopology = {
    generatedAt: '2026-10-30T10:00:00Z',
    summary: { totalSystems: 5, totalConnections: 3, healthyCount: 5, warningCount: 0, criticalCount: 0 },
    nodes: [
        makeNode({ id: 'WEBSHOP', code: 'WEBSHOP', name: 'E-Commerce Webshop', category: 'Source' }),
        makeNode({ id: 'S4HANA', code: 'S4HANA', name: 'SAP S/4HANA', category: 'Target' }),
        makeNode({ id: 'PAYGATE', code: 'PAYGATE', name: 'Payment Gateway', category: 'Target' }),
        makeNode({ id: 'WMS', code: 'WMS', name: 'Warehouse WMS', category: 'Source' }),
        makeNode({ id: 'CPI', code: 'CPI', name: 'SAP BTP Cloud Integration', category: 'Middleware' })
    ],
    edges: [
        makeEdge({ id: 'e1', interfaceId: 'iface-1', source: 'WEBSHOP', target: 'S4HANA', status: 'Healthy' }),
        makeEdge({ id: 'e2', interfaceId: 'iface-2', source: 'S4HANA', target: 'PAYGATE', status: 'Healthy' }),
        makeEdge({ id: 'e3', interfaceId: 'iface-3', source: 'WMS', target: 'CPI', status: 'Healthy' })
    ]
};

describe('Topology structure', () => {
    it('has exactly 5 systems and 3 connections', () => {
        const result = normalizeTopology(fiveSystemTopology);
        assert.equal(result.nodes.length, 5);
        assert.equal(result.edges.length, 3);
        assert.equal(result.summary.totalSystems, 5);
        assert.equal(result.summary.totalConnections, 3);
    });

    it('maps correct source/target for each connection', () => {
        const result = normalizeTopology(fiveSystemTopology);
        const pairs = result.edges.map((e) => [e.source, e.target]);
        assert.ok(pairs.some((p) => p[0] === 'WEBSHOP' && p[1] === 'S4HANA'), 'WEBSHOP -> S4HANA');
        assert.ok(pairs.some((p) => p[0] === 'S4HANA' && p[1] === 'PAYGATE'), 'S4HANA -> PAYGATE');
        assert.ok(pairs.some((p) => p[0] === 'WMS' && p[1] === 'CPI'), 'WMS -> CPI');
    });

    it('each edge carries an interface id and metrics', () => {
        const result = normalizeTopology(fiveSystemTopology);
        for (const edge of result.edges) {
            assert.ok(edge.interfaceId, `edge ${edge.id} missing interfaceId`);
            assert.ok(edge.metrics, `edge ${edge.id} missing metrics`);
            assert.ok(typeof edge.status === 'string');
        }
    });

    it('buildViewModel returns all nodes/edges with no filters', () => {
        const vm = buildViewModel(fiveSystemTopology, {});
        assert.equal(vm.nodes.length, 5);
        assert.equal(vm.edges.length, 3);
    });

    it('node filter keeps selected node and only its connected edges', () => {
        const vm = buildViewModel(fiveSystemTopology, { nodeFilter: { type: 'node', id: 'WEBSHOP', name: 'Webshop' } });
        assert.equal(vm.nodes.length, 1);
        assert.equal(vm.nodes[0].id, 'WEBSHOP');
        assert.equal(vm.edges.length, 1);
        assert.ok(vm.edges[0].source === 'WEBSHOP' || vm.edges[0].target === 'WEBSHOP');
    });
});

describe('Health propagation (edge -> node)', () => {
    it('computeNodeHealth: critical edge makes node critical', () => {
        assert.equal(computeNodeHealth([{ status: 'Critical' }, { status: 'Healthy' }]), 'Critical');
    });

    it('computeNodeHealth: warning edge (no critical) makes node warning', () => {
        assert.equal(computeNodeHealth([{ status: 'Warning' }, { status: 'Healthy' }]), 'Warning');
    });

    it('computeNodeHealth: all healthy edges -> healthy node', () => {
        assert.equal(computeNodeHealth([{ status: 'Healthy' }, { status: 'Healthy' }]), 'Healthy');
    });

    it('computeNodeHealth: no edges -> healthy node', () => {
        assert.equal(computeNodeHealth([]), 'Healthy');
        assert.equal(computeNodeHealth(null), 'Healthy');
        assert.equal(computeNodeHealth(undefined), 'Healthy');
    });

    it('buildTopologyGraph propagates critical edge health to connected nodes', () => {
        const systems = [
            { ID: 's1', code: 'WEBSHOP', name: 'Webshop', category: 'Source' },
            { ID: 's2', code: 'S4HANA', name: 'S4HANA', category: 'Target' }
        ];
        const connections = [
            { ID: 'c1', interface_ID: 'iface-1', sourceSystem_ID: 's1', targetSystem_ID: 's2', component: 'CPI', protocol: 'HTTPS', connectionType: 'Async' }
        ];
        const interfaces = [
            { ID: 'iface-1', name: 'Order Inbound', sourceSystem: 'WEBSHOP', targetSystem: 'S4HANA', maxRetryThreshold: 100, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100 }
        ];
        // Snapshot with retryAttempts >= maxRetryThreshold -> edge Critical.
        const snapshots = [{ interface_ID: 'iface-1', capturedAt: '2026-10-30T10:00:00Z', pendingCount: 5, failedCount: 0, retryAttempts: 150, successCount: 100, oldestPendingAgeSeconds: 30 }];
        const alerts = [];

        const topo = buildTopologyGraph(systems, connections, interfaces, snapshots, alerts);
        assert.equal(topo.nodes.length, 2);
        assert.equal(topo.edges.length, 1);
        const edge = topo.edges[0];
        assert.equal(edge.source, 'WEBSHOP');
        assert.equal(edge.target, 'S4HANA');
        assert.equal(edge.status, 'Critical'); // retry 150 >= threshold 100

        // Both connected nodes should be Critical.
        const webshop = topo.nodes.find((n) => n.id === 'WEBSHOP');
        const s4hana = topo.nodes.find((n) => n.id === 'S4HANA');
        assert.equal(webshop.status, 'Critical');
        assert.equal(s4hana.status, 'Critical');
        assert.equal(topo.summary.criticalCount, 2);
        assert.equal(topo.summary.totalSystems, 2);
        assert.equal(topo.summary.totalConnections, 1);
    });

    it('buildTopologyGraph: healthy snapshot keeps nodes healthy', () => {
        const systems = [
            { ID: 's1', code: 'WEBSHOP', name: 'Webshop', category: 'Source' },
            { ID: 's2', code: 'S4HANA', name: 'S4HANA', category: 'Target' }
        ];
        const connections = [
            { ID: 'c1', interface_ID: 'iface-1', sourceSystem_ID: 's1', targetSystem_ID: 's2', component: 'CPI', protocol: 'HTTPS', connectionType: 'Async' }
        ];
        const interfaces = [
            { ID: 'iface-1', name: 'Order Inbound', sourceSystem: 'WEBSHOP', targetSystem: 'S4HANA', maxRetryThreshold: 100, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600, recoveryStalledBacklog: 100 }
        ];
        const snapshots = [{ interface_ID: 'iface-1', capturedAt: 't', pendingCount: 5, failedCount: 0, retryAttempts: 1, successCount: 100, oldestPendingAgeSeconds: 30 }];
        const alerts = [];

        const topo = buildTopologyGraph(systems, connections, interfaces, snapshots, alerts);
        assert.equal(topo.edges[0].status, 'Healthy');
        assert.equal(topo.summary.healthyCount, 2);
        assert.equal(topo.summary.criticalCount, 0);
    });

    it('normalizeTopology handles empty/malformed topology', () => {
        const empty = normalizeTopology(null);
        assert.equal(empty.nodes.length, 0);
        assert.equal(empty.edges.length, 0);
        const malformed = normalizeTopology('{ not json');
        assert.equal(malformed.nodes.length, 0);
        const scalar = normalizeTopology(42);
        assert.equal(scalar.nodes.length, 0);
    });
});
