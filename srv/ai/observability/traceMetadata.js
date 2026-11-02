/**
 * Standardized Trace Metadata Helpers for Restorm
 *
 * Constructs sanitized, allowlisted metadata dictionaries for each
 * trace boundary in the AI explanation lifecycle.
 */

const { sanitizeTraceMetadata } = require('./traceRedaction');

/**
 * Builds base metadata common to all Restorm AI operations.
 */
function buildBaseMetadata(extra = {}) {
    return {
        environment: process.env.NODE_ENV || 'development',
        orchestrationMode: (process.env.RESTORM_AI_ORCHESTRATION || 'legacy').toLowerCase(),
        timestamp: new Date().toISOString(),
        ...extra
    };
}

/**
 * Metadata for top-level incident explanation trace ('restorm.incident_explanation').
 */
function buildExplanationMetadata(alert = {}, options = {}) {
    const raw = buildBaseMetadata({
        ruleCode: alert.ruleCode || 'UNKNOWN',
        severity: alert.severity || 'UNKNOWN',
        interfaceId: alert.interface_ID || alert.interfaceId || 'unscoped',
        fallbackUsed: Boolean(options.fallbackUsed),
        provider: options.provider || 'unknown',
        model: options.model || 'unknown',
        durationMs: typeof options.durationMs === 'number' ? Math.round(options.durationMs) : undefined,
        validationPassed: options.validationPassed !== undefined ? Boolean(options.validationPassed) : undefined,
        errorClassification: options.errorClassification || undefined,
        inputTokens: options.usage?.inputTokens,
        outputTokens: options.usage?.outputTokens,
        totalTokens: options.usage?.totalTokens
    });
    return sanitizeTraceMetadata(raw);
}

/**
 * Metadata for runbook retrieval trace ('restorm.runbook_retrieval').
 */
function buildRetrievalMetadata(alert = {}, resultCount = 0, durationMs = 0) {
    const raw = buildBaseMetadata({
        ruleCode: alert.ruleCode || 'UNKNOWN',
        severity: alert.severity || 'UNKNOWN',
        retrievalResultCount: Number(resultCount) || 0,
        durationMs: Math.round(durationMs)
    });
    return sanitizeTraceMetadata(raw);
}

/**
 * Metadata for model generation trace ('restorm.model_generation').
 */
function buildGenerationMetadata(provider, model, durationMs = 0, usage = null, error = null) {
    const raw = buildBaseMetadata({
        provider: String(provider || 'unknown'),
        model: String(model || 'unknown'),
        durationMs: Math.round(durationMs),
        inputTokens: usage?.inputTokens || usage?.promptTokens,
        outputTokens: usage?.outputTokens || usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        errorClassification: error ? (error.name || 'GenerationError') : undefined
    });
    return sanitizeTraceMetadata(raw);
}

/**
 * Metadata for output validation trace ('restorm.output_validation').
 */
function buildValidationMetadata(ruleCode, passed = true, durationMs = 0) {
    const raw = buildBaseMetadata({
        ruleCode: ruleCode || 'UNKNOWN',
        validationPassed: Boolean(passed),
        durationMs: Math.round(durationMs)
    });
    return sanitizeTraceMetadata(raw);
}

/**
 * Metadata for deterministic fallback trace ('restorm.deterministic_fallback').
 */
function buildFallbackMetadata(ruleCode, severity, reason = 'missing_credentials') {
    const raw = buildBaseMetadata({
        ruleCode: ruleCode || 'UNKNOWN',
        severity: severity || 'UNKNOWN',
        fallbackUsed: true,
        errorClassification: String(reason)
    });
    return sanitizeTraceMetadata(raw);
}

/**
 * Metadata for tool execution trace ('restorm.tool_execution').
 */
function buildToolMetadata(toolName, durationMs = 0, success = true, error = null) {
    const raw = buildBaseMetadata({
        toolsCalled: [String(toolName)],
        toolCallCount: 1,
        durationMs: Math.round(durationMs),
        validationPassed: Boolean(success),
        errorClassification: error ? (error.name || 'ToolError') : undefined
    });
    return sanitizeTraceMetadata(raw);
}

module.exports = {
    buildBaseMetadata,
    buildExplanationMetadata,
    buildRetrievalMetadata,
    buildGenerationMetadata,
    buildValidationMetadata,
    buildFallbackMetadata,
    buildToolMetadata
};
