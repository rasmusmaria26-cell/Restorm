const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    redactString,
    redactData,
    sanitizeTraceMetadata,
    sanitizeRunContent,
    isSensitiveKey,
    ALLOWED_METADATA_KEYS
} = require('../../srv/ai/observability/traceRedaction');

describe('LangSmith Trace Redaction & Privacy Engine (Test Group B)', () => {

    it('B1: API keys and bearer tokens are redacted from strings', () => {
        const inputWithBearer = 'Request failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123';
        assert.ok(!redactString(inputWithBearer).includes('eyJhbGciOiJIUzI1Ni'));
        assert.ok(redactString(inputWithBearer).includes('[REDACTED_SECRET]'));

        const inputWithGemini = 'Calling Gemini key AIzaSyTEST_FAKE_KEY_DO_NOT_USE_ABCDEFGHIJKLM';
        assert.ok(!redactString(inputWithGemini).includes('AIzaSyTEST_FAKE_KEY_DO_NOT_USE_ABCDEFGHIJKLM'));
        assert.ok(redactString(inputWithGemini).includes('[REDACTED_SECRET]'));

        const inputWithOpenRouter = 'Using key sk-or-v1-TEST_FAKE_KEY_DO_NOT_USE_ABCDEFGHIJKLM';
        assert.ok(!redactString(inputWithOpenRouter).includes('sk-or-v1-TEST_FAKE_KEY_DO_NOT_USE_ABCDEFGHIJKLM'));
        assert.ok(redactString(inputWithOpenRouter).includes('[REDACTED_SECRET]'));

        const inputWithLangSmith = 'Using lsv2_pt_TEST_FAKE_KEY_DO_NOT_USE_ABCDEFGHIJKLM';
        assert.ok(!redactString(inputWithLangSmith).includes('lsv2_pt_TEST_FAKE_KEY_DO_NOT_USE_ABCDEFGHIJKLM'));
        assert.ok(redactString(inputWithLangSmith).includes('[REDACTED_SECRET]'));
    });

    it('B2: Database connection URIs containing credentials are redacted', () => {
        const dbUri = 'sqlite://user:super_secret_pw@prod-db.corp.local/sentinel.db';
        const sanitized = redactString(dbUri);
        assert.ok(!sanitized.includes('super_secret_pw'));
        assert.ok(sanitized.includes('[REDACTED_SECRET]'));
    });

    it('B3: Sensitive keys in nested objects are redacted', () => {
        const payload = {
            interfaceId: 'IF-ORDERS-01',
            apiKey: 'TEST_FAKE_API_KEY_DO_NOT_USE',
            authorization: 'Bearer TEST_FAKE_BEARER_TOKEN_DO_NOT_USE',
            password: 'TEST_FAKE_PASSWORD_DO_NOT_USE',
            nested: {
                client_secret: 'TEST_FAKE_CLIENT_SECRET_DO_NOT_USE',
                safeMetric: 450
            }
        };

        const cleaned = redactData(payload);
        assert.equal(cleaned.interfaceId, 'IF-ORDERS-01');
        assert.equal(cleaned.apiKey, '[REDACTED_CREDENTIAL]');
        assert.equal(cleaned.authorization, '[REDACTED_CREDENTIAL]');
        assert.equal(cleaned.password, '[REDACTED_CREDENTIAL]');
        assert.equal(cleaned.nested.client_secret, '[REDACTED_CREDENTIAL]');
        assert.equal(cleaned.nested.safeMetric, 450);
    });

    it('B4: Metadata dictionary is strictly filtered against allowlist', () => {
        const metadata = {
            environment: 'production',
            ruleCode: 'EXCESSIVE_RETRIES',
            severity: 'Critical',
            durationMs: 312,
            unauthorizedKey: 'customer_ssn_12345',
            rawSql: 'SELECT * FROM Users WHERE id = 1',
            clientIp: '192.168.1.1'
        };

        const sanitized = sanitizeTraceMetadata(metadata);
        assert.equal(sanitized.environment, 'production');
        assert.equal(sanitized.ruleCode, 'EXCESSIVE_RETRIES');
        assert.equal(sanitized.severity, 'Critical');
        assert.equal(sanitized.durationMs, 312);
        assert.equal(sanitized.unauthorizedKey, undefined);
        assert.equal(sanitized.rawSql, undefined);
        assert.equal(sanitized.clientIp, undefined);
    });

    it('B5: Content capture disabled by default returns metadata-only summary', () => {
        const rawContent = {
            payload: '<Orders><Customer>Acme Corp</Customer><CreditCard>4111-2222-3333-4444</CreditCard></Orders>',
            messages: ['Order #1001 failed', 'Order #1002 failed']
        };

        const resultWhenDisabled = sanitizeRunContent(rawContent, false);
        assert.equal(resultWhenDisabled.summary, '[CONTENT_CAPTURE_DISABLED]');
        assert.equal(resultWhenDisabled.itemCount, 2);
        assert.equal(resultWhenDisabled.payload, undefined);

        const resultWhenEnabled = sanitizeRunContent({ safeText: 'Normal log' }, true);
        assert.equal(resultWhenEnabled.safeText, 'Normal log');
    });

    it('B6: Error objects are sanitized without leaking raw internal stacks or tokens', () => {
        const err = new Error('Connection refused to https://api.service.com?apiKey=AIzaSyTEST_FAKE_KEY_DO_NOT_USE_ABCDEFGHIJKLM');
        const sanitizedErr = redactData(err);
        assert.equal(sanitizedErr.name, 'Error');
        assert.ok(!sanitizedErr.message.includes('AIzaSyD3x9kL4mN2pQ8rT6vW1yZ0aB5cE7gH9jK'));
        assert.ok(sanitizedErr.message.includes('[REDACTED_SECRET]'));
        assert.equal(sanitizedErr.stack, undefined);
    });

    it('B7: isSensitiveKey detects common secret variations', () => {
        assert.ok(isSensitiveKey('api_key'));
        assert.ok(isSensitiveKey('apiKey'));
        assert.ok(isSensitiveKey('Authorization'));
        assert.ok(isSensitiveKey('bearer_token'));
        assert.ok(isSensitiveKey('client_secret'));
        assert.ok(isSensitiveKey('connection_string'));
        assert.ok(!isSensitiveKey('ruleCode'));
        assert.ok(!isSensitiveKey('pendingCount'));
    });
});
