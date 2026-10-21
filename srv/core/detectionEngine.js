/**
 * Detection rules configuration & deterministic evaluator
 * (Clean Architecture - Domain/Core Service)
 */

const DEFAULT_THRESHOLDS = Object.freeze({
    EXCESSIVE_RETRIES: 100,         // Rule A: Max retry attempts per evaluation interval
    QUEUE_GROWTH_LIMIT: 200,        // Rule B: Total backlog limit before growth warning
    OLD_MESSAGE_AGE_SEC: 600,       // Rule C: 10 minutes max age before SLA alert
    RECOVERY_STALLED_PENDING: 100,  // Rule D: Minimum pending queue threshold for stalled recovery
    RECOVERY_MAX_RETRIES: 5,        // Rule D: Max retries to consider destination recovered
    RECOVERY_MAX_FAILURES: 0        // Rule D: Max failures to consider destination recovered
});

/**
 * Evaluates queue metrics against deterministic threshold rules.
 * Supports optional previousMetrics for trend analysis (Rule D: Recovery Stalled),
 * and per-interface customThresholds with safe fallback to DEFAULT_THRESHOLDS.
 *
 * @param {Object} metrics - Current snapshot metrics
 * @param {Object} [previousMetrics=null] - Preceding snapshot metrics for differential checks
 * @param {Object} [customThresholds=null] - Per-interface threshold policy
 * @returns {Object} Evaluation result { triggered: boolean, ruleCode?: string, severity?: string, summary?: string }
 */
function evaluateMetrics(metrics, previousMetrics = null, customThresholds = null) {
    if (!metrics || typeof metrics !== 'object') {
        return { triggered: false };
    }

    // Resolve active thresholds: fallback safely to DEFAULT_THRESHOLDS if property is missing or non-integer
    const getThreshold = (primaryKey, secondaryKey, defaultVal) => {
        const val1 = customThresholds?.[primaryKey];
        if (Number.isInteger(val1) && val1 > 0) return val1;
        const val2 = customThresholds?.[secondaryKey];
        if (Number.isInteger(val2) && val2 > 0) return val2;
        return defaultVal;
    };

    const thresholds = {
        EXCESSIVE_RETRIES: getThreshold('maxRetryThreshold', 'EXCESSIVE_RETRIES', DEFAULT_THRESHOLDS.EXCESSIVE_RETRIES),
        QUEUE_GROWTH_LIMIT: getThreshold('queueGrowthLimit', 'QUEUE_GROWTH_LIMIT', DEFAULT_THRESHOLDS.QUEUE_GROWTH_LIMIT),
        OLD_MESSAGE_AGE_SEC: getThreshold('oldMessageAgeLimitSeconds', 'OLD_MESSAGE_AGE_SEC', DEFAULT_THRESHOLDS.OLD_MESSAGE_AGE_SEC),
        RECOVERY_STALLED_PENDING: getThreshold('recoveryStalledBacklog', 'RECOVERY_STALLED_PENDING', DEFAULT_THRESHOLDS.RECOVERY_STALLED_PENDING),
        RECOVERY_MAX_RETRIES: DEFAULT_THRESHOLDS.RECOVERY_MAX_RETRIES,
        RECOVERY_MAX_FAILURES: DEFAULT_THRESHOLDS.RECOVERY_MAX_FAILURES
    };

    const {
        pendingCount = 0,
        retryAttempts = 0,
        failedCount = 0,
        successCount = 0,
        oldestPendingAgeSeconds = 0
    } = metrics;

    // Rule A: Excessive Retries (Critical)
    if (retryAttempts >= thresholds.EXCESSIVE_RETRIES) {
        return {
            triggered: true,
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            summary: `Excessive retries detected (${retryAttempts} attempts >= limit ${thresholds.EXCESSIVE_RETRIES}).`
        };
    }

    // Rule D: Recovery Stalled (High)
    // Destination system recovered (low retries and zero failures), but pending queue fails to drain
    const isDestinationRecovered = retryAttempts <= thresholds.RECOVERY_MAX_RETRIES && failedCount <= thresholds.RECOVERY_MAX_FAILURES;
    const isBacklogElevated = pendingCount >= thresholds.RECOVERY_STALLED_PENDING;

    // Drain is stalled if consumer throughput is depressed (< 30) or queue depth failed to decrease
    let isDrainStalled = successCount < 30;
    if (previousMetrics && typeof previousMetrics === 'object') {
        isDrainStalled = isDrainStalled || pendingCount >= (previousMetrics.pendingCount || 0);
    }

    if (isDestinationRecovered && isBacklogElevated && isDrainStalled) {
        return {
            triggered: true,
            ruleCode: 'RECOVERY_STALLED',
            severity: 'High',
            summary: `Post-recovery queue drain stalled (${pendingCount} pending >= threshold ${thresholds.RECOVERY_STALLED_PENDING} without expected reduction).`
        };
    }

    // Rule B: Queue Growth (High)
    if (pendingCount >= thresholds.QUEUE_GROWTH_LIMIT) {
        return {
            triggered: true,
            ruleCode: 'QUEUE_GROWTH',
            severity: 'High',
            summary: `Dangerous queue accumulation (${pendingCount} pending >= threshold ${thresholds.QUEUE_GROWTH_LIMIT}).`
        };
    }

    // Rule C: Old Message Age (High)
    if (oldestPendingAgeSeconds >= thresholds.OLD_MESSAGE_AGE_SEC) {
        return {
            triggered: true,
            ruleCode: 'OLD_MESSAGE_AGE',
            severity: 'High',
            summary: `Oldest message age (${oldestPendingAgeSeconds}s) breached SLA limit of ${thresholds.OLD_MESSAGE_AGE_SEC}s.`
        };
    }

    return { triggered: false };
}

module.exports = {
    DEFAULT_THRESHOLDS,
    THRESHOLDS: DEFAULT_THRESHOLDS, // Preserved for backward compatibility
    evaluateMetrics
};
