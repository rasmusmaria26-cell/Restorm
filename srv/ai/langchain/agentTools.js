/**
 * Read-Only Investigation Tools for LangChain Agent
 *
 * Provides five strictly scoped, read-only tools validated with Zod.
 * Enforces cross-interface access control, bounded outputs, and timeouts.
 * No tools exist to modify thresholds, alter queues, or resolve incidents.
 */

const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const cds = require('@sap/cds');
const { retrieveRelevantRunbooks } = require('../runbookRetrieval');
const { withTrace } = require('../observability/langsmithTracing');
const { buildToolMetadata } = require('../observability/traceMetadata');
const { EXECUTION_POLICY } = require('./executionPolicy');

function assertAuthorizedScope(requestedId, authorizedId) {
    if (!authorizedId) return; // If unscoped, allow valid ID
    if (requestedId !== authorizedId) {
        throw new Error(`[AccessDenied] Interface "${requestedId}" is outside the authorized investigation scope "${authorizedId}". Access blocked.`);
    }
}

/**
 * Resolves a CDS entity object or fallback string name.
 */
function resolveEntity(name) {
    if (cds.entities && typeof cds.entities === 'function') {
        try {
            const set = cds.entities('sap.retrysentinel');
            if (set && set[name]) return set[name];
        } catch {}
    }
    return `sap.retrysentinel.${name}`;
}

/**
 * Creates the five read-only investigation tools bound to a specific investigation scope.
 *
 * @param {Object} scopeContext
 * @param {string} scopeContext.authorizedInterfaceId - The interface ID authorized for this investigation
 * @param {Array<Object>} [scopeContext.runbookCatalog] - In-memory runbook catalog (if available)
 * @param {Object} [scopeContext.parentRun] - LangSmith parent run for nested trace recording
 * @returns {Array<Object>} Array of 5 LangChain tool instances
 */
