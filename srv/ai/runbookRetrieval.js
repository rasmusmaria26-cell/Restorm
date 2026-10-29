/**
 * Runbook Retrieval (RAG) Module for Restorm
 *
 * Provides simple, explainable baseline retrieval over approved runbook entries
 * based on ruleCode matching and keyword/symptom relevance scoring.
 *
 * Guarantees:
 * - Returns top relevant entries with original IDs.
 * - Treats log content and runbook text as untrusted data strings.
 * - Gracefully handles missing/malformed alert inputs.
 */

/**
 * Retrieve relevant runbook entries for a given alert and available runbook catalog.
 *
 * @param {Object} alert - The alert object ({ ruleCode, observedMetrics, message, etc. })
 * @param {Array<Object>} runbookCatalog - Array of approved runbook entry objects
 * @param {Object} [options] - Retrieval options ({ topK: 2 })
 * @returns {Array<Object>} Ranked array of relevant runbook entries
 */
function retrieveRelevantRunbooks(alert, runbookCatalog, options = {}) {
    if (!alert || typeof alert !== 'object') return [];
    if (!Array.isArray(runbookCatalog) || runbookCatalog.length === 0) return [];

    const topK = options.topK || 2;
    const ruleCode = (alert.ruleCode || '').trim().toUpperCase();

    // Extract search text from alert (observed metrics, message, ruleCode)
    let metricsStr = '';
    try {
        metricsStr = typeof alert.observedMetrics === 'string'
            ? alert.observedMetrics
            : JSON.stringify(alert.observedMetrics || {});
    } catch (e) {
        metricsStr = String(alert.observedMetrics || '');
    }

    const alertText = `${ruleCode} ${metricsStr} ${alert.message || ''} ${alert.severity || ''}`.toLowerCase();
    const alertTokens = new Set(alertText.match(/\b[a-z0-9_-]{3,}\b/g) || []);

    const scored = runbookCatalog.map(entry => {
        let score = 0;

        // 1. Exact ruleCode match is high priority
        const entryRuleCode = (entry.ruleCode || '').trim().toUpperCase();
        if (entryRuleCode && ruleCode && entryRuleCode === ruleCode) {
            score += 50;
        }

        // 2. Keyword overlap scoring
        const keywords = (entry.keywords || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
        for (const kw of keywords) {
            if (alertText.includes(kw)) {
                score += 15;
            }
        }

        // 3. Symptom & title token overlap scoring
        const entryText = `${entry.title || ''} ${entry.symptoms || ''} ${entry.checks || ''}`.toLowerCase();
        const entryTokens = entryText.match(/\b[a-z0-9_-]{3,}\b/g) || [];
        for (const token of entryTokens) {
            if (alertTokens.has(token)) {
                score += 2;
            }
        }

        return { entry, score };
    });

    // Filter out zero or negative scores unless no rule match at all, sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Return topK entries that have a score > 0, or fallback to the first entry if ruleCode matched or catalog has entries
    const relevant = scored.filter(s => s.score > 0).map(s => s.entry);

    if (relevant.length === 0 && scored.length > 0 && scored[0].score >= 0) {
        // Fallback: if ruleCode matched or we have a catalog, provide the top scored entry with original ID
        if (scored[0].score > 0 || ruleCode) {
            relevant.push(scored[0].entry);
        }
    }

    return relevant.slice(0, topK);
}

module.exports = {
    retrieveRelevantRunbooks
};
