const fs = require('fs');
const path = require('path');
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const {
    buildGradualStages,
    startGradualSimulation,
    cancelSimulation,
    getSimulationStatus,
    resetSimulationState,
    ALLOWED_SCENARIOS,
    generateCurvePoints,
    createPRNG,
    normalizedSigmoid
} = require('../srv/core/gradualSimulator');


describe('Gradual Telemetry Simulation (Phase 2)', () => {
    let srv;
    let targetInterface;
    let allInterfaces;

    before(async () => {
        cds.env.requires.db = { kind: 'sqlite', credentials: { url: 'sentinel.db' } };
        const csn = await cds.load('srv/monitoring-service.cds');
        cds.model = csn;
        await cds.connect.to('db');
        srv = await cds.serve('MonitoringService').from('srv/monitoring-service.cds');

        const adminTx = srv.tx({
            user: new cds.User({ id: 'admin', roles: ['SupportViewer', 'SupportOperator', 'SimulatorAdmin'] })
        });
        allInterfaces = await adminTx.run(SELECT.from(srv.entities.Interfaces));
        targetInterface = allInterfaces[0];
        assert.ok(targetInterface, 'Initial interfaces must be present in database');
    });

    beforeEach(() => {
        resetSimulationState();
    });

    // -------------------------------------------------------------------------
    // 1. Unit Tests — Stage Building & Dynamic Threshold Adaptation
    // -------------------------------------------------------------------------
    describe('Stage Profile Generation & Threshold Scaling', () => {
        it('U1: Generates valid progressive stages for all allowed scenarios', () => {
            for (const scenario of ALLOWED_SCENARIOS) {
                const stages = buildGradualStages(scenario, targetInterface);
                assert.ok(Array.isArray(stages), `Stages for ${scenario} must be an array`);
                assert.ok(stages.length >= 3, `Expected at least 3 stages for ${scenario}`);

                for (const stage of stages) {
                    assert.equal(typeof stage.stageIndex, 'number');
                    assert.equal(typeof stage.stageName, 'string');
                    assert.ok(stage.stageName.length > 0);

                    const m = stage.metrics;
                    assert.ok(m, 'Stage must contain metrics object');
                    assert.ok(Number.isInteger(m.pendingCount) && m.pendingCount >= 0);
                    assert.ok(Number.isInteger(m.retryAttempts) && m.retryAttempts >= 0);
                    assert.ok(Number.isInteger(m.failedCount) && m.failedCount >= 0);
                    assert.ok(Number.isInteger(m.successCount) && m.successCount >= 0);
                    assert.ok(Number.isInteger(m.oldestPendingAgeSeconds) && m.oldestPendingAgeSeconds >= 0);
                }
            }
        });

        it('U2: Dynamically scales metric stages to custom interface thresholds', () => {
            const standardIface = { maxRetryThreshold: 100, queueGrowthLimit: 200 };
            const customIface = { maxRetryThreshold: 400, queueGrowthLimit: 800 };

            const standardStages = buildGradualStages('RETRY_STORM', standardIface);
            const customStages = buildGradualStages('RETRY_STORM', customIface);

            // In warning zone (stage 2), standard is ~85, custom is ~340
            assert.equal(standardStages[2].metrics.retryAttempts, 85);
            assert.equal(customStages[2].metrics.retryAttempts, 340);

            // In threshold crossed (stage 3), standard is ~135, custom is ~540
            assert.equal(standardStages[3].metrics.retryAttempts, 135);
            assert.equal(customStages[3].metrics.retryAttempts, 540);
        });

        it('U3: RETRY_STORM stages progression: baseline -> warning -> breach -> peak', () => {
            const stages = buildGradualStages('RETRY_STORM', targetInterface);
            const threshold = targetInterface.maxRetryThreshold || 100;

            // Stage 0: baseline (healthy)
            assert.ok(stages[0].metrics.retryAttempts < threshold * 0.2);
            // Stage 1: transient blip (under threshold)
            assert.ok(stages[1].metrics.retryAttempts < threshold);
            // Stage 2: warning zone (under threshold, approaching)
            assert.ok(stages[2].metrics.retryAttempts < threshold);
            assert.ok(stages[2].metrics.retryAttempts >= threshold * 0.7);
            // Stage 3: crossed (triggers Rule A)
            assert.ok(stages[3].metrics.retryAttempts >= threshold);
            // Stage 4: peak storm
            assert.ok(stages[4].metrics.retryAttempts > stages[3].metrics.retryAttempts);
        });
    });

    // -------------------------------------------------------------------------
    // 2. Integration Tests — Start, Sequential Progression, and Ingestion
    // -------------------------------------------------------------------------
    describe('Gradual Simulation Execution & Canonical Ingestion', () => {
        it('T1: Operator starts gradual simulation and receives prompt session info', async () => {
            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });

            const res = await bobTx.send('startGradualSimulation', {
                scenario: 'RETRY_STORM',
                interfaceId: targetInterface.ID,
                stepIntervalMs: 30
            });

            assert.ok(res);
            assert.ok(res.sessionId, 'Session must have unique sessionId');
            assert.equal(res.scenario, 'RETRY_STORM');
            assert.equal(res.status, 'RUNNING');
            assert.equal(res.totalStages, 5);

            // Wait for background simulation to finish (5 stages * 30ms + buffer = ~350ms)
            await new Promise(r => setTimeout(r, 400));

            const status = await bobTx.send('getSimulationStatus', { sessionId: res.sessionId });
            assert.equal(status.status, 'COMPLETED');
            assert.equal(status.currentStage, 5);
            assert.equal(status.progressPercent, 100);
        });

        it('T2: Every gradual stage persists a snapshot via processSnapshotAndEvaluate', async () => {
            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });

            // Count snapshots before simulation
            const beforeSnaps = await bobTx.run(
                SELECT.from(srv.entities.QueueSnapshots).where({ interface_ID: targetInterface.ID })
            );

            const res = await bobTx.send('startGradualSimulation', {
                scenario: 'QUEUE_GROWTH',
                interfaceId: targetInterface.ID,
                stepIntervalMs: 25
            });

            // Wait for completion
            await new Promise(r => setTimeout(r, 350));

            // Count snapshots after simulation: 5 new snapshots must be recorded
            const afterSnaps = await bobTx.run(
                SELECT.from(srv.entities.QueueSnapshots).where({ interface_ID: targetInterface.ID })
            );

            assert.equal(afterSnaps.length - beforeSnaps.length, 5, 'Exactly 5 snapshots must be persisted');

            // Verify the newest snapshots have non-decreasing capturedAt timestamps
            const recent = afterSnaps.slice(-5);
            for (let i = 1; i < recent.length; i++) {
                assert.ok(
                    new Date(recent[i].capturedAt).getTime() >= new Date(recent[i - 1].capturedAt).getTime(),
                    'Snapshots must have non-decreasing temporal order'
                );
            }
        });

        it('T3: Deterministic alert is created when threshold-crossing stage executes', async () => {
            const adminTx = srv.tx({
                user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] })
            });

            // Clean database baseline before test
            await adminTx.send('resetToCleanSeed');

            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });

            // Check no alerts initially
            const initialAlerts = await bobTx.run(
                SELECT.from(srv.entities.Alerts).where({ interface_ID: targetInterface.ID, status: 'Open' })
            );
            assert.equal(initialAlerts.length, 0);

            // Run RETRY_STORM gradual simulation
            await bobTx.send('startGradualSimulation', {
                scenario: 'RETRY_STORM',
                interfaceId: targetInterface.ID,
                stepIntervalMs: 25
            });

            await new Promise(r => setTimeout(r, 350));

            // Alert must now exist with Critical severity and ruleCode EXCESSIVE_RETRIES
            const openAlerts = await bobTx.run(
                SELECT.from(srv.entities.Alerts).where({ interface_ID: targetInterface.ID, status: 'Open' })
            );
            assert.ok(openAlerts.length >= 1, 'Critical alert must be generated');
            const alert = openAlerts[0];
            assert.equal(alert.ruleCode, 'EXCESSIVE_RETRIES');
            assert.equal(alert.severity, 'Critical');
        });

        it('T4: Landscape-wide (ALL) simulation processes all active interfaces in sequence', async () => {
            const adminTx = srv.tx({
                user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin'] })
            });

            const res = await adminTx.send('startGradualSimulation', {
                scenario: 'NORMAL',
                interfaceId: 'ALL',
                stepIntervalMs: 25
            });

            assert.equal(res.interfaceId, 'ALL');
            assert.equal(res.status, 'RUNNING');

            // Wait for 3 stages to complete
            await new Promise(r => setTimeout(r, 250));

            const status = await adminTx.send('getSimulationStatus', { sessionId: res.sessionId });
            assert.equal(status.status, 'COMPLETED');
            assert.equal(status.currentStage, 3);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Conflict Prevention & Cancellation
    // -------------------------------------------------------------------------
    describe('Concurrency Control & Cancellation', () => {
        it('C1: Prevents duplicate active simulation on the same interface with 409', async () => {
            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });

            // Start first simulation with longer interval (500ms)
            const first = await bobTx.send('startGradualSimulation', {
                scenario: 'RETRY_STORM',
                interfaceId: targetInterface.ID,
                stepIntervalMs: 500
            });
            assert.equal(first.status, 'RUNNING');

            // Attempt to start a second simulation on same interface -> 409 Conflict
            await assert.rejects(
                async () => {
                    await bobTx.send('startGradualSimulation', {
                        scenario: 'QUEUE_GROWTH',
                        interfaceId: targetInterface.ID,
                        stepIntervalMs: 50
                    });
                },
                (err) => {
                    const code = err.code || err.status;
                    assert.equal(code, 409, `Expected 409 Conflict, received ${code}`);
                    return true;
                }
            );

            // Clean up by cancelling first session
            await bobTx.send('cancelSimulation', { sessionId: first.sessionId });
        });

        it('C2: Operator can cancel an active simulation cleanly', async () => {
            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });

            const session = await bobTx.send('startGradualSimulation', {
                scenario: 'RETRY_STORM',
                interfaceId: targetInterface.ID,
                stepIntervalMs: 500
            });
            assert.equal(session.status, 'RUNNING');

            const cancelled = await bobTx.send('cancelSimulation', { sessionId: session.sessionId });
            assert.equal(cancelled.status, 'CANCELLED');
            assert.ok(cancelled.completedAt);

            // Verify active lock is immediately released: another simulation can now start
            const second = await bobTx.send('startGradualSimulation', {
                scenario: 'NORMAL',
                interfaceId: targetInterface.ID,
                stepIntervalMs: 20
            });
            assert.equal(second.status, 'RUNNING');

            await new Promise(r => setTimeout(r, 150));
        });
    });

    // -------------------------------------------------------------------------
    // 4. Authorization & Input Validation
    // -------------------------------------------------------------------------
    describe('Authorization & Input Validation', () => {
        it('A1: Anonymous request to startGradualSimulation is rejected with 401', async () => {
            await assert.rejects(
                async () => {
                    await srv.send('startGradualSimulation', {
                        scenario: 'RETRY_STORM',
                        interfaceId: targetInterface.ID
                    });
                },
                (err) => {
                    const code = err.code || err.status;
                    assert.equal(code, 401, `Expected 401, got ${code}`);
                    return true;
                }
            );
        });

        it('A2: SupportViewer (alice) is forbidden from starting simulation (403)', async () => {
            const aliceTx = srv.tx({
                user: new cds.User({ id: 'alice', roles: ['SupportViewer'] })
            });

            await assert.rejects(
                async () => {
                    await aliceTx.send('startGradualSimulation', {
                        scenario: 'RETRY_STORM',
                        interfaceId: targetInterface.ID
                    });
                },
                (err) => {
                    const code = err.code || err.status;
                    assert.equal(code, 403, `Expected 403, got ${code}`);
                    return true;
                }
            );
        });

        it('A3: SupportViewer (alice) can read simulation status (200)', async () => {
            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });
            const session = await bobTx.send('startGradualSimulation', {
                scenario: 'NORMAL',
                interfaceId: targetInterface.ID,
                stepIntervalMs: 20
            });

            const aliceTx = srv.tx({
                user: new cds.User({ id: 'alice', roles: ['SupportViewer'] })
            });
            const status = await aliceTx.send('getSimulationStatus', { sessionId: session.sessionId });
            assert.ok(status);
            assert.equal(status.sessionId, session.sessionId);

            await new Promise(r => setTimeout(r, 150));
        });

        it('V1: Invalid scenario rejected with 400', async () => {
            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });

            await assert.rejects(
                async () => {
                    await bobTx.send('startGradualSimulation', {
                        scenario: 'INVALID_SCENARIO_NAME',
                        interfaceId: targetInterface.ID
                    });
                },
                (err) => {
                    const code = err.code || err.status;
                    assert.equal(code, 400);
                    return true;
                }
            );
        });
    });

    // -------------------------------------------------------------------------
    // 5. Metric Phase Lag Ordering & S-Curve Realism
    // -------------------------------------------------------------------------
    describe('Metric Phase Lag Ordering & S-Curve Realism', () => {
        it('U4: Realistic curve ordering: retries rise first, pending queue follows, message age lags', () => {
            const iface = { maxRetryThreshold: 100, queueGrowthLimit: 200, oldMessageAgeLimitSeconds: 600 };
            const stages = buildGradualStages('RETRY_STORM', iface, { totalStages: 20, seed: 42 });
            assert.equal(stages.length, 20);

            const retries = stages.map(s => s.metrics.retryAttempts);
            const pending = stages.map(s => s.metrics.pendingCount);
            const age = stages.map(s => s.metrics.oldestPendingAgeSeconds);

            const norm = (arr) => {
                const min = Math.min(...arr);
                const max = Math.max(...arr);
                return arr.map(v => (v - min) / (max - min || 1));
            };

            const normRetries = norm(retries);
            const normPending = norm(pending);
            const normAge = norm(age);

            // Find stage index where metric reaches >= 50% of normalized rise
            const t50Retries = normRetries.findIndex(v => v >= 0.5);
            const t50Pending = normPending.findIndex(v => v >= 0.5);
            const t50Age = normAge.findIndex(v => v >= 0.5);

            // Causal order: t50(retries) < t50(pending) <= t50(age)
            assert.ok(
                t50Retries < t50Pending,
                `Retries (t50=${t50Retries}) must reach 50% rise before pending queue (t50=${t50Pending})`
            );
            assert.ok(
                t50Pending <= t50Age,
                `Pending queue (t50=${t50Pending}) must reach 50% rise before or at oldest message age (t50=${t50Age})`
            );

            // Early stage delta: by 25% of simulation, retries lead pending queue
            const earlyIdx = Math.floor(stages.length * 0.25);
            assert.ok(
                normRetries[earlyIdx] > normPending[earlyIdx],
                `Early retry fraction (${normRetries[earlyIdx].toFixed(2)}) must lead pending queue fraction (${normPending[earlyIdx].toFixed(2)})`
            );
        });

        it('U5: Processing throughput (successCount) monotonically decreases during RETRY_STORM', () => {
            // Milestone mode (5 stages)
            const milestoneStages = buildGradualStages('RETRY_STORM', targetInterface);
            for (let i = 1; i < milestoneStages.length; i++) {
                assert.ok(
                    milestoneStages[i].metrics.successCount <= milestoneStages[i - 1].metrics.successCount,
                    `Milestone throughput at stage ${i} (${milestoneStages[i].metrics.successCount}) must not exceed stage ${i - 1} (${milestoneStages[i - 1].metrics.successCount})`
                );
            }
            const baselineMilestone = milestoneStages[0].metrics.successCount;
            const peakMilestone = milestoneStages[milestoneStages.length - 1].metrics.successCount;
            assert.ok(peakMilestone <= baselineMilestone * 0.15, 'Peak storm throughput must suffer >= 85% reduction');

            // 20-stage S-curve mode with standard seed
            const s20 = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed: 42 });
            for (let i = 1; i < s20.length; i++) {
                assert.ok(
                    s20[i].metrics.successCount <= s20[i - 1].metrics.successCount,
                    `Continuous throughput at stage ${i} (${s20[i].metrics.successCount}) must not exceed stage ${i - 1} (${s20[i - 1].metrics.successCount})`
                );
            }
            assert.ok(s20[s20.length - 1].metrics.successCount <= s20[0].metrics.successCount * 0.15);
        });

        it('U6: Continuous 20-stage S-curve generation across all scenarios', () => {
            for (const scenario of ALLOWED_SCENARIOS) {
                const stages = buildGradualStages(scenario, targetInterface, { totalStages: 20, seed: 100 });
                assert.equal(stages.length, 20, `${scenario} must generate exactly 20 stages when requested`);
                for (let i = 0; i < stages.length; i++) {
                    assert.equal(stages[i].stageIndex, i);
                    assert.ok(stages[i].stageName.length > 0);
                    assert.ok(stages[i].name.length > 0);
                    assert.ok(stages[i].stepIntervalMs > 0);
                    assert.ok(stages[i].metrics);
                }
            }
        });
    });

    // -------------------------------------------------------------------------
    // 6. Monotonicity & Deterministic Seeded Jitter
    // -------------------------------------------------------------------------
    describe('Monotonicity & Deterministic Seeded Jitter', () => {
        it('U7: Cumulative retry counts remain strictly monotonic across all stages even with seeded jitter', () => {
            const testSeeds = [1, 42, 1337, 99999, 12345, 0, 777777];
            for (const seed of testSeeds) {
                const stages = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed });
                for (let i = 1; i < stages.length; i++) {
                    assert.ok(
                        stages[i].metrics.retryAttempts >= stages[i - 1].metrics.retryAttempts,
                        `Seed ${seed}: retryAttempts decreased at stage ${i} (${stages[i].metrics.retryAttempts} < ${stages[i - 1].metrics.retryAttempts})`
                    );
                }
            }
        });

        it('U8: Identical seed produces bitwise identical telemetry curve across independent runs', () => {
            const runA = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed: 12345 });
            const runB = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed: 12345 });

            assert.equal(runA.length, runB.length);
            for (let i = 0; i < runA.length; i++) {
                assert.deepEqual(
                    runA[i].metrics,
                    runB[i].metrics,
                    `Stage ${i} metrics must be bitwise identical for identical seed`
                );
            }
        });

        it('U9: Bounded realism jitter produces distinct variations between different seeds', () => {
            const runA = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed: 100 });
            const runB = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed: 200 });

            assert.equal(runA.length, 20);
            assert.equal(runB.length, 20);

            const hasVariation = runA.some((stage, i) =>
                stage.metrics.retryAttempts !== runB[i].metrics.retryAttempts ||
                stage.metrics.pendingCount !== runB[i].metrics.pendingCount
            );
            assert.ok(hasVariation, 'Different seeds should produce slight variations due to PRNG jitter');

            // Bounded realism check: final storm stage should still breach threshold in both runs
            const threshold = targetInterface.maxRetryThreshold || 100;
            assert.ok(runA[runA.length - 1].metrics.retryAttempts >= threshold);
            assert.ok(runB[runB.length - 1].metrics.retryAttempts >= threshold);
        });
    });

    // -------------------------------------------------------------------------
    // 7. Pre-Breach Warning & Rising Telemetry Trajectory
    // -------------------------------------------------------------------------
    describe('Pre-Breach Warning & Rising Telemetry Trajectory', () => {
        it('U10: Provides at least 3 rising pre-breach telemetry observations before deterministic breach', () => {
            // Test 5-stage milestone mode
            const stages5 = buildGradualStages('RETRY_STORM', targetInterface);
            const threshold = targetInterface.maxRetryThreshold || 100;
            const breachIdx5 = stages5.findIndex(s => s.metrics.retryAttempts >= threshold);
            assert.ok(breachIdx5 >= 3, `Expected at least 3 stages before breach in 5-stage mode, got ${breachIdx5}`);
            for (let i = 1; i < breachIdx5; i++) {
                assert.ok(stages5[i].metrics.retryAttempts >= stages5[i - 1].metrics.retryAttempts);
            }

            // Test 20-stage S-curve mode
            const stages20 = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed: 42 });
            const breachIdx20 = stages20.findIndex(s => s.metrics.retryAttempts >= threshold);
            assert.ok(breachIdx20 >= 3, `Expected at least 3 stages before breach in 20-stage mode, got ${breachIdx20}`);
            for (let i = 1; i < breachIdx20; i++) {
                assert.ok(stages20[i].metrics.retryAttempts >= stages20[i - 1].metrics.retryAttempts);
            }
        });

        it('U11: Pre-breach telemetry trajectory has positive rate of increase suitable for regression slope calculation', () => {
            const stages = buildGradualStages('RETRY_STORM', targetInterface, { totalStages: 20, seed: 42 });
            const threshold = targetInterface.maxRetryThreshold || 100;
            const breachIdx = stages.findIndex(s => s.metrics.retryAttempts >= threshold);

            // Compute delta from baseline to stage right before breach
            const preBreachSamples = stages.slice(0, breachIdx);
            assert.ok(preBreachSamples.length >= 3, 'Must have at least 3 samples for regression window');

            const delta = preBreachSamples[preBreachSamples.length - 1].metrics.retryAttempts - preBreachSamples[0].metrics.retryAttempts;
            assert.ok(delta > 0, 'Cumulative retries must show positive increase over pre-breach window');
        });
    });

    // -------------------------------------------------------------------------
    // 8. Architectural Isolation & Telemetry Schema Purity
    // -------------------------------------------------------------------------
    describe('Architectural Isolation & Telemetry Schema Purity', () => {
        it('ARCH1: Simulator engine strictly isolated from predictive calculation logic', () => {
            const simulatorPath = path.resolve(__dirname, '../srv/core/gradualSimulator.js');
            const simulatorSource = fs.readFileSync(simulatorPath, 'utf8');

            const forbiddenPatterns = [
                /\blinearRegression\b/i,
                /\bestimateTimeToBreach\b/i,
                /\bpredictiveAlert\b/i,
                /\bforecastEta\b/i,
                /\bpolynomialFit\b/i,
                /\btimeToBreach\b/i
            ];

            for (const pattern of forbiddenPatterns) {
                assert.equal(
                    pattern.test(simulatorSource),
                    false,
                    `gradualSimulator.js contains forbidden predictive logic matching ${pattern}`
                );
            }
        });

        it('ARCH2: Generated stages output pure raw telemetry without prediction fields', () => {
            const allowedMetricFields = new Set([
                'pendingCount',
                'failedCount',
                'retryAttempts',
                'successCount',
                'oldestPendingAgeSeconds'
            ]);

            for (const scenario of ALLOWED_SCENARIOS) {
                const s5 = buildGradualStages(scenario, targetInterface);
                const s20 = buildGradualStages(scenario, targetInterface, { totalStages: 20, seed: 42 });

                for (const stage of [...s5, ...s20]) {
                    assert.ok(stage.metrics, 'Stage must contain metrics object');
                    for (const key of Object.keys(stage.metrics)) {
                        assert.ok(
                            allowedMetricFields.has(key),
                            `Forbidden non-telemetry field '${key}' found in stage metrics for scenario '${scenario}'`
                        );
                    }
                }
            }
        });
    });
});


