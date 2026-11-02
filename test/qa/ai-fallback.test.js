/**
 * test/qa/ai-fallback.test.js
 *
 * Phase 5 Agent 6 — AI fallback behavior tests (backend).
 *
 * Verifies: no API key -> deterministic fallback; invalid key -> fallback;
 * malformed observedMetrics handled; unsafe recommendations rejected.
 * Tests the real explanationService generateGroundedExplanation /
 * validateModelOutput with process.env API keys controlled.
 *
 * Runs with: node --test test/qa/ai-fallback.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const explanationService = require('../../srv/ai/explanationService.js');
const { generateGroundedExplanation, validateModelOutput } = explanationService;

const origGemini = process.env.GEMINI_API_KEY;
const origOpenrouter = process.env.OPENROUTER_API_KEY;
let originalFetch = global.fetch;

function withNoKeys() {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
}

function restoreKeys() {
    if (origGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origGemini;
    if (origOpenrouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = origOpenrouter;
}

function setFetch(handler) {
    originalFetch = global.fetch;
    global.fetch = handler;
}
function restoreFetch() {
    global.fetch = originalFetch;
}

const baseRunbook = [
    { ID: 'rb-001', ruleCode: 'EXCESSIVE_RETRIES', title: 'Destination Timeout', symptoms: 'retry spike', checks: '1. check logs. 2. verify backoff.', limitations: 'does not pinpoint layer.', keywords: 'retry' }
];

const baseAlert = (overrides = {}) => ({
    ID: 'alert-1',
    interface_ID: 'iface-1',
    ruleCode: 'EXCESSIVE_RETRIES',
    severity: 'Critical',
    observedMetrics: JSON.stringify({ pendingCount: 500, retryAttempts: 120 }),
    windowStart: '2026-10-30T08:50:00Z',
    windowEnd: '2026-10-30T09:00:00Z',
    ...overrides
});

describe('AI fallback behavior', () => {
    before(() => withNoKeys());
    after(() => { restoreKeys(); restoreFetch(); });

    describe('no API key -> deterministic fallback', () => {
        it('returns offline deterministic fallback with no keys configured', async () => {
            withNoKeys();
            setFetch(() => { throw new Error('must not be called'); });
            const expl = await generateGroundedExplanation(baseAlert(), baseRunbook);
            assert.equal(expl.aiAssisted, false);
            assert.ok(expl.provider && expl.provider.includes('Offline'));
            assert.ok(expl.summary);
            assert.ok(expl.limitations);
            assert.ok(Array.isArray(expl.possibleHypotheses));
            assert.ok(expl.observedFacts);
            assert.equal(expl.observedFacts.pendingCount, 500);
            assert.equal(expl.observedFacts.retryAttempts, 120);
        });

        it('does not call any AI provider when no key is present', async () => {
            withNoKeys();
            let called = false;
            setFetch(async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; });
            const expl = await generateGroundedExplanation(baseAlert(), baseRunbook);
            assert.equal(called, false);
            assert.equal(expl.aiAssisted, false);
        });
    });

    describe('invalid API key -> fallback', () => {
        it('fake gemini key with failing fetch falls back to deterministic', async () => {
            process.env.GEMINI_API_KEY = 'fake-invalid-key';
            setFetch(async () => { throw new Error('network down'); });
            const expl = await generateGroundedExplanation(baseAlert(), baseRunbook);
            assert.equal(expl.aiAssisted, false);
            assert.ok(expl.summary);
        });

        it('fake gemini key with non-ok response falls back to deterministic', async () => {
            process.env.GEMINI_API_KEY = 'fake-invalid-key';
            setFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid key' }) }));
            const expl = await generateGroundedExplanation(baseAlert(), baseRunbook);
            assert.equal(expl.aiAssisted, false);
            assert.ok(expl.limitations);
        });

        it('fake openrouter key with failing fetch falls back to deterministic', async () => {
            process.env.GEMINI_API_KEY = '';
            process.env.OPENROUTER_API_KEY = 'fake-openrouter-key';
            setFetch(async () => { throw new Error('openrouter down'); });
            const expl = await generateGroundedExplanation(baseAlert(), baseRunbook);
            assert.equal(expl.aiAssisted, false);
            assert.ok(expl.summary);
        });
    });

    describe('malformed observedMetrics handled', () => {
        it('invalid JSON observedMetrics does not crash; raw preserved', async () => {
            withNoKeys();
            const expl = await generateGroundedExplanation(baseAlert({ observedMetrics: '{ not valid json' }), baseRunbook);
            assert.equal(expl.aiAssisted, false);
            assert.ok(expl.observedFacts);
            assert.equal(expl.observedFacts.raw, '{ not valid json');
        });

        it('null observedMetrics handled', async () => {
            withNoKeys();
            const expl = await generateGroundedExplanation(baseAlert({ observedMetrics: null }), baseRunbook);
            assert.equal(expl.aiAssisted, false);
            assert.ok(expl.observedFacts);
        });

        it('missing runbook still produces a fallback summary', async () => {
            withNoKeys();
            const expl = await generateGroundedExplanation(baseAlert(), []);
            assert.equal(expl.aiAssisted, false);
            assert.ok(expl.summary);
            assert.ok(expl.limitations);
        });
    });

    describe('unsafe recommendations rejected (validateModelOutput)', () => {
        const retrieved = [{ ID: 'rb-001', title: 'x' }];

        it('filters out unsafe operational commands from checks', () => {
            const parsed = {
                summary: 's',
                citedRunbookIds: ['rb-001', 'rb-999'],
                recommendedChecks: ['drop queue', 'check target logs', 'delete message', 'verify config', 'rm -rf /data'],
                evidenceGaps: 'gaps'
            };
            const out = validateModelOutput(parsed, retrieved);
            assert.ok(!out.citedRunbookIds.includes('rb-999'), 'hallucinated runbook id rejected');
            assert.equal(out.citedRunbookIds[0], 'rb-001');
            assert.ok(!out.recommendedChecks.some((c) => /drop\s+queue/i.test(c)));
            assert.ok(!out.recommendedChecks.some((c) => /delete\s+message/i.test(c)));
            assert.ok(!out.recommendedChecks.some((c) => /rm\s+-rf/i.test(c)));
            assert.ok(out.recommendedChecks.some((c) => /check target logs/i.test(c)));
            assert.ok(out.recommendedChecks.some((c) => /verify config/i.test(c)));
        });

        it('keeps safe checks and valid citations intact', () => {
            const parsed = {
                summary: 's',
                citedRunbookIds: ['rb-001'],
                recommendedChecks: ['inspect response codes', 'verify backoff config'],
                evidenceGaps: 'gaps'
            };
            const out = validateModelOutput(parsed, retrieved);
            assert.deepEqual(out.citedRunbookIds, ['rb-001']);
            assert.equal(out.recommendedChecks.length, 2);
        });

        it('empty / non-array inputs handled gracefully', () => {
            assert.deepEqual(validateModelOutput({}, []).citedRunbookIds, []);
            assert.deepEqual(validateModelOutput({ recommendedChecks: 'not-array' }, []).recommendedChecks, []);
        });
    });
});
