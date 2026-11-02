/**
 * test/frontend/topology-graph.test.js
 *
 * Frontend unit tests for the Integration Topology data transformations
 * (normalizeTopology, buildViewModel) exported by TopologyPage.js.
 *
 * Uses synthetic data matching the actual getTopology() backend contract:
 * { generatedAt, summary:{totalSystems,totalConnections,healthyCount,warningCount,criticalCount},
 *   nodes:[{id,name,category,environment,tier,status,activeAlertCount,connectedInterfaceCount}],
 *   edges:[{id,interfaceId,name,source,target,component,protocol,connectionType,status,metrics:{...},activeAlertCount,activeAlerts:[{id,ruleCode,severity,summary,repeatCount}]}] }
 *
 * Run with: node --test test/frontend/topology-graph.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM shim so shared components (LoadingState) that touch `document`
// at module load time can be imported in a Node test environment.
// Test-only; production code is unchanged.
if (typeof globalThis.document === 'undefined') {
    const styleEl = { };
    globalThis.document = {
        getElementById: () => null,
        createElement: () => ({
            setAttribute: () => {},
            appendChild: () => {},
            style: {},
            textContent: ''
        }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
    };
}

const TopologyPage = await import('../../app/js/pages/TopologyPage.js');
const { normalizeTopology, buildViewModel } = TopologyPage;

/* ------------------------------------------------------------------ */
/* Synthetic fixtures                                                 */
/* ------------------------------------------------------------------ */

function makeEdge(overrides = {}) {
    return {
        id: 'edge-1',
        interfaceId: 'iface-1',
        name: 'Order Inbound (S/4HANA)',
        source: 'WEBSHOP',
        target: 'S4HANA',
        component: 'SAP Cloud Integration (CPI)',
        protocol: 'HTTPS / OData V4',
        connectionType: 'Asynchronous Queue',
        status: 'Healthy',
        metrics: {
            pendingCount: 5,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 100,
            oldestPendingAgeSeconds: 30,
            capturedAt: '2026-10-30T10:00:00Z'
        },
        activeAlertCount: 0,
        activeAlerts: [],
        ...overrides
    };
}

