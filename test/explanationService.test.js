const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateGroundedExplanation } = require('../srv/ai/explanationService');

describe('AI Grounded Explanation Service', () => {

    it('T8 Grounded Output: Citations and hypotheses correctly match curated runbook entry', () => {
        const mockAlert = {
            ID: 'alert-123',
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            observedMetrics: JSON.stringify({
                pendingCount: 450,
                retryAttempts: 320,
                failedCount: 190,
                oldestPendingAgeSeconds: 780
            })
        };

        const mockRunbook = {
            ID: 'rb-001',
            ruleCode: 'EXCESSIVE_RETRIES',
            title: 'Destination System Timeout / Rate Limiting',
            symptoms: 'Sudden spike in retryAttempts while pending count accumulates.',
            checks: '1. Inspect target system response codes. 2. Verify retry interval.',
            limitations: 'Does not pinpoint whether failure is network layer or target application crash.',
            keywords: 'retry,timeout,429'
        };

        const explanation = generateGroundedExplanation(mockAlert, mockRunbook);

        assert.ok(explanation.summary.includes('EXCESSIVE_RETRIES'));
        assert.ok(explanation.summary.includes('Critical'));
        assert.equal(explanation.observedFacts.retryAttempts, 320);
        assert.equal(explanation.observedFacts.pendingCount, 450);
        assert.deepEqual(explanation.citedRunbookIds, ['rb-001']);
        assert.deepEqual(explanation.possibleHypotheses, [mockRunbook.symptoms]);
        assert.ok(explanation.recommendedChecks.length >= 2);
        assert.equal(explanation.limitations, mockRunbook.limitations);
    });

    it('T8 Fallback: Gracefully handles missing runbook entry with clear uncertainty disclaimer', () => {
        const mockAlert = {
            ID: 'alert-999',
            ruleCode: 'UNKNOWN_RULE',
            severity: 'Warning',
            observedMetrics: '{"pendingCount": 50}'
        };

        const explanation = generateGroundedExplanation(mockAlert, null);

        assert.deepEqual(explanation.citedRunbookIds, []);
        assert.ok(explanation.limitations.includes('Metrics describe queue state'));
        assert.ok(explanation.possibleHypotheses[0].includes('Unspecified'));
    });

    it('Robustness: Gracefully handles malformed JSON observedMetrics', () => {
        const mockAlert = {
            ID: 'alert-malformed',
            ruleCode: 'QUEUE_GROWTH',
            severity: 'High',
            observedMetrics: 'INVALID_NON_JSON'
        };

        const explanation = generateGroundedExplanation(mockAlert, null);
        assert.equal(explanation.observedFacts.raw, 'INVALID_NON_JSON');
    });
});
