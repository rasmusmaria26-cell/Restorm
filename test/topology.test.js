const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');

describe('Integration Topology Landscape (Phase 4)', () => {
    let srv;
    let targetInterface;

    before(async () => {
        cds.env.requires.db = { kind: 'sqlite', credentials: { url: 'sentinel.db' } };
        const csn = await cds.load('srv/monitoring-service.cds');
        cds.model = csn;
        await cds.connect.to('db');
        srv = await cds.serve('MonitoringService').from('srv/monitoring-service.cds');

        // Reset database to clean baseline seed
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');

        const ifaces = await adminTx.run(SELECT.from(srv.entities.Interfaces).where({ active: true }));
        assert.ok(ifaces.length > 0, 'Seed interfaces must exist');
        targetInterface = ifaces[0];
    });

    after(async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');
    });

    it('T1 Systems Entity: Returns 5 modeled landscape systems with codes and tiers', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        const systems = await aliceTx.run(SELECT.from(srv.entities.Systems));

        assert.equal(systems.length, 5, 'Must have 5 seeded systems');
        const codes = systems.map(s => s.code);
        assert.ok(codes.includes('WEBSHOP'), 'Must include WEBSHOP');
        assert.ok(codes.includes('S4HANA'), 'Must include S4HANA');
        assert.ok(codes.includes('PAYGATE'), 'Must include PAYGATE');
        assert.ok(codes.includes('WMS'), 'Must include WMS');
        assert.ok(codes.includes('CPI'), 'Must include CPI');
    });

    it('T2 Connections Entity: Returns 3 modeled integration channels with components and protocols', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        const connections = await aliceTx.run(SELECT.from(srv.entities.Connections));

        assert.equal(connections.length, 3, 'Must have 3 seeded integration connections');
        const components = connections.map(c => c.component);
        assert.ok(components.some(c => c.includes('SAP Cloud Integration')), 'Must include CPI component');
        assert.ok(components.some(c => c.includes('Event Mesh')), 'Must include Event Mesh component');
    });

    it('T3 getTopology Function: Returns structured landscape graph in baseline healthy state', async () => {
        const aliceTx = srv.tx({ user: new cds.User({ id: 'alice', roles: ['SupportViewer'] }) });
        const topologyStr = await aliceTx.send('getTopology');
        assert.ok(typeof topologyStr === 'string', 'Expected JSON string');

        const topology = JSON.parse(topologyStr);
        assert.ok(topology.summary, 'Must contain summary');
        assert.equal(topology.summary.totalSystems, 5);
        assert.equal(topology.summary.totalConnections, 3);
        assert.equal(topology.summary.criticalCount, 0, 'Zero critical in clean seed');
        assert.equal(topology.summary.warningCount, 0, 'Zero warning in clean seed');
        assert.equal(topology.summary.healthyCount, 5, 'All 5 systems healthy');

        assert.ok(Array.isArray(topology.nodes), 'Nodes must be an array');
        assert.equal(topology.nodes.length, 5);
        for (const node of topology.nodes) {
            assert.equal(node.status, 'Healthy', `System ${node.id} should be Healthy`);
        }

        assert.ok(Array.isArray(topology.edges), 'Edges must be an array');
        assert.equal(topology.edges.length, 3);
        for (const edge of topology.edges) {
            assert.equal(edge.status, 'Healthy', `Edge ${edge.name} should be Healthy`);
            assert.ok(edge.metrics, 'Edge must include snapshot metrics');
        }
    });

    it('T4 Dynamic Propagation: Ingesting retry storm updates edge and connected nodes to Critical', async () => {
        const bobTx = srv.tx({ user: new cds.User({ id: 'bob', roles: ['SupportOperator'] }) });

        // Trigger retry storm on targetInterface (Order Inbound)
        await bobTx.send('triggerSimulation', {
            interfaceId: targetInterface.ID,
            scenario: 'RETRY_STORM'
        });

        // Query updated topology
        const topologyStr = await bobTx.send('getTopology');
        const topology = JSON.parse(topologyStr);

        assert.ok(topology.summary.criticalCount >= 1, 'Critical count must increase');

        // Find Order Inbound edge
        const stormEdge = topology.edges.find(e => e.interfaceId === targetInterface.ID);
        assert.ok(stormEdge, 'Target interface edge must exist in graph');
        assert.equal(stormEdge.status, 'Critical', 'Edge under retry storm must report Critical');
        assert.ok(stormEdge.activeAlertCount >= 1, 'Edge must have active alerts attached');

        // Connected source (WEBSHOP) and target (S4HANA) nodes must reflect Critical status
        const sourceNode = topology.nodes.find(n => n.id === stormEdge.source);
        const targetNode = topology.nodes.find(n => n.id === stormEdge.target);

        assert.ok(sourceNode, 'Source node must exist');
        assert.ok(targetNode, 'Target node must exist');
        assert.equal(sourceNode.status, 'Critical', 'Connected source system should reflect Critical status');
        assert.equal(targetNode.status, 'Critical', 'Connected target system should reflect Critical status');

        // Unconnected systems (e.g. WMS, PAYGATE) should remain Healthy
        const wmsNode = topology.nodes.find(n => n.id === 'WMS');
        assert.equal(wmsNode.status, 'Healthy', 'Unrelated system WMS should remain Healthy');
    });

    it('T5 Healing & Reset: Resetting database returns topology graph to pristine Healthy state', async () => {
        const adminTx = srv.tx({ user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] }) });
        await adminTx.send('resetToCleanSeed');

        const topologyStr = await adminTx.send('getTopology');
        const topology = JSON.parse(topologyStr);

        assert.equal(topology.summary.criticalCount, 0);
        assert.equal(topology.summary.healthyCount, 5);
        for (const edge of topology.edges) {
            assert.equal(edge.status, 'Healthy');
        }
    });

    it('T6 Authentication: Anonymous user is rejected with 401', async () => {
        const anonTx = srv.tx({ user: new cds.User.Anonymous() });
        await assert.rejects(
            async () => {
                await anonTx.send('getTopology');
            },
            (err) => {
                const code = err.code || err.status;
                assert.ok(code === 401 || code === 403, `Expected 401 or 403, got ${code}`);
                return true;
            }
        );
    });
});
