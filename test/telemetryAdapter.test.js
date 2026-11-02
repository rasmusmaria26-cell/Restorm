const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { adaptAndValidateCPITelemetry } = require('../srv/ai/telemetryAdapter');

describe('SAP Telemetry Adapter & Strict Validator', () => {
    const validUuid = '12345678-1234-1234-1234-123456781234';

    it('T1 Valid Telemetry: Successfully adapts and validates a well-formed payload', () => {
        const payload = {
            interfaceId: validUuid,
            timestamp: '2026-10-29T12:00:00.000Z',
            pendingCount: 150,
            failedCount: 2,
            retryAttempts: 10,
            successCount: 500,
            oldestPendingAgeSeconds: 120
        };

        const adapted = adaptAndValidateCPITelemetry(payload);
        assert.equal(adapted.interfaceId, validUuid);
        assert.equal(adapted.pendingCount, 150);
        assert.equal(adapted.retryAttempts, 10);
        assert.equal(adapted.oldestPendingAgeSeconds, 120);
    });

    it('T2 Missing Required Fields: Throws error on missing pendingCount or interfaceId', () => {
        const missingInterface = {
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(missingInterface), /interfaceId/i);

        const missingPending = {
            interfaceId: validUuid,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(missingPending), /pendingCount/i);
    });

    it('T3 Strict Numeric Validation: Rejects malformed strings, floats, and negative values', () => {
        const malformedString = {
            interfaceId: validUuid,
            pendingCount: '12abc',
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(malformedString), /must be an integer/i);

        const floatValue = {
            interfaceId: validUuid,
            pendingCount: 10.5,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(floatValue), /must be an integer/i);

        const negativeValue = {
            interfaceId: validUuid,
            pendingCount: -1,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(negativeValue), /out of allowed bounds/i);
    });

    it('T4 Timestamp Validation: Rejects invalid or future-skewed timestamps', () => {
        const invalidDate = {
            interfaceId: validUuid,
            timestamp: 'not-a-date',
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(invalidDate), /ISO-8601/i);

        const futureDate = {
            interfaceId: validUuid,
            timestamp: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(futureDate), /future/i);
    });

    it('T5 Channel ID Mapping: Resolves external channel ID via interfaceUuidMapping', () => {
        const payload = {
            channelId: 'CPI_IFLOW_001',
            timestamp: '2026-10-29T12:00:00.000Z',
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        const mapping = { 'CPI_IFLOW_001': validUuid };
        const adapted = adaptAndValidateCPITelemetry(payload, mapping);
        assert.equal(adapted.interfaceId, validUuid);
    });

    it('T6 Metrics Object Nesting: Reads metrics from nested metrics object', () => {
        const payload = {
            interfaceId: validUuid,
            timestamp: '2026-10-29T12:00:00.000Z',
            metrics: {
                queued: 200,
                failed: 5,
                retries: 50,
                success: 800,
                maxWaitTime: 300
            }
        };
        const adapted = adaptAndValidateCPITelemetry(payload);
        assert.equal(adapted.pendingCount, 200);
        assert.equal(adapted.failedCount, 5);
        assert.equal(adapted.retryAttempts, 50);
        assert.equal(adapted.successCount, 800);
        assert.equal(adapted.oldestPendingAgeSeconds, 300);
    });

    it('T7 Default Timestamp: Uses current time when capturedAt is missing', () => {
        const payload = {
            interfaceId: validUuid,
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        const adapted = adaptAndValidateCPITelemetry(payload);
        const now = new Date();
        const adaptedTime = new Date(adapted.capturedAt);
        assert.ok(Math.abs(now - adaptedTime) < 5000, 'Timestamp should be within 5 seconds of now');
    });

    it('T8 Alternative Field Names: Accepts alternate field name aliases', () => {
        const payload = {
            interfaceId: validUuid,
            eventTime: '2026-10-29T12:00:00.000Z',
            processing: 100,
            dlq: 3,
            attemptCount: 20,
            completed: 400,
            maxWaitTime: 180
        };
        const adapted = adaptAndValidateCPITelemetry(payload);
        assert.equal(adapted.pendingCount, 100);
        assert.equal(adapted.failedCount, 3);
        assert.equal(adapted.retryAttempts, 20);
        assert.equal(adapted.successCount, 400);
        assert.equal(adapted.oldestPendingAgeSeconds, 180);
    });

    it('T9 Invalid Payload Type: Throws on non-object payload', () => {
        assert.throws(() => adaptAndValidateCPITelemetry(null), /expected an object/);
        assert.throws(() => adaptAndValidateCPITelemetry([1, 2, 3]), /expected an object/);
        assert.throws(() => adaptAndValidateCPITelemetry('string'), /expected an object/);
        assert.throws(() => adaptAndValidateCPITelemetry(42), /expected an object/);
    });

    it('T10 Upper Bound Rejection: Rejects values exceeding 1,000,000', () => {
        const overLimit = {
            interfaceId: validUuid,
            pendingCount: 1000001,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(overLimit), /out of allowed bounds/);
    });

    it('T11 Oldest Pending Age Upper Bound: Rejects values exceeding 2,592,000 (30 days)', () => {
        const overLimit = {
            interfaceId: validUuid,
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 2592001
        };
        assert.throws(() => adaptAndValidateCPITelemetry(overLimit), /out of allowed bounds/);
    });

    it('T12 Seven Days Past Rejection: Rejects timestamps older than 7 days', () => {
        const oldDate = {
            interfaceId: validUuid,
            timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            pendingCount: 10,
            failedCount: 0,
            retryAttempts: 0,
            successCount: 10,
            oldestPendingAgeSeconds: 0
        };
        assert.throws(() => adaptAndValidateCPITelemetry(oldDate), /older than 7 days/);
    });
});
