const cds = require('@sap/cds');

module.exports = class MonitoringService extends cds.ApplicationService {
    async init() {
        const { Alerts, Interfaces, QueueSnapshots, RunbookEntries } = this.entities;

        // Action: Acknowledge an open alert
        this.on('acknowledge', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            const acknowledgedBy = req.data.acknowledgedBy || 'Operator';

            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) {
                return req.reject(404, `Alert ${alertId} not found`);
            }

            await UPDATE(Alerts, alertId).with({
                status: 'Acknowledged',
                acknowledgedAt: new Date().toISOString(),
                acknowledgedBy: acknowledgedBy
            });

            return await SELECT.one.from(Alerts).where({ ID: alertId });
        });

        // Action: Grounded AI Explanation (Fallback & Runbook match)
        this.on('explain', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert not found`);

            const runbook = await SELECT.one.from(RunbookEntries).where({ ruleCode: alert.ruleCode });
            
            // Grounded deterministic explanation structure (following prompt requirements in Section 14)
            const explanation = {
                summary: `Incident detected on ${alert.ruleCode}. Severity: ${alert.severity}.`,
                observedFacts: JSON.parse(alert.observedMetrics || '{}'),
                possibleHypotheses: [
                    runbook ? runbook.symptoms : 'Unclassified operational behavior.'
                ],
                recommendedChecks: runbook ? runbook.checks.split('. ') : ['Review integration logs.'],
                citedRunbookIds: runbook ? [runbook.ID] : [],
                limitations: runbook ? runbook.limitations : 'No direct root cause guaranteed from queue metrics.'
            };

            const explanationStr = JSON.stringify(explanation, null, 2);

            await UPDATE(Alerts, alertId).with({ aiExplanation: explanationStr });
            return explanationStr;
        });

        // Action: Trigger repeatable simulation scenarios (M3 & M4 integration)
        this.on('triggerSimulation', async (req) => {
            const { scenario, interfaceId } = req.data;
            const targetInterface = await SELECT.one.from(Interfaces).where({ ID: interfaceId }) 
                                  || await SELECT.one.from(Interfaces);

            if (!targetInterface) return req.reject(400, 'No active interface found for simulation');

            const now = new Date();
            let snapshotData = {
                interface_ID: targetInterface.ID,
                capturedAt: now.toISOString(),
                pendingCount: 5,
                failedCount: 0,
                retryAttempts: 0,
                successCount: 150,
                oldestPendingAgeSeconds: 12
            };

            let ruleTriggered = null;
            let severity = 'Info';

            switch (scenario) {
                case 'RETRY_STORM':
                    snapshotData.pendingCount = 420;
                    snapshotData.failedCount = 180;
                    snapshotData.retryAttempts = 350;
                    snapshotData.successCount = 5;
                    snapshotData.oldestPendingAgeSeconds = 720; // 12 minutes
                    ruleTriggered = 'EXCESSIVE_RETRIES';
                    severity = 'Critical';
                    break;
                case 'QUEUE_GROWTH':
                    snapshotData.pendingCount = 280;
                    snapshotData.failedCount = 30;
                    snapshotData.retryAttempts = 40;
                    snapshotData.successCount = 50;
                    snapshotData.oldestPendingAgeSeconds = 300;
                    ruleTriggered = 'QUEUE_GROWTH';
                    severity = 'High';
                    break;
                case 'PERSISTENT_BACKLOG':
                    snapshotData.pendingCount = 120;
                    snapshotData.failedCount = 10;
                    snapshotData.retryAttempts = 15;
                    snapshotData.successCount = 8;
                    snapshotData.oldestPendingAgeSeconds = 1800; // 30 minutes
                    ruleTriggered = 'OLD_MESSAGE_AGE';
                    severity = 'High';
                    break;
                case 'RECOVERY':
                    snapshotData.pendingCount = 25;
                    snapshotData.failedCount = 0;
                    snapshotData.retryAttempts = 2;
                    snapshotData.successCount = 290;
                    snapshotData.oldestPendingAgeSeconds = 45;
                    break;
                case 'NORMAL':
                default:
                    // default values are normal
                    break;
            }

            // Insert snapshot
            await INSERT.into(QueueSnapshots).entries(snapshotData);

            // Rule evaluation & Alert creation if triggered
            if (ruleTriggered) {
                const observedMetrics = JSON.stringify({
                    pendingCount: snapshotData.pendingCount,
                    retryAttempts: snapshotData.retryAttempts,
                    failedCount: snapshotData.failedCount,
                    oldestPendingAgeSeconds: snapshotData.oldestPendingAgeSeconds,
                    timestamp: now.toISOString()
                });

                await INSERT.into(Alerts).entries({
                    interface_ID: targetInterface.ID,
                    ruleCode: ruleTriggered,
                    severity: severity,
                    status: 'Open',
                    detectedAt: now.toISOString(),
                    windowStart: new Date(now.getTime() - 15 * 60000).toISOString(),
                    windowEnd: now.toISOString(),
                    observedMetrics: observedMetrics,
                    summary: `Rule [${ruleTriggered}] fired during ${scenario} scenario.`
                });

                return `Scenario ${scenario} simulated. Snapshot recorded and Alert generated (${ruleTriggered}).`;
            }

            return `Scenario ${scenario} simulated. Normal snapshot recorded. No alerts triggered.`;
        });

        await super.init();
    }
};
