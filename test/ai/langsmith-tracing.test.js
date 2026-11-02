const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    withTrace,
    isTracingEnabled,
    isContentCaptureEnabled,
    getLangSmithClient,
    getTracingDiagnostics,
    resetClient
} = require('../../srv/ai/observability/langsmithTracing');
const { generateGroundedExplanation } = require('../../srv/ai/explanationService');

describe('LangSmith Configuration & Failure Isolation (Test Groups A & G)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.RESTORM_LANGSMITH_ENABLED;
        delete process.env.LANGSMITH_TRACING;
        delete process.env.LANGSMITH_API_KEY;
        resetClient();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        resetClient();
    });

    it('A1: Tracing is disabled by default when no flags or keys are set', () => {
        delete process.env.RESTORM_LANGSMITH_ENABLED;
        delete process.env.LANGSMITH_TRACING;
        delete process.env.LANGSMITH_API_KEY;

        assert.equal(isTracingEnabled(), false);
        assert.equal(getLangSmithClient(), null);
    });

    it('A2: Tracing requires BOTH the enabled flag AND a non-empty API key', () => {
        // Flag true, no key
        process.env.RESTORM_LANGSMITH_ENABLED = 'true';
        delete process.env.LANGSMITH_API_KEY;
        assert.equal(isTracingEnabled(), false);

        // Key present, flag false
        process.env.RESTORM_LANGSMITH_ENABLED = 'false';
        process.env.LANGSMITH_API_KEY = 'lsv2_pt_testkey_123';
        assert.equal(isTracingEnabled(), false);

        // Both present
        process.env.RESTORM_LANGSMITH_ENABLED = 'true';
        process.env.LANGSMITH_API_KEY = 'lsv2_pt_testkey_123';
        assert.equal(isTracingEnabled(), true);
    });

    it('A3: Disabled tracing executes function directly with zero overhead', async () => {
        delete process.env.RESTORM_LANGSMITH_ENABLED;
        delete process.env.LANGSMITH_API_KEY;

        let executed = false;
        const result = await withTrace('test.disabled', 'chain', async (run) => {
            assert.equal(run, null);
            executed = true;
            return 'success_val';
        });

        assert.equal(executed, true);
        assert.equal(result, 'success_val');
    });

    it('A4: Diagnostics report safe status without exposing API key', () => {
        process.env.RESTORM_LANGSMITH_ENABLED = 'true';
        process.env.LANGSMITH_API_KEY = 'lsv2_pt_super_secret_key_999';

        const diag = getTracingDiagnostics();
        assert.equal(diag.tracingEnabled, true);
        assert.equal(diag.hasApiKey, true);
        assert.equal(diag.status, 'active');
        // Ensure the actual key is NEVER present in diagnostics
        assert.equal(JSON.stringify(diag).includes('super_secret_key'), false);
    });

    it('A5: Content capture flag is false by default', () => {
        delete process.env.RESTORM_LANGSMITH_CAPTURE_CONTENT;
        assert.equal(isContentCaptureEnabled(), false);

        process.env.RESTORM_LANGSMITH_CAPTURE_CONTENT = 'true';
        assert.equal(isContentCaptureEnabled(), true);
    });

    it('G1: Tracing failure during an explanation does not affect the explanation result', async () => {
        // Even if LangSmith is enabled with a mock key that cannot connect
        process.env.RESTORM_LANGSMITH_ENABLED = 'true';
        process.env.LANGSMITH_API_KEY = 'lsv2_pt_mock_non_connecting_key';
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const mockAlert = {
            ID: 'alert-trace-fail-test',
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            observedMetrics: JSON.stringify({ pendingCount: 400, retryAttempts: 250 })
        };

        const mockRunbook = {
            ID: 'rb-001',
            ruleCode: 'EXCESSIVE_RETRIES',
            title: 'Downstream Timeout',
            symptoms: 'Retry storm building',
            checks: '1. Check endpoint. 2. Verify backoff.',
            limitations: 'Metrics state only'
        };

        // Must succeed without throwing, returning the deterministic explanation
        const explanation = await generateGroundedExplanation(mockAlert, mockRunbook);
        assert.ok(explanation);
        assert.equal(explanation.aiAssisted, false);
        assert.deepEqual(explanation.citedRunbookIds, ['rb-001']);
        assert.equal(explanation.observedFacts.pendingCount, 400);
    });

    it('G2: withTrace propagates original application errors cleanly', async () => {
        delete process.env.RESTORM_LANGSMITH_ENABLED;

        await assert.rejects(
            async () => {
                await withTrace('test.error', 'chain', async () => {
                    throw new Error('Specific Business Error');
                });
            },
            {
                name: 'Error',
                message: 'Specific Business Error'
            }
        );
    });
});
