const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runIncidentAgentExplanation } = require('../../srv/ai/langchain/incidentAgent');
const { EXECUTION_POLICY } = require('../../srv/ai/langchain/executionPolicy');

describe('LangChain Incident Investigation Agent (Test Group C)', () => {

    const mockAlert = {
        ID: 'alert-agent-01',
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
            title: 'Destination Rate Limiting',
            symptoms: 'Sudden spike in retryAttempts while pending count accumulates.',
            checks: '1. Inspect target HTTP response codes. 2. Verify retry interval.',
            limitations: 'Does not pinpoint database crash versus network timeout.'
        }
    ];

    it('C1: Deterministic offline fallback when no API keys are present', async () => {
        const savedGemini = process.env.GEMINI_API_KEY;
        const savedOpenRouter = process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;

        try {
            const explanation = await runIncidentAgentExplanation(mockAlert, mockRunbooks);
            assert.equal(explanation.aiAssisted, false);
            assert.ok(explanation.provider.includes('Deterministic'));
            assert.equal(explanation.observedFacts.retryAttempts, 320);
            assert.deepEqual(explanation.citedRunbookIds, ['rb-001']);
        } finally {
            if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
            if (savedOpenRouter) process.env.OPENROUTER_API_KEY = savedOpenRouter;
        }
    });

    it('C2: Agent invokes read-only tool and generates validated structured output', async () => {
        // Mock model that first requests get_interface_metrics, then returns structured explanation
        let step = 0;
        const mockModel = async (messages, tools) => {
            step++;
            if (step === 1) {
                return {
                    type: 'tool_call',
                    provider: 'Mock Model',
                    toolCall: {
                        name: 'get_interface_metrics',
                        args: { interfaceId: 'IF-S4-ORDERS' },
                        id: 'call_1'
                    }
                };
            }
            return {
                type: 'text',
                provider: 'Mock Model',
                content: JSON.stringify({
                    summary: 'Orders integration experiencing downstream rate limiting backoff.',
                    possibleHypotheses: ['Downstream S/4HANA endpoint returned HTTP 429'],
                    recommendedChecks: ['Inspect HTTP response codes on target receiver channel'],
                    citedRunbookIds: ['rb-001'],
                    evidenceGaps: 'Requires SAP CPI trace log inspection for exact 429 response body'
                })
            };
        };

        const explanation = await runIncidentAgentExplanation(mockAlert, mockRunbooks, { mockModel });
        assert.equal(explanation.aiAssisted, true);
        assert.ok(explanation.provider.includes('LangChain Orchestrated'));
        assert.equal(explanation.summary.includes('rate limiting'), true);
        assert.deepEqual(explanation.citedRunbookIds, ['rb-001']);
        assert.equal(explanation.possibleHypotheses.length, 1);
        assert.equal(step, 2);
    });

    it('C3: Agent execution bounds - halts when tool limit is reached', async () => {
        let toolCalls = 0;
        const mockModel = async () => {
            toolCalls++;
            return {
                type: 'tool_call',
                provider: 'Looping Mock Model',
                toolCall: {
                    name: 'get_interface_metrics',
                    args: { interfaceId: 'IF-S4-ORDERS' },
                    id: `call_${toolCalls}`
                }
            };
        };

        const explanation = await runIncidentAgentExplanation(mockAlert, mockRunbooks, { mockModel });
        // Must gracefully terminate and return deterministic fallback rather than looping indefinitely
        assert.ok(explanation);
        assert.ok(toolCalls <= EXECUTION_POLICY.MAX_TOOL_CALLS + 2);
    });

    it('C4: Malformed non-JSON output recovers or falls back safely', async () => {
        let attempts = 0;
        const mockModel = async () => {
            attempts++;
            return {
                type: 'text',
                provider: 'Broken JSON Provider',
                content: 'This is invalid non-json prose that breaks the schema'
            };
        };

        const explanation = await runIncidentAgentExplanation(mockAlert, mockRunbooks, { mockModel });
        assert.ok(explanation);
        assert.equal(explanation.aiAssisted, false); // Fell back safely
        assert.deepEqual(explanation.citedRunbookIds, ['rb-001']);
    });

    it('C5: Hallucinated runbook citations outside catalog are stripped', async () => {
        const mockModel = async () => {
            return {
                type: 'text',
                provider: 'Hallucinating Provider',
                content: JSON.stringify({
                    summary: 'Rate limit backlog detected.',
                    possibleHypotheses: ['Downstream failure'],
                    recommendedChecks: ['Check logs'],
                    citedRunbookIds: ['rb-001', 'rb-999-hallucinated'],
                    evidenceGaps: 'Need logs'
                })
            };
        };

        const explanation = await runIncidentAgentExplanation(mockAlert, mockRunbooks, { mockModel });
        assert.ok(explanation.citedRunbookIds.includes('rb-001'));
        assert.ok(!explanation.citedRunbookIds.includes('rb-999-hallucinated'));
    });
});