function createIncidentAgentTools(scopeContext = {}) {
    const { authorizedInterfaceId, runbookCatalog = [], parentRun = null } = scopeContext;

    // Tool 1: get_interface_metrics
    const getInterfaceMetricsTool = tool(
        async ({ interfaceId }) => {
            const start = Date.now();
            return await withTrace('restorm.tool.get_interface_metrics', 'tool', async () => {
                assertAuthorizedScope(interfaceId, authorizedInterfaceId);

                let iface = null;
                try {
                    if (cds.db) {
                        const target = resolveEntity('Interfaces');
                        iface = await SELECT.one.from(target).where({ ID: interfaceId });
                    }
                } catch (e) {
                    console.warn('[AgentTools] DB query error in get_interface_metrics:', e.message);
                }

                if (!iface) {
                    return JSON.stringify({
                        interfaceId,
                        status: 'UNKNOWN_OR_NOT_FOUND',
                        message: `Interface ${interfaceId} not found in repository.`
                    });
                }

                // Return only authorized telemetry fields (never return customer payloads)
                return JSON.stringify({
                    interfaceId: iface.ID,
                    name: iface.name,
                    sourceSystem: iface.sourceSystem,
                    targetSystem: iface.targetSystem,
                    healthStatus: iface.healthStatus || 'Healthy',
                    pendingCount: iface.pendingCount ?? 0,
                    retryAttempts: iface.retryAttempts ?? 0,
                    failedCount: iface.failedCount ?? 0,
                    successCount: iface.successCount ?? 0,
                    oldestPendingAgeSeconds: iface.oldestPendingAgeSeconds ?? 0,
                    lastCapturedAt: iface.lastCapturedAt || null,
                    effectiveThresholds: {
                        maxRetryThreshold: iface.maxRetryThreshold ?? 100,
                        queueGrowthLimit: iface.queueGrowthLimit ?? 200,
                        oldMessageAgeLimitSeconds: iface.oldMessageAgeLimitSeconds ?? 600,
                        recoveryStalledBacklog: iface.recoveryStalledBacklog ?? 100
                    }
                });
            }, {
                parentRun,
                metadata: buildToolMetadata('get_interface_metrics', Date.now() - start)
            });
        },
        {
            name: 'get_interface_metrics',
            description: 'Retrieve current operational telemetry metrics and health status for an authorized interface. Read-only.',
            schema: z.object({
                interfaceId: z.string().min(2).max(64).describe('The unique identifier of the interface')
            })
        }
    );

    // Tool 2: get_recent_snapshots
    const getRecentSnapshotsTool = tool(
        async ({ interfaceId, limit }) => {
            const start = Date.now();
            return await withTrace('restorm.tool.get_recent_snapshots', 'tool', async () => {
                assertAuthorizedScope(interfaceId, authorizedInterfaceId);

                const count = Math.min(Math.max(limit || 5, 1), EXECUTION_POLICY.MAX_SNAPSHOTS_LIMIT);
                let snapshots = [];

                try {
                    if (cds.db) {
                        const target = resolveEntity('QueueSnapshots');
                        snapshots = await SELECT.from(target)
                            .where({ interface_ID: interfaceId })
                            .orderBy('capturedAt desc')
                            .limit(count);
                    }
                } catch (e) {
                    console.warn('[AgentTools] DB query error in get_recent_snapshots:', e.message);
                }

                if (!snapshots || snapshots.length === 0) {
                    return JSON.stringify({
                        interfaceId,
                        count: 0,
                        snapshots: [],
                        note: 'No historical snapshots recorded for this interface.'
                    });
                }

                // Return chronologically sorted bounded observations
                const sorted = snapshots.reverse().map(s => ({
                    snapshotId: s.ID,
                    capturedAt: s.capturedAt,
                    pendingCount: s.pendingCount,
                    retryAttempts: s.retryAttempts,
                    failedCount: s.failedCount,
                    successCount: s.successCount,
                    oldestPendingAgeSeconds: s.oldestPendingAgeSeconds
                }));

                return JSON.stringify({
                    interfaceId,
                    count: sorted.length,
                    snapshots: sorted
                });
            }, {
                parentRun,
                metadata: buildToolMetadata('get_recent_snapshots', Date.now() - start)
            });
        },
        {
            name: 'get_recent_snapshots',
            description: 'Retrieve a bounded list of recent historical telemetry observations for the authorized interface, sorted chronologically. Read-only.',
            schema: z.object({
                interfaceId: z.string().min(2).max(64).describe('The unique identifier of the interface'),
                limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of snapshots to return (1-20)')
            })
        }
    );

    // Tool 3: get_active_incidents
    const getActiveIncidentsTool = tool(
        async ({ interfaceId }) => {
            const start = Date.now();
            return await withTrace('restorm.tool.get_active_incidents', 'tool', async () => {
                assertAuthorizedScope(interfaceId, authorizedInterfaceId);

                let alerts = [];
                try {
                    if (cds.db) {
                        const target = resolveEntity('Alerts');
                        alerts = await SELECT.from(target)
                            .where({ interface_ID: interfaceId, status: { in: ['Open', 'Acknowledged'] } })
                            .orderBy('detectedAt desc')
                            .limit(10);
                    }
                } catch (e) {
                    console.warn('[AgentTools] DB query error in get_active_incidents:', e.message);
                }

                return JSON.stringify({
                    interfaceId,
                    activeIncidentCount: alerts.length,
                    incidents: alerts.map(a => ({
                        alertId: a.ID,
                        ruleCode: a.ruleCode,
                        severity: a.severity,
                        status: a.status,
                        detectedAt: a.detectedAt,
                        repeatCount: a.repeatCount || 1,
                        summary: a.summary
                    }))
                });
            }, {
                parentRun,
                metadata: buildToolMetadata('get_active_incidents', Date.now() - start)
            });
        },
        {
            name: 'get_active_incidents',
            description: 'Retrieve active open incidents currently associated with the authorized interface. Read-only.',
            schema: z.object({
                interfaceId: z.string().min(2).max(64).describe('The unique identifier of the interface')
            })
        }
    );

    // Tool 4: search_runbooks
    const searchRunbooksTool = tool(
        async ({ query, ruleCode }) => {
            const start = Date.now();
            return await withTrace('restorm.tool.search_runbooks', 'tool', async () => {
                let catalog = Array.isArray(runbookCatalog) && runbookCatalog.length > 0
                    ? runbookCatalog
                    : [];

                if (catalog.length === 0 && cds.db) {
                    try {
                        const target = resolveEntity('RunbookEntries');
                        catalog = await SELECT.from(target);
                    } catch (e) {
                        console.warn('[AgentTools] DB query error in search_runbooks:', e.message);
                    }
                }

                const syntheticAlert = {
                    ruleCode: ruleCode || '',
                    message: query || '',
                    observedMetrics: query || ''
                };

                const results = retrieveRelevantRunbooks(syntheticAlert, catalog, {
                    topK: EXECUTION_POLICY.MAX_RUNBOOK_RESULTS
                });

                return JSON.stringify({
                    query,
                    ruleCode,
                    resultCount: results.length,
                    runbooks: results.map(rb => ({
                        ID: rb.ID,
                        ruleCode: rb.ruleCode,
                        title: rb.title,
                        symptoms: rb.symptoms,
                        recommendedChecks: rb.checks,
                        limitations: rb.limitations
                    }))
                });
            }, {
                parentRun,
                metadata: buildToolMetadata('search_runbooks', Date.now() - start)
            });
        },
        {
            name: 'search_runbooks',
            description: 'Search the approved enterprise runbook catalog for guidance matching a rule code or symptom keywords. Read-only.',
            schema: z.object({
                query: z.string().max(200).describe('Search query, symptom description, or keyword'),
                ruleCode: z.string().max(50).optional().describe('Optional rule code to filter by (e.g. EXCESSIVE_RETRIES)')
            })
        }
    );

    // Tool 5: get_threshold_policy
    const getThresholdPolicyTool = tool(
        async ({ interfaceId }) => {
            const start = Date.now();
            return await withTrace('restorm.tool.get_threshold_policy', 'tool', async () => {
                assertAuthorizedScope(interfaceId, authorizedInterfaceId);

                let iface = null;
                try {
                    if (cds.db) {
                        const target = resolveEntity('Interfaces');
                        iface = await SELECT.one.from(target).where({ ID: interfaceId });
                    }
                } catch (e) {
                    console.warn('[AgentTools] DB query error in get_threshold_policy:', e.message);
                }

                return JSON.stringify({
                    interfaceId,
                    effectivePolicy: {
                        maxRetryThreshold: iface?.maxRetryThreshold ?? 100,
                        queueGrowthLimit: iface?.queueGrowthLimit ?? 200,
                        oldMessageAgeLimitSeconds: iface?.oldMessageAgeLimitSeconds ?? 600,
                        recoveryStalledBacklog: iface?.recoveryStalledBacklog ?? 100
                    },
                    isCustomOverride: Boolean(iface?.maxRetryThreshold !== undefined),
                    readOnlyNotice: 'Threshold modifications require human administrator approval via MonitoringService.'
                });
            }, {
                parentRun,
                metadata: buildToolMetadata('get_threshold_policy', Date.now() - start)
            });
        },
        {
            name: 'get_threshold_policy',
            description: 'Retrieve the effective sensitivity and threshold configuration policy for an authorized interface. Read-only.',
            schema: z.object({
                interfaceId: z.string().min(2).max(64).describe('The unique identifier of the interface')
            })
        }
    );

    return [
        getInterfaceMetricsTool,
        getRecentSnapshotsTool,
        getActiveIncidentsTool,
        searchRunbooksTool,
        getThresholdPolicyTool
    ];
}

module.exports = {
    createIncidentAgentTools,
    assertAuthorizedScope
};
