/**
 * Unified Model Factory for Restorm LangChain Architecture
 *
 * Integrates Google Gemini and OpenRouter providers, preserving existing
 * API keys, candidate model failover, timeouts, and deterministic fallback.
 */

const { withTrace } = require('../observability/langsmithTracing');
const { buildGenerationMetadata } = require('../observability/traceMetadata');
const { convertToOpenAITool } = require('@langchain/core/utils/function_calling');
const { EXECUTION_POLICY } = require('./executionPolicy');

// Gemini candidate models in order of attempt (starts with stable production candidates)
const GEMINI_MODELS = [
    'gemini-3.1-flash-lite',
    'gemini-2.0-flash',
    'gemini-3-flash-preview',
    'gemini-flash-latest'
];

// In-memory cooldown cache for quota-exhausted (429) or failing models
const modelCooldowns = new Map();

function isModelInCooldown(model) {
    const expiresAt = modelCooldowns.get(model);
    if (!expiresAt) return false;
    if (Date.now() >= expiresAt) {
        modelCooldowns.delete(model);
        return false;
    }
    return true;
}

function markModelCooldown(model, retryAfterSeconds = 60) {
    const ms = (retryAfterSeconds > 0 ? retryAfterSeconds : 60) * 1000;
    modelCooldowns.set(model, Date.now() + ms);
}

function resetModelCooldowns() {
    modelCooldowns.clear();
}

/**
 * Formats LangChain messages into standard role/content objects.
 */
function normalizeMessages(messages = []) {
    return messages.map(m => {
        if (typeof m.toDict === 'function') {
            const d = m.toDict();
            return { role: d.type === 'human' ? 'user' : (d.type === 'ai' ? 'assistant' : d.type), content: m.content };
        }
        if (m._getType) {
            const t = m._getType();
            return { role: t === 'human' ? 'user' : (t === 'ai' ? 'assistant' : t), content: m.content };
        }
        if (typeof m === 'object' && m.role && m.content) {
            return m;
        }
        return { role: 'user', content: String(m) };
    });
}

/**
 * Invokes Google Gemini API with candidate fallback and optional tool declarations.
 */
async function callGemini(messages, tools = [], options = {}) {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return null;

    const normMsgs = normalizeMessages(messages);
    const systemInstruction = normMsgs.find(m => m.role === 'system')?.content || '';
    const conversation = normMsgs.filter(m => m.role !== 'system');

    // Build Gemini contents array
    const contents = conversation.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

    // Convert tools to Gemini functionDeclarations format if tools are provided
    let geminiTools = undefined;
    if (tools.length > 0) {
        const decls = tools.map(t => {
            const openAiFormat = convertToOpenAITool(t);
            const fn = openAiFormat.function;
            const params = { ...fn.parameters };
            delete params.$schema;
            delete params.additionalProperties;
            return {
                name: fn.name,
                description: fn.description,
                parameters: params
            };
        });
        geminiTools = [{ functionDeclarations: decls }];
    }

    const parentRun = options.parentRun || null;

    const configuredModel = (process.env.GEMINI_MODEL || '').trim();
    const candidateModels = configuredModel
        ? [configuredModel, ...GEMINI_MODELS.filter(m => m !== configuredModel)]
        : GEMINI_MODELS;

    for (const model of candidateModels) {
        // Skip candidate if currently in 429/quota cooldown
        if (isModelInCooldown(model)) {
            continue;
        }

        const t0 = Date.now();
        let generationResult = null;

        try {
            generationResult = await withTrace('restorm.model_generation', 'llm', async () => {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
                const bodyPayload = {
                    contents,
                    generationConfig: {
                        temperature: 0.2
                    }
                };
                if (systemInstruction) {
                    bodyPayload.systemInstruction = { parts: [{ text: systemInstruction }] };
                }
                if (geminiTools) {
                    bodyPayload.tools = geminiTools;
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify(bodyPayload),
                    signal: AbortSignal.timeout(options.timeoutMs || EXECUTION_POLICY.MODEL_TIMEOUT_MS)
                });

                if (!response.ok) {
                    if (response.status === 429) {
                        const retryHeader = response.headers?.get('retry-after');
                        const retrySec = retryHeader ? parseInt(retryHeader, 10) : 60;
                        markModelCooldown(model, isNaN(retrySec) ? 60 : retrySec);
                        console.warn(`[ModelFactory] Gemini (${model}) HTTP 429. Cooling down for ${retrySec}s. Trying next candidate.`);
                    } else if (response.status === 401 || response.status === 403) {
                        markModelCooldown(model, 300);
                        console.warn(`[ModelFactory] Gemini (${model}) HTTP ${response.status}. Key invalid/unauthorized. Trying next candidate.`);
                    } else {
                        console.warn(`[ModelFactory] Gemini (${model}) HTTP ${response.status}. Trying next candidate.`);
                    }
                    return null;
                }

                const data = await response.json();
                const part = data?.candidates?.[0]?.content?.parts?.[0];
                const usage = data?.usageMetadata ? {
                    inputTokens: data.usageMetadata.promptTokenCount,
                    outputTokens: data.usageMetadata.candidatesTokenCount,
                    totalTokens: data.usageMetadata.totalTokenCount
                } : null;

                // Check for functionCall
                if (part?.functionCall) {
                    return {
                        type: 'tool_call',
                        toolCall: {
                            name: part.functionCall.name,
                            args: part.functionCall.args || {},
                            id: `call_${Date.now()}`
                        },
                        provider: `Google Gemini (${model})`,
                        usage
                    };
                }

                if (part?.text) {
                    return {
                        type: 'text',
                        content: part.text,
                        provider: `Google Gemini (${model})`,
                        usage
                    };
                }

                return null;
            }, {
                parentRun,
                metadata: buildGenerationMetadata('Google Gemini', model, Date.now() - t0)
            });
        } catch (err) {
            console.warn(`[ModelFactory] Gemini (${model}) failed:`, err.message);
            continue;
        }

        if (generationResult) {
            return generationResult;
        }
    }

    return null;
}

