const cds = require('@sap/cds');
const { evaluateMetrics } = require('./core/detectionEngine');
const { generateSnapshotData } = require('./core/simulator');
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
            const acknowledgedBy = req.data.acknowledgedBy || 'Operator';

            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert ${alertId} not found`);

            await UPDATE(Alerts, alertId).with({
                status: 'Acknowledged',
                acknowledgedAt: new Date().toISOString(),
                acknowledgedBy: acknowledgedBy
            });

            return await SELECT.one.from(Alerts).where({ ID: alertId });
        });

        // Action: Grounded Explanation
        this.on('explain', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert not found`);

            const runbook = await SELECT.one.from(RunbookEntries).where({ ruleCode: alert.ruleCode });
            const explanation = generateGroundedExplanation(alert, runbook);
            const explanationStr = JSON.stringify(explanation, null, 2);

            await UPDATE(Alerts, alertId).with({ aiExplanation: explanationStr });
            return explanationStr;
        });

        // Action: Trigger scenario simulation & evaluate detection rules
        this.on('triggerSimulation', async (req) => {
            const { scenario, interfaceId } = req.data;
            const targetInterface = await SELECT.one.from(Interfaces).where({ ID: interfaceId }) 
                                  || await SELECT.one.from(Interfaces);

            if (!targetInterface) return req.reject(400, 'No active interface found for simulation');

            // 1. Generate snapshot via Simulator
            const snapshotData = generateSnapshotData(scenario, targetInterface.ID);
            await INSERT.into(QueueSnapshots).entries(snapshotData);

            // 2. Evaluate metrics via Detection Engine
            const detectionResult = evaluateMetrics(snapshotData);

            // 3. Persist Alert if rule conditions are met
            if (detectionResult.triggered) {
                const now = new Date();
                const observedMetrics = JSON.stringify({
                    pendingCount: snapshotData.pendingCount,
                    retryAttempts: snapshotData.retryAttempts,
                    failedCount: snapshotData.failedCount,
                    oldestPendingAgeSeconds: snapshotData.oldestPendingAgeSeconds,
                    timestamp: snapshotData.capturedAt
                });

                await INSERT.into(Alerts).entries({
                    interface_ID: targetInterface.ID,
                    ruleCode: detectionResult.ruleCode,
                    severity: detectionResult.severity,
                    status: 'Open',
                    detectedAt: now.toISOString(),
                    windowStart: new Date(now.getTime() - 15 * 60000).toISOString(),
                    windowEnd: now.toISOString(),
                    observedMetrics: observedMetrics,
                    summary: detectionResult.summary
                });

                return `Scenario [${scenario}] executed: Snapshot saved & Alert [${detectionResult.ruleCode}] created (${detectionResult.severity}).`;
            }

            return `Scenario [${scenario}] executed: Snapshot saved. System operating normally.`;
        });

        await super.init();
    }
};
