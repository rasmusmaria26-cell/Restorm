const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateGroundedExplanation, validateModelOutput } = require('../srv/ai/explanationService');

describe('AI Grounded Explanation Service', () => {

    it('T8 Grounded Output: Citations and hypotheses correctly match curated runbook entry (Deterministic Mode)', async () => {
        const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
        const savedGeminiKey = process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;

        try {
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

            const explanation = await generateGroundedExplanation(mockAlert, mockRunbook);

            assert.equal(explanation.aiAssisted, false);
            assert.ok(explanation.summary.includes('EXCESSIVE_RETRIES'));
            assert.ok(explanation.summary.includes('Critical'));
            assert.equal(explanation.observedFacts.retryAttempts, 320);
            assert.equal(explanation.observedFacts.pendingCount, 450);
            assert.deepEqual(explanation.citedRunbookIds, ['rb-001']);
            assert.deepEqual(explanation.possibleHypotheses, [mockRunbook.symptoms]);
            assert.ok(explanation.recommendedChecks.length >= 2);
            assert.equal(explanation.limitations, mockRunbook.limitations);
        } finally {
            if (savedOpenRouterKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
            if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey;
        }
    });

    it('T8 Fallback: Gracefully handles missing runbook entry with clear uncertainty disclaimer', async () => {
        const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
        const savedGeminiKey = process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;

        try {
            const mockAlert = {
                ID: 'alert-999',
                ruleCode: 'UNKNOWN_RULE',
                severity: 'Warning',
                observedMetrics: '{"pendingCount": 50}'
            };

            const explanation = await generateGroundedExplanation(mockAlert, null);

            assert.deepEqual(explanation.citedRunbookIds, []);
            assert.ok(explanation.limitations.includes('Metrics describe queue state'));
            assert.ok(explanation.possibleHypotheses[0].includes('Unspecified'));
        } finally {
            if (savedOpenRouterKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
            if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey;
        }
    });

    it('Robustness: Gracefully handles malformed JSON observedMetrics', async () => {
        const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
        const savedGeminiKey = process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;

        try {
            const mockAlert = {
                ID: 'alert-malformed',
                ruleCode: 'QUEUE_GROWTH',
                severity: 'High',
                observedMetrics: 'INVALID_NON_JSON'
            };

            const explanation = await generateGroundedExplanation(mockAlert, null);
            assert.equal(explanation.observedFacts.raw, 'INVALID_NON_JSON');
        } finally {
            if (savedOpenRouterKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
            if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey;
        }
    });

    it('Robustness: Gracefully handles offline or invalid OPENROUTER_API_KEY with deterministic fallback', async () => {
        const oldKey = process.env.OPENROUTER_API_KEY;
        const oldGemini = process.env.GEMINI_API_KEY;
        process.env.OPENROUTER_API_KEY = 'sk-or-test-invalid-key-that-fails';
        delete process.env.GEMINI_API_KEY;

        try {
            const mockAlert = {
                ID: 'alert-test',
                ruleCode: 'EXCESSIVE_RETRIES',
                severity: 'Critical',
                observedMetrics: '{"pendingCount": 100}'
            };

            const explanation = await generateGroundedExplanation(mockAlert, null);
            assert.equal(explanation.aiAssisted, false);
            assert.ok(explanation.provider.includes('Deterministic'));
        } finally {
            if (oldKey !== undefined) process.env.OPENROUTER_API_KEY = oldKey;
            else delete process.env.OPENROUTER_API_KEY;
            if (oldGemini !== undefined) process.env.GEMINI_API_KEY = oldGemini;
        }
    });

    it('Live AI Integration: Resolves grounded explanation when valid OPENROUTER_API_KEY is present', async () => {
        if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_API_KEY.startsWith('sk-or-')) {
            return; // Skip in pure offline environments
        }

        const mockAlert = {
            ID: 'alert-live-test',
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            observedMetrics: JSON.stringify({ retryRate: 0.88, spikes: 5 }),
            windowStart: '2026-10-21T10:00:00Z',
            windowEnd: '2026-10-21T10:05:00Z'
        };

        const mockRunbook = {
            ID: 'RB-INTEG-RETRY-001',
            title: 'Excessive Retries in CPI Message Processing',
            symptoms: 'Target endpoint returning 503 or 429 backpressure',
            checks: '1. Check SAP CPI trace 2. Inspect receiver endpoint health',
            limitations: 'Cannot discern network timeout from receiver crash'
        };

        const explanation = await generateGroundedExplanation(mockAlert, mockRunbook);
        if (explanation.aiAssisted) {
            assert.ok(explanation.provider.includes('OpenRouter') || explanation.provider.includes('Gemini'));
            assert.ok(explanation.summary.length > 10);
            assert.ok(explanation.possibleHypotheses.length > 0);
            assert.ok(explanation.recommendedChecks.length > 0);
            assert.deepEqual(explanation.citedRunbookIds, ['RB-INTEG-RETRY-001']);
        } else {
            // Gracefully handled free-tier latency timeout via deterministic runbook fallback
            assert.ok(explanation.provider.includes('Deterministic'));
            assert.ok(explanation.summary.includes('EXCESSIVE_RETRIES'));
            assert.deepEqual(explanation.citedRunbookIds, ['RB-INTEG-RETRY-001']);
        }
    });

    it('Safety Validation: Rejects unsupported citations and unsafe operational actions', () => {
        const retrieved = [{ ID: 'rb-001', title: 'Valid Runbook' }];
        const modelOutput = {
            summary: 'Test incident',
            possibleHypotheses: ['Hypothesis A'],
            recommendedChecks: ['Check logs', 'drop queue production', 'delete message at head'],
            citedRunbookIds: ['rb-001', 'hallucinated-rb-999']
        };

        const validated = validateModelOutput(modelOutput, retrieved);
        assert.deepEqual(validated.citedRunbookIds, ['rb-001']);
        assert.deepEqual(validated.recommendedChecks, ['Check logs']);
    });
});
