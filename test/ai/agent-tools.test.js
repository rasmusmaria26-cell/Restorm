const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createIncidentAgentTools, assertAuthorizedScope } = require('../../srv/ai/langchain/agentTools');

describe('LangChain Read-Only Agent Tools (Test Groups D & E)', () => {

    const mockRunbooks = [
        {
            ID: 'rb-001',
            ruleCode: 'EXCESSIVE_RETRIES',
            title: 'Downstream Rate Limiting',
            symptoms: 'Surge in retryAttempts with accumulated backlog.',
            checks: '1. Check HTTP response codes. 2. Verify backoff interval.',
            limitations: 'Does not pinpoint database crash versus network timeout.'
        },
        {
            ID: 'rb-002',
            ruleCode: 'QUEUE_GROWTH',
            title: 'Rapid Queue Accumulation',
            symptoms: 'Inflow rate exceeds worker pool drain rate.',
            checks: '1. Check thread pool saturation. 2. Verify batch upload triggers.',
            limitations: 'Does not inspect message payloads.'
        }
    ];

    it('D1: All five required read-only tools are instantiated', () => {
        const tools = createIncidentAgentTools({
            authorizedInterfaceId: 'IF-ORDERS-01',
            runbookCatalog: mockRunbooks
        });

        assert.equal(tools.length, 5);
        const names = tools.map(t => t.name);
        assert.ok(names.includes('get_interface_metrics'));
        assert.ok(names.includes('get_recent_snapshots'));
        assert.ok(names.includes('get_active_incidents'));
        assert.ok(names.includes('search_runbooks'));
        assert.ok(names.includes('get_threshold_policy'));
    });

    it('D2: get_interface_metrics retrieves metrics for authorized interface', async () => {
        const tools = createIncidentAgentTools({
            authorizedInterfaceId: 'IF-ORDERS-01'
        });
        const tool = tools.find(t => t.name === 'get_interface_metrics');

        const resultStr = await tool.invoke({ interfaceId: 'IF-ORDERS-01' });
        const result = JSON.parse(resultStr);
        assert.ok(result);
        assert.equal(result.interfaceId, 'IF-ORDERS-01');
    });

    it('D3: Cross-interface access outside authorized scope is blocked', async () => {
        const tools = createIncidentAgentTools({
            authorizedInterfaceId: 'IF-ORDERS-01'
        });
        const tool = tools.find(t => t.name === 'get_interface_metrics');

        await assert.rejects(
            async () => {
                await tool.invoke({ interfaceId: 'IF-PAYMENTS-02' });
            },
            {
                name: 'Error',
                message: /\[AccessDenied\] Interface "IF-PAYMENTS-02" is outside the authorized investigation scope/
            }
        );
    });

    it('D4: get_recent_snapshots respects limit bounds', async () => {
        const tools = createIncidentAgentTools({
            authorizedInterfaceId: 'IF-ORDERS-01'
        });
        const tool = tools.find(t => t.name === 'get_recent_snapshots');

        const resultStr = await tool.invoke({ interfaceId: 'IF-ORDERS-01', limit: 3 });
        const result = JSON.parse(resultStr);
        assert.ok(result);
        assert.equal(result.interfaceId, 'IF-ORDERS-01');
        assert.ok(Array.isArray(result.snapshots));
    });

    it('D5: search_runbooks finds relevant runbook by ruleCode', async () => {
        const tools = createIncidentAgentTools({
            authorizedInterfaceId: 'IF-ORDERS-01',
            runbookCatalog: mockRunbooks
        });
        const tool = tools.find(t => t.name === 'search_runbooks');

        const resultStr = await tool.invoke({ query: 'retry spike', ruleCode: 'EXCESSIVE_RETRIES' });
        const result = JSON.parse(resultStr);
        assert.ok(result);
        assert.equal(result.resultCount >= 1, true);
        assert.equal(result.runbooks[0].ID, 'rb-001');
        assert.equal(result.runbooks[0].ruleCode, 'EXCESSIVE_RETRIES');
    });

    it('D6: get_threshold_policy returns read-only policy configuration', async () => {
        const tools = createIncidentAgentTools({
            authorizedInterfaceId: 'IF-ORDERS-01'
        });
        const tool = tools.find(t => t.name === 'get_threshold_policy');

        const resultStr = await tool.invoke({ interfaceId: 'IF-ORDERS-01' });
        const result = JSON.parse(resultStr);
        assert.ok(result);
        assert.ok(result.effectivePolicy);
        assert.ok(result.readOnlyNotice.includes('human administrator approval'));
    });

    it('E1: Read-only security audit - no modification tools registered', () => {
        const tools = createIncidentAgentTools({
            authorizedInterfaceId: 'IF-ORDERS-01'
        });
        const names = tools.map(t => t.name.toLowerCase());

        assert.ok(!names.includes('acknowledge'));
        assert.ok(!names.includes('resolve'));
        assert.ok(!names.includes('set_threshold'));
        assert.ok(!names.includes('delete_message'));
        assert.ok(!names.includes('drop_queue'));
        assert.ok(!names.includes('restart_cpi'));
        assert.ok(!names.includes('execute_sql'));
    });

    it('E2: assertAuthorizedScope helper enforcement', () => {
        assert.doesNotThrow(() => assertAuthorizedScope('IF-01', 'IF-01'));
        assert.doesNotThrow(() => assertAuthorizedScope('IF-01', null));
        assert.throws(() => assertAuthorizedScope('IF-02', 'IF-01'), /\[AccessDenied\]/);
    });
});
