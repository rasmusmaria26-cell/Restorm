const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const {
    startGradualSimulation,
    getSimulationStatus,
    resetSimulationState,
    buildGradualStages
} = require('../srv/core/gradualSimulator');
const {
    calculateLinearForecast,
    evaluateInterfacePredictions
} = require('../srv/core/predictiveEngine');
const {
    retrieveFromPdfRunbooks,
    getPdfRunbookCatalog
} = require('../srv/core/pdfRunbookEngine');
const { generateGroundedExplanation } = require('../srv/ai/explanationService');
const { processSnapshotAndEvaluate } = require('../srv/core/ingestionPipeline');

describe('End-to-End Proactive Incident Intelligence Demonstration', () => {
    let srv;
    let targetInterface;
    let allInterfaces;

    before(async () => {
        cds.env.requires.db = { kind: 'sqlite', credentials: { url: 'sentinel.db' } };
        const csn = await cds.load(['srv/monitoring-service.cds', 'srv/annotations.cds']);
        cds.model = csn;
        await cds.connect.to('db');
        srv = await cds.serve('MonitoringService').from('srv/monitoring-service.cds');

        const adminTx = srv.tx({
            user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin', 'SupportOperator', 'SupportViewer'] })
        });
        await adminTx.send('resetToCleanSeed');

        allInterfaces = await adminTx.run(SELECT.from(srv.entities.Interfaces).where({ active: true }));
        targetInterface = allInterfaces[0];
        assert.ok(targetInterface, 'Initial interfaces must exist in database');
    });

    it('Executes the complete 9-step Proactive Incident Intelligence Demonstration', async () => {
        const adminTx = srv.tx({
            user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin', 'SupportOperator', 'SupportViewer'] })
        });

        // ---------------------------------------------------------------------
        // STEP 1: Start with healthy synthetic SAP integration traffic
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 1] Verifying baseline healthy estate...');
        const initialAlerts = await adminTx.run(SELECT.from(srv.entities.Alerts));
        assert.equal(initialAlerts.length, 0, 'Step 1: Estate must start with 0 active alerts');

        const initialSnapshots = await adminTx.run(
            SELECT.from(srv.entities.QueueSnapshots).where({ interface_ID: targetInterface.ID })
        );
        assert.ok(initialSnapshots.length > 0, 'Step 1: Baseline snapshot must be initialized');
        const baseline = initialSnapshots[initialSnapshots.length - 1];
        assert.equal(baseline.retryAttempts, 1);
        assert.equal(baseline.pendingCount, 8);
        console.log(`[DEMO STEP 1 PASS] Interface '${targetInterface.name}' is healthy (Retries: 1, Pending: 8, Alerts: 0).`);

        // ---------------------------------------------------------------------
        // STEP 2: Trigger gradual retry storm simulation
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 2] Triggering gradual retry storm simulation...');
        const stages20 = buildGradualStages('RETRY_STORM', targetInterface, {
            totalStages: 20,
            seed: 0x5EED,
            stepIntervalMs: 1000
        });
        assert.equal(stages20.length, 20, 'Step 2: Simulation must generate 20 stages');
        console.log(`[DEMO STEP 2 PASS] Configured 20-stage S-curve for ${targetInterface.name}.`);

        // ---------------------------------------------------------------------
        // STEP 3: Ingest pre-breach stages (Stages 1 to 13) — Retries rise, throughput degrades
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 3] Ingesting telemetry progression (Stages 1-13)...');
        const baseTime = Date.now();
        const preBreachCount = 13;

        for (let i = 0; i < preBreachCount; i++) {
            const stage = stages20[i];
            const capturedAt = new Date(baseTime + i * 1000).toISOString();

            await processSnapshotAndEvaluate(
                srv.entities,
                targetInterface,
                {
                    interface_ID: targetInterface.ID,
                    capturedAt,
                    pendingCount: stage.metrics.pendingCount,
                    failedCount: stage.metrics.failedCount,
                    retryAttempts: stage.metrics.retryAttempts,
                    successCount: stage.metrics.successCount,
                    oldestPendingAgeSeconds: stage.metrics.oldestPendingAgeSeconds
                },
                `Demo Simulation Stage ${i + 1}/20`
            );
        }

        const preBreachAlerts = await adminTx.run(SELECT.from(srv.entities.Alerts));
        assert.equal(preBreachAlerts.length, 0, 'Step 3: Deterministic alert must NOT have fired yet during pre-breach');

        const latestPreBreachSnap = await adminTx.run(
            SELECT.one.from(srv.entities.QueueSnapshots)
                .where({ interface_ID: targetInterface.ID })
                .orderBy('capturedAt desc')
        );
        assert.ok(latestPreBreachSnap.retryAttempts < (targetInterface.maxRetryThreshold || 100));
        assert.ok(latestPreBreachSnap.retryAttempts >= 70);
        console.log(`[DEMO STEP 3 PASS] Retries climbed to ${latestPreBreachSnap.retryAttempts} (< threshold 100); throughput degraded to ${latestPreBreachSnap.successCount} msg/s.`);

        // ---------------------------------------------------------------------
        // STEP 4: Display predictive warning before threshold breach
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 4] Evaluating predictive forecasting engine...');
        const predictions = await evaluateInterfacePredictions(srv.entities, targetInterface);
        assert.ok(Array.isArray(predictions) && predictions.length >= 3);

        const retryPred = predictions.find(p => p.metric === 'retryAttempts');
        assert.ok(retryPred, 'Step 4: Retry prediction must exist');
        assert.equal(retryPred.status, 'PREDICTIVE_WARNING', 'Step 4: Status must be PREDICTIVE_WARNING');
        assert.equal(retryPred.hasPrediction, true);
        assert.ok(retryPred.growthRatePerSecond > 0, 'Growth rate must be positive');
        assert.ok(retryPred.estimatedSecondsToBreach > 0 && retryPred.estimatedSecondsToBreach <= 5.0);
        assert.ok(retryPred.confidence >= 0.80);
        console.log(`[DEMO STEP 4 PASS] PREDICTIVE WARNING ACTIVE: ${retryPred.summary}`);
        console.log(`                  Growth Rate: +${retryPred.growthRatePerSecond}/s | ETA: ~${retryPred.estimatedSecondsToBreach}s | Confidence: ${Math.round(retryPred.confidence * 100)}%`);

        // ---------------------------------------------------------------------
        // STEP 5: Ingest threshold-breaching snapshot — Deterministic detection confirms incident
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 5] Ingesting Stage 14 (Threshold breach crossing)...');
        const breachStage = stages20[13]; // Index 13 = Stage 14 (Retries >= 100)
        assert.ok(breachStage.metrics.retryAttempts >= (targetInterface.maxRetryThreshold || 100));

        const breachEval = await processSnapshotAndEvaluate(
            srv.entities,
            targetInterface,
            {
                interface_ID: targetInterface.ID,
                capturedAt: new Date(baseTime + 13000).toISOString(),
                pendingCount: breachStage.metrics.pendingCount,
                failedCount: breachStage.metrics.failedCount,
                retryAttempts: breachStage.metrics.retryAttempts,
                successCount: breachStage.metrics.successCount,
                oldestPendingAgeSeconds: breachStage.metrics.oldestPendingAgeSeconds
            },
            'Demo Simulation Stage 14/20'
        );

        assert.equal(breachEval.alertTriggered, true, 'Step 5: Alert must trigger deterministically');
        assert.equal(breachEval.ruleCode, 'EXCESSIVE_RETRIES');
        assert.equal(breachEval.severity, 'Critical');

        const postBreachAlerts = await adminTx.run(SELECT.from(srv.entities.Alerts));
        assert.equal(postBreachAlerts.length, 1, 'Step 5: Exactly 1 confirmed Critical alert in database');
        const activeAlert = postBreachAlerts[0];
        console.log(`[DEMO STEP 5 PASS] Deterministic incident confirmed: Alert [${activeAlert.ruleCode}] created with Severity [${activeAlert.severity}].`);

        // ---------------------------------------------------------------------
        // STEP 6: Retrieve relevant PDF Runbook information
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 6] Retrieving operational guidance from master PDF runbook...');
        const retrievedPdfChunks = retrieveFromPdfRunbooks(activeAlert, { topK: 1 });
        assert.equal(retrievedPdfChunks.length, 1);
        const primaryPdfChunk = retrievedPdfChunks[0];
        assert.equal(primaryPdfChunk.ID, 'RB-PDF-001');
        assert.equal(primaryPdfChunk.pageNumber, 2);
        assert.equal(primaryPdfChunk.sourceCitation, 'PDF:Restorm_Operational_Runbooks.pdf#Page2');
        console.log(`[DEMO STEP 6 PASS] Retrieved Runbook [${primaryPdfChunk.ID}] from ${primaryPdfChunk.sourceCitation}`);
        console.log(`                  Title: "${primaryPdfChunk.title}"`);

        // ---------------------------------------------------------------------
        // STEP 7: Generate grounded AI explanation with source references
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 7] Generating grounded AI incident explanation...');
        const explanation = await generateGroundedExplanation(activeAlert, primaryPdfChunk);
        assert.ok(explanation);
        assert.ok(explanation.citedRunbookIds.includes('RB-PDF-001'), 'Must cite RB-PDF-001');
        assert.ok(explanation.summary && explanation.summary.length > 20, 'Summary must be non-empty string');
        assert.ok(explanation.recommendedChecks.length >= 2, 'Must provide at least 2 actionable checks');
        console.log(`[DEMO STEP 7 PASS] Grounded Explanation Generated:`);
        console.log(`                  Summary: ${explanation.summary}`);
        console.log(`                  Citations: ${explanation.citedRunbookIds.join(', ')}`);
        console.log(`                  Checks: 1. ${explanation.recommendedChecks[0]}`);

        // ---------------------------------------------------------------------
        // STEP 8: Export incident postmortem report
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 8] Exporting incident postmortem report...');
        const report = await adminTx.send({
            event: 'exportIncidentReport',
            entity: 'Alerts',
            params: [{ ID: activeAlert.ID }],
            data: { format: 'markdown' }
        });
        assert.ok(typeof report === 'string' && report.length > 100);
        assert.ok(report.includes('POSTMORTEM') || report.includes('EXCESSIVE_RETRIES') || report.includes('Incident'));
        console.log(`[DEMO STEP 8 PASS] Successfully exported postmortem markdown report (${report.length} bytes).`);

        // ---------------------------------------------------------------------
        // STEP 9: Demonstrate Fiori Elements List Report & OData V4 annotations
        // ---------------------------------------------------------------------
        console.log('\n[DEMO STEP 9] Verifying SAP Fiori Elements proof of concept...');
        const ifaceEntity = cds.model.definitions['MonitoringService.Interfaces'];
        assert.equal(ifaceEntity['@UI.HeaderInfo.TypeName'], 'Monitored Interface');
        assert.ok(Array.isArray(ifaceEntity['@UI.LineItem']));

        const fioriManifestPath = require('path').resolve(__dirname, '../app/fiori/webapp/manifest.json');
        assert.ok(require('fs').existsSync(fioriManifestPath));
        console.log(`[DEMO STEP 9 PASS] Fiori Elements List Report configured and connected to /odata/v4/monitoring/Interfaces.`);

        console.log('\n========================================================================');
        console.log('>>> COMPLETE 9-STEP PROACTIVE INCIDENT INTELLIGENCE DEMO VERIFIED! <<<');
        console.log('========================================================================\n');
    });
});