function makeNode(overrides = {}) {
    return {
        id: 'WEBSHOP',
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

const healthyTopology = {
    generatedAt: '2026-10-30T10:00:00Z',
    summary: {
        totalSystems: 5,
        totalConnections: 3,
        healthyCount: 5,
        warningCount: 0,
        criticalCount: 0
    },
    nodes: [
        makeNode({ id: 'WEBSHOP', name: 'E-Commerce Webshop', status: 'Healthy', connectedInterfaceCount: 1 }),
        makeNode({ id: 'S4HANA', name: 'SAP S/4HANA', status: 'Healthy', connectedInterfaceCount: 2 }),
        makeNode({ id: 'PAYGATE', name: 'Payment Gateway', status: 'Healthy', connectedInterfaceCount: 1 }),
        makeNode({ id: 'WMS', name: 'Warehouse WMS', status: 'Healthy', connectedInterfaceCount: 1 }),
        makeNode({ id: 'CPI', name: 'SAP BTP Cloud Integration', status: 'Healthy', connectedInterfaceCount: 3 })
    ],
    edges: [
        makeEdge({ interfaceId: 'iface-1', name: 'Order Inbound (S/4HANA)', source: 'WEBSHOP', target: 'S4HANA', status: 'Healthy', activeAlertCount: 0 }),
        makeEdge({ interfaceId: 'iface-2', name: 'Invoice Outbound', source: 'S4HANA', target: 'PAYGATE', status: 'Healthy', activeAlertCount: 0 }),
        makeEdge({ interfaceId: 'iface-3', name: 'Inventory Replication', source: 'WMS', target: 'CPI', status: 'Healthy', activeAlertCount: 0, component: 'Enterprise Event Mesh' })
    ]
};

const criticalTopology = {
    generatedAt: '2026-10-30T10:05:00Z',
    summary: {
        totalSystems: 5,
        totalConnections: 3,
        healthyCount: 2,
        warningCount: 1,
        criticalCount: 2
    },
    nodes: [
        makeNode({ id: 'WEBSHOP', name: 'E-Commerce Webshop', status: 'Critical', activeAlertCount: 2, connectedInterfaceCount: 1 }),
        makeNode({ id: 'S4HANA', name: 'SAP S/4HANA', status: 'Critical', activeAlertCount: 2, connectedInterfaceCount: 2 }),
        makeNode({ id: 'PAYGATE', name: 'Payment Gateway', status: 'Warning', activeAlertCount: 1, connectedInterfaceCount: 1 }),
        makeNode({ id: 'WMS', name: 'Warehouse WMS', status: 'Healthy', activeAlertCount: 0, connectedInterfaceCount: 1 }),
        makeNode({ id: 'CPI', name: 'SAP BTP Cloud Integration', status: 'Healthy', activeAlertCount: 0, connectedInterfaceCount: 3 })
    ],
    edges: [
        makeEdge({ interfaceId: 'iface-1', name: 'Order Inbound (S/4HANA)', source: 'WEBSHOP', target: 'S4HANA', status: 'Critical', activeAlertCount: 2,
            activeAlerts: [
                { id: 'a1', ruleCode: 'EXCESSIVE_RETRIES', severity: 'Critical', summary: 'Too many retries', repeatCount: 5 },
                { id: 'a2', ruleCode: 'QUEUE_GROWTH', severity: 'Critical', summary: 'Queue growing fast', repeatCount: 3 }
            ] }),
        makeEdge({ interfaceId: 'iface-2', name: 'Invoice Outbound', source: 'S4HANA', target: 'PAYGATE', status: 'Warning', activeAlertCount: 1,
            activeAlerts: [
                { id: 'a3', ruleCode: 'OLD_MESSAGE_AGE', severity: 'High', summary: 'Messages waiting too long', repeatCount: 1 }
            ] }),
        makeEdge({ interfaceId: 'iface-3', name: 'Inventory Replication', source: 'WMS', target: 'CPI', status: 'Healthy', activeAlertCount: 0, activeAlerts: [] })
    ]
};

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Topology data transformation (normalizeTopology)', () => {
    it('parses a LargeString JSON body into a topology object', () => {
        const raw = JSON.stringify(healthyTopology);
        const result = normalizeTopology(raw);
        assert.equal(result.nodes.length, 5);
        assert.equal(result.edges.length, 3);
        assert.equal(result.summary.totalSystems, 5);
        assert.equal(result.summary.totalConnections, 3);
        assert.equal(result.summary.healthyCount, 5);
        assert.equal(result.summary.warningCount, 0);
        assert.equal(result.summary.criticalCount, 0);
    });

    it('parses an object payload directly (already parsed JSON)', () => {
        const result = normalizeTopology(healthyTopology);
        assert.equal(result.nodes.length, 5);
        assert.equal(result.edges.length, 3);
    });

    it('handles { value: "<json string>" } wrapper', () => {
        const result = normalizeTopology({ value: JSON.stringify(healthyTopology) });
        assert.equal(result.nodes.length, 5);
        assert.equal(result.summary.healthyCount, 5);
    });

    it('handles { value: <object> } wrapper', () => {
        const result = normalizeTopology({ value: healthyTopology });
        assert.equal(result.nodes.length, 5);
    });

    it('returns empty topology for null input', () => {
        const result = normalizeTopology(null);
        assert.equal(result.nodes.length, 0);
        assert.equal(result.edges.length, 0);
        assert.equal(result.summary.totalSystems, 0);
    });

    it('returns empty topology for malformed JSON string', () => {
        const result = normalizeTopology('{ not valid json');
        assert.equal(result.nodes.length, 0);
        assert.equal(result.edges.length, 0);
    });

    it('returns empty topology for undefined input', () => {
        const result = normalizeTopology(undefined);
        assert.equal(result.nodes.length, 0);
        assert.equal(result.edges.length, 0);
    });
});

