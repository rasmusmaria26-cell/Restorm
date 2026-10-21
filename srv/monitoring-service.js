const cds = require('@sap/cds');
const { generateSnapshotData, ALLOWED_SCENARIOS } = require('./core/simulator');
const { generateGroundedExplanation } = require('./ai/explanationService');
const {
    validateIntegerBound,
    validateTimestamp,
    processSnapshotAndEvaluate
} = require('./core/ingestionPipeline');

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

        // Action: Ingest external integration telemetry
        this.on('ingestTelemetry', async (req) => {
            const data = req.data || {};
            const { interfaceId, capturedAt } = data;

            // 1. Validate interfaceId
            if (!interfaceId || typeof interfaceId !== 'string' || interfaceId.length > 36) {
                return req.reject(400, "Invalid 'interfaceId' format: expected a valid UUID string");
            }

            const targetInterface = await SELECT.one.from(Interfaces).where({ ID: interfaceId });
            if (!targetInterface) {
                return req.reject(404, `Interface with ID '${interfaceId}' does not exist`);
            }
            if (!targetInterface.active) {
                return req.reject(400, `Interface '${targetInterface.name}' is currently inactive; telemetry rejected`);
            }

            // 2. Validate numeric bounds
            const pendingCheck = validateIntegerBound(data.pendingCount, 'pendingCount', 0, 1000000);
            if (!pendingCheck.valid) return req.reject(400, pendingCheck.error);

            const failedCheck = validateIntegerBound(data.failedCount, 'failedCount', 0, 1000000);
            if (!failedCheck.valid) return req.reject(400, failedCheck.error);

            const retryCheck = validateIntegerBound(data.retryAttempts, 'retryAttempts', 0, 1000000);
            if (!retryCheck.valid) return req.reject(400, retryCheck.error);

            const successCheck = validateIntegerBound(data.successCount, 'successCount', 0, 1000000);
            if (!successCheck.valid) return req.reject(400, successCheck.error);

            const ageCheck = validateIntegerBound(data.oldestPendingAgeSeconds, 'oldestPendingAgeSeconds', 0, 2592000);
            if (!ageCheck.valid) return req.reject(400, ageCheck.error);

            // 3. Validate timestamp
            const timeCheck = validateTimestamp(capturedAt);
            if (!timeCheck.valid) return req.reject(400, timeCheck.error);

            // 4. Assemble snapshot
            const snapshotData = {
                interface_ID: targetInterface.ID,
                capturedAt: timeCheck.value,
                pendingCount: pendingCheck.value,
                failedCount: failedCheck.value,
                retryAttempts: retryCheck.value,
                successCount: successCheck.value,
                oldestPendingAgeSeconds: ageCheck.value
            };

            // 5. Execute core ingestion and evaluation pipeline
            const result = await processSnapshotAndEvaluate(
                { QueueSnapshots, Alerts, Interfaces },
                targetInterface,
                snapshotData,
                `External Ingestion [${targetInterface.name}]`
            );

            return JSON.stringify({
                status: result.status,
                interfaceId: targetInterface.ID,
                interfaceName: targetInterface.name,
                capturedAt: snapshotData.capturedAt,
                alertTriggered: result.alertTriggered,
                alertAction: result.alertAction,
                ruleCode: result.ruleCode || null,
                severity: result.severity || null,
                repeatCount: result.repeatCount || 0,
                summary: result.summary,
                message: result.message
            }, null, 2);
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

            // 3. Generate snapshot via Simulator
            const snapshotData = generateSnapshotData(scenario, targetInterface.ID);

            // 4. Execute core evaluation pipeline
            const result = await processSnapshotAndEvaluate(
                { QueueSnapshots, Alerts, Interfaces },
                targetInterface,
                snapshotData,
                `Scenario [${scenario || 'NORMAL'}] executed`
            );

            return result.message;
        });

        // Action: Configure per-interface threshold policies (Admin only)
        this.on('configureThresholds', async (req) => {
            const data = req.data || {};
            const { interfaceId } = data;

            if (!interfaceId || typeof interfaceId !== 'string' || interfaceId.length > 36) {
                return req.reject(400, "Invalid 'interfaceId' format: expected a valid UUID string");
            }

            const targetInterface = await SELECT.one.from(Interfaces).where({ ID: interfaceId });
            if (!targetInterface) {
                return req.reject(404, `Interface with ID '${interfaceId}' does not exist`);
            }

            const retryCheck = validateIntegerBound(data.maxRetryThreshold, 'maxRetryThreshold', 1, 10000);
            if (!retryCheck.valid) return req.reject(400, retryCheck.error);

            const queueCheck = validateIntegerBound(data.queueGrowthLimit, 'queueGrowthLimit', 1, 100000);
            if (!queueCheck.valid) return req.reject(400, queueCheck.error);

            const ageCheck = validateIntegerBound(data.oldMessageAgeLimitSeconds, 'oldMessageAgeLimitSeconds', 10, 2592000);
            if (!ageCheck.valid) return req.reject(400, ageCheck.error);

            const recoveryCheck = validateIntegerBound(data.recoveryStalledBacklog, 'recoveryStalledBacklog', 1, 100000);
            if (!recoveryCheck.valid) return req.reject(400, recoveryCheck.error);

            await UPDATE(Interfaces, interfaceId).with({
                maxRetryThreshold: retryCheck.value,
                queueGrowthLimit: queueCheck.value,
                oldMessageAgeLimitSeconds: ageCheck.value,
                recoveryStalledBacklog: recoveryCheck.value
            });

            return await SELECT.one.from(Interfaces).where({ ID: interfaceId });
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
