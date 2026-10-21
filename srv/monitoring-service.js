const cds = require('@sap/cds');
const { evaluateMetrics } = require('./core/detectionEngine');
const { generateSnapshotData, ALLOWED_SCENARIOS } = require('./core/simulator');
const { generateGroundedExplanation } = require('./ai/explanationService');

/**
 * MonitoringService Controller
 * Delegates business actions to pure domain services
 */
module.exports = class MonitoringService extends cds.ApplicationService {
    async init() {
        const { Alerts, Interfaces, QueueSnapshots, RunbookEntries } = this.entities;

        // Action: Acknowledge an open alert
        this.on('acknowledge', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            if (!alertId || typeof alertId !== 'string') {
                return req.reject(400, 'Invalid alert ID');
            }

            let acknowledgedBy = req.data?.acknowledgedBy || req.user?.id || 'Operator';
            if (typeof acknowledgedBy !== 'string') acknowledgedBy = 'Operator';
            acknowledgedBy = acknowledgedBy.trim().replace(/[\r\n\t]/g, ' ').substring(0, 100);

            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert ${alertId} not found`);

            if (alert.status !== 'Open') {
                return req.reject(409, `Alert ${alertId} is already in status '${alert.status}'. Only Open alerts can be acknowledged.`);
            }

            await UPDATE(Alerts, alertId).with({
                status: 'Acknowledged',
                acknowledgedAt: new Date().toISOString(),
                acknowledgedBy: acknowledgedBy
            });

            return await SELECT.one.from(Alerts).where({ ID: alertId });
        });

        // Action: Resolve an active or acknowledged alert
        this.on('resolveAlert', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            if (!alertId || typeof alertId !== 'string') {
                return req.reject(400, 'Invalid alert ID');
            }

            let resolvedBy = req.data?.resolvedBy || req.user?.id || 'Operator';
            if (typeof resolvedBy !== 'string') resolvedBy = 'Operator';
            resolvedBy = resolvedBy.trim().replace(/[\r\n\t]/g, ' ').substring(0, 100);

            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert ${alertId} not found`);

            if (alert.status === 'Resolved' || alert.status === 'Closed') {
                return req.reject(409, `Alert ${alertId} is already in status '${alert.status}'.`);
            }

            await UPDATE(Alerts, alertId).with({
                status: 'Resolved',
                resolvedAt: new Date().toISOString(),
                resolvedBy: resolvedBy
            });

            return await SELECT.one.from(Alerts).where({ ID: alertId });
        });

        // Action: Grounded Explanation
        this.on('explain', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            if (!alertId || typeof alertId !== 'string') {
                return req.reject(400, 'Invalid alert ID');
            }

            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert not found`);

            const runbook = await SELECT.one.from(RunbookEntries).where({ ruleCode: alert.ruleCode });
            const explanation = await generateGroundedExplanation(alert, runbook);
            const explanationStr = JSON.stringify(explanation, null, 2);

            await UPDATE(Alerts, alertId).with({ aiExplanation: explanationStr });
            return explanationStr;
        });

        // Action: Trigger scenario simulation & evaluate detection rules
        this.on('triggerSimulation', async (req) => {
            const { scenario, interfaceId } = req.data || {};

            // 1. Validate scenario input against frozen allowlist
            if (scenario && !ALLOWED_SCENARIOS.includes(scenario)) {
                return req.reject(400, `Invalid scenario '${scenario}'. Allowed: ${ALLOWED_SCENARIOS.join(', ')}`);
            }

            // 2. Validate interfaceId
            let targetInterface;
            if (interfaceId) {
                if (typeof interfaceId !== 'string' || interfaceId.length > 36) {
                    return req.reject(400, 'Invalid interfaceId format');
                }
                targetInterface = await SELECT.one.from(Interfaces).where({ ID: interfaceId });
                if (!targetInterface) return req.reject(404, `Interface ${interfaceId} not found`);
            } else {
                targetInterface = await SELECT.one.from(Interfaces).where({ active: true }) 
                               || await SELECT.one.from(Interfaces);
            }

            if (!targetInterface) return req.reject(400, 'No active interface found for simulation');

            // 3. Retrieve preceding snapshot for differential analysis (e.g. Rule D: Recovery Stalled)
            const previousSnapshot = await SELECT.one.from(QueueSnapshots)
                .where({ interface_ID: targetInterface.ID })
                .orderBy('capturedAt desc');

            // 4. Generate snapshot via Simulator
            const snapshotData = generateSnapshotData(scenario, targetInterface.ID);
            await INSERT.into(QueueSnapshots).entries(snapshotData);

            // 5. Evaluate metrics via Detection Engine (passing previous snapshot)
            const detectionResult = evaluateMetrics(snapshotData, previousSnapshot);

            // 6. Persist or Deduplicate Alert if rule conditions are met
            if (detectionResult.triggered) {
                const now = new Date();
                const observedMetrics = JSON.stringify({
                    pendingCount: snapshotData.pendingCount,
                    retryAttempts: snapshotData.retryAttempts,
                    failedCount: snapshotData.failedCount,
                    successCount: snapshotData.successCount,
                    oldestPendingAgeSeconds: snapshotData.oldestPendingAgeSeconds,
                    timestamp: snapshotData.capturedAt
                });

                // Deduplication check: Is there an existing Open alert for this interface & rule?
                const existingOpenAlert = await SELECT.one.from(Alerts).where({
                    interface_ID: targetInterface.ID,
                    ruleCode: detectionResult.ruleCode,
                    status: 'Open'
                });

                if (existingOpenAlert) {
                    // Deduplicate: extend observation window, increment repeat count, and update current metrics
                    const updatedRepeatCount = (existingOpenAlert.repeatCount || 1) + 1;
                    await UPDATE(Alerts, existingOpenAlert.ID).with({
                        windowEnd: now.toISOString(),
                        observedMetrics: observedMetrics,
                        summary: detectionResult.summary,
                        repeatCount: updatedRepeatCount
                    });

                    return `Scenario [${scenario || 'NORMAL'}] executed: Snapshot saved. Active Alert [${detectionResult.ruleCode}] updated (deduplicated, occurrence #${updatedRepeatCount}).`;
                }

                // New incident: persist new Alert record
                await INSERT.into(Alerts).entries({
                    interface_ID: targetInterface.ID,
                    ruleCode: detectionResult.ruleCode,
                    severity: detectionResult.severity,
                    status: 'Open',
                    repeatCount: 1,
                    detectedAt: now.toISOString(),
                    windowStart: new Date(now.getTime() - 15 * 60000).toISOString(),
                    windowEnd: now.toISOString(),
                    observedMetrics: observedMetrics,
                    summary: detectionResult.summary
                });

                return `Scenario [${scenario || 'NORMAL'}] executed: Snapshot saved & Alert [${detectionResult.ruleCode}] created (${detectionResult.severity}).`;
            }

            return `Scenario [${scenario || 'NORMAL'}] executed: Snapshot saved. System operating normally.`;
        });

        // Administrative Action: Reset database to clean baseline seed
        this.on('resetToCleanSeed', async (req) => {
            // Delete all generated alerts and runtime snapshots
            await DELETE.from(Alerts);
            await DELETE.from(QueueSnapshots);

            const allInterfaces = await SELECT.from(Interfaces);
            const now = new Date();

            // Re-initialize baseline queue snapshot for each interface
            for (const iface of allInterfaces) {
                await INSERT.into(QueueSnapshots).entries({
                    interface_ID: iface.ID,
                    capturedAt: now.toISOString(),
                    pendingCount: 8,
                    failedCount: 0,
                    retryAttempts: 1,
                    successCount: 140,
                    oldestPendingAgeSeconds: 15
                });
            }

            return `Database reset to clean baseline. ${allInterfaces.length} queues initialized with 0 active alerts.`;
        });

        await super.init();
    }
};