describe('Topology health computation', () => {
    it('computes summary counts from node statuses', () => {
        const result = normalizeTopology(criticalTopology);
        assert.equal(result.summary.criticalCount, 2);
        assert.equal(result.summary.warningCount, 1);
        assert.equal(result.summary.healthyCount, 2);
        assert.equal(result.summary.totalSystems, 5);
    });

    it('flags critical edges with active alerts', () => {
        const result = normalizeTopology(criticalTopology);
        const stormEdge = result.edges.find((e) => e.interfaceId === 'iface-1');
        assert.ok(stormEdge);
        assert.equal(stormEdge.status, 'Critical');
        assert.equal(stormEdge.activeAlertCount, 2);
        assert.equal(stormEdge.activeAlerts.length, 2);
        assert.equal(stormEdge.activeAlerts[0].ruleCode, 'EXCESSIVE_RETRIES');
        assert.equal(stormEdge.activeAlerts[0].severity, 'Critical');
    });

    it('flags warning edges with active alerts', () => {
        const result = normalizeTopology(criticalTopology);
        const edge = result.edges.find((e) => e.interfaceId === 'iface-2');
        assert.equal(edge.status, 'Warning');
        assert.equal(edge.activeAlertCount, 1);
    });
});

describe('Search and filter logic (buildViewModel)', () => {
    it('returns all nodes and edges when no filters applied', () => {
        const vm = buildViewModel(healthyTopology, {});
        assert.equal(vm.nodes.length, 5);
        assert.equal(vm.edges.length, 3);
    });

    it('search filters nodes by name', () => {
        const vm = buildViewModel(healthyTopology, { searchText: 'webshop' });
        assert.equal(vm.nodes.length, 1);
        assert.equal(vm.nodes[0].id, 'WEBSHOP');
    });

    it('search filters edges by component name', () => {
        const vm = buildViewModel(healthyTopology, { searchText: 'event mesh' });
        assert.equal(vm.edges.length, 1);
        assert.equal(vm.edges[0].name, 'Inventory Replication');
    });

    it('health filter keeps only matching status', () => {
        const vm = buildViewModel(criticalTopology, { healthFilter: 'Critical' });
        assert.equal(vm.nodes.length, 2);
        assert.ok(vm.nodes.every((n) => n.status === 'Critical'));
        assert.equal(vm.edges.length, 1);
        assert.equal(vm.edges[0].status, 'Critical');
    });

    it('node filter keeps selected node and its connected edges', () => {
        const vm = buildViewModel(healthyTopology, { nodeFilter: { type: 'node', id: 'WEBSHOP', name: 'E-Commerce Webshop' } });
        assert.equal(vm.nodes.length, 1);
        assert.equal(vm.nodes[0].id, 'WEBSHOP');
        assert.equal(vm.edges.length, 1);
        assert.ok(vm.edges[0].source === 'WEBSHOP' || vm.edges[0].target === 'WEBSHOP');
    });

    it('combined search + health filter intersects', () => {
        const vm = buildViewModel(criticalTopology, { searchText: 'invoice', healthFilter: 'Warning' });
        assert.equal(vm.edges.length, 1);
        assert.equal(vm.edges[0].name, 'Invoice Outbound');
    });
});

describe('Empty / malformed response handling', () => {
    it('buildViewModel handles empty topology', () => {
        const empty = { nodes: [], edges: [], summary: { totalSystems: 0, totalConnections: 0, healthyCount: 0, warningCount: 0, criticalCount: 0 } };
        const vm = buildViewModel(empty, {});
        assert.equal(vm.nodes.length, 0);
        assert.equal(vm.edges.length, 0);
    });

    it('normalizeTopology missing nodes/edges defaults to empty arrays', () => {
        const result = normalizeTopology({ summary: {} });
        assert.equal(result.nodes.length, 0);
        assert.equal(result.edges.length, 0);
        assert.equal(result.summary.totalSystems, 0);
    });

    it('normalizeTopology non-object scalar returns empty', () => {
        assert.equal(normalizeTopology(42).nodes.length, 0);
        assert.equal(normalizeTopology('hello').nodes.length, 0);
    });
});
