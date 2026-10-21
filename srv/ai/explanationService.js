/**
 * Grounded AI Incident Explainer
 * (Clean Architecture - AI Explanation Service)
 *
 * Provides grounded, safety-constrained root-cause analysis based STRICTLY
 * on observed queue telemetry and approved enterprise runbook entries.
 *
 * Supports:
 * 1. OpenRouter API (via OPENROUTER_API_KEY, OpenAI-compatible chat completions)
 * 2. Direct Google Gemini API (via GEMINI_API_KEY)
 * 3. Deterministic Curated Runbook Fallback (zero credentials, 100% offline reliability)
 */

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
 * Generates an advisory explanation for an alert.
 *
 * @param {Object} alert - The alert entity instance
 * @param {Object} [runbookEntry=null] - The matching RunbookEntry from the catalog
 * @returns {Promise<Object>} Structured explanation
 */
async function generateGroundedExplanation(alert, runbookEntry = null) {
    let observedMetrics = {};
    try {
        observedMetrics = JSON.parse(alert.observedMetrics || '{}');
    } catch (e) {
        observedMetrics = { raw: alert.observedMetrics };
    }

    const checksList = runbookEntry 
        ? runbookEntry.checks.split(/(?:\s*\d+\.\s*)/).filter(Boolean)
        : ['Review integration trace logs in SAP Cloud Integration / S/4HANA.'];

    const friendlySummary = runbookEntry 
        ? `${runbookEntry.title} (${alert.severity} - ${alert.ruleCode}): ${runbookEntry.symptoms} Root-cause analysis and operational mitigation grounded in Curated Runbook [${runbookEntry.ID}].`
        : `Operational incident detected for rule [${alert.ruleCode}] with severity [${alert.severity}]. Review target endpoint health and retry backpressure.`;

    const deterministicFallback = {
        aiAssisted: false,
        provider: 'Deterministic Runbook Grounding (Offline Mode)',
        summary: friendlySummary,
        observedFacts: observedMetrics,
        possibleHypotheses: [
            runbookEntry ? runbookEntry.symptoms : 'Unspecified queue/retry anomaly.'
        ],
        recommendedChecks: checksList,
        citedRunbookIds: runbookEntry ? [runbookEntry.ID] : [],
        evidenceGaps: runbookEntry 
            ? runbookEntry.limitations 
            : 'Metrics describe queue state; direct root cause requires system log inspection.',
        limitations: runbookEntry 
            ? runbookEntry.limitations 
            : 'Metrics describe queue state; direct root cause requires system log inspection.'
    };

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if ((!openrouterKey || !openrouterKey.trim()) && (!geminiKey || !geminiKey.trim())) {
        return deterministicFallback;
    }

    const promptText = `You are an expert integration support engineer co-pilot for enterprise SAP systems.
Your task is to analyze an operational alert based STRICTLY AND ONLY on the provided observed facts and approved runbook entries.

CRITICAL SAFETY RULES:
1. Do not invent or assume root causes, external network logs, or facts not present in the input.
2. All suspected causes must be labeled as hypotheses, not proven facts.
3. Recommend safe, read-only investigation steps first.
4. Never recommend deleting messages, dropping queues, or executing unauthorized actions.
5. Explicitly cite the supplied runbook ID(s).
6. State what evidence is missing or needed to confirm the root cause.

Alert Telemetry:
- Rule Code: ${alert.ruleCode}
- Severity: ${alert.severity}
- Observed Metrics: ${JSON.stringify(observedMetrics)}
- Analysis Window: ${alert.windowStart || 'N/A'} to ${alert.windowEnd || 'N/A'}

Approved Runbook Catalog Entry:
- Runbook ID: ${runbookEntry ? runbookEntry.ID : 'None'}
- Title: ${runbookEntry ? runbookEntry.title : 'None'}
- Known Symptoms: ${runbookEntry ? runbookEntry.symptoms : 'None'}
- Diagnostic Checks: ${runbookEntry ? runbookEntry.checks : 'None'}
- Limitations: ${runbookEntry ? runbookEntry.limitations : 'None'}

Respond in valid JSON format matching this schema:
{
  "summary": "Concise 1-2 sentence executive overview of the incident",
  "possibleHypotheses": ["Hypothesis 1 (clearly marked as a possibility)", "..."],
  "recommendedChecks": ["Priority Check 1...", "Priority Check 2..."],
  "citedRunbookIds": ["${runbookEntry ? runbookEntry.ID : ''}"],
  "evidenceGaps": "Details of what telemetry or server logs are needed to verify the hypothesis"
}`;

    // Provider 1: Direct Google Gemini API (if configured)
    if (geminiKey && geminiKey.trim().length > 0) {
        const geminiModels = ['gemini-flash-latest', 'gemini-3.5-flash'];
        for (const model of geminiModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey.trim())}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }],
                        generationConfig: {
                            responseMimeType: 'application/json',
                            temperature: 0.2
                        }
                    }),
                    signal: AbortSignal.timeout(6000)
                });

                if (!response.ok) {
                    console.warn(`[AI Explainer] Gemini (${model}) returned status ${response.status}. Trying next option...`);
                    continue;
                }

                const data = await response.json();
                const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!candidateText) continue;

                const parsed = JSON.parse(candidateText);

                const summary = typeof parsed.summary === 'string'
                    ? parsed.summary
                    : (parsed.summary?.assessment || parsed.summary?.alert || deterministicFallback.summary);

                const possibleHypotheses = normalizeList(parsed.possibleHypotheses, 'hypothesis');
                const recommendedChecks = normalizeList(parsed.recommendedChecks, 'check');
                const evidenceGaps = typeof parsed.evidenceGaps === 'string'
                    ? parsed.evidenceGaps
                    : (Array.isArray(parsed.evidenceGaps) ? parsed.evidenceGaps.join(' ') : deterministicFallback.evidenceGaps);

                return {
                    aiAssisted: true,
                    provider: `Google Gemini (${model})`,
                    summary,
                    observedFacts: observedMetrics,
                    possibleHypotheses: possibleHypotheses.length > 0 ? possibleHypotheses : deterministicFallback.possibleHypotheses,
                    recommendedChecks: recommendedChecks.length > 0 ? recommendedChecks : deterministicFallback.recommendedChecks,
                    citedRunbookIds: runbookEntry ? [runbookEntry.ID] : [],
                    evidenceGaps,
                    limitations: deterministicFallback.limitations
                };
            } catch (err) {
                console.warn(`[AI Explainer] Gemini (${model}) exception:`, err.message);
            }
        }
    }

    // Provider 2: OpenRouter API (if configured)
    if (openrouterKey && openrouterKey.trim().length > 0) {
        try {
            const modelName = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free';
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

            if (response.ok) {
                const data = await response.json();
                const contentText = data?.choices?.[0]?.message?.content;
                if (contentText) {
                    const parsed = JSON.parse(contentText);

                    const summary = typeof parsed.summary === 'string'
                        ? parsed.summary
                        : (parsed.summary?.assessment || parsed.summary?.alert || deterministicFallback.summary);

                    const possibleHypotheses = normalizeList(parsed.possibleHypotheses, 'hypothesis');
                    const recommendedChecks = normalizeList(parsed.recommendedChecks, 'check');
                    const evidenceGaps = typeof parsed.evidenceGaps === 'string'
                        ? parsed.evidenceGaps
                        : (Array.isArray(parsed.evidenceGaps) ? parsed.evidenceGaps.join(' ') : deterministicFallback.evidenceGaps);

                    return {
                        aiAssisted: true,
                        provider: `OpenRouter (${modelName})`,
                        summary,
                        observedFacts: observedMetrics,
                        possibleHypotheses: possibleHypotheses.length > 0 ? possibleHypotheses : deterministicFallback.possibleHypotheses,
                        recommendedChecks: recommendedChecks.length > 0 ? recommendedChecks : deterministicFallback.recommendedChecks,
                        citedRunbookIds: runbookEntry ? [runbookEntry.ID] : [],
                        evidenceGaps,
                        limitations: deterministicFallback.limitations
                    };
                }
            } else {
                console.warn(`[AI Explainer] OpenRouter returned status ${response.status}. Using deterministic fallback.`);
            }
        } catch (err) {
            console.warn('[AI Explainer] Exception calling OpenRouter API:', err.message);
        }
    }

    return deterministicFallback;
}

module.exports = {
    generateGroundedExplanation
};
