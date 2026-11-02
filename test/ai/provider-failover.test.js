const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    callGemini,
    callOpenRouter,
    invokeModel,
    resetModelCooldowns,
    isModelInCooldown,
    markModelCooldown,
    GEMINI_MODELS
} = require('../../srv/ai/langchain/modelFactory');
const { runIncidentAgentExplanation } = require('../../srv/ai/langchain/incidentAgent');
const { ExplanationOutputSchema } = require('../../srv/ai/langchain/responseSchema');

describe('Provider Failover, Reliability & Deadlines (Phase B.2)', () => {

    beforeEach(() => {
        resetModelCooldowns();
    });

    it('F1: Gemini 429 triggers candidate cooldown and failover to next model', async () => {
        const originalFetch = global.fetch;
        const attemptedModels = [];

        global.fetch = async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('gemini-3.1-flash-lite')) {
                attemptedModels.push('gemini-3.1-flash-lite');
                return {
                    ok: false,
                    status: 429,
                    headers: new Map([['retry-after', '30']])
                };
            }
            if (urlStr.includes('gemini-2.0-flash')) {
                attemptedModels.push('gemini-2.0-flash');
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }]
                    })
                };
            }
            return { ok: false, status: 500 };
        };

        const prevKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'test_gemini_fake_key_123';

        try {
            const result = await callGemini([{ role: 'user', content: 'test' }]);
            assert.ok(result);
            assert.equal(result.type, 'text');
            assert.ok(result.provider.includes('gemini-2.0-flash'));
            assert.ok(attemptedModels.includes('gemini-3.1-flash-lite'));
            assert.ok(attemptedModels.includes('gemini-2.0-flash'));
            assert.ok(isModelInCooldown('gemini-3.1-flash-lite'));
        } finally {
            global.fetch = originalFetch;
            process.env.GEMINI_API_KEY = prevKey;
        }
    });

    it('F2: All Gemini candidates exhausted returns null without crashing', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => ({
            ok: false,
            status: 429,
            headers: new Map([['retry-after', '60']])
        });

        const prevKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'test_key';

        try {
            const result = await callGemini([{ role: 'user', content: 'test' }]);
            assert.equal(result, null);
            for (const model of GEMINI_MODELS) {
                assert.ok(isModelInCooldown(model));
            }
        } finally {
            global.fetch = originalFetch;
            process.env.GEMINI_API_KEY = prevKey;
        }
    });

    it('F3: OpenRouter 401 triggers cooldown and returns null gracefully', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => ({
            ok: false,
            status: 401,
            json: async () => ({ error: { message: 'API key expired.' } })
        });

        const prevKey = process.env.OPENROUTER_API_KEY;
        process.env.OPENROUTER_API_KEY = 'expired_key_test';

        try {
            const result = await callOpenRouter([{ role: 'user', content: 'test' }]);
            assert.equal(result, null);
            assert.ok(isModelInCooldown('openrouter'));
        } finally {
            global.fetch = originalFetch;
            process.env.OPENROUTER_API_KEY = prevKey;
        }
    });

    it('F4: Provider timeout is caught and handled safely', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            const err = new Error('The operation was aborted');
            err.name = 'TimeoutError';
            throw err;
        };

        const prevKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'test_key';

        try {
            const result = await callGemini([{ role: 'user', content: 'test' }], [], { timeoutMs: 10 });
            assert.equal(result, null);
        } finally {
            global.fetch = originalFetch;
            process.env.GEMINI_API_KEY = prevKey;
        }
    });

    it('F5: Malformed tool-call arguments do not crash modelFactory', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{
                    message: {
                        tool_calls: [{
                            id: 'call_123',
                            function: {
                                name: 'get_interface_metrics',
                                arguments: 'INVALID_NON_JSON_ARGUMENTS'
                            }
                        }]
                    }
                }]
            })
        });

        const prevKey = process.env.OPENROUTER_API_KEY;
        process.env.OPENROUTER_API_KEY = 'test_key';

        try {
            const result = await callOpenRouter([{ role: 'user', content: 'test' }]);
            assert.ok(result);
            assert.equal(result.type, 'tool_call');
            assert.deepEqual(result.toolCall.args, {});
        } finally {
            global.fetch = originalFetch;
            process.env.OPENROUTER_API_KEY = prevKey;
        }
    });

    it('F6: Successful tool-calling response parses functionCall correctly', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                candidates: [{
                    content: {
                        parts: [{
                            functionCall: {
                                name: 'get_interface_metrics',
                                args: { interfaceId: 'IF-TEST-123' }
                            }
                        }]
                    }
                }]
            })
        });

        const prevKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'test_key';

        try {
            const result = await callGemini([{ role: 'user', content: 'test' }]);
            assert.ok(result);
            assert.equal(result.type, 'tool_call');
            assert.equal(result.toolCall.name, 'get_interface_metrics');
            assert.equal(result.toolCall.args.interfaceId, 'IF-TEST-123');
        } finally {
            global.fetch = originalFetch;
            process.env.GEMINI_API_KEY = prevKey;
        }
    });

    it('F7: Schema validation: handles incomplete, malformed, empty, and valid responses', () => {
        // Valid output
        const valid = {
            summary: 'High queue retry anomaly detected on endpoint.',
            possibleHypotheses: ['Possible downstream rate limiting HTTP 429.'],
            recommendedChecks: ['1. Check target endpoint status codes.'],
            citedRunbookIds: ['rb-001'],
            evidenceGaps: 'Requires server trace logs.'
        };
        const validParse = ExplanationOutputSchema.safeParse(valid);
        assert.ok(validParse.success);

        // Empty output
        const emptyParse = ExplanationOutputSchema.safeParse({});
        assert.equal(emptyParse.success, false);

        // Incomplete output (missing summary)
        const incompleteParse = ExplanationOutputSchema.safeParse({
            possibleHypotheses: ['Hypothesis 1'],
            recommendedChecks: ['Check 1'],
            citedRunbookIds: ['rb-001'],
            evidenceGaps: 'Missing logs'
        });
        assert.equal(incompleteParse.success, false);

        // Malformed runbook ID format
        const badCitationParse = ExplanationOutputSchema.safeParse({
            ...valid,
            citedRunbookIds: ['INVALID_ID_NOT_RB']
        });
        assert.equal(badCitationParse.success, false);
    });

    it('F8: Total investigation deadline aborts loop and returns fallback within deadline', async () => {
        const alert = {
            ID: 'alert-timeout-test',
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            interfaceId: 'IF-TEST-001',
            observedMetrics: JSON.stringify({ pendingCount: 500, retryAttempts: 150 })
        };

        // Mock model that sleeps 500ms per iteration
        const slowMock = async () => {
            await new Promise(r => setTimeout(r, 400));
            return {
                type: 'tool_call',
                toolCall: { name: 'get_interface_metrics', args: { interfaceId: 'IF-TEST-001' } }
            };
        };

        const t0 = Date.now();
        const result = await runIncidentAgentExplanation(alert, [], {
            mockModel: slowMock,
            totalTimeoutMs: 600, // Short deadline
            maxIterations: 5
        });
        const elapsed = Date.now() - t0;

        assert.ok(elapsed < 1200, `Elapsed ${elapsed}ms should respect totalTimeoutMs`);
        assert.ok(result);
        assert.equal(result.aiAssisted, false);
        assert.ok(result.provider.includes('Deterministic Runbook Grounding'));
    });

});
