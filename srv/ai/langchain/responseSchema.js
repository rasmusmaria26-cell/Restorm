/**
 * Structured Output Schema for Incident Explanations
 *
 * Uses Zod to strictly validate model outputs against the Restorm
 * public contract, ensuring safety, grounding, and absence of hallucinations.
 */

const { z } = require('zod');

const ExplanationOutputSchema = z.object({
    summary: z.string()
        .min(10, 'Summary must be at least 10 characters')
        .max(500, 'Summary must not exceed 500 characters')
        .describe('Concise 1-2 sentence executive overview of the incident'),

    possibleHypotheses: z.array(z.string().min(5).max(300))
        .min(1, 'At least one hypothesis is required')
        .max(5, 'Maximum 5 hypotheses allowed')
        .describe('List of suspected contributing factors, clearly labeled as possibilities'),

    recommendedChecks: z.array(z.string().min(5).max(300))
        .min(1, 'At least one recommended check is required')
        .max(6, 'Maximum 6 recommended checks allowed')
        .describe('Prioritized, safe, read-only diagnostic steps'),

    citedRunbookIds: z.array(z.string().regex(/^rb-[a-zA-Z0-9_-]+$/, 'Runbook ID must match format rb-xxx'))
        .max(4, 'Maximum 4 runbook citations allowed')
        .describe('Exact runbook IDs retrieved from the approved catalog'),

    evidenceGaps: z.string()
        .min(5, 'Evidence gaps description is required')
        .max(500, 'Evidence gaps must not exceed 500 characters')
        .describe('Details of what telemetry or server logs are needed to verify the hypothesis')
});

module.exports = {
    ExplanationOutputSchema
};
