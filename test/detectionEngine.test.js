const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMetrics, THRESHOLDS } = require('../srv/core/detectionEngine');

describe('Detection Engine - Deterministic Rule Evaluator', () => {

    it('T1 Normal: Normal metrics produce no alert', () => {
        const normalMetrics = {
            pendingCount: 8,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 140,
            oldestPendingAgeSeconds: 15
        };

        const result = evaluateMetrics(normalMetrics);
        assert.equal(result.triggered, false);
        assert.equal(result.ruleCode, undefined);
    });

    it('T2 Retry Storm: Excessive retry attempts trigger Critical alert (Rule A)', () => {
        const stormMetrics = {
            pendingCount: 450,
            failedCount: 190,
            retryAttempts: 320,
            successCount: 4,
            oldestPendingAgeSeconds: 780
        };

        const result = evaluateMetrics(stormMetrics);
        assert.equal(result.triggered, true);
        assert.equal(result.ruleCode, 'EXCESSIVE_RETRIES');
        assert.equal(result.severity, 'Critical');
        assert.match(result.summary, /Excessive retries detected/);
        assert.match(result.summary, /320/);
    });

    it('T3 Queue Growth: Backlog accumulation triggers High alert (Rule B)', () => {
        const growthMetrics = {
            pendingCount: 260,
            failedCount: 25,
            retryAttempts: 35,
            successCount: 40,
            oldestPendingAgeSeconds: 290
        };

        const result = evaluateMetrics(growthMetrics);
        assert.equal(result.triggered, true);
        assert.equal(result.ruleCode, 'QUEUE_GROWTH');
        assert.equal(result.severity, 'High');
        assert.match(result.summary, /Dangerous queue accumulation/);
        assert.match(result.summary, /260/);
    });

    it('T4 Old Message Age: Stale messages breaching SLA trigger High alert (Rule C)', () => {
        const staleMetrics = {
            pendingCount: 50,
            failedCount: 2,
            retryAttempts: 5,
            successCount: 60,
            oldestPendingAgeSeconds: 750
        };

        const result = evaluateMetrics(staleMetrics);
        assert.equal(result.triggered, true);
        assert.equal(result.ruleCode, 'OLD_MESSAGE_AGE');
        assert.equal(result.severity, 'High');
        assert.match(result.summary, /breached SLA limit/);
        assert.match(result.summary, /750s/);
    });

    it('T5 Recovery Stalled: Destination recovered but queue fails to drain triggers High alert (Rule D)', () => {
        const stalledMetrics = {
            pendingCount: 300,
            failedCount: 0,
            retryAttempts: 2,
            successCount: 10,
            oldestPendingAgeSeconds: 700
        };

        const previousMetrics = {
            pendingCount: 280,
            failedCount: 50,
            retryAttempts: 120
        };

        const result = evaluateMetrics(stalledMetrics, previousMetrics);
        assert.equal(result.triggered, true);
        assert.equal(result.ruleCode, 'RECOVERY_STALLED');
        assert.equal(result.severity, 'High');
        assert.match(result.summary, /Post-recovery queue drain stalled/);
    });

    it('T5 Recovery Succeeded: Destination recovered and queue drains produces no alert', () => {
        const drainedMetrics = {
            pendingCount: 18,
            failedCount: 0,
            retryAttempts: 1,
            successCount: 280,
            oldestPendingAgeSeconds: 40
        };

        const previousMetrics = {
            pendingCount: 450,
            failedCount: 190,
            retryAttempts: 320
        };

        const result = evaluateMetrics(drainedMetrics, previousMetrics);
        assert.equal(result.triggered, false);
    });

    it('Edge Cases: Handles empty, null, or undefined metrics gracefully', () => {
        assert.equal(evaluateMetrics(null).triggered, false);
        assert.equal(evaluateMetrics(undefined).triggered, false);
        assert.equal(evaluateMetrics({}).triggered, false);
        assert.equal(evaluateMetrics("not an object").triggered, false);
    });
});
