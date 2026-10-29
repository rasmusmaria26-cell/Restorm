const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { retrieveRelevantRunbooks } = require('../srv/ai/runbookRetrieval');

describe('Runbook Retrieval (RAG) Module', () => {
    const catalog = [
        { ID: 'rb-001', ruleCode: 'EXCESSIVE_RETRIES', title: 'Timeout', symptoms: 'retry storm 429', keywords: 'retry,timeout,429' },
        { ID: 'rb-002', ruleCode: 'QUEUE_GROWTH', title: 'Backlog', symptoms: 'inflow queue growth', keywords: 'growth,backlog' },
        { ID: 'rb-003', ruleCode: 'OLD_MESSAGE_AGE', title: 'Poison', symptoms: 'stuck message age', keywords: 'age,stuck,poison' }
    ];

    it('T1 Relevant Runbook Retrieval: Matches alert ruleCode and keywords correctly', () => {
        const alert = { ruleCode: 'EXCESSIVE_RETRIES', observedMetrics: '{"retryAttempts": 500}' };
        const results = retrieveRelevantRunbooks(alert, catalog);
        assert.ok(results.length > 0);
        assert.equal(results[0].ID, 'rb-001');
        assert.equal(results[0].ruleCode, 'EXCESSIVE_RETRIES');
    });

    it('T2 No Relevant Runbook Found: Returns empty array or graceful fallback when no match', () => {
        const alert = { ruleCode: 'UNKNOWN_RULE', observedMetrics: '{"foo": "bar"}' };
        const results = retrieveRelevantRunbooks(alert, []);
        assert.deepEqual(results, []);
    });

    it('T3 Source ID Preservation: Verifies original IDs are strictly preserved in retrieved entries', () => {
        const alert = { ruleCode: 'QUEUE_GROWTH', observedMetrics: '{"pendingCount": 999}' };
        const results = retrieveRelevantRunbooks(alert, catalog);
        assert.ok(results.length > 0);
        assert.equal(results[0].ID, 'rb-002');
        assert.equal(typeof results[0].ID, 'string');
    });

    it('T4 Missing or Malformed Telemetry: Handles null, undefined, or non-JSON metrics safely', () => {
        const alert1 = { ruleCode: 'EXCESSIVE_RETRIES', observedMetrics: null };
        const results1 = retrieveRelevantRunbooks(alert1, catalog);
        assert.ok(results1.length > 0);
        assert.equal(results1[0].ID, 'rb-001');

        const alert2 = { ruleCode: 'EXCESSIVE_RETRIES', observedMetrics: 'INVALID_JSON_STRING' };
        const results2 = retrieveRelevantRunbooks(alert2, catalog);
        assert.ok(results2.length > 0);
    });
});
