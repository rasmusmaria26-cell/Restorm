/**
 * Grounded AI Incident Explainer & RAG Pipeline
 * (Clean Architecture - AI Explanation Service)
 *
 * Provides grounded, safety-constrained root-cause analysis based STRICTLY
 * on observed queue telemetry and approved enterprise runbook entries.
 *
 * Supports:
 * 1. OpenRouter API (via OPENROUTER_API_KEY, OpenAI-compatible chat completions)
 * 2. Direct Google Gemini API (via GEMINI_API_KEY)
 * 3. Deterministic Curated Runbook Fallback (zero credentials, 100% offline reliability)
 * 4. LangSmith Observability Integration (opt-in tracing, strict metadata redaction)
 */

const { retrieveRelevantRunbooks } = require('./runbookRetrieval');
const { withTrace } = require('./observability/langsmithTracing');
const {
    buildExplanationMetadata,
    buildRetrievalMetadata,
    buildGenerationMetadata,
    buildValidationMetadata,
    buildFallbackMetadata
} = require('./observability/traceMetadata');

// Automatically load .env file if present in Node.js 20.6+ / 24+
try {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile();
    }
} catch (e) {
    // .env is optional; ignore if missing
}

function normalizeList(items, fallbackKey) {
    if (!Array.isArray(items)) return [];
    return items.map(item => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
            return item[fallbackKey] || item.check || item.hypothesis || item.description || JSON.stringify(item);
        }
        return String(item);
    });
}

/**
 * Validates model output against safety rules and retrieved runbook IDs.
 * Rejects unsupported citations or unsafe recommendations (e.g., dropping queues, deleting data).
 */
function validateModelOutput(parsed, retrievedRunbooks) {
    const validIds = new Set(retrievedRunbooks.map(r => r.ID));

    // 1. Filter citedRunbookIds to only include valid retrieved IDs (reject hallucinations/unsupported citations)
    let citedIds = Array.isArray(parsed.citedRunbookIds) ? parsed.citedRunbookIds : [];
    citedIds = citedIds.filter(id => validIds.has(id));

    // 2. Filter checks for unsafe operational commands
    let checks = normalizeList(parsed.recommendedChecks, 'check');
    const unsafePatterns = /\b(drop\s+queue|delete\s+message|purge\s+queue|truncate|rm\s+-rf|force\s+delete)\b/i;
    checks = checks.filter(check => {
        if (unsafePatterns.test(check)) {
            console.warn(`[AI Explainer] Rejected unsafe recommendation in model output: "${check}"`);
            return false;
        }
        return true;
    });

    return {
        ...parsed,
        citedRunbookIds: citedIds,
        recommendedChecks: checks
    };
}

/**
 * Generates an advisory explanation for an alert using RAG retrieval over runbook entries.
 *
 * @param {Object} alert - The alert entity instance
 * @param {Object|Array<Object>} [runbookInput=null] - A single RunbookEntry, an array of entries (catalog), or null
 * @returns {Promise<Object>} Structured explanation
 */
