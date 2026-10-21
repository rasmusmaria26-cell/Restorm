const cds = require('@sap/cds');
const { evaluateMetrics } = require('./detectionEngine');

/**
 * Validates an integer field within specific numeric bounds.
 * Rejects floats, strings, negative numbers, and out-of-bounds values.
 *
 * @param {*} val - Value to validate
 * @param {string} name - Field name for error reporting
 * @param {number} min - Minimum allowed integer
 * @param {number} max - Maximum allowed integer
 * @returns {{ valid: boolean, error?: string, value?: number }}
 */
function validateIntegerBound(val, name, min = 0, max = 1000000) {
    if (val === undefined || val === null) {
        return { valid: false, error: `Field '${name}' is required` };
    }
    if (typeof val !== 'number' || !Number.isInteger(val)) {
        return { valid: false, error: `Field '${name}' must be an integer, got ${typeof val === 'number' ? 'float' : typeof val}` };
    }
    if (val < min || val > max) {
        return { valid: false, error: `Field '${name}' out of allowed bounds [${min}, ${max}], got ${val}` };
    }
    return { valid: true, value: val };
}

/**
 * Validates an ISO-8601 capturedAt timestamp within a realistic temporal window.
 *
 * @param {*} capturedAt - Timestamp string or undefined
 * @returns {{ valid: boolean, error?: string, value?: string }}
 */
function validateTimestamp(capturedAt) {
    if (capturedAt === undefined || capturedAt === null) {
        return { valid: true, value: new Date().toISOString() };
    }
    if (typeof capturedAt !== 'string') {
        return { valid: false, error: "Field 'capturedAt' must be a valid ISO-8601 date string" };
    }
    const parsed = Date.parse(capturedAt);
    if (Number.isNaN(parsed)) {
        return { valid: false, error: "Field 'capturedAt' must be a valid ISO-8601 date string" };
    }

    const now = Date.now();
    // Rejects timestamps > 5 minutes in the future (clock skew defense)
    if (parsed > now + 5 * 60 * 1000) {
        return { valid: false, error: "Field 'capturedAt' cannot be more than 5 minutes in the future" };
    }
    // Rejects telemetry older than 7 days
    if (parsed < now - 7 * 24 * 60 * 60 * 1000) {
        return { valid: false, error: "Field 'capturedAt' cannot be older than 7 days" };
    }

    return { valid: true, value: new Date(parsed).toISOString() };
}

/**
 * Core Ingestion Pipeline
 * Persists snapshot, performs differential metric checks, and applies alert deduplication.
 *
 * @param {Object} entities - CDS entities { QueueSnapshots, Alerts }
 * @param {string} targetInterfaceId - Target interface UUID
 * @param {Object} snapshotData - Validated metric data
 * @param {string} sourceDescription - Origin context ('Ingested' or scenario name)
 * @returns {Promise<Object>} Execution outcome
 */
async function processSnapshotAndEvaluate(entities, targetInterfaceId, snapshotData, sourceDescription = 'Ingested') {
    const { QueueSnapshots, Alerts } = entities;

    // 1. Retrieve preceding snapshot for differential analysis (e.g. Rule D: Recovery Stalled)
    const previousSnapshot = await SELECT.one.from(QueueSnapshots)
        .where({ interface_ID: targetInterfaceId })
        .orderBy('capturedAt desc');

    // 2. Persist snapshot
    await INSERT.into(QueueSnapshots).entries(snapshotData);

    // 3. Evaluate metrics via Detection Engine
    const detectionResult = evaluateMetrics(snapshotData, previousSnapshot);

    // 4. Persist or Deduplicate Alert if triggered
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
            interface_ID: targetInterfaceId,
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

            return {
                status: 'Accepted',
                alertTriggered: true,
                alertAction: 'Updated',
                ruleCode: detectionResult.ruleCode,
                severity: detectionResult.severity,
                repeatCount: updatedRepeatCount,
                summary: detectionResult.summary,
                message: `${sourceDescription}: Snapshot saved. Active Alert [${detectionResult.ruleCode}] updated (deduplicated, occurrence #${updatedRepeatCount}).`
            };
        }

        // New incident: persist new Alert record
        await INSERT.into(Alerts).entries({
            interface_ID: targetInterfaceId,
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

        return {
            status: 'Accepted',
            alertTriggered: true,
            alertAction: 'Created',
            ruleCode: detectionResult.ruleCode,
            severity: detectionResult.severity,
            repeatCount: 1,
            summary: detectionResult.summary,
            message: `${sourceDescription}: Snapshot saved & Alert [${detectionResult.ruleCode}] created (${detectionResult.severity}).`
        };
    }

    return {
        status: 'Accepted',
        alertTriggered: false,
        alertAction: 'None',
        summary: 'System operating normally.',
        message: `${sourceDescription}: Snapshot saved. System operating normally.`
    };
}

module.exports = {
    validateIntegerBound,
    validateTimestamp,
    processSnapshotAndEvaluate
};
