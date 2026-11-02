/**
 * Controlled Incident Investigation Agent for Restorm
 *
 * Implements a bounded, read-only ReAct-style agent orchestration loop
 * using LangChain tool definitions, Zod validation, and execution bounds.
 * Falls back deterministically if providers fail, limits are reached, or JSON is malformed.
 */

const { SystemMessage, HumanMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');
const { createIncidentAgentTools } = require('./agentTools');
const { SYSTEM_PROMPT, buildInvestigationPrompt } = require('./agentPrompts');
const { ExplanationOutputSchema } = require('./responseSchema');
const { invokeModel } = require('./modelFactory');
const { EXECUTION_POLICY } = require('./executionPolicy');
const { validateModelOutput } = require('../explanationService');
const { retrieveRelevantRunbooks } = require('../runbookRetrieval');
const { withTrace } = require('../observability/langsmithTracing');
const { buildFallbackMetadata, buildValidationMetadata } = require('../observability/traceMetadata');

/**
 * Executes a controlled incident investigation using LangChain agent orchestration.
 *
 * @param {Object} alert - The alert entity object
 * @param {Array<Object>} [runbookCatalog=[]] - The catalog of approved runbook entries
 * @param {Object} [options={}] - Options (parentRun, mockModel, timeoutMs)
 * @returns {Promise<Object>} Formatted explanation matching Restorm's public contract
 */
async function runIncidentAgentExplanation(alert, runbookCatalog = [], options = {}) {
    const parentRun = options.parentRun || null;
    const authorizedInterfaceId = alert.interface_ID || alert.interfaceId || null;

    let observedMetrics = {};
    try {
        observedMetrics = typeof alert.observedMetrics === 'string'
            ? JSON.parse(alert.observedMetrics || '{}')
            : (alert.observedMetrics || {});
    } catch (e) {
        observedMetrics = { raw: alert.observedMetrics };
    }

    // Baseline relevant runbook for deterministic fallback
    const relevantRunbooks = retrieveRelevantRunbooks(alert, runbookCatalog, { topK: 2 });
    const primaryRunbook = relevantRunbooks[0] || null;

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
        recommendedChecks: (primaryRunbook && typeof primaryRunbook.checks === 'string')
            ? primaryRunbook.checks.split(/(?:\s*\d+\.\s*)/).filter(Boolean)
            : (primaryRunbook && Array.isArray(primaryRunbook.checks)
                ? primaryRunbook.checks
                : ['Review integration trace logs in SAP Cloud Integration / S/4HANA.']),
        citedRunbookIds: relevantRunbooks.map(r => r.ID),
        evidenceGaps: primaryRunbook
            ? primaryRunbook.limitations
            : 'Metrics describe queue state; direct root cause requires system log inspection.',
        limitations: primaryRunbook
            ? primaryRunbook.limitations
            : 'Metrics describe queue state; direct root cause requires system log inspection.'
    };

    // If no provider keys are configured, return deterministic fallback immediately
    const hasKeys = Boolean((process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) ||
                            (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()) ||
                            options.mockModel);
    if (!hasKeys) {
        await withTrace('restorm.deterministic_fallback', 'chain', async () => deterministicFallback, {
            parentRun,
            metadata: buildFallbackMetadata(alert.ruleCode, alert.severity, 'missing_api_keys')
        });
        return deterministicFallback;
    }

    // Build the 5 read-only tools with scope enforcement
    const tools = createIncidentAgentTools({
        authorizedInterfaceId,
        runbookCatalog,
        parentRun
    });
    const toolMap = new Map(tools.map(t => [t.name, t]));

    // Format pre-retrieved catalog text for initial context
    const runbookContextText = relevantRunbooks.length > 0
        ? relevantRunbooks.map(rb => `- Runbook ID: ${rb.ID}\n  Title: ${rb.title}\n  Symptoms: ${rb.symptoms}\n  Checks: ${rb.checks}\n  Limitations: ${rb.limitations}`).join('\n\n')
        : '';

    // Initialize messages
    const messages = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(buildInvestigationPrompt(alert, runbookContextText))
    ];

    let iterationCount = 0;
    let toolCallCount = 0;
    let lastProvider = 'LangChain Agent';

    const totalTimeoutMs = options.totalTimeoutMs || options.timeoutMs || EXECUTION_POLICY.TOTAL_INVESTIGATION_TIMEOUT_MS;
    const deadline = Date.now() + totalTimeoutMs;

    while (iterationCount < EXECUTION_POLICY.MAX_ITERATIONS) {
        iterationCount++;

        const remainingTime = deadline - Date.now();
        if (remainingTime <= 500) {
            console.warn(`[IncidentAgent] Total investigation deadline reached (${totalTimeoutMs}ms). Using deterministic fallback.`);
            break;
        }

        let modelResponse = null;
        try {
            const modelTimeout = Math.min(EXECUTION_POLICY.MODEL_TIMEOUT_MS, remainingTime);
            if (options.mockModel) {
                modelResponse = await options.mockModel(messages, tools);
            } else {
                modelResponse = await invokeModel(messages, tools, { parentRun, timeoutMs: modelTimeout });
            }
        } catch (err) {
            console.warn('[IncidentAgent] Model invocation failed:', err.message);
            break;
        }

        if (!modelResponse) {
            break; // Provider exhausted or failed
        }

        if (modelResponse.provider) {
            lastProvider = modelResponse.provider;
        }

        // Branch 1: Model requested a tool execution
        if (modelResponse.type === 'tool_call' && modelResponse.toolCall) {
            if (toolCallCount >= EXECUTION_POLICY.MAX_TOOL_CALLS) {
                console.warn('[IncidentAgent] Reached maximum allowed tool calls. Halting tool execution.');
                messages.push(new HumanMessage('Tool limit reached. Formulate your final explanation now in valid JSON.'));
                continue;
            }

            const { name, args, id } = modelResponse.toolCall;
            const targetTool = toolMap.get(name);

            if (!targetTool) {
                console.warn(`[IncidentAgent] Model requested unregistered tool: "${name}"`);
                messages.push(new AIMessage(`Requested unregistered tool "${name}".`));
                messages.push(new HumanMessage(`Error: Tool "${name}" does not exist. Available tools: ${Array.from(toolMap.keys()).join(', ')}.`));
                continue;
            }

            toolCallCount++;
            let toolOutput = '';

            try {
                // Execute tool with remaining time limit
                const toolTimeout = Math.min(EXECUTION_POLICY.TOOL_TIMEOUT_MS, Math.max(1000, deadline - Date.now()));
                toolOutput = await Promise.race([
                    targetTool.invoke(args || {}),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timed out')), toolTimeout))
                ]);
            } catch (toolErr) {
                console.warn(`[IncidentAgent] Tool "${name}" execution error:`, toolErr.message);
                toolOutput = JSON.stringify({ error: toolErr.message });
            }

            // Append conversational assistant message and tool result for universal provider compatibility
            messages.push(new AIMessage(`Investigation tool "${name}" invoked with parameters: ${JSON.stringify(args || {})}`));
            messages.push(new HumanMessage(`Tool [${name}] returned result:\n${typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput)}\n\nReview this evidence. If you have sufficient information, formulate your final JSON explanation matching the required schema now. Otherwise, invoke another tool.`));
            continue;
        }

        // Branch 2: Model returned text (final candidate explanation)
        if (modelResponse.type === 'text' && modelResponse.content) {
            let parsed = null;

            // Strip markdown code fences or extract JSON block
            let cleanedText = modelResponse.content.trim();
            if (cleanedText.startsWith('```')) {
                cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            }
            const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanedText = jsonMatch[0];
            }

            try {
                parsed = JSON.parse(cleanedText);
            } catch (e) {
                console.warn('[IncidentAgent] Model returned non-JSON text. Prompting for JSON format.');
                messages.push(new AIMessage(modelResponse.content));
                messages.push(new HumanMessage('Invalid JSON format. You MUST output strictly a pure JSON object matching the required schema.'));
                continue;
            }

            // Normalize key aliases if model used slight naming variants
            if (parsed && typeof parsed === 'object') {
                if (parsed.explanation && typeof parsed.explanation === 'object') {
                    parsed = { ...parsed.explanation, ...parsed };
                }
                if (!parsed.summary && (parsed.assessment || parsed.overview || parsed.alertSummary)) {
                    parsed.summary = parsed.assessment || parsed.overview || parsed.alertSummary;
                }
                if (!parsed.possibleHypotheses && (parsed.hypotheses || parsed.potentialCauses || parsed.suspectedCauses)) {
                    parsed.possibleHypotheses = parsed.hypotheses || parsed.potentialCauses || parsed.suspectedCauses;
                }
                if (!parsed.recommendedChecks && (parsed.checks || parsed.actions || parsed.diagnosticChecks)) {
                    parsed.recommendedChecks = parsed.checks || parsed.actions || parsed.diagnosticChecks;
                }
                if (!parsed.citedRunbookIds && (parsed.runbooks || parsed.runbookIds || parsed.citations)) {
                    parsed.citedRunbookIds = parsed.runbooks || parsed.runbookIds || parsed.citations;
                }
                if (!parsed.evidenceGaps && (parsed.gaps || parsed.limitations || parsed.missingData)) {
                    parsed.evidenceGaps = parsed.gaps || parsed.limitations || parsed.missingData;
                }
            }

            // Validate against Zod schema
            const zodResult = ExplanationOutputSchema.safeParse(parsed);
            if (!zodResult.success) {
                console.warn('[IncidentAgent] Schema validation notice:', zodResult.error.message);
            }

            // Validate against Restorm safety filters (unsupported citations, drop queue, rm -rf)
            const validated = validateModelOutput(parsed, relevantRunbooks);

            await withTrace('restorm.output_validation', 'chain', async () => ({
                zodValid: zodResult.success,
                retainedCitations: validated.citedRunbookIds.length
            }), {
                parentRun,
                metadata: buildValidationMetadata(alert.ruleCode, zodResult.success)
            });

            const summary = typeof validated.summary === 'string' && validated.summary.length >= 10
                ? validated.summary
                : deterministicFallback.summary;

            const possibleHypotheses = Array.isArray(validated.possibleHypotheses) && validated.possibleHypotheses.length > 0
                ? validated.possibleHypotheses
                : deterministicFallback.possibleHypotheses;

            const recommendedChecks = Array.isArray(validated.recommendedChecks) && validated.recommendedChecks.length > 0
                ? validated.recommendedChecks
                : deterministicFallback.recommendedChecks;

            const citedRunbookIds = Array.isArray(validated.citedRunbookIds) && validated.citedRunbookIds.length > 0
                ? validated.citedRunbookIds
                : relevantRunbooks.map(r => r.ID);

            const evidenceGaps = typeof validated.evidenceGaps === 'string' && validated.evidenceGaps.length >= 5
                ? validated.evidenceGaps
                : deterministicFallback.evidenceGaps;

            return {
                aiAssisted: true,
                provider: `LangChain Orchestrated (${lastProvider})`,
                summary,
                observedFacts: observedMetrics,
                possibleHypotheses,
                recommendedChecks,
                citedRunbookIds,
                evidenceGaps,
                limitations: primaryRunbook ? primaryRunbook.limitations : deterministicFallback.limitations
            };
        }
    }

    // Fallback if loop finishes without valid structured response
    await withTrace('restorm.deterministic_fallback', 'chain', async () => deterministicFallback, {
        parentRun,
        metadata: buildFallbackMetadata(alert.ruleCode, alert.severity, 'agent_loop_exhausted')
    });

    return deterministicFallback;
}

module.exports = {
    runIncidentAgentExplanation
};
