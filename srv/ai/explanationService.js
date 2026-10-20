/**
 * Grounded AI Incident Explainer
 * (Clean Architecture - AI Explanation Service)
 */

function generateGroundedExplanation(alert, runbookEntry) {
    let observedMetrics = {};
    try {
        observedMetrics = JSON.parse(alert.observedMetrics || '{}');
    } catch (e) {
        observedMetrics = { raw: alert.observedMetrics };
    }

    return {
        summary: `Deterministic alert for rule [${alert.ruleCode}] with severity [${alert.severity}].`,
        observedFacts: observedMetrics,
        possibleHypotheses: [
            runbookEntry ? runbookEntry.symptoms : 'Unspecified queue/retry anomaly.'
        ],
        recommendedChecks: runbookEntry 
            ? runbookEntry.checks.split('. ').filter(Boolean)
            : ['Review integration trace logs in SAP Cloud Integration / S/4HANA.'],
        citedRunbookIds: runbookEntry ? [runbookEntry.ID] : [],
        limitations: runbookEntry 
            ? runbookEntry.limitations 
            : 'Metrics describe queue state; direct root cause requires system log inspection.'
    };
}

module.exports = {
    generateGroundedExplanation
};
