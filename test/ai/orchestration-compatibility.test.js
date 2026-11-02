const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateGroundedExplanation } = require('../../srv/ai/explanationService');

describe('Orchestration Mode Compatibility & Feature Flags (Test Group H)', () => {

    const mockAlert = {
        ID: 'alert-compat-01',
        ruleCode: 'EXCESSIVE_RETRIES',
        severity: 'Critical',
        interface_ID: 'IF-S4-ORDERS',
        observedMetrics: JSON.stringify({
            pendingCount: 450,
            retryAttempts: 320,
            failedCount: 190,
            oldestPendingAgeSeconds: 780
        })
    };

    const mockRunbooks = [
        {
            ID: 'rb-001',
            ruleCode: 'EXCESSIVE_RETRIES',
            title: 'Rate Limit Backoff',
            symptoms: 'Sudden spike in retryAttempts while pending count accumulates.',
            checks: '1. Inspect target system response codes. 2. Verify retry interval.',
            limitations: 'Does not pinpoint whether failure is network layer or target crash.'
        }
    ];

    it('H1: Legacy mode returns expected public explanation contract', async () => {
        const savedMode = process.env.RESTORM_AI_ORCHESTRATION;
        process.env.RESTORM_AI_ORCHESTRATION = 'legacy';
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;

        try {
            const result = await generateGroundedExplanation(mockAlert, mockRunbooks);
            assert.equal(typeof result.aiAssisted, 'boolean');
            assert.equal(typeof result.provider, 'string');
            assert.equal(typeof result.summary, 'string');
            assert.equal(typeof result.observedFacts, 'object');
            assert.ok(Array.isArray(result.possibleHypotheses));
            assert.ok(Array.isArray(result.recommendedChecks));
            assert.ok(Array.isArray(result.citedRunbookIds));
            assert.equal(typeof result.evidenceGaps, 'string');
            assert.equal(typeof result.limitations, 'string');
        } finally {
            if (savedMode) process.env.RESTORM_AI_ORCHESTRATION = savedMode;
            else delete process.env.RESTORM_AI_ORCHESTRATION;
        }
    });

    it('H2: LangChain mode returns identical public explanation contract', async () => {
        const savedMode = process.env.RESTORM_AI_ORCHESTRATION;
        process.env.RESTORM_AI_ORCHESTRATION = 'langchain';
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;

        try {
            const result = await generateGroundedExplanation(mockAlert, mockRunbooks);
            assert.equal(typeof result.aiAssisted, 'boolean');
            assert.equal(typeof result.provider, 'string');
            assert.equal(typeof result.summary, 'string');
            assert.equal(typeof result.observedFacts, 'object');
            assert.ok(Array.isArray(result.possibleHypotheses));
            assert.ok(Array.isArray(result.recommendedChecks));
            assert.ok(Array.isArray(result.citedRunbookIds));
            assert.equal(typeof result.evidenceGaps, 'string');
            assert.equal(typeof result.limitations, 'string');
        } finally {
            if (savedMode) process.env.RESTORM_AI_ORCHESTRATION = savedMode;
            else delete process.env.RESTORM_AI_ORCHESTRATION;
        }
    });

    it('H3: Default mode when RESTORM_AI_ORCHESTRATION is unset is legacy', async () => {
        const savedMode = process.env.RESTORM_AI_ORCHESTRATION;
        delete process.env.RESTORM_AI_ORCHESTRATION;
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;

        try {
            const result = await generateGroundedExplanation(mockAlert, mockRunbooks);
            // In offline fallback, provider string confirms standard deterministic runbook grounding
            assert.equal(result.provider, 'Deterministic Runbook Grounding (Offline Mode)');
        } finally {
            if (savedMode) process.env.RESTORM_AI_ORCHESTRATION = savedMode;
        }
    });
});
