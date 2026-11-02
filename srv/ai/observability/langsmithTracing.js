/**
 * LangSmith Observability Integration for Restorm
 *
 * Responsibilities:
 * - Safe opt-in tracing for Restorm AI execution pipelines.
 * - Enforces metadata-only capture by default with strict redaction.
 * - Non-blocking failure isolation: tracing errors NEVER fail business logic.
 * - Zero network calls when tracing is disabled or credentials are missing.
 * - Diagnostics reporting for tracing configuration without exposing keys.
 */

// Automatically load .env file if present in Node.js 20.6+ / 24+
try {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile();
    }
} catch (e) {
    // .env is optional; ignore if missing
}

const { Client, RunTree } = require('langsmith');
const {
    sanitizeTraceMetadata,
    sanitizeRunContent,
    redactData
} = require('./traceRedaction');

// Singleton client instance
let langsmithClient = null;
let clientInitialized = false;

/**
 * Returns true if LangSmith tracing is explicitly enabled and properly configured.
 */
function isTracingEnabled() {
    if ((process.env.RESTORM_LANGSMITH_ENABLED || '').toLowerCase() === 'false') {
        return false;
    }
    const enabledFlag = (process.env.RESTORM_LANGSMITH_ENABLED || '').toLowerCase() === 'true' ||
                        (process.env.LANGSMITH_TRACING || '').toLowerCase() === 'true';
    const apiKey = (process.env.LANGSMITH_API_KEY || '').trim();
    return enabledFlag && apiKey.length > 0;
}

/**
 * Returns true if content capture (inputs/outputs) is explicitly enabled. Default is false (metadata only).
 */
function isContentCaptureEnabled() {
    return (process.env.RESTORM_LANGSMITH_CAPTURE_CONTENT || '').toLowerCase() === 'true';
}

/**
 * Initializes and returns the LangSmith client singleton.
 * Returns null if tracing is disabled or credentials missing.
 */
function getLangSmithClient() {
    if (clientInitialized) return langsmithClient;

    if (!isTracingEnabled()) {
        clientInitialized = true;
        langsmithClient = null;
        return null;
    }

    try {
        const clientOptions = {
            apiKey: process.env.LANGSMITH_API_KEY.trim()
        };
        if (process.env.LANGSMITH_ENDPOINT && process.env.LANGSMITH_ENDPOINT.trim()) {
            clientOptions.apiUrl = process.env.LANGSMITH_ENDPOINT.trim();
        }
        if (process.env.LANGSMITH_WORKSPACE_ID && process.env.LANGSMITH_WORKSPACE_ID.trim()) {
            clientOptions.workspaceId = process.env.LANGSMITH_WORKSPACE_ID.trim();
        }

        langsmithClient = new Client(clientOptions);
        clientInitialized = true;
    } catch (err) {
        console.warn('[LangSmith] Initialization failed safely; tracing disabled:', err.message);
        langsmithClient = null;
        clientInitialized = true;
    }

    return langsmithClient;
}

/**
 * Resets the client singleton (useful for isolated unit tests).
 */
function resetClient() {
    langsmithClient = null;
    clientInitialized = false;
}

/**
 * Safe tracing wrapper for an async or synchronous function.
 *
 * @param {string} name - The trace name (e.g. 'restorm.incident_explanation')
 * @param {string} runType - 'chain' | 'llm' | 'tool' | 'retriever'
 * @param {Function} fn - The actual business logic callback (receives run object or null)
 * @param {Object} [options]
 * @param {Object} [options.inputs] - Input payload to record
 * @param {Object} [options.metadata] - Allowlisted metadata dictionary
 * @param {Array<string>} [options.tags] - Safe trace tags
 * @param {Object} [options.parentRun] - Parent RunTree instance for nesting
 * @returns {Promise<*>} Result of fn()
 */
async function withTrace(name, runType, fn, options = {}) {
    if (!isTracingEnabled()) {
        // Tracing disabled: execute directly without overhead or network calls
        return await fn(null);
    }

    const client = getLangSmithClient();
    if (!client) {
        return await fn(null);
    }

    const captureContent = isContentCaptureEnabled();
    const sanitizedInputs = sanitizeRunContent(options.inputs, captureContent);
    const sanitizedMetadata = sanitizeTraceMetadata(options.metadata || {});
    const safeTags = Array.isArray(options.tags)
        ? options.tags.map(t => String(t).slice(0, 50))
        : ['restorm'];

    let runTree = null;
    const startTime = Date.now();

    try {
        const projectName = process.env.LANGSMITH_PROJECT || process.env.RESTORM_LANGSMITH_PROJECT || 'restorm-ai-development';
        const runConfig = {
            name,
            run_type: runType || 'chain',
            inputs: sanitizedInputs,
            project_name: projectName,
            client,
            extra: {
                metadata: sanitizedMetadata
            },
            tags: safeTags
        };

        if (options.parentRun && typeof options.parentRun.createChild === 'function') {
            runTree = options.parentRun.createChild(runConfig);
        } else {
            runTree = new RunTree(runConfig);
        }

        // Post the start of run
        const postPromise = runTree.postRun().catch(err => {
            console.warn(`[LangSmith] postRun warning for "${name}":`, err.message);
        });
        if (options.flushSync) {
            await postPromise;
        }
    } catch (err) {
        // Never allow tracing initialization failure to block execution
        console.warn(`[LangSmith] RunTree setup failed for "${name}":`, err.message);
        runTree = null;
    }

    try {
        const result = await fn(runTree);

        if (runTree) {
            const durationMs = Date.now() - startTime;
            const sanitizedOutputs = sanitizeRunContent(result, captureContent);

            runTree.end({
                outputs: sanitizedOutputs
            });

            // Patch completion
            const patchPromise = runTree.patchRun().catch(err => {
                console.warn(`[LangSmith] patchRun warning for "${name}":`, err.message);
            });
            if (options.flushSync) {
                await patchPromise;
            }
        }

        return result;
    } catch (error) {
        if (runTree) {
            try {
                runTree.end({
                    error: redactData(error.message || String(error))
                });
                runTree.patchRun().catch(() => {});
            } catch (e) {
                // Ignore tracing error completion failures
            }
        }
        throw error;
    }
}

/**
 * Returns current tracing health and diagnostics status for backend inspection.
 * Never exposes API keys.
 */
function getTracingDiagnostics() {
    const enabled = isTracingEnabled();
    const rawFlag = process.env.RESTORM_LANGSMITH_ENABLED || process.env.LANGSMITH_TRACING || 'false';
    const hasKey = Boolean(process.env.LANGSMITH_API_KEY && process.env.LANGSMITH_API_KEY.trim());

    return {
        tracingEnabled: enabled,
        configuredFlag: rawFlag,
        hasApiKey: hasKey,
        projectName: process.env.LANGSMITH_PROJECT || 'restorm-ai-development',
        endpoint: process.env.LANGSMITH_ENDPOINT || 'default (https://api.smith.langchain.com)',
        captureContent: isContentCaptureEnabled(),
        status: enabled ? 'active' : (hasKey ? 'disabled_by_flag' : 'missing_credentials')
    };
}

module.exports = {
    withTrace,
    isTracingEnabled,
    isContentCaptureEnabled,
    getLangSmithClient,
    getTracingDiagnostics,
    resetClient
};
