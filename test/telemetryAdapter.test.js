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
});
