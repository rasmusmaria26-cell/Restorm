const fs = require('fs');
const path = require('path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const {
    getPdfRunbookCatalog,
    retrieveFromPdfRunbooks,
    PDF_RUNBOOK_CHUNKS,
    DEFAULT_PDF_PATH
} = require('../srv/core/pdfRunbookEngine');
const { buildRunbookPdf } = require('../scripts/generateRunbookPdf');
const { generateGroundedExplanation, validateModelOutput } = require('../srv/ai/explanationService');

describe('PDF-Based Runbook RAG & Knowledge Grounding (Phase 4)', () => {
    before(async () => {
        // Ensure PDF is compiled on disk
        if (!fs.existsSync(DEFAULT_PDF_PATH)) {
            await buildRunbookPdf();
        }
    });

    // -------------------------------------------------------------------------
    // 1. PDF Compilation & File Integrity
    // -------------------------------------------------------------------------
    describe('PDF Compilation & Artifact Integrity', () => {
        it('PDF1: Master operational runbook PDF exists on disk with valid PDF magic bytes', () => {
            assert.ok(fs.existsSync(DEFAULT_PDF_PATH), `PDF must exist at ${DEFAULT_PDF_PATH}`);
            const stat = fs.statSync(DEFAULT_PDF_PATH);
            assert.ok(stat.size > 5000, `Expected PDF size > 5KB, got ${stat.size} bytes`);

            const buffer = fs.readFileSync(DEFAULT_PDF_PATH);
            const header = buffer.subarray(0, 5).toString('utf8');
            assert.equal(header, '%PDF-', 'File must start with standard %PDF- magic header');
        });

        it('PDF2: Extracted chunk catalog contains exactly 4 structured rule chunks with full metadata', () => {
            const catalog = getPdfRunbookCatalog();
            assert.equal(catalog.length, 4);

            for (const chunk of catalog) {
                assert.ok(chunk.ID.startsWith('RB-PDF-'));
                assert.ok(chunk.ruleCode, 'Chunk must contain ruleCode');
                assert.ok(chunk.title, 'Chunk must contain title');
                assert.ok(typeof chunk.pageNumber === 'number' && chunk.pageNumber >= 2);
                assert.ok(chunk.sourceCitation.includes(`Restorm_Operational_Runbooks.pdf#Page${chunk.pageNumber}`));
                assert.ok(Array.isArray(chunk.hypotheses) && chunk.hypotheses.length >= 2);
                assert.ok(Array.isArray(chunk.checks) && chunk.checks.length >= 3);
                assert.ok(chunk.safetyNotes, 'Chunk must specify safetyNotes');
                assert.ok(chunk.keywords, 'Chunk must provide keywords');
                assert.equal(chunk.pdfAvailable, true);
            }
        });
    });

    // -------------------------------------------------------------------------
    // 2. Retrieval Precision across all 4 Core Rules
    // -------------------------------------------------------------------------
    describe('Retrieval Precision & Source Citation Fidelity', () => {
        it('RAG1: Correctly matches EXCESSIVE_RETRIES alert to RB-PDF-001 (Page 2)', () => {
            const alert = {
                ruleCode: 'EXCESSIVE_RETRIES',
                severity: 'Critical',
                observedMetrics: JSON.stringify({ retryAttempts: 320, pendingCount: 450 })
            };

            const results = retrieveFromPdfRunbooks(alert, { topK: 1 });
            assert.equal(results.length, 1);
            assert.equal(results[0].ID, 'RB-PDF-001');
            assert.equal(results[0].ruleCode, 'EXCESSIVE_RETRIES');
            assert.equal(results[0].pageNumber, 2);
            assert.equal(results[0].sourceCitation, 'PDF:Restorm_Operational_Runbooks.pdf#Page2');
        });

        it('RAG2: Correctly matches RETRY_STORM scenario alias to RB-PDF-001 (Page 2)', () => {
            const alert = {
                ruleCode: 'RETRY_STORM',
                severity: 'Critical',
                observedMetrics: JSON.stringify({ retryAttempts: 280, pendingCount: 300 })
            };

            const results = retrieveFromPdfRunbooks(alert, { topK: 1 });
            assert.equal(results.length, 1);
            assert.equal(results[0].ID, 'RB-PDF-001');
            assert.equal(results[0].pageNumber, 2);
            assert.equal(results[0].sourceCitation, 'PDF:Restorm_Operational_Runbooks.pdf#Page2');
        });

        it('RAG3: Correctly matches QUEUE_GROWTH alert to RB-PDF-002 (Page 3)', () => {
            const alert = {
                ruleCode: 'QUEUE_GROWTH',
                severity: 'High',
                observedMetrics: JSON.stringify({ pendingCount: 550, successCount: 120 })
            };

            const results = retrieveFromPdfRunbooks(alert, { topK: 1 });
            assert.equal(results.length, 1);
            assert.equal(results[0].ID, 'RB-PDF-002');
            assert.equal(results[0].pageNumber, 3);
            assert.equal(results[0].sourceCitation, 'PDF:Restorm_Operational_Runbooks.pdf#Page3');
        });

        it('RAG4: Correctly matches OLD_MESSAGE_AGE alert to RB-PDF-003 (Page 4)', () => {
            const alert = {
                ruleCode: 'OLD_MESSAGE_AGE',
                severity: 'High',
                observedMetrics: JSON.stringify({ oldestPendingAgeSeconds: 1200, pendingCount: 50 })
            };

            const results = retrieveFromPdfRunbooks(alert, { topK: 1 });
            assert.equal(results.length, 1);
            assert.equal(results[0].ID, 'RB-PDF-003');
            assert.equal(results[0].pageNumber, 4);
            assert.equal(results[0].sourceCitation, 'PDF:Restorm_Operational_Runbooks.pdf#Page4');
        });

        it('RAG5: Correctly matches RECOVERY_STALLED alert to RB-PDF-004 (Page 5)', () => {
            const alert = {
                ruleCode: 'RECOVERY_STALLED',
                severity: 'High',
                observedMetrics: JSON.stringify({ failedCount: 0, retryAttempts: 0, pendingCount: 220 })
            };

            const results = retrieveFromPdfRunbooks(alert, { topK: 1 });
            assert.equal(results.length, 1);
            assert.equal(results[0].ID, 'RB-PDF-004');
            assert.equal(results[0].pageNumber, 5);
            assert.equal(results[0].sourceCitation, 'PDF:Restorm_Operational_Runbooks.pdf#Page5');
        });
    });

    // -------------------------------------------------------------------------
    // 3. Grounded Explanation Generation & Safety Validation
    // -------------------------------------------------------------------------
    describe('Grounded AI Explanation & Safety Boundaries', () => {
        it('EXP1: Explanation generated from PDF chunk preserves exact page citation and symptoms', async () => {
            const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
            const savedGeminiKey = process.env.GEMINI_API_KEY;
            delete process.env.OPENROUTER_API_KEY;
            delete process.env.GEMINI_API_KEY;

            try {
                const alert = {
                    ruleCode: 'EXCESSIVE_RETRIES',
                    severity: 'Critical',
                    observedMetrics: JSON.stringify({ retryAttempts: 320, pendingCount: 450, failedCount: 190 })
                };

                const [pdfChunk] = retrieveFromPdfRunbooks(alert, { topK: 1 });
                assert.ok(pdfChunk);

                const explanation = await generateGroundedExplanation(alert, pdfChunk);

                assert.equal(explanation.aiAssisted, false);
                assert.deepEqual(explanation.citedRunbookIds, ['RB-PDF-001']);
                assert.ok(explanation.summary.includes('RB-PDF-001'));
                assert.ok(explanation.summary.includes('Excessive Retries'));
                assert.ok(explanation.recommendedChecks.length >= 3);
            } finally {
                if (savedOpenRouterKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
                if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey;
            }
        });

        it('EXP2: Safety validation rejects hallucinated citations outside the PDF runbook catalog', () => {
            const retrieved = [PDF_RUNBOOK_CHUNKS[0]]; // RB-PDF-001
            const parsedOutput = {
                summary: 'Analysis complete',
                citedRunbookIds: ['RB-PDF-001', 'HALLUCINATED_RUNBOOK_999', 'EXTERNAL_SOURCE_FAKE'],
                recommendedChecks: ['Check downstream HTTP status code in SAP CPI']
            };

            const validated = validateModelOutput(parsedOutput, retrieved);
            assert.deepEqual(validated.citedRunbookIds, ['RB-PDF-001']);
            assert.equal(validated.citedRunbookIds.includes('HALLUCINATED_RUNBOOK_999'), false);
        });

        it('EXP3: Safety validation strips unsafe destructive commands from operational checks', () => {
            const retrieved = [PDF_RUNBOOK_CHUNKS[0]];
            const parsedOutput = {
                summary: 'Analysis complete',
                citedRunbookIds: ['RB-PDF-001'],
                recommendedChecks: [
                    'Verify target endpoint health status',
                    'drop queue production_orders',
                    'rm -rf /var/sap/cpi',
                    'Inspect Cloud Integration retry backoff configuration'
                ]
            };

            const validated = validateModelOutput(parsedOutput, retrieved);
            assert.equal(validated.recommendedChecks.length, 2);
            assert.equal(validated.recommendedChecks[0], 'Verify target endpoint health status');
            assert.equal(validated.recommendedChecks[1], 'Inspect Cloud Integration retry backoff configuration');
        });
    });
});

