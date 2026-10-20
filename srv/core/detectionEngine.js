/**
 * Detection rules configuration & deterministic evaluator
 * (Clean Architecture - Domain/Core Service)
 */

const THRESHOLDS = {
    EXCESSIVE_RETRIES: 100,      // Max retry attempts per evaluation interval
    QUEUE_GROWTH_LIMIT: 200,     // Total backlog limit before growth warning
    OLD_MESSAGE_AGE_SEC: 600     // 10 minutes max age before SLA alert
};

function evaluateMetrics(metrics) {
    const { pendingCount, retryAttempts, oldestPendingAgeSeconds } = metrics;

    if (retryAttempts >= THRESHOLDS.EXCESSIVE_RETRIES) {
        return {
            triggered: true,
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            summary: `Excessive retries detected (${retryAttempts} attempts >= limit ${THRESHOLDS.EXCESSIVE_RETRIES}).`
        };
    }

    if (pendingCount >= THRESHOLDS.QUEUE_GROWTH_LIMIT) {
        return {
            triggered: true,
            ruleCode: 'QUEUE_GROWTH',
            severity: 'High',
            summary: `Dangerous queue accumulation (${pendingCount} pending >= threshold ${THRESHOLDS.QUEUE_GROWTH_LIMIT}).`
        };
    }

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
