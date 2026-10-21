const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateSnapshotData, ALLOWED_SCENARIOS, SCENARIOS } = require('../srv/core/simulator');

describe('Simulator Engine - Input Validation & Prototype Safety', () => {

    it('T1 Scenario Generation: Returns valid snapshot for all allowed scenarios', () => {
        for (const scenario of ALLOWED_SCENARIOS) {
            const snapshot = generateSnapshotData(scenario, 'test-interface-uuid');
            assert.equal(snapshot.interface_ID, 'test-interface-uuid');
            assert.ok(snapshot.capturedAt);
            assert.equal(typeof snapshot.pendingCount, 'number');
            assert.equal(typeof snapshot.retryAttempts, 'number');
            assert.equal(typeof snapshot.failedCount, 'number');
            assert.equal(typeof snapshot.successCount, 'number');
            assert.equal(typeof snapshot.oldestPendingAgeSeconds, 'number');
        }
    });

    it('T7 Prototype Pollution Defense: Built-in properties safely fallback to NORMAL', () => {
        const dangerousKeys = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];
        
        for (const key of dangerousKeys) {
            const snapshot = generateSnapshotData(key);
            assert.equal(snapshot.pendingCount, SCENARIOS.NORMAL.pendingCount);
            assert.equal(snapshot.retryAttempts, SCENARIOS.NORMAL.retryAttempts);
            assert.equal(snapshot.failedCount, SCENARIOS.NORMAL.failedCount);
            assert.equal(typeof snapshot.capturedAt, 'string');
        }
    });

    it('T7 Input Validation: Invalid types and unknown scenarios safely fallback to NORMAL', () => {
        const invalidInputs = [null, undefined, 12345, true, {}, [], 'UNKNOWN_SCENARIO', 'DROP TABLE'];
        
        for (const input of invalidInputs) {
            const snapshot = generateSnapshotData(input);
            assert.equal(snapshot.pendingCount, SCENARIOS.NORMAL.pendingCount);
            assert.equal(snapshot.retryAttempts, SCENARIOS.NORMAL.retryAttempts);
        }
    });

    it('T7 Interface ID Sanitization: Oversized or non-string IDs are rejected or defaulted', () => {
        const validId = '11111111-1111-1111-1111-111111111111';
        assert.equal(generateSnapshotData('NORMAL', validId).interface_ID, validId);

        // Oversized ID (> 36 chars)
        const oversizedId = 'a'.repeat(40);
        assert.equal(generateSnapshotData('NORMAL', oversizedId).interface_ID, null);

        // Object injection attempt
        assert.equal(generateSnapshotData('NORMAL', { bad: 1 }).interface_ID, null);

        // Undefined preserves undefined
        assert.equal(generateSnapshotData('NORMAL', undefined).interface_ID, undefined);
    });

    it('Immutability: Templates cannot be modified through generated snapshot objects', () => {
        const snapshot = generateSnapshotData('NORMAL');
        snapshot.pendingCount = 99999;
        assert.equal(SCENARIOS.NORMAL.pendingCount, 8, 'Original NORMAL template was mutated!');
    });
});