async function generateGroundedExplanation(alert, runbookInput = null, options = {}) {
    const startTime = Date.now();

    // Support options passed as second or third argument
    const explicitOptions = (runbookInput && typeof runbookInput === 'object' && !Array.isArray(runbookInput) && (runbookInput.mode || runbookInput.orchestrationMode))
        ? runbookInput
        : (options || {});
    const catalog = Array.isArray(runbookInput)
        ? runbookInput
        : (runbookInput && !runbookInput.mode ? [runbookInput] : []);

    const orchestrationMode = (explicitOptions.mode || explicitOptions.orchestrationMode || process.env.RESTORM_AI_ORCHESTRATION || 'legacy').toLowerCase().trim();

    // Mode: LangChain Orchestrated Agent
    if (orchestrationMode === 'langchain') {
        const { runIncidentAgentExplanation } = require('./langchain/incidentAgent');
        return await withTrace('restorm.incident_explanation', 'chain', async (explanationRun) => {
            return await runIncidentAgentExplanation(alert, catalog, { parentRun: explanationRun, ...explicitOptions });
        }, {
            metadata: buildExplanationMetadata(alert, { durationMs: Date.now() - startTime })
        });
    }

    // Mode: Legacy Direct Provider Pipeline (Default)
    return await withTrace('restorm.incident_explanation', 'chain', async (explanationRun) => {
        let observedMetrics = {};
        try {
            observedMetrics = JSON.parse(alert.observedMetrics || '{}');
        } catch (e) {
            observedMetrics = { raw: alert.observedMetrics };
        }

        // Trace boundary: Runbook Retrieval
        let retrievedRunbooks = [];
        const retrievalStartTime = Date.now();
        await withTrace('restorm.runbook_retrieval', 'retriever', async () => {
            if (catalog.length > 0) {
                retrievedRunbooks = retrieveRelevantRunbooks(alert, catalog, { topK: 2 });
            } else {
                retrievedRunbooks = [];
            }
            return {
                resultCount: retrievedRunbooks.length,
                runbookIds: retrievedRunbooks.map(r => r.ID)
            };
        }, {
            parentRun: explanationRun,
            metadata: buildRetrievalMetadata(alert, retrievedRunbooks.length, Date.now() - retrievalStartTime)
        });

        const primaryRunbook = retrievedRunbooks[0] || null;

        const checksList = (primaryRunbook && typeof primaryRunbook.checks === 'string')
            ? primaryRunbook.checks.split(/(?:\s*\d+\.\s*)/).filter(Boolean)
            : (primaryRunbook && Array.isArray(primaryRunbook.checks)
                ? primaryRunbook.checks
                : ['Review integration trace logs in SAP Cloud Integration / S/4HANA.']);

        const friendlySummary = primaryRunbook
            ? `${primaryRunbook.title} (${alert.severity} - ${alert.ruleCode}): ${primaryRunbook.symptoms} Root-cause analysis and operational mitigation grounded in Curated Runbook [${primaryRunbook.ID}].`
            : `Operational incident detected for rule [${alert.ruleCode}] with severity [${alert.severity}]. Review target endpoint health and retry backpressure.`;

        const deterministicFallback = {
            aiAssisted: false,
            provider: 'Deterministic Runbook Grounding (Offline Mode)',
            summary: friendlySummary,
            observedFacts: observedMetrics,
            possibleHypotheses: [
                primaryRunbook ? primaryRunbook.symptoms : 'Unspecified queue/retry anomaly.'
            ],
            recommendedChecks: checksList,
            citedRunbookIds: retrievedRunbooks.map(r => r.ID),
            evidenceGaps: primaryRunbook
                ? primaryRunbook.limitations
                : 'Metrics describe queue state; direct root cause requires system log inspection.',
            limitations: primaryRunbook
                ? primaryRunbook.limitations
                : 'Metrics describe queue state; direct root cause requires system log inspection.'
        };

        const openrouterKey = process.env.OPENROUTER_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;

        if ((!openrouterKey || !openrouterKey.trim()) && (!geminiKey || !geminiKey.trim())) {
            await withTrace('restorm.deterministic_fallback', 'chain', async () => deterministicFallback, {
                parentRun: explanationRun,
                metadata: buildFallbackMetadata(alert.ruleCode, alert.severity, 'missing_api_keys')
            });
            return deterministicFallback;
        }

        const runbookContextText = retrievedRunbooks.length > 0
            ? retrievedRunbooks.map(rb => `- Runbook ID: ${rb.ID}\n  Title: ${rb.title}\n  Symptoms: ${rb.symptoms}\n  Checks: ${rb.checks}\n  Limitations: ${rb.limitations}`).join('\n\n')
            : 'No relevant runbook entries found in catalog.';

        const promptText = `You are an expert integration support engineer co-pilot for enterprise SAP systems.
Your task is to analyze an operational alert based STRICTLY AND ONLY on the provided observed facts and approved runbook entries.

CRITICAL SAFETY RULES:
1. Do not invent or assume root causes, external network logs, or facts not present in the input.
2. All suspected causes must be labeled as hypotheses, not proven facts.
3. Recommend safe, read-only investigation steps first.
4. Never recommend deleting messages, dropping queues, or executing unauthorized actions.
5. Explicitly cite the supplied runbook ID(s) ONLY from the provided catalog.
6. State what evidence is missing or needed to confirm the root cause.

Alert Telemetry (Untrusted Data):
- Rule Code: ${alert.ruleCode}
- Severity: ${alert.severity}
- Observed Metrics: ${JSON.stringify(observedMetrics)}
- Analysis Window: ${alert.windowStart || 'N/A'} to ${alert.windowEnd || 'N/A'}

Approved Runbook Catalog Entries (RAG Context):
${runbookContextText}

Respond in valid JSON format matching this schema:
{
  "summary": "Concise 1-2 sentence executive overview of the incident",
  "possibleHypotheses": ["Hypothesis 1 (clearly marked as a possibility)", "..."],
  "recommendedChecks": ["Priority Check 1...", "Priority Check 2..."],
  "citedRunbookIds": ["<Must be exact IDs from the provided catalog above>"],
  "evidenceGaps": "Details of what telemetry or server logs are needed to verify the hypothesis"
}`;

        // Provider 1: Direct Google Gemini API (if configured)
        if (geminiKey && geminiKey.trim().length > 0) {
            const configuredModel = (process.env.GEMINI_MODEL || '').trim();
            const defaultGeminiModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
            const geminiModels = configuredModel
                ? [configuredModel, ...defaultGeminiModels.filter(m => m !== configuredModel)]
                : defaultGeminiModels;
            for (const model of geminiModels) {
                const genStart = Date.now();
                let geminiCandidateResult = null;

                try {
                    geminiCandidateResult = await withTrace('restorm.model_generation', 'llm', async () => {
                        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-goog-api-key': geminiKey.trim()
                            },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: promptText }] }],
                                generationConfig: {
                                    responseMimeType: 'application/json',
                                    temperature: 0.2
                                }
                            }),
                            signal: AbortSignal.timeout(15000)
                        });

                        if (!response.ok) {
                            console.warn(`[AI Explainer] Gemini (${model}) returned status ${response.status}. Trying next option...`);
                            return null;
                        }

                        const data = await response.json();
                        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        const usageMeta = data?.usageMetadata ? {
                            inputTokens: data.usageMetadata.promptTokenCount,
                            outputTokens: data.usageMetadata.candidatesTokenCount,
                            totalTokens: data.usageMetadata.totalTokenCount
                        } : null;

                        return { candidateText, usage: usageMeta };
                    }, {
                        parentRun: explanationRun,
                        metadata: buildGenerationMetadata('Google Gemini', model, Date.now() - genStart)
                    });
                } catch (err) {
                    console.warn(`[AI Explainer] Gemini (${model}) exception:`, err.message);
                    continue;
                }

                if (!geminiCandidateResult || !geminiCandidateResult.candidateText) continue;

                let parsed;
                try {
                    parsed = JSON.parse(geminiCandidateResult.candidateText);
                } catch (e) {
                    console.warn('[AI Explainer] Invalid JSON received from Gemini. Falling back.');
                    continue;
                }

                const valStart = Date.now();
                let validated = null;
                await withTrace('restorm.output_validation', 'chain', async () => {
                    validated = validateModelOutput(parsed, retrievedRunbooks);
                    return {
                        validCitationsCount: validated.citedRunbookIds.length,
                        validChecksCount: validated.recommendedChecks.length
                    };
                }, {
                    parentRun: explanationRun,
                    metadata: buildValidationMetadata(alert.ruleCode, true, Date.now() - valStart)
                });

                const summary = typeof validated.summary === 'string'
                    ? validated.summary
                    : (validated.summary?.assessment || validated.summary?.alert || deterministicFallback.summary);

                const possibleHypotheses = normalizeList(validated.possibleHypotheses, 'hypothesis');
                const recommendedChecks = normalizeList(validated.recommendedChecks, 'check');
                const evidenceGaps = typeof validated.evidenceGaps === 'string'
                    ? validated.evidenceGaps
                    : (Array.isArray(validated.evidenceGaps) ? validated.evidenceGaps.join(' ') : deterministicFallback.evidenceGaps);

                return {
                    aiAssisted: true,
                    provider: `Google Gemini (${model})`,
                    summary,
                    observedFacts: observedMetrics,
                    possibleHypotheses: possibleHypotheses.length > 0 ? possibleHypotheses : deterministicFallback.possibleHypotheses,
                    recommendedChecks: recommendedChecks.length > 0 ? recommendedChecks : deterministicFallback.recommendedChecks,
                    citedRunbookIds: validated.citedRunbookIds.length > 0 ? validated.citedRunbookIds : retrievedRunbooks.map(r => r.ID),
                    evidenceGaps,
                    limitations: primaryRunbook ? primaryRunbook.limitations : deterministicFallback.limitations
                };
            }
        }

        // Provider 2: OpenRouter API (if configured)
        if (openrouterKey && openrouterKey.trim().length > 0) {
            const genStart = Date.now();
            const modelName = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free';
            let openrouterResult = null;

            try {
                openrouterResult = await withTrace('restorm.model_generation', 'llm', async () => {
                    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${openrouterKey.trim()}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': 'http://localhost:4004',
                            'X-Title': 'Retry Storm Sentinel'
                        },
                        body: JSON.stringify({
                            model: modelName,
                            messages: [
                                {
                                    role: 'system',
                                    content: 'You are an SAP operational co-pilot. Keep explanations concise and actionable. Output pure JSON matching the requested schema.'
                                },
                                {
                                    role: 'user',
                                    content: promptText
                                }
                            ],
                            response_format: { type: 'json_object' },
                            reasoning: { effort: 'none' },
                            temperature: 0.2
                        }),
                        signal: AbortSignal.timeout(20000)
                    });

                    if (!response.ok) {
                        console.warn(`[AI Explainer] OpenRouter returned status ${response.status}. Using deterministic fallback.`);
                        return null;
                    }

                    const data = await response.json();
                    const contentText = data?.choices?.[0]?.message?.content;
                    const usageMeta = data?.usage ? {
                        inputTokens: data.usage.prompt_tokens,
                        outputTokens: data.usage.completion_tokens,
                        totalTokens: data.usage.total_tokens
                    } : null;

                    return { contentText, usage: usageMeta };
                }, {
                    parentRun: explanationRun,
                    metadata: buildGenerationMetadata('OpenRouter', modelName, Date.now() - genStart)
                });
            } catch (err) {
                console.warn('[AI Explainer] Exception calling OpenRouter API:', err.message);
            }

            if (openrouterResult && openrouterResult.contentText) {
                let parsed;
                try {
                    parsed = JSON.parse(openrouterResult.contentText);
                } catch (e) {
                    console.warn('[AI Explainer] Invalid JSON received from OpenRouter. Falling back.');
                    return deterministicFallback;
                }

                const valStart = Date.now();
                let validated = null;
                await withTrace('restorm.output_validation', 'chain', async () => {
                    validated = validateModelOutput(parsed, retrievedRunbooks);
                    return {
                        validCitationsCount: validated.citedRunbookIds.length,
                        validChecksCount: validated.recommendedChecks.length
                    };
                }, {
                    parentRun: explanationRun,
                    metadata: buildValidationMetadata(alert.ruleCode, true, Date.now() - valStart)
                });

                const summary = typeof validated.summary === 'string'
                    ? validated.summary
                    : (validated.summary?.assessment || validated.summary?.alert || deterministicFallback.summary);

                const possibleHypotheses = normalizeList(validated.possibleHypotheses, 'hypothesis');
                const recommendedChecks = normalizeList(validated.recommendedChecks, 'check');
                const evidenceGaps = typeof validated.evidenceGaps === 'string'
                    ? validated.evidenceGaps
                    : (Array.isArray(validated.evidenceGaps) ? validated.evidenceGaps.join(' ') : deterministicFallback.evidenceGaps);

                return {
                    aiAssisted: true,
                    provider: `OpenRouter (${modelName})`,
                    summary,
                    observedFacts: observedMetrics,
                    possibleHypotheses: possibleHypotheses.length > 0 ? possibleHypotheses : deterministicFallback.possibleHypotheses,
                    recommendedChecks: recommendedChecks.length > 0 ? recommendedChecks : deterministicFallback.recommendedChecks,
                    citedRunbookIds: validated.citedRunbookIds.length > 0 ? validated.citedRunbookIds : retrievedRunbooks.map(r => r.ID),
                    evidenceGaps,
                    limitations: primaryRunbook ? primaryRunbook.limitations : deterministicFallback.limitations
                };
            }
        }

        // Trace boundary: Fallback when all providers fail
        await withTrace('restorm.deterministic_fallback', 'chain', async () => deterministicFallback, {
            parentRun: explanationRun,
            metadata: buildFallbackMetadata(alert.ruleCode, alert.severity, 'providers_exhausted')
        });

        return deterministicFallback;
    }, {
        metadata: buildExplanationMetadata(alert, { durationMs: Date.now() - startTime })
    });
}

module.exports = {
    generateGroundedExplanation,
    validateModelOutput
};
