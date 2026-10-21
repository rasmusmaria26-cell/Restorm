/**
 * Topology Service - Pure Domain Module
 * 
 * Assembles system landscape nodes, integration connections,
 * and computes dynamic real-time health states from queue snapshots and alerts.
 */

/**
 * Compute edge health status based on active alerts and snapshot metrics
 * 
 * @param {Object} iface Interface entity with threshold policies
 * @param {Object|null} snapshot Latest queue snapshot
 * @param {Array} activeAlerts Active (unresolved) alerts for this interface
 * @returns {String} 'Healthy' | 'Warning' | 'Critical'
 */
function computeEdgeHealth(iface, snapshot, activeAlerts) {
    // 1. Check active alerts
    if (activeAlerts && activeAlerts.length > 0) {
        const hasCritical = activeAlerts.some(a => a.severity === 'Critical');
        if (hasCritical) return 'Critical';
        const hasWarning = activeAlerts.some(a => a.severity === 'High' || a.severity === 'Warning');
        if (hasWarning) return 'Warning';
    }

    // 2. Check snapshot metrics against threshold policies
    if (snapshot && iface) {
        const maxRetries = iface.maxRetryThreshold || 100;
        const queueLimit = iface.queueGrowthLimit || 200;
        const ageLimit = iface.oldMessageAgeLimitSeconds || 600;

        if (snapshot.retryAttempts >= maxRetries) {
            return 'Critical';
        }
        if (snapshot.pendingCount >= queueLimit || snapshot.oldestPendingAgeSeconds >= ageLimit) {
            return 'Warning';
        }
    }

    return 'Healthy';
}

/**
 * Compute node health from its connected edges
 * 
 * @param {Array} connectedEdges Edges attached to this system
 * @returns {String} 'Healthy' | 'Warning' | 'Critical'
 */
function computeNodeHealth(connectedEdges) {
    if (!connectedEdges || connectedEdges.length === 0) return 'Healthy';
    if (connectedEdges.some(e => e.status === 'Critical')) return 'Critical';
    if (connectedEdges.some(e => e.status === 'Warning')) return 'Warning';
    return 'Healthy';
}

/**
 * Assemble landscape topology graph
 * 
 * @param {Array} systems List of Systems entities
 * @param {Array} connections List of Connections entities
 * @param {Array} interfaces List of Interfaces entities
 * @param {Array} latestSnapshots Map or array of latest QueueSnapshots
 * @param {Array} activeAlerts Array of active alerts
 * @returns {Object} Structured topology model
 */
function buildTopologyGraph(systems, connections, interfaces, latestSnapshots, activeAlerts) {
    const safeSystems = Array.isArray(systems) ? systems : [];
    const safeConnections = Array.isArray(connections) ? connections : [];
    const safeInterfaces = Array.isArray(interfaces) ? interfaces : [];
    const safeAlerts = Array.isArray(activeAlerts) ? activeAlerts : [];

    // Map snapshots by interface ID
    const snapshotByIface = new Map();
    if (Array.isArray(latestSnapshots)) {
        for (const snap of latestSnapshots) {
            const ifaceId = snap.interface_ID || snap.interface?.ID;
            if (ifaceId && !snapshotByIface.has(ifaceId)) {
                snapshotByIface.set(ifaceId, snap);
            }
        }
    }

    // Group active alerts by interface ID
    const alertsByIface = new Map();
    for (const alert of safeAlerts) {
        const ifaceId = alert.interface_ID || alert.interface?.ID;
        if (!ifaceId) continue;
        if (!alertsByIface.has(ifaceId)) {
            alertsByIface.set(ifaceId, []);
        }
        alertsByIface.get(ifaceId).push(alert);
    }

    // Build map of interfaces
    const ifaceMap = new Map();
    for (const iface of safeInterfaces) {
        ifaceMap.set(iface.ID, iface);
    }

    // Build map of systems by ID and Code
    const systemById = new Map();
    const systemByCode = new Map();
    for (const sys of safeSystems) {
        if (sys.ID) systemById.set(sys.ID, sys);
        if (sys.code) systemByCode.set(sys.code, sys);
    }

    // Build edges
    const edges = [];
    for (const conn of safeConnections) {
        const ifaceId = conn.interface_ID || conn.interface?.ID;
        const iface = ifaceMap.get(ifaceId);
        const snapshot = snapshotByIface.get(ifaceId) || null;
        const ifaceAlerts = alertsByIface.get(ifaceId) || [];

        const status = computeEdgeHealth(iface, snapshot, ifaceAlerts);

        // Resolve source and target codes cleanly
        const srcSys = conn.sourceSystem?.ID ? systemById.get(conn.sourceSystem.ID) : systemById.get(conn.sourceSystem_ID);
        const tgtSys = conn.targetSystem?.ID ? systemById.get(conn.targetSystem.ID) : systemById.get(conn.targetSystem_ID);

        const sourceCode = conn.sourceSystem?.code || (srcSys ? srcSys.code : (conn.sourceSystem_code || 'SRC'));
        const targetCode = conn.targetSystem?.code || (tgtSys ? tgtSys.code : (conn.targetSystem_code || 'TGT'));

        edges.push({
            id: conn.ID,
            interfaceId: ifaceId,
            name: iface ? iface.name : (conn.component || 'Integration Flow'),
            source: sourceCode,
            target: targetCode,
            component: conn.component || 'Middleware Broker',
            protocol: conn.protocol || 'HTTPS',
            connectionType: conn.connectionType || 'Asynchronous',
            status: status,
            metrics: snapshot ? {
                pendingCount: snapshot.pendingCount || 0,
                failedCount: snapshot.failedCount || 0,
                retryAttempts: snapshot.retryAttempts || 0,
                successCount: snapshot.successCount || 0,
                oldestPendingAgeSeconds: snapshot.oldestPendingAgeSeconds || 0,
                capturedAt: snapshot.capturedAt
            } : null,
            activeAlertCount: ifaceAlerts.length,
            activeAlerts: ifaceAlerts.map(a => ({
                id: a.ID,
                ruleCode: a.ruleCode,
                severity: a.severity,
                summary: a.summary,
                repeatCount: a.repeatCount
            }))
        });
    }

    // Build nodes
    const nodes = [];
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;

    for (const sys of safeSystems) {
        const connectedEdges = edges.filter(e => e.source === sys.code || e.target === sys.code);
        const nodeStatus = computeNodeHealth(connectedEdges);
        const activeAlertCount = connectedEdges.reduce((sum, e) => sum + e.activeAlertCount, 0);

        if (nodeStatus === 'Critical') criticalCount++;
        else if (nodeStatus === 'Warning') warningCount++;
        else healthyCount++;

        nodes.push({
            id: sys.code,
            name: sys.name,
            category: sys.category || 'System',
            environment: sys.environment || 'Synthetic',
            tier: sys.tier || 'Core',
            status: nodeStatus,
            activeAlertCount: activeAlertCount,
            connectedInterfaceCount: connectedEdges.length
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            totalSystems: nodes.length,
            totalConnections: edges.length,
            healthyCount: healthyCount,
            warningCount: warningCount,
            criticalCount: criticalCount
        },
        nodes: nodes,
        edges: edges
    };
}

module.exports = {
    computeEdgeHealth,
    computeNodeHealth,
    buildTopologyGraph
};
