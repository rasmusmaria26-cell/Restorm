/**
 * Repeatable Synthetic Scenario Simulator
 * (Clean Architecture - Simulation Engine)
 */

const SCENARIOS = {
    NORMAL: {
        pendingCount: 8,
        failedCount: 0,
        retryAttempts: 1,
        successCount: 140,
        oldestPendingAgeSeconds: 15
    },
    RETRY_STORM: {
        pendingCount: 450,
        failedCount: 190,
        retryAttempts: 320,
        successCount: 4,
        oldestPendingAgeSeconds: 780
    },
    QUEUE_GROWTH: {
        pendingCount: 260,
        failedCount: 25,
        retryAttempts: 35,
        successCount: 40,
        oldestPendingAgeSeconds: 290
    },
    PERSISTENT_BACKLOG: {
        pendingCount: 110,
        failedCount: 8,
        retryAttempts: 12,
        successCount: 15,
        oldestPendingAgeSeconds: 1500
    },
    RECOVERY: {
        pendingCount: 18,
        failedCount: 0,
        retryAttempts: 1,
        successCount: 280,
        oldestPendingAgeSeconds: 40
    }
};

function generateSnapshotData(scenarioKey, interfaceId) {
    const template = SCENARIOS[scenarioKey] || SCENARIOS.NORMAL;
    return {
        interface_ID: interfaceId,
        capturedAt: new Date().toISOString(),
        ...template
    };
}

module.exports = {
    SCENARIOS,
    generateSnapshotData
};
