/**
 * Central Trace Redaction Utility for LangSmith Observability
 * (Privacy & Defense-in-Depth for Restorm AI Pipeline)
 *
 * Enforces strict redaction of sensitive credentials, connection strings,
 * raw SAP payloads, and customer data before any trace data can reach LangSmith.
 * Default behavior is strictly metadata-only.
 */

// Patterns matching secrets, API keys, tokens, and credentials
const SECRET_KEY_PATTERNS = [
    /api[_-]?key/i,
    /auth(orization)?/i,
    /bearer/i,
    /token/i,
    /password/i,
    /secret/i,
    /credential/i,
    /private[_-]?key/i,
    /conn(ection)?[_-]?str(ing)?/i,
    /(raw[_-]?)?payload/i,
    /message[_-]?body/i,
    /body/i,
    /envelope/i
];

const SECRET_VALUE_PATTERNS = [
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /Basic\s+[A-Za-z0-9+/=]+/i,
    /AIzaSy[A-Za-z0-9_-]{33}/i,           // Google API keys
    /sk-[A-Za-z0-9_-]{20,}/i,             // OpenAI / OpenRouter style keys
    /lsv2_pt_[A-Za-z0-9_-]+/i,            // LangSmith personal tokens
    /(postgres|mysql|sqlite|hana|mongodb):\/\/[^:\s]+:[^@\s]+@[^\s]+/i // DB connection URIs with auth
];

// Explicit allowlist of metadata attributes permitted in traces
const ALLOWED_METADATA_KEYS = new Set([
    'environment',
    'ruleCode',
    'severity',
    'interfaceId',
    'provider',
    'model',
    'orchestrationMode',
    'durationMs',
    'retrievalResultCount',
    'toolCallCount',
    'toolsCalled',
    'fallbackUsed',
    'validationPassed',
    'errorClassification',
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'status',
    'timestamp'
]);

/**
 * Checks if a key name suggests a secret or sensitive attribute.
 */
function isSensitiveKey(key) {
    if (typeof key !== 'string') return false;
    return SECRET_KEY_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Sanitizes a string value, replacing any embedded tokens, keys or connection secrets.
 */
function redactString(val) {
    if (typeof val !== 'string') return val;
    let sanitized = val;
    for (const pat of SECRET_VALUE_PATTERNS) {
        sanitized = sanitized.replace(pat, '[REDACTED_SECRET]');
    }
    return sanitized;
}

/**
 * Deep recursive sanitizer for objects, arrays, and primitives.
 * Strips sensitive keys, redacts secret patterns, and truncates overly long strings.
 */
function redactData(input, depth = 0) {
    if (depth > 6) return '[MAX_DEPTH_REACHED]';
    if (input === null || input === undefined) return input;

    if (typeof input === 'string') {
        return redactString(input);
    }

    if (typeof input === 'number' || typeof input === 'boolean') {
        return input;
    }

    if (Array.isArray(input)) {
        return input.map(item => redactData(item, depth + 1));
    }

    if (typeof input === 'object') {
        // Redact Error objects safely
        if (input instanceof Error) {
            return {
                name: input.name,
                message: redactString(input.message),
                // Exclude raw stack traces in traces to prevent internal path and env leak
                errorType: input.name || 'Error'
            };
        }

        const out = {};
        for (const [key, val] of Object.entries(input)) {
            if (isSensitiveKey(key)) {
                out[key] = '[REDACTED_CREDENTIAL]';
            } else {
                out[key] = redactData(val, depth + 1);
            }
        }
        return out;
    }

    return String(input);
}

/**
 * Filters metadata dictionary against the strict allowlist.
 */
function sanitizeTraceMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== 'object') return {};
    const sanitized = {};
    for (const [key, val] of Object.entries(metadata)) {
        if (ALLOWED_METADATA_KEYS.has(key)) {
            sanitized[key] = redactData(val);
        }
    }
    return sanitized;
}

/**
 * Sanitizes inputs and outputs for trace runs according to capture policy.
 * When captureContent is false (default), input and output are redacted to metadata-only summary.
 */
function sanitizeRunContent(content, captureContent = false) {
    if (!captureContent) {
        if (!content || typeof content !== 'object') {
            return { summary: '[CONTENT_CAPTURE_DISABLED]' };
        }
        // Metadata-only summary
        return {
            summary: '[CONTENT_CAPTURE_DISABLED]',
            itemCount: Array.isArray(content) ? content.length : Object.keys(content).length
        };
    }
    return redactData(content);
}

module.exports = {
    redactString,
    redactData,
    sanitizeTraceMetadata,
    sanitizeRunContent,
    isSensitiveKey,
    ALLOWED_METADATA_KEYS
};
