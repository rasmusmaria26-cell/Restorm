const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const {
    calculateLinearForecast,
    evaluateInterfacePredictions,
    evaluateLandscapePredictions
} = require('../srv/core/predictiveEngine');

describe('Predictive Incident Intelligence (Phase 3)', () => {
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
            user: new cds.User({ id: 'admin', roles: ['SimulatorAdmin', 'SupportOperator', 'SupportViewer'] })
        });
        allInterfaces = await adminTx.run(SELECT.from(srv.entities.Interfaces));
        targetInterface = allInterfaces[0];
        assert.ok(targetInterface, 'Database must contain initial interfaces');
    });

    // -------------------------------------------------------------------------
    // 1. Unit Tests — Pure Mathematical Linear Forecasting Engine
    // -------------------------------------------------------------------------
    describe('Mathematical Linear Forecasting & OLS Regression', () => {
        it('P1: Calculates exact slope, R², and ETA for perfect linear progression', () => {
            const now = Date.now();
            // Retries rising at exactly 10 per second: 50 -> 60 -> 70 -> 80
            const samples = [
                { timestamp: new Date(now - 3000), value: 50 },
                { timestamp: new Date(now - 2000), value: 60 },
                { timestamp: new Date(now - 1000), value: 70 },
                { timestamp: new Date(now), value: 80 }
            ];

            const forecast = calculateLinearForecast(samples, 100, { now });

            assert.equal(forecast.hasPrediction, true);
            assert.equal(forecast.status, 'PREDICTIVE_WARNING');
            assert.equal(forecast.currentValue, 80);
            assert.equal(forecast.threshold, 100);
            assert.equal(forecast.growthRatePerSecond, 10);
            assert.equal(forecast.rSquared, 1);
            // Remaining delta is 20 retries at 10/s = 2.0s to breach
            assert.equal(forecast.estimatedSecondsToBreach, 2.0);
            assert.equal(forecast.riskLevel, 'CRITICAL'); // <= 5s is critical
            assert.ok(forecast.projectedBreachAt);
        });

        it('P2: Accurately projects breach timestamp based on latest sample time + ETA', () => {
            const now = Date.now();
            const samples = [
                { timestamp: new Date(now - 4000), value: 65 },
                { timestamp: new Date(now - 2000), value: 75 },
                { timestamp: new Date(now), value: 85 }
            ];

            const forecast = calculateLinearForecast(samples, 100, { now });
            assert.equal(forecast.hasPrediction, true);
            // Growth rate: (85 - 65) / 4s = 5/s. Remaining to 100 = 15. ETA = 3.0s
            assert.equal(forecast.growthRatePerSecond, 5);
            assert.equal(forecast.estimatedSecondsToBreach, 3.0);

            const projectedTime = new Date(forecast.projectedBreachAt).getTime();
            assert.equal(projectedTime, now + 3000);
        });
    });

    // -------------------------------------------------------------------------
    // 2. Guardrails & Boundary Conditions
    // -------------------------------------------------------------------------
    describe('Guardrail & Edge Case Handling', () => {
        it('G1: Rejects insufficient observations (< 3 samples) with INSUFFICIENT_DATA', () => {
            const resultEmpty = calculateLinearForecast([], 100);
            assert.equal(resultEmpty.status, 'INSUFFICIENT_DATA');
            assert.equal(resultEmpty.hasPrediction, false);

            const resultOne = calculateLinearForecast([{ timestamp: new Date(), value: 40 }], 100);
            assert.equal(resultOne.status, 'INSUFFICIENT_DATA');
            assert.equal(resultOne.hasPrediction, false);

            const resultTwo = calculateLinearForecast([
                { timestamp: new Date(Date.now() - 1000), value: 40 },
                { timestamp: new Date(), value: 50 }
            ], 100);
            assert.equal(resultTwo.status, 'INSUFFICIENT_DATA');
            assert.equal(resultTwo.hasPrediction, false);
        });

        it('G2: Identifies stale telemetry (> 180s old) with STALE_TELEMETRY', () => {
            const oldTime = Date.now() - 250000; // 250 seconds ago
            const samples = [
                { timestamp: new Date(oldTime - 2000), value: 70 },
                { timestamp: new Date(oldTime - 1000), value: 80 },
                { timestamp: new Date(oldTime), value: 90 }
            ];

            const result = calculateLinearForecast(samples, 100, { now: Date.now() });
            assert.equal(result.status, 'STALE_TELEMETRY');
            assert.equal(result.hasPrediction, false);
            assert.equal(result.growthRatePerSecond, 0);
        });

        it('G3: Handles already breached threshold with THRESHOLD_BREACHED', () => {
            const now = Date.now();
            const samples = [
                { timestamp: new Date(now - 2000), value: 90 },
                { timestamp: new Date(now - 1000), value: 98 },
                { timestamp: new Date(now), value: 105 } // Breached (>= 100)
            ];

            const result = calculateLinearForecast(samples, 100, { now });
            assert.equal(result.status, 'THRESHOLD_BREACHED');
            assert.equal(result.hasPrediction, false);
            assert.equal(result.estimatedSecondsToBreach, 0);
            assert.equal(result.riskLevel, 'CRITICAL');
        });

        it('G4: Identifies stable or decreasing trends (slope <= 0.05) with STABLE', () => {
            const now = Date.now();
            // Decreasing values (system recovering or normal fluctuation)
            const samples = [
                { timestamp: new Date(now - 3000), value: 30 },
                { timestamp: new Date(now - 2000), value: 25 },
                { timestamp: new Date(now - 1000), value: 20 },
                { timestamp: new Date(now), value: 15 }
            ];

            const result = calculateLinearForecast(samples, 100, { now });
            assert.equal(result.status, 'STABLE');
            assert.equal(result.hasPrediction, false);
            assert.ok(result.growthRatePerSecond <= 0);
            assert.equal(result.estimatedSecondsToBreach, null);
        });

        it('G5: Rejects erratic noisy telemetry (R² < 0.60) with LOW_CONFIDENCE', () => {
            const now = Date.now();
            // Volatile sawtooth values with no linear correlation
            const samples = [
                { timestamp: new Date(now - 5000), value: 10 },
                { timestamp: new Date(now - 4000), value: 80 },
                { timestamp: new Date(now - 3000), value: 15 },
                { timestamp: new Date(now - 2000), value: 85 },
                { timestamp: new Date(now - 1000), value: 20 },
                { timestamp: new Date(now), value: 75 }
            ];

            const result = calculateLinearForecast(samples, 100, { now });
            assert.equal(result.status, 'LOW_CONFIDENCE');
            assert.equal(result.hasPrediction, false);
            assert.ok(result.rSquared < 0.60);
            assert.equal(result.estimatedSecondsToBreach, null);
        });

        it('G6: Filters out distant breaches beyond maxHorizonSeconds with OUT_OF_HORIZON', () => {
            const now = Date.now();
            // Very slow creep: +0.1 retries per second. At current 20, needs 800 seconds to reach 100
            const samples = [
                { timestamp: new Date(now - 30000), value: 17 },
                { timestamp: new Date(now - 20000), value: 18 },
                { timestamp: new Date(now - 10000), value: 19 },
                { timestamp: new Date(now), value: 20 }
            ];

            const result = calculateLinearForecast(samples, 100, { maxHorizonSeconds: 120, now });
            assert.equal(result.status, 'OUT_OF_HORIZON');
            assert.equal(result.hasPrediction, false);
            assert.ok(result.estimatedSecondsToBreach > 120);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Database Persistence & Landscape Integration
    // -------------------------------------------------------------------------
    describe('Database Persistence & Landscape Forecasting', () => {
        beforeEach(async () => {
            await cds.db.run(DELETE.from(srv.entities.QueueSnapshots));
            await cds.db.run(DELETE.from(srv.entities.Alerts));
        });

        it('D1: Evaluates real persisted snapshots from SQLite and detects impending breach', async () => {
            // Insert 6 synthetic rising snapshots for targetInterface
            const baseTime = Date.now();
            const risingPoints = [
                { retries: 25, pending: 30, age: 30, dt: -5000 },
                { retries: 40, pending: 45, age: 45, dt: -4000 },
                { retries: 55, pending: 60, age: 60, dt: -3000 },
                { retries: 70, pending: 75, age: 80, dt: -2000 },
                { retries: 85, pending: 90, age: 100, dt: -1000 }
            ];

            for (const pt of risingPoints) {
                await cds.db.run(INSERT.into(srv.entities.QueueSnapshots).entries({
                    interface_ID: targetInterface.ID,
                    capturedAt: new Date(baseTime + pt.dt).toISOString(),
                    retryAttempts: pt.retries,
                    pendingCount: pt.pending,
                    successCount: 100,
                    failedCount: 2,
                    oldestPendingAgeSeconds: pt.age
                }));
            }

            const predictions = await evaluateInterfacePredictions(srv.entities, targetInterface);
            assert.ok(Array.isArray(predictions));
            assert.equal(predictions.length, 3); // Retries, Queue, Age

            const retryPred = predictions.find(p => p.metric === 'retryAttempts');
            assert.ok(retryPred);
            assert.equal(retryPred.status, 'PREDICTIVE_WARNING');
            assert.equal(retryPred.currentValue, 85);
            assert.equal(retryPred.threshold, targetInterface.maxRetryThreshold || 100);
            assert.equal(retryPred.growthRatePerSecond, 15); // +15/s
            assert.equal(retryPred.estimatedSecondsToBreach, 1.0); // (100 - 85) / 15 = 1.0s
            assert.equal(retryPred.riskLevel, 'CRITICAL');
        });

        it('D2: evaluateLandscapePredictions prioritizes active warnings by urgency', async () => {
            // Interface 0: critical approaching breach (ETA ~2s)
            // Interface 1: healthy baseline (STABLE)
            const now = Date.now();
            for (let i = 0; i < 4; i++) {
                await cds.db.run(INSERT.into(srv.entities.QueueSnapshots).entries({
                    interface_ID: allInterfaces[0].ID,
                    capturedAt: new Date(now - (3 - i) * 1000).toISOString(),
                    retryAttempts: 60 + i * 10, // 60, 70, 80, 90
                    pendingCount: 20,
                    successCount: 120,
                    failedCount: 0,
                    oldestPendingAgeSeconds: 20
                }));
            }

            for (let i = 0; i < 4; i++) {
                await cds.db.run(INSERT.into(srv.entities.QueueSnapshots).entries({
                    interface_ID: allInterfaces[1].ID,
                    capturedAt: new Date(now - (3 - i) * 1000).toISOString(),
                    retryAttempts: 1,
                    pendingCount: 10,
                    successCount: 150,
                    failedCount: 0,
                    oldestPendingAgeSeconds: 15
                }));
            }

            const landscape = await evaluateLandscapePredictions(srv.entities);
            assert.ok(Array.isArray(landscape));
            assert.ok(landscape.length >= 2);

            // First item should be the urgent predictive warning
            assert.equal(landscape[0].status, 'PREDICTIVE_WARNING');
            assert.equal(landscape[0].interfaceId, allInterfaces[0].ID);
            assert.equal(landscape[0].metric, 'retryAttempts');
        });
    });

    // -------------------------------------------------------------------------
    // 4. OData API Endpoint & Authorization
    // -------------------------------------------------------------------------
    describe('OData Functions & Role Authorization', () => {
        it('O1: Anonymous user calling getPredictions is rejected with 401', async () => {
            const anonTx = srv.tx({ user: new cds.User.Anonymous() });
            await assert.rejects(
                async () => {
                    await anonTx.send('getPredictions', { interfaceId: targetInterface.ID });
                },
                (err) => {
                    const code = err.code || err.status;
                    assert.equal(code, 401, `Expected 401, got ${code}`);
                    return true;
                }
            );
        });

        it('O2: Authenticated SupportViewer (alice) can successfully query predictions (200)', async () => {
            const aliceTx = srv.tx({
                user: new cds.User({ id: 'alice', roles: ['SupportViewer'] })
            });

            const result = await aliceTx.send('getPredictions', { interfaceId: targetInterface.ID });
            assert.ok(Array.isArray(result));
            assert.equal(result.length, 3);
        });

        it('O3: Authenticated user can query getLandscapePredictions (200)', async () => {
            const bobTx = srv.tx({
                user: new cds.User({ id: 'bob', roles: ['SupportOperator'] })
            });

            const result = await bobTx.send('getLandscapePredictions', {});
            assert.ok(Array.isArray(result));
            assert.ok(result.length >= 3);
        });
    });
});
