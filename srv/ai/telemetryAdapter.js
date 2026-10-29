/**
 * SAP Cloud Integration (CPI) v1 Telemetry Adapter & Strict Validator
 */

/**
 * Validates and normalizes raw external telemetry payloads without permissive coercion.
 * Rejects malformed strings, floats, negative values, and missing required metrics.
 */
function adaptAndValidateCPITelemetry(externalPayload, interfaceUuidMapping = {}) {
    if (!externalPayload || typeof externalPayload !== 'object' || Array.isArray(externalPayload)) {
        throw new Error("Invalid telemetry payload: expected an object");
    }

    // Required Interface Identification
    const sourceChannel = externalPayload.channelId || externalPayload.integrationFlowId || externalPayload.interfaceId;
    if (!sourceChannel || typeof sourceChannel !== 'string' || !sourceChannel.trim()) {
        throw new Error("Missing required field 'interfaceId' or channel identifier");
    }

    const mappedInterfaceId = interfaceUuidMapping[sourceChannel] || sourceChannel;

    // Helper for strict integer validation (no parseInt or float coercion)
    const parseStrictInt = (val, fieldName, min = 0, max = 1000000) => {
        if (val === undefined || val === null || val === '') {
            throw new Error(`Field '${fieldName}' is required`);
        }
        if (typeof val === 'string') {
            if (!/^\d+$/.test(val.trim())) {
                throw new Error(`Field '${fieldName}' must be an integer, got string: '${val}'`);
            }
        }
        if (typeof val !== 'number' && typeof val !== 'string') {
            throw new Error(`Field '${fieldName}' must be an integer`);
        }
        const num = Number(val);
        if (!Number.isInteger(num)) {
            throw new Error(`Field '${fieldName}' must be an integer`);
        }
        if (num < min || num > max) {
            throw new Error(`Field '${fieldName}' out of allowed bounds [${min}, ${max}], got ${num}`);
        }
        return num;
    };

    const metrics = externalPayload.metrics && typeof externalPayload.metrics === 'object' ? externalPayload.metrics : externalPayload;

    const pendingCount = parseStrictInt(metrics.pendingCount ?? metrics.queued ?? metrics.processing, 'pendingCount', 0, 1000000);
    const failedCount = parseStrictInt(metrics.failedCount ?? metrics.failed ?? metrics.dlq, 'failedCount', 0, 1000000);
    const retryAttempts = parseStrictInt(metrics.retryAttempts ?? metrics.retries ?? metrics.attempts, 'retryAttempts', 0, 1000000);
    const successCount = parseStrictInt(metrics.successCount ?? metrics.success ?? metrics.completed, 'successCount', 0, 1000000);
    const oldestPendingAgeSeconds = parseStrictInt(metrics.oldestPendingAgeSeconds ?? metrics.oldestAgeSec ?? metrics.maxWaitTime, 'oldestPendingAgeSeconds', 0, 2592000);

    let capturedAt = externalPayload.timestamp || externalPayload.capturedAt || externalPayload.eventTime;
    if (capturedAt !== undefined && capturedAt !== null) {
        if (typeof capturedAt !== 'string') {
            throw new Error("Field 'capturedAt' must be a valid ISO-8601 date string");
        }
        const parsed = Date.parse(capturedAt);
        if (Number.isNaN(parsed)) {
            throw new Error("Field 'capturedAt' must be a valid ISO-8601 date string");
        }
        const now = Date.now();
        if (parsed > now + 5 * 60 * 1000) {
            throw new Error("Field 'capturedAt' cannot be more than 5 minutes in the future");
        }
        if (parsed < now - 7 * 24 * 60 * 60 * 1000) {
            throw new Error("Field 'capturedAt' cannot be older than 7 days");
        }
        capturedAt = new Date(parsed).toISOString();
    } else {
        capturedAt = new Date().toISOString();
    }

    return {
        interfaceId: mappedInterfaceId,
        capturedAt,
        pendingCount,
        failedCount,
        retryAttempts,
        successCount,
        oldestPendingAgeSeconds
    };
}

module.exports = {
    adaptAndValidateCPITelemetry
};
