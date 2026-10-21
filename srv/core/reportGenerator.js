/**
 * Incident Postmortem & Audit Report Generator
 * (Clean Architecture - Domain Report Service)
 *
 * Assembles persisted telemetry, audit timestamps, operational lifecycle events,
 * and grounded runbook analysis into standardized ITIL/SRE postmortem reports.
 */

/**
 * Formats duration between two ISO timestamps into human-readable string.
 */
function calculateDuration(startIso, endIso) {
    if (!startIso || !endIso) return 'Ongoing / Open';
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (isNaN(start) || isNaN(end) || end < start) return 'N/A';
    
    const diffSec = Math.floor((end - start) / 1000);
    if (diffSec < 60) return `${diffSec} seconds`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
}

/**
 * Generates an audit-ready Markdown postmortem document.
 *
 * @param {Object} alert - Persisted Alert entity record
 * @param {Object} [iface=null] - Associated Interface record
 * @param {Object} [runbook=null] - Curated Runbook catalog record
 * @returns {string} Formatted Markdown report
 */
function generateMarkdownReport(alert, iface = null, runbook = null) {
    let metrics = {};
    try {
        metrics = JSON.parse(alert.observedMetrics || '{}');
    } catch (e) {
        metrics = { raw: alert.observedMetrics };
    }

    let explanation = null;
    try {
        if (alert.aiExplanation) {
            explanation = JSON.parse(alert.aiExplanation);
        }
    } catch (e) {
        explanation = null;
    }

    const duration = calculateDuration(alert.detectedAt, alert.resolvedAt);
    const ifaceName = iface ? iface.name : 'Unknown Integration Interface';
    const sourceSystem = iface ? iface.sourceSystem : 'N/A';
    const targetSystem = iface ? iface.targetSystem : 'N/A';

    const maxRetriesSLA = iface?.maxRetryThreshold || 100;
    const queueLimitSLA = iface?.queueGrowthLimit || 200;
    const ageLimitSLA = iface?.oldMessageAgeLimitSeconds || 600;

    const reportDate = new Date().toUTCString();

    let hypothesesList = '';
    if (explanation?.possibleHypotheses && Array.isArray(explanation.possibleHypotheses)) {
        hypothesesList = explanation.possibleHypotheses.map(h => `- ${h}`).join('\n');
    } else if (runbook?.symptoms) {
        hypothesesList = `- ${runbook.symptoms} (Derived from Runbook ${runbook.ID})`;
    } else {
        hypothesesList = '- Unspecified queue or network retry anomaly requiring trace inspection.';
    }

    let checksList = '';
    if (explanation?.recommendedChecks && Array.isArray(explanation.recommendedChecks)) {
        checksList = explanation.recommendedChecks.map((c, i) => `${i + 1}. ${c}`).join('\n');
    } else if (runbook?.checks) {
        checksList = runbook.checks;
    } else {
        checksList = '1. Review CPI message trace logs.\n2. Inspect target system response codes (HTTP 429/503).';
    }

    const citedRunbooks = explanation?.citedRunbookIds?.length > 0 
        ? explanation.citedRunbookIds.join(', ')
        : (runbook ? runbook.ID : 'None cited');

    const evidenceGaps = explanation?.evidenceGaps || runbook?.limitations || 'Metrics describe queue saturation; root cause requires target application log verification.';

    return `# INCIDENT POSTMORTEM REPORT: ${alert.ruleCode}
**Report Generated:** ${reportDate}  
**Classification:** Enterprise Operational Governance & SRE Review  
**Sentinel Instance:** Retry Storm Sentinel (SAP BTP Edition)

---

## 1. Executive Summary
- **Incident ID:** \`${alert.ID}\`
- **Interface:** **${ifaceName}** (\`${sourceSystem}\` ➔ \`${targetSystem}\`)
- **Severity Level:** **${alert.severity.toUpperCase()}**
- **Lifecycle Status:** **${alert.status}**
- **Incident Summary:** ${alert.summary || 'Operational alert raised due to queue telemetry breach.'}
- **Total Duration (MTTR):** ${duration}

---

## 2. Incident Timeline & Audit Trail
| Milestone | Timestamp (UTC) | Actor / Source |
| :--- | :--- | :--- |
| **First Detected** | \`${alert.detectedAt || 'N/A'}\` | Deterministic Detection Engine |
| **Observation Window Start** | \`${alert.windowStart || 'N/A'}\` | Sentinel Sliding Window |
| **Observation Window End** | \`${alert.windowEnd || 'N/A'}\` | Telemetry Pipeline |
| **Occurrences / Re-triggers** | **${alert.repeatCount || 1}** time(s) | Deduplication Tracker |
| **Operator Acknowledgment** | \`${alert.acknowledgedAt || 'Pending / Unacknowledged'}\` | ${alert.acknowledgedBy ? `**${alert.acknowledgedBy}**` : '—'} |
| **Incident Resolution** | \`${alert.resolvedAt || 'Open / Unresolved'}\` | ${alert.resolvedBy ? `**${alert.resolvedBy}**` : '—'} |

---

## 3. Telemetry Evidence at Incident Peak
| Metric Parameter | Observed Telemetry Value | Configured Interface SLA Limit | Variance / Breach Status |
| :--- | :--- | :--- | :--- |
| **Pending Message Backlog** | \`${metrics.pendingCount ?? 'N/A'}\` messages | \`${queueLimitSLA}\` messages | ${(metrics.pendingCount || 0) >= queueLimitSLA ? '⚠️ BREACHED' : '✅ Within SLA'} |
| **Retry Attempts** | \`${metrics.retryAttempts ?? 'N/A'}\` retries | \`${maxRetriesSLA}\` retries | ${(metrics.retryAttempts || 0) >= maxRetriesSLA ? '🚨 CRITICAL SPIKE' : '✅ Nominal'} |
| **Failed Messages** | \`${metrics.failedCount ?? 0}\` failures | 0 tolerance | ${(metrics.failedCount || 0) > 0 ? '⚠️ Message Failures' : '✅ Zero Failures'} |
| **Successful Throughput** | \`${metrics.successCount ?? 0}\` messages | Dynamic | N/A |
| **Oldest Message Age** | \`${metrics.oldestPendingAgeSeconds ?? 0}\` seconds | \`${ageLimitSLA}\` seconds | ${(metrics.oldestPendingAgeSeconds || 0) >= ageLimitSLA ? '⚠️ SLA BREACHED' : '✅ Within SLA'} |

---

## 4. Root Cause Analysis & Grounded AI Advisory
> **Advisory Mode:** ${explanation?.aiAssisted ? `AI-Assisted Copilot (${explanation.provider})` : 'Deterministic Runbook Grounding'}  
> **Citations:** Approved Enterprise Runbook Catalog (\`${citedRunbooks}\`)

### Suspected Hypotheses
${hypothesesList}

### Corrective & Diagnostic Checks Performed
${checksList}

### Evidence Gaps & Observability Limitations
${evidenceGaps}

---

## 5. Prevention & Governance Sign-off
1. **Circuit Breaker Policy:** Review whether backoff intervals on \`${ifaceName}\` should be increased during downstream maintenance.
2. **Rate Limiting Guardrails:** Ensure upstream callers respect exponential backoff and jitter to prevent retry storms.
3. **Audit Compliance:** This report is derived strictly from immutable runtime queue snapshots and authorized operator audit timestamps.

*Generated autonomously by Retry Storm Sentinel — Clean Architecture Integration SRE.*
`;
}

module.exports = {
    calculateDuration,
    generateMarkdownReport
};
