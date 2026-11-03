// Automatically load .env file if present in Node.js 20.6+ / 24+
try {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile();
    }
} catch (e) {
    // .env is optional; ignore if missing
}

const cds = require('@sap/cds');
const { generateSnapshotData, ALLOWED_SCENARIOS } = require('./core/simulator');
const { generateGroundedExplanation } = require('./ai/explanationService');
const { generateMarkdownReport } = require('./core/reportGenerator');
const {
    validateIntegerBound,
    validateTimestamp,
    processSnapshotAndEvaluate
} = require('./core/ingestionPipeline');
const { buildTopologyGraph } = require('./core/topologyService');
const { enforceRateLimit, enforceBodySize, LIMITERS } = require('./rateLimiter');

/**
 * MonitoringService Controller
 * Delegates business actions to pure domain services
 *
 * Rate limiting is enforced server-side on state-changing and expensive actions,
 * keyed by the authenticated user identity from the CAP request context (req.user.id).
 * Client-provided usernames are never trusted as rate limit keys.
 */
module.exports = class MonitoringService extends cds.ApplicationService {
    async init() {
        const { Alerts, Interfaces, QueueSnapshots, RunbookEntries, Systems, Connections } = this.entities;

        // Action: Acknowledge an open alert
        this.on('acknowledge', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            if (!alertId || typeof alertId !== 'string') {
                return req.reject(400, 'Invalid alert ID');
            }

            // Rate limit: state-changing alert lifecycle action
            const rateLimitResult = enforceRateLimit(req, 'acknowledge', LIMITERS.acknowledge);
            if (rateLimitResult) return rateLimitResult;

            let acknowledgedBy = req.user?.id || 'Operator';
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

            // Rate limit: state-changing alert lifecycle action
            const rateLimitResult = enforceRateLimit(req, 'resolveAlert', LIMITERS.resolveAlert);
            if (rateLimitResult) return rateLimitResult;

            let resolvedBy = req.user?.id || 'Operator';
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

            // Rate limit: expensive LLM explanation requests
            const rateLimitResult = enforceRateLimit(req, 'explain', LIMITERS.explain);
            if (rateLimitResult) return rateLimitResult;

            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert not found`);

            const runbook = await SELECT.one.from(RunbookEntries).where({ ruleCode: alert.ruleCode });
            const explanation = await generateGroundedExplanation(alert, runbook);
            const explanationStr = JSON.stringify(explanation, null, 2);

            await UPDATE(Alerts, alertId).with({ aiExplanation: explanationStr });
            return explanationStr;
        });

        // Action: Export Incident Postmortem Report (Markdown / JSON)
        this.on('exportIncidentReport', 'Alerts', async (req) => {
            const alertId = req.params[0]?.ID || req.params[0];
            if (!alertId || typeof alertId !== 'string') {
                return req.reject(400, 'Invalid alert ID');
            }

            const alert = await SELECT.one.from(Alerts).where({ ID: alertId });
            if (!alert) return req.reject(404, `Alert ${alertId} not found`);

            const iface = await SELECT.one.from(Interfaces).where({ ID: alert.interface_ID });
            const runbook = await SELECT.one.from(RunbookEntries).where({ ruleCode: alert.ruleCode });

            const format = (req.data?.format || 'markdown').toLowerCase();
            if (format === 'json') {
                let metrics = {};
                try { metrics = JSON.parse(alert.observedMetrics || '{}'); } catch(e) { metrics = { raw: alert.observedMetrics }; }
                let explanation = null;
                try { if (alert.aiExplanation) explanation = JSON.parse(alert.aiExplanation); } catch(e) {}

                return JSON.stringify({
                    reportType: 'IncidentPostmortem',
                    alertId: alert.ID,
                    ruleCode: alert.ruleCode,
                    severity: alert.severity,
                    status: alert.status,
                    detectedAt: alert.detectedAt,
                    acknowledgedAt: alert.acknowledgedAt,
                    acknowledgedBy: alert.acknowledgedBy,
                    resolvedAt: alert.resolvedAt,
                    resolvedBy: alert.resolvedBy,
                    repeatCount: alert.repeatCount,
                    interface: iface ? { ID: iface.ID, name: iface.name, sourceSystem: iface.sourceSystem, targetSystem: iface.targetSystem } : null,
                    observedMetrics: metrics,
                    explanation: explanation,
                    runbookCited: runbook ? { ID: runbook.ID, title: runbook.title } : null
                }, null, 2);
            }

            // Default to standardized Markdown report
            return generateMarkdownReport(alert, iface, runbook);
        });

        // Function: Landscape Topology Graph & Live Health
        this.on('getTopology', async (req) => {
            const systems = await SELECT.from(Systems);
            const connections = await SELECT.from(Connections);
            const interfaces = await SELECT.from(Interfaces);

            // Fetch snapshots in reverse chronological order to find latest per interface
            const allSnapshots = await SELECT.from(QueueSnapshots).orderBy('capturedAt desc');
            const latestSnapshots = [];
            const seenIface = new Set();
            for (const snap of allSnapshots) {
                const ifaceId = snap.interface_ID;
                if (ifaceId && !seenIface.has(ifaceId)) {
                    seenIface.add(ifaceId);
                    latestSnapshots.push(snap);
                }
            }

            // Fetch active (Open or Acknowledged) alerts
            const activeAlerts = await SELECT.from(Alerts)
                .where({ status: { '!=': 'Resolved' } })
                .and({ status: { '!=': 'Closed' } });

            const topology = buildTopologyGraph(systems, connections, interfaces, latestSnapshots, activeAlerts);
            return JSON.stringify(topology, null, 2);
        });

        // Action: Ingest external integration telemetry
        this.on('ingestTelemetry', async (req) => {
            // Protect against oversized request bodies
            const bodySizeResult = enforceBodySize(req);
            if (bodySizeResult) return bodySizeResult;

            // Rate limit: telemetry ingestion
            const rateLimitResult = enforceRateLimit(req, 'ingestTelemetry', LIMITERS.ingestTelemetry);
            if (rateLimitResult) return rateLimitResult;

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
            // Protect against oversized request bodies
            const bodySizeResult = enforceBodySize(req);
            if (bodySizeResult) return bodySizeResult;

            // Rate limit: simulation trigger
            const rateLimitResult = enforceRateLimit(req, 'triggerSimulation', LIMITERS.triggerSimulation);
            if (rateLimitResult) return rateLimitResult;

            const { scenario, interfaceId } = req.data || {};

            // 1. Validate scenario input against frozen allowlist
            if (scenario && !ALLOWED_SCENARIOS.includes(scenario)) {
                return req.reject(400, `Invalid scenario '${scenario}'. Allowed: ${ALLOWED_SCENARIOS.join(', ')}`);
            }

            // 2. Determine target interface(s)
            let targetInterfaces;
            let isLandscapeWide = false;

            if (interfaceId === 'ALL' || interfaceId === undefined || interfaceId === null) {
                // Landscape-wide cascade: simulate across all active interfaces
                isLandscapeWide = true;
                targetInterfaces = await SELECT.from(Interfaces).where({ active: true });
                if (!targetInterfaces || targetInterfaces.length === 0) {
                    return req.reject(400, 'No active interfaces found for landscape-wide simulation');
                }
            } else {
                // Single interface: validate and lookup
                if (typeof interfaceId !== 'string' || interfaceId.length > 36) {
                    return req.reject(400, 'Invalid interfaceId format');
                }
                const single = await SELECT.one.from(Interfaces).where({ ID: interfaceId });
                if (!single) return req.reject(404, `Interface ${interfaceId} not found`);
                targetInterfaces = [single];
            }

            // 3-4. For each interface: generate snapshot + execute detection pipeline
            const results = [];
            for (const iface of targetInterfaces) {
                const snapshotData = generateSnapshotData(scenario, iface.ID);
                try {
                    const result = await processSnapshotAndEvaluate(
                        { QueueSnapshots, Alerts, Interfaces },
                        iface,
                        snapshotData,
                        `Scenario [${scenario || 'NORMAL'}] executed on ${iface.ID}`
                    );
                    results.push({
                        interfaceId: iface.ID,
                        interfaceName: iface.name,
                        status: result.status,
                        alertTriggered: result.alertTriggered,
                        alertAction: result.alertAction,
                        ruleCode: result.ruleCode,
                        severity: result.severity,
                        repeatCount: result.repeatCount,
                        summary: result.summary,
                        message: result.message,
                        error: null
                    });
                } catch (err) {
                    results.push({
                        interfaceId: iface.ID,
                        interfaceName: iface.name,
                        status: 'Error',
                        alertTriggered: false,
                        alertAction: 'None',
                        ruleCode: null,
                        severity: null,
                        repeatCount: 0,
                        summary: null,
                        message: null,
                        error: err.message || 'Simulation failed'
                    });
                }
            }

            if (isLandscapeWide) {
                const total = results.length;
                const triggered = results.filter(r => r.alertTriggered).length;
                const errors = results.filter(r => r.error).length;
                return {
                    landscapeWide: true,
                    scenario: scenario || 'NORMAL',
                    totalInterfaces: total,
                    interfacesWithAlerts: triggered,
                    interfacesWithErrors: errors,
                    results
                };
            }

            return results[0].message;
        });

        // Action: Configure per-interface threshold policies (Admin only)
        this.on('configureThresholds', async (req) => {
            // Protect against oversized request bodies
            const bodySizeResult = enforceBodySize(req);
            if (bodySizeResult) return bodySizeResult;

            // Rate limit: threshold configuration
            const rateLimitResult = enforceRateLimit(req, 'configureThresholds', LIMITERS.configureThresholds);
            if (rateLimitResult) return rateLimitResult;

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
            // Rate limit: destructive database reset — strictest limit
            const rateLimitResult = enforceRateLimit(req, 'resetToCleanSeed', LIMITERS.resetToCleanSeed);
            if (rateLimitResult) return rateLimitResult;

            // Delete all generated alerts and runtime snapshots
            await DELETE.from(Alerts);
            await DELETE.from(QueueSnapshots);

            // Reset interfaces to default threshold policies
            await UPDATE(Interfaces).with({
                maxRetryThreshold: 100,
                queueGrowthLimit: 200,
                oldMessageAgeLimitSeconds: 600,
                recoveryStalledBacklog: 100
            });

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

        // GET /odata/v4/monitoring/getCurrentUser — Returns the authenticated
        // user's identity and roles from the CDS request context. Backend is
        // the sole source of truth for identity and roles.
        this.on('getCurrentUser', async (req) => {
            if (!req.user) {
                return req.reject(401, 'Authentication required');
            }
            const userRoles = req.user.roles;
            const roleArray = typeof userRoles === 'object' && !Array.isArray(userRoles)
                ? Object.keys(userRoles).filter(r => userRoles[r])
                : Array.isArray(userRoles) ? userRoles : [];
            return {
                userId: req.user.id,
                roles: roleArray
            };
        });

        await super.init();
    }
};
