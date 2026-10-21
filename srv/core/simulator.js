/**
 * Repeatable Synthetic Scenario Simulator
 * (Clean Architecture - Simulation Engine)
 */

const ALLOWED_SCENARIOS = Object.freeze([
    'NORMAL',
    'RETRY_STORM',
    'QUEUE_GROWTH',
    'PERSISTENT_BACKLOG',
    'RECOVERY',
    'RECOVERY_STALLED'
]);

const SCENARIOS = Object.freeze({
    NORMAL: Object.freeze({
        pendingCount: 8,
        failedCount: 0,
        retryAttempts: 1,
        successCount: 140,
        oldestPendingAgeSeconds: 15
    }),
    RETRY_STORM: Object.freeze({
        pendingCount: 450,
        failedCount: 190,
        retryAttempts: 320,
        successCount: 4,
        oldestPendingAgeSeconds: 780
    }),
    QUEUE_GROWTH: Object.freeze({
        pendingCount: 260,
        failedCount: 25,
        retryAttempts: 35,
        successCount: 40,
        oldestPendingAgeSeconds: 290
    }),
    PERSISTENT_BACKLOG: Object.freeze({
        pendingCount: 110,
        failedCount: 8,
        retryAttempts: 12,
        successCount: 15,
        oldestPendingAgeSeconds: 1500
    }),
    RECOVERY: Object.freeze({
        pendingCount: 18,
        failedCount: 0,
        retryAttempts: 1,
        successCount: 280,
        oldestPendingAgeSeconds: 40
    }),
    RECOVERY_STALLED: Object.freeze({
        pendingCount: 320,
        failedCount: 0,
        retryAttempts: 2,
        successCount: 15,
        oldestPendingAgeSeconds: 700
    })
});

function generateSnapshotData(scenarioKey, interfaceId) {
    const safeKey = (
        typeof scenarioKey === 'string' &&
        ALLOWED_SCENARIOS.includes(scenarioKey) &&
        Object.prototype.hasOwnProperty.call(SCENARIOS, scenarioKey)
    ) ? scenarioKey : 'NORMAL';

    const safeInterfaceId = (typeof interfaceId === 'string' && interfaceId.length <= 36)
        ? interfaceId
        : (interfaceId === undefined ? undefined : null);

    const template = SCENARIOS[safeKey];

    // Defensive copy ensuring no mutation or leaking of internal templates
    return {
        interface_ID: safeInterfaceId,
        scenario: safeKey,
        capturedAt: new Date().toISOString(),
        pendingCount: template.pendingCount,
        failedCount: template.failedCount,
        retryAttempts: template.retryAttempts,
        successCount: template.successCount,
        oldestPendingAgeSeconds: template.oldestPendingAgeSeconds
    };
}

module.exports = {
    SCENARIOS,
    ALLOWED_SCENARIOS,
    generateSnapshotData
};
