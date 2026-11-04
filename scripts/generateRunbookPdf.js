/**
 * generateRunbookPdf.js — Generates the Master Operational Runbooks PDF for Restorm
 *
 * Creates a structured, multi-page PDF document in srv/data/runbooks/Restorm_Operational_Runbooks.pdf
 * covering operational procedures for the four core SAP integration failure scenarios:
 *   Page 1: Architecture & Governance Policy
 *   Page 2: Rule A — EXCESSIVE_RETRIES (Retry Storm & Throttle Mitigation)
 *   Page 3: Rule B — QUEUE_GROWTH (Inflow Backlog & Worker Saturation)
 *   Page 4: Rule C — OLD_MESSAGE_AGE (Head-of-Line Blocking & Poison Messages)
 *   Page 5: Rule D — RECOVERY_STALLED (Post-Outage Drain Failure)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUTPUT_DIR = path.resolve(__dirname, '../srv/data/runbooks');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'Restorm_Operational_Runbooks.pdf');

function buildRunbookPdf() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
            Title: 'Restorm Operational Runbooks — SAP Integration Sentinel',
            Author: 'Restorm Incident Intelligence Team',
            Subject: 'Standard Operating Procedures for SAP Integration Telemetry Incidents',
            Keywords: 'SAP, CPI, Retry Storm, Queue Backlog, Poison Message, Runbook, S/4HANA'
        }
    });

    const stream = fs.createWriteStream(OUTPUT_FILE);
    doc.pipe(stream);

    // Color palette
    const primaryColor = '#1E3A8A'; // Deep Navy
    const secondaryColor = '#0284C7'; // Cyan
    const darkText = '#1F2937'; // Slate
    const alertAmber = '#B45309'; // Amber
    const alertRed = '#DC2626'; // Red
    const lightBg = '#F3F4F6';

    // Helper: Header bar
    function drawHeader(pageTitle, pageNum) {
        doc.rect(50, 40, 495, 25).fill(primaryColor);
        doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
           .text('RESTORM INCIDENT INTELLIGENCE — RUNBOOK MANUAL', 60, 47);
        doc.fillColor('#93C5FD').fontSize(10).font('Helvetica')
           .text(`PAGE ${pageNum} OF 5`, 470, 47);
        doc.moveDown(2);
    }

    // Helper: Footer bar
    function drawFooter(citationId) {
        const y = doc.page.height - 45;
        doc.rect(50, y, 495, 1).fill('#D1D5DB');
        doc.fillColor('#6B7280').fontSize(9).font('Helvetica')
           .text(`Official Runbook Citation: ${citationId} | Confidential Synthetic Demo Document`, 50, y + 8);
    }

    // =========================================================================
    // PAGE 1: Master Overview & Governance
    // =========================================================================
    drawHeader('OPERATIONAL OVERVIEW', 1);
    doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold')
       .text('SAP Integration Incident Operational Runbooks', 50, 85);
    doc.fillColor(secondaryColor).fontSize(12).font('Helvetica')
       .text('Standard Operating Procedures (SOP) & Automated Diagnostic Guidance v1.0', 50, 110);
    doc.moveDown(1.5);

    doc.fillColor(darkText).fontSize(10).font('Helvetica').lineGap(3)
       .text('1. SCOPE AND PURPOSE', { underline: true }).font('Helvetica')
       .text('This document establishes standard operating procedures for detecting, diagnosing, and mitigating automated integration failures across SAP Cloud Integration (CPI), JMS messaging layers, and S/4HANA OData services monitored by Retry Storm Sentinel.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('2. CORE INCIDENT DETECTION RULES', { underline: true }).font('Helvetica')
       .text('• Rule A (EXCESSIVE_RETRIES): Triggered when cumulative retryAttempts exceed configured maxRetryThreshold. Signals downstream destination throttling or socket timeout retry loops.')
       .text('• Rule B (QUEUE_GROWTH): Triggered when pendingCount exceeds queueGrowthLimit. Signals rapid consumer thread saturation or massive upstream batch inflow.')
       .text('• Rule C (OLD_MESSAGE_AGE): Triggered when oldestPendingAgeSeconds breaches SLA. Signals head-of-line poison messages or persistent transaction locks.')
       .text('• Rule D (RECOVERY_STALLED): Triggered when downstream errors clear but queue backlog fails to drain. Signals consumer thread starvation or improper backoff pacing.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('3. STRICT SAFETY CONSTRAINTS & GOVERNANCE RULES', { underline: true }).font('Helvetica')
       .text('All operators and AI-assisted investigation workflows must strictly adhere to the following safety policies:')
       .fillColor(alertRed)
       .text('  [CRITICAL] NEVER issue commands to drop queues, purge messages, or truncate database tables.')
       .text('  [CRITICAL] NEVER bypass schema validation, access controls, or authorization boundaries.')
       .text('  [CRITICAL] AI models are advisory-only: AI MUST NOT execute automated remediation or invent citations.')
       .fillColor(darkText)
       .moveDown(1);

    doc.font('Helvetica-Bold').text('4. RUNBOOK CATALOG INDEX', { underline: true }).font('Helvetica')
       .text('• Page 2: Runbook [RB-PDF-001] — EXCESSIVE_RETRIES (Destination System Throttle / Retry Storm)')
       .text('• Page 3: Runbook [RB-PDF-002] — QUEUE_GROWTH (Inflow Backlog & Consumer Worker Saturation)')
       .text('• Page 4: Runbook [RB-PDF-003] — OLD_MESSAGE_AGE (Poison Message & Head-of-Line Blocking)')
       .text('• Page 5: Runbook [RB-PDF-004] — RECOVERY_STALLED (Post-Outage Drain Failure & Thread Starvation)')
       .moveDown(1);

    drawFooter('PDF:Restorm_Operational_Runbooks.pdf#Page1');

    // =========================================================================
    // PAGE 2: Rule A — EXCESSIVE_RETRIES / RETRY_STORM
    // =========================================================================
    doc.addPage();
    drawHeader('RULE A — EXCESSIVE RETRIES', 2);

    doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold')
       .text('Runbook RB-PDF-001: Excessive Retries & Downstream Throttle Storm', 50, 85);
    doc.fillColor(secondaryColor).fontSize(11).font('Helvetica')
       .text('Detection Rule: EXCESSIVE_RETRIES (Alias: RETRY_STORM) | Criticality: CRITICAL', 50, 105);
    doc.moveDown(1.5);

    doc.fillColor(darkText).fontSize(10).font('Helvetica-Bold').text('SYMPTOMS & OBSERVABLE TELEMETRY:').font('Helvetica')
       .text('• Rapid, non-linear escalation in cumulative retryAttempts over short observation windows.')
       .text('• Outgoing consumer processing throughput collapses to near zero (typically < 10 msg/s).')
       .text('• Pending queue backlog accumulates subsequently as unacknowledged messages linger.')
       .text('• HTTP 429 (Too Many Requests) or HTTP 503 (Service Unavailable) returned by destination ERP/CRM.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('ROOT CAUSE HYPOTHESES:').font('Helvetica')
       .text('1. Downstream S/4HANA or third-party API gateway has hit ingress rate limits and is throttling callers.')
       .text('2. Integration flow retry policy lacks exponential backoff with randomized jitter, causing thundering herds.')
       .text('3. Network socket timeouts lock up worker threads, preventing new messages from being acknowledged.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('APPROVED OPERATIONAL DIAGNOSTIC CHECKS:').font('Helvetica')
       .text('1. Verify target endpoint health status and inspect HTTP response codes in SAP Cloud Integration trace.')
       .text('2. Check retry backoff policy in integration flow configuration; verify exponential backoff is active.')
       .text('3. Inspect receiver connection pool concurrency; verify database connection limits on target system.')
       .text('4. Check if a downstream deployment, maintenance window, or database deadlock is in progress.')
       .moveDown(0.8);

    doc.fillColor(alertAmber).font('Helvetica-Bold').text('PREDICTIVE WARNING CRITERIA:').font('Helvetica')
       .text('• When retry trajectory slope exceeds +5 retries/sec and current retries reach >= 60% of threshold, emit PREDICTIVE_WARNING before deterministic Rule A breach occurs.')
       .moveDown(0.8);

    doc.fillColor(darkText).font('Helvetica-Bold').text('MANDATORY SAFETY BOUNDARIES:').font('Helvetica')
       .text('Advisory only. Do not purge messages or delete interface queues. Use rate-limited backoff.')
       .moveDown(1);

    drawFooter('PDF:Restorm_Operational_Runbooks.pdf#Page2');

    // =========================================================================
    // PAGE 3: Rule B — QUEUE_GROWTH
    // =========================================================================
    doc.addPage();
    drawHeader('RULE B — QUEUE GROWTH', 3);

    doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold')
       .text('Runbook RB-PDF-002: Rapid Queue Inflow Backlog & Worker Saturation', 50, 85);
    doc.fillColor(secondaryColor).fontSize(11).font('Helvetica')
       .text('Detection Rule: QUEUE_GROWTH | Criticality: HIGH', 50, 105);
    doc.moveDown(1.5);

    doc.fillColor(darkText).fontSize(10).font('Helvetica-Bold').text('SYMPTOMS & OBSERVABLE TELEMETRY:').font('Helvetica')
       .text('• Pending queue backlog (pendingCount) surges past configured queueGrowthLimit.')
       .text('• Inflow rate from upstream publishers exceeds maximum consumer drain rate.')
       .text('• Processing throughput remains at peak capacity but cannot keep pace with incoming volume.')
       .text('• Oldest message age begins rising steadily as wait time in queue accumulates.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('ROOT CAUSE HYPOTHESES:').font('Helvetica')
       .text('1. Unplanned upstream batch dispatch (e.g. bulk catalog sync, billing cycle run, or mass order upload).')
       .text('2. Consumer thread pool exhaustion: workers are fully saturated and queue capacity is strained.')
       .text('3. High database I/O latency on receiver persistence layer slows per-message acknowledgment time.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('APPROVED OPERATIONAL DIAGNOSTIC CHECKS:').font('Helvetica')
       .text('1. Inspect upstream trigger event logs to determine whether an unauthorized batch load was launched.')
       .text('2. Check worker thread allocation and thread pool utilization in SAP Cloud Integration / JMS runtime.')
       .text('3. Verify downstream database I/O latency and transaction log flush times on target database.')
       .text('4. Monitor queue growth rate slope: calculate projected buffer saturation time.')
       .moveDown(0.8);

    doc.fillColor(alertAmber).font('Helvetica-Bold').text('PREDICTIVE WARNING CRITERIA:').font('Helvetica')
       .text('• Emit PREDICTIVE_WARNING when queue slope is positive and depth reaches >= 60% of queueGrowthLimit.')
       .moveDown(0.8);

    doc.fillColor(darkText).font('Helvetica-Bold').text('MANDATORY SAFETY BOUNDARIES:').font('Helvetica')
       .text('Do not terminate worker processes ungracefully. Never discard unprocessed integration messages.')
       .moveDown(1);

    drawFooter('PDF:Restorm_Operational_Runbooks.pdf#Page3');

    // =========================================================================
    // PAGE 4: Rule C — OLD_MESSAGE_AGE / PERSISTENT_BACKLOG
    // =========================================================================
    doc.addPage();
    drawHeader('RULE C — OLD MESSAGE AGE', 4);

    doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold')
       .text('Runbook RB-PDF-003: Poison Message & Head-of-Line Blocking', 50, 85);
    doc.fillColor(secondaryColor).fontSize(11).font('Helvetica')
       .text('Detection Rule: OLD_MESSAGE_AGE (Alias: PERSISTENT_BACKLOG) | Criticality: HIGH', 50, 105);
    doc.moveDown(1.5);

    doc.fillColor(darkText).fontSize(10).font('Helvetica-Bold').text('SYMPTOMS & OBSERVABLE TELEMETRY:').font('Helvetica')
       .text('• oldestPendingAgeSeconds breaches configured SLA limit (e.g. > 600s / 10 minutes).')
       .text('• Pending queue depth remains stagnant or grows very slowly without active drain.')
       .text('• Consumer throughput drops to near zero as the lead worker thread repeatedly blocks.')
       .text('• FIFO sequential processing queues are paralyzed behind an unparsable message.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('ROOT CAUSE HYPOTHESES:').font('Helvetica')
       .text('1. Poison message at head of queue containing malformed XML/JSON schema causing unhandled exceptions.')
       .text('2. Deadlock or persistent transactional lock held on target business object (e.g. locked sales order).')
       .text('3. Expired authentication certificate or invalid authorization credentials for the specific payload.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('APPROVED OPERATIONAL DIAGNOSTIC CHECKS:').font('Helvetica')
       .text('1. Identify correlation ID of the oldest message at queue head via integration monitoring console.')
       .text('2. Inspect payload syntax, character encoding, and required schema fields for invalid characters.')
       .text('3. Check target system SM12 / DB lock entries for concurrent exclusive locks on the entity.')
       .text('4. Route confirmed poison message to Dead Letter Queue (DLQ) for manual inspection and correction.')
       .moveDown(0.8);

    doc.fillColor(darkText).font('Helvetica-Bold').text('MANDATORY SAFETY BOUNDARIES:').font('Helvetica')
       .text('Never delete head-of-line messages permanently. Dead-letter routing requires authorized sign-off.')
       .moveDown(1);

    drawFooter('PDF:Restorm_Operational_Runbooks.pdf#Page4');

    // =========================================================================
    // PAGE 5: Rule D — RECOVERY_STALLED
    // =========================================================================
    doc.addPage();
    drawHeader('RULE D — RECOVERY STALLED', 5);

    doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold')
       .text('Runbook RB-PDF-004: Post-Recovery Queue Drain Failure', 50, 85);
    doc.fillColor(secondaryColor).fontSize(11).font('Helvetica')
       .text('Detection Rule: RECOVERY_STALLED | Criticality: HIGH', 50, 105);
    doc.moveDown(1.5);

    doc.fillColor(darkText).fontSize(10).font('Helvetica-Bold').text('SYMPTOMS & OBSERVABLE TELEMETRY:').font('Helvetica')
       .text('• Destination error rate (failedCount) and retries have cleared to zero (downstream reports healthy).')
       .text('• Pending queue backlog remains elevated well above recoveryStalledBacklog threshold.')
       .text('• Processing throughput fails to rebound to expected post-incident drain rate.')
       .text('• System is technically "clean" of errors but integration traffic is effectively frozen.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('ROOT CAUSE HYPOTHESES:').font('Helvetica')
       .text('1. Consumer workers entered circuit-breaker dormancy or excessive backoff during the outage.')
       .text('2. Worker thread starvation: available threads were de-allocated and polling has not resumed.')
       .text('3. Inflow equals or slightly exceeds suppressed drain rate, preventing backlog depletion.')
       .moveDown(0.8);

    doc.font('Helvetica-Bold').text('APPROVED OPERATIONAL DIAGNOSTIC CHECKS:').font('Helvetica')
       .text('1. Verify consumer connection status: check if active polling threads are running against the queue.')
       .text('2. Review circuit-breaker reset policy; verify if manual heartbeat probe is required to re-engage.')
       .text('3. Check integration runtime worker thread pool concurrency; verify allocated consumer count.')
       .text('4. Validate that post-recovery drain rate exceeds incoming message volume.')
       .moveDown(0.8);

    doc.fillColor(darkText).font('Helvetica-Bold').text('MANDATORY SAFETY BOUNDARIES:').font('Helvetica')
       .text('Ensure drain rate increases smoothly to prevent triggering secondary downstream rate limits.')
       .moveDown(1);

    drawFooter('PDF:Restorm_Operational_Runbooks.pdf#Page5');

    doc.end();

    return new Promise((resolve, reject) => {
        stream.on('finish', () => {
            console.log(`[PDF Generator] Successfully generated master runbook: ${OUTPUT_FILE}`);
            resolve(OUTPUT_FILE);
        });
        stream.on('error', reject);
    });
}

if (require.main === module) {
    buildRunbookPdf().catch(err => {
        console.error('[PDF Generator] Error generating runbook PDF:', err);
        process.exit(1);
    });
}

module.exports = {
    buildRunbookPdf,
    OUTPUT_FILE
};

