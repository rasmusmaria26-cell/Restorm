/**
 * Detection rules configuration & deterministic evaluator
 * (Clean Architecture - Domain/Core Service)
 */

const THRESHOLDS = Object.freeze({
    EXCESSIVE_RETRIES: 100,         // Rule A: Max retry attempts per evaluation interval
    QUEUE_GROWTH_LIMIT: 200,        // Rule B: Total backlog limit before growth warning
    OLD_MESSAGE_AGE_SEC: 600,       // Rule C: 10 minutes max age before SLA alert
    RECOVERY_STALLED_PENDING: 100,  // Rule D: Minimum pending queue threshold for stalled recovery
    RECOVERY_MAX_RETRIES: 5,        // Rule D: Max retries to consider destination recovered
    RECOVERY_MAX_FAILURES: 0        // Rule D: Max failures to consider destination recovered
});

/**
 * Evaluates queue metrics against deterministic threshold rules.
 * Supports optional previousMetrics for trend analysis (Rule D: Recovery Stalled).
 *
 * @param {Object} metrics - Current snapshot metrics
 * @param {Object} [previousMetrics=null] - Preceding snapshot metrics for differential checks
 * @returns {Object} Evaluation result { triggered: boolean, ruleCode?: string, severity?: string, summary?: string }
 */
function evaluateMetrics(metrics, previousMetrics = null) {
    if (!metrics || typeof metrics !== 'object') {
        return { triggered: false };
    }

    const {
        pendingCount = 0,
        retryAttempts = 0,
        failedCount = 0,
        successCount = 0,
        oldestPendingAgeSeconds = 0
    } = metrics;

    // Rule A: Excessive Retries (Critical)
    if (retryAttempts >= THRESHOLDS.EXCESSIVE_RETRIES) {
        return {
            triggered: true,
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            summary: `Excessive retries detected (${retryAttempts} attempts >= limit ${THRESHOLDS.EXCESSIVE_RETRIES}).`
        };
    }

    // Rule D: Recovery Stalled (High)
    // Destination system recovered (low retries and zero failures), but pending queue fails to drain
    const isDestinationRecovered = retryAttempts <= THRESHOLDS.RECOVERY_MAX_RETRIES && failedCount <= THRESHOLDS.RECOVERY_MAX_FAILURES;
    const isBacklogElevated = pendingCount >= THRESHOLDS.RECOVERY_STALLED_PENDING;

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
            summary: `Post-recovery queue drain stalled (${pendingCount} pending >= threshold ${THRESHOLDS.RECOVERY_STALLED_PENDING} without expected reduction).`
        };
    }

    // Rule B: Queue Growth (High)
    if (pendingCount >= THRESHOLDS.QUEUE_GROWTH_LIMIT) {
        return {
            triggered: true,
            ruleCode: 'QUEUE_GROWTH',
            severity: 'High',
            summary: `Dangerous queue accumulation (${pendingCount} pending >= threshold ${THRESHOLDS.QUEUE_GROWTH_LIMIT}).`
        };
    }

    // Rule C: Old Message Age (High)
    if (oldestPendingAgeSeconds >= THRESHOLDS.OLD_MESSAGE_AGE_SEC) {
        return {
            triggered: true,
            ruleCode: 'OLD_MESSAGE_AGE',
            severity: 'High',
            summary: `Oldest message age (${oldestPendingAgeSeconds}s) breached SLA limit of ${THRESHOLDS.OLD_MESSAGE_AGE_SEC}s.`
        };
    }

    return { triggered: false };
}

module.exports = {
    THRESHOLDS,
    evaluateMetrics
};