/**
 * Invokes OpenRouter API with OpenAI-compatible tool calling.
 */
async function callOpenRouter(messages, tools = [], options = {}) {
    const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
    if (!apiKey) return null;

    if (isModelInCooldown('openrouter')) {
        return null;
    }

    const modelName = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free';
    const normMsgs = normalizeMessages(messages);
    const parentRun = options.parentRun || null;
    const t0 = Date.now();

    try {
        return await withTrace('restorm.model_generation', 'llm', async () => {
            const bodyPayload = {
                model: modelName,
                messages: normMsgs,
                temperature: 0.2,
                reasoning: { effort: 'none' }
            };

            if (tools.length > 0) {
                bodyPayload.tools = tools.map(convertToOpenAITool);
            }

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:4004',
                    'X-Title': 'Retry Storm Sentinel'
                },
                body: JSON.stringify(bodyPayload),
                signal: AbortSignal.timeout(options.timeoutMs || EXECUTION_POLICY.MODEL_TIMEOUT_MS)
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    markModelCooldown('openrouter', 300);
                    console.warn(`[ModelFactory] OpenRouter HTTP ${response.status} (Auth/Expired). Cooling down.`);
                } else if (response.status === 429) {
                    markModelCooldown('openrouter', 60);
                    console.warn(`[ModelFactory] OpenRouter HTTP 429 (Rate limit). Cooling down.`);
                } else {
                    console.warn(`[ModelFactory] OpenRouter HTTP ${response.status}. Using fallback.`);
                }
                return null;
            }

            const data = await response.json();
            const message = data?.choices?.[0]?.message;
            const usage = data?.usage ? {
                inputTokens: data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens
            } : null;

            if (message?.tool_calls && message.tool_calls.length > 0) {
                const tc = message.tool_calls[0];
                let parsedArgs = {};
                try {
                    parsedArgs = typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : (tc.function.arguments || {});
                } catch (e) {
                    parsedArgs = {};
                }
                return {
                    type: 'tool_call',
                    toolCall: {
                        name: tc.function.name,
                        args: parsedArgs,
                        id: tc.id || `call_${Date.now()}`
                    },
                    provider: `OpenRouter (${modelName})`,
                    usage
                };
            }

            if (message?.content) {
                return {
                    type: 'text',
                    content: message.content,
                    provider: `OpenRouter (${modelName})`,
                    usage
                };
            }

            return null;
        }, {
            parentRun,
            metadata: buildGenerationMetadata('OpenRouter', modelName, Date.now() - t0)
        });
    } catch (err) {
        console.warn('[ModelFactory] OpenRouter exception:', err.message);
        return null;
    }
}

/**
 * Dispatches to Gemini first, then OpenRouter. Returns null if all providers fail or are unconfigured.
 */
async function invokeModel(messages, tools = [], options = {}) {
    // 1. Google Gemini candidate failover
    const geminiResult = await callGemini(messages, tools, options);
    if (geminiResult) return geminiResult;

    // 2. OpenRouter fallback
    const openrouterResult = await callOpenRouter(messages, tools, options);
    if (openrouterResult) return openrouterResult;

    return null;
}

module.exports = {
    invokeModel,
    callGemini,
    callOpenRouter,
    normalizeMessages,
    resetModelCooldowns,
    isModelInCooldown,
    markModelCooldown,
    GEMINI_MODELS
};
