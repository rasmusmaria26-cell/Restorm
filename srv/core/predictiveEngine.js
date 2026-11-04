/**
 * predictiveEngine.js — Deterministic Mathematical Forecasting Engine (Phase 3)
 * (Clean Architecture - Proactive Incident Intelligence)
 *
 * Implements rolling Ordinary Least Squares (OLS) linear regression forecasting
 * on actual persisted QueueSnapshot telemetry to project metric trajectories,
 * calculate estimated time to configured threshold breaches (ETA), and emit
 * predictive early warnings before deterministic rule breaches occur.
 *
 * CORE PRINCIPLES:
 * 1. Deterministic & Grounded: All calculations are derived strictly from real
 *    timestamped SQLite telemetry snapshots. Zero invented numbers.
 * 2. LLM Separation: The LLM NEVER invents or computes forecasts. It only receives
 *    these calculated mathematical facts to compose operational explanations.
 * 3. Robust Guardrails: Explicit handling for insufficient data, stale telemetry,
 *    flat/negative slopes, high variance (low R²), and out-of-horizon events.
 * 4. Architectural Isolation: Completely decoupled from gradualSimulator.js.
 */

'use strict';

// Default configuration constants
const DEFAULT_MIN_OBSERVATIONS = 3;
const DEFAULT_MAX_OBSERVATIONS = 8;
const DEFAULT_STALE_THRESHOLD_SECONDS = 180;
const DEFAULT_MAX_HORIZON_SECONDS = 180;
const DEFAULT_WARNING_FRACTION = 0.60;

/**
 * Calculates deterministic linear regression and estimated time to threshold breach.
 *
 * @param {Array<{timestamp: string|number|Date, value: number}>} observations - Chronological observations
 * @param {number} threshold - Configured interface limit to forecast against
 * @param {Object} [options={}] - Custom options
 * @param {number} [options.minObservations=3] - Minimum required samples
 * @param {number} [options.staleThresholdSeconds=180] - Age threshold for staleness
 * @param {number} [options.maxHorizonSeconds=180] - Maximum lookahead horizon in seconds
 * @param {number} [options.warningThresholdFraction=0.60] - Fraction of threshold to trigger warning
 * @param {number} [options.now] - Override current timestamp for testing
 * @returns {Object} Structured forecast result
 */
function calculateLinearForecast(observations, threshold, options = {}) {
    const {
        minObservations = DEFAULT_MIN_OBSERVATIONS,
        staleThresholdSeconds = DEFAULT_STALE_THRESHOLD_SECONDS,
        maxHorizonSeconds = DEFAULT_MAX_HORIZON_SECONDS,
        warningThresholdFraction = DEFAULT_WARNING_FRACTION,
        now = Date.now()
    } = options;

    const limit = Number(threshold) || 100;

    // 1. Guardrail: Insufficient observations
    if (!Array.isArray(observations) || observations.length < minObservations) {
        return {
            status: 'INSUFFICIENT_DATA',
            hasPrediction: false,
            confidence: 0,
            rSquared: 0,
            growthRatePerSecond: 0,
            estimatedSecondsToBreach: null,
            projectedBreachAt: null,
            riskLevel: 'NONE',
            observationsCount: Array.isArray(observations) ? observations.length : 0,
            currentValue: Array.isArray(observations) && observations.length > 0 ? Number(observations[observations.length - 1].value) || 0 : 0,
            threshold: limit,
            summary: `Insufficient observation history (minimum ${minObservations} samples required).`
        };
    }

    const N = observations.length;
    const latest = observations[N - 1];
    const latestTime = new Date(latest.timestamp || latest.capturedAt).getTime();

    // 2. Guardrail: Stale telemetry
    if (now - latestTime > staleThresholdSeconds * 1000) {
        return {
            status: 'STALE_TELEMETRY',
            hasPrediction: false,
            confidence: 0,
            rSquared: 0,
            growthRatePerSecond: 0,
            estimatedSecondsToBreach: null,
            projectedBreachAt: null,
            riskLevel: 'NONE',
            observationsCount: N,
            currentValue: Number(latest.value) || 0,
            threshold: limit,
            summary: `Telemetry is stale (no recent snapshots within ${staleThresholdSeconds}s).`
        };
    }

    const yLatest = Number(latest.value) || 0;

    // 3. Guardrail: Threshold already crossed (deterministic incident territory)
    if (yLatest >= limit) {
        return {
            status: 'THRESHOLD_BREACHED',
            hasPrediction: false,
            confidence: 1.0,
            rSquared: 1.0,
            growthRatePerSecond: 0,
            estimatedSecondsToBreach: 0,
            projectedBreachAt: new Date(latestTime).toISOString(),
            riskLevel: 'CRITICAL',
            observationsCount: N,
            currentValue: yLatest,
            threshold: limit,
            summary: `Configured threshold (${limit}) is already breached (current value: ${yLatest}).`
        };
    }

    // 4. Ordinary Least Squares (OLS) Linear Regression
    const t0 = new Date(observations[0].timestamp || observations[0].capturedAt).getTime();
    let sumX = 0;
    let sumY = 0;
    const points = [];

    for (let i = 0; i < N; i++) {
        const t = new Date(observations[i].timestamp || observations[i].capturedAt).getTime();
        const x = (t - t0) / 1000; // Normalized time in seconds from baseline
        const y = Number(observations[i].value) || 0;
        sumX += x;
        sumY += y;
        points.push({ x, y });
    }

    const xBar = sumX / N;
    const yBar = sumY / N;

    let ssXX = 0;
    let ssYY = 0;
    let ssXY = 0;

    for (const p of points) {
        const dx = p.x - xBar;
        const dy = p.y - yBar;
        ssXX += dx * dx;
        ssYY += dy * dy;
        ssXY += dx * dy;
    }

    // All samples occurred at the exact same millisecond
    if (ssXX === 0) {
        return {
            status: 'INSUFFICIENT_DATA',
            hasPrediction: false,
            confidence: 0,
            rSquared: 0,
            growthRatePerSecond: 0,
            estimatedSecondsToBreach: null,
            projectedBreachAt: null,
            riskLevel: 'NONE',
            observationsCount: N,
            currentValue: yLatest,
            threshold: limit,
            summary: 'Zero elapsed time across observation window.'
        };
    }

    const slope = ssXY / ssXX;
    const rSquared = ssYY > 0 ? Math.min(1.0, Math.max(0.0, (ssXY * ssXY) / (ssXX * ssYY))) : 1.0;
    const growthRate = Math.round(slope * 100) / 100;

    // 5. Guardrail: Flat or negative trend (system healthy or recovering)
    if (slope <= 0.05) {
        return {
            status: 'STABLE',
            hasPrediction: false,
            confidence: Math.round(rSquared * 100) / 100,
            rSquared: Math.round(rSquared * 10000) / 10000,
            growthRatePerSecond: growthRate,
            estimatedSecondsToBreach: null,
            projectedBreachAt: null,
            riskLevel: 'NONE',
            observationsCount: N,
            currentValue: yLatest,
            threshold: limit,
            summary: 'Trend is stable or decreasing. No threshold breach projected.'
        };
    }

    // 6. Guardrail: Low confidence / erratic telemetry
    if (rSquared < 0.60 && N >= 5) {
        return {
            status: 'LOW_CONFIDENCE',
            hasPrediction: false,
            confidence: Math.round(rSquared * 100) / 100,
            rSquared: Math.round(rSquared * 10000) / 10000,
            growthRatePerSecond: growthRate,
            estimatedSecondsToBreach: null,
            projectedBreachAt: null,
            riskLevel: 'LOW',
            observationsCount: N,
            currentValue: yLatest,
            threshold: limit,
            summary: `Telemetry trajectory has high volatility (R² = ${rSquared.toFixed(2)}). Forecast uncertain.`
        };
    }

    // 7. Calculate ETA in seconds
    const remainingDelta = limit - yLatest;
    const etaSeconds = Math.max(0.1, remainingDelta / slope);
    const roundedEta = Math.round(etaSeconds * 10) / 10;
    const projectedBreachAt = new Date(latestTime + etaSeconds * 1000).toISOString();

    // 8. Guardrail: Out of operational horizon (> 180s)
    if (etaSeconds > maxHorizonSeconds) {
        return {
            status: 'OUT_OF_HORIZON',
            hasPrediction: false,
            confidence: Math.round(rSquared * 100) / 100,
            rSquared: Math.round(rSquared * 10000) / 10000,
            growthRatePerSecond: growthRate,
            estimatedSecondsToBreach: roundedEta,
            projectedBreachAt,
            riskLevel: 'LOW',
            observationsCount: N,
            currentValue: yLatest,
            threshold: limit,
            summary: `Projected breach is beyond operational horizon (> ${maxHorizonSeconds}s).`
        };
    }

    // 9. Active Predictive Warning!
    const isApproaching = yLatest >= limit * warningThresholdFraction;
    const riskLevel = roundedEta <= 5.0 ? 'CRITICAL' : (roundedEta <= 15.0 ? 'HIGH' : 'MEDIUM');

    return {
        status: isApproaching ? 'PREDICTIVE_WARNING' : 'ELEVATED_TREND',
        hasPrediction: true,
        confidence: Math.round(rSquared * 100) / 100,
        rSquared: Math.round(rSquared * 10000) / 10000,
        growthRatePerSecond: growthRate,
        estimatedSecondsToBreach: roundedEta,
        projectedBreachAt,
        riskLevel,
        observationsCount: N,
        currentValue: yLatest,
        threshold: limit,
        summary: `Impending breach in ~${roundedEta}s at +${growthRate}/s (Confidence: ${Math.round(rSquared * 100)}%).`
    };
}

/**
 * Evaluates predictive forecasts for an individual interface across its key metrics.
 *
 * @param {Object} entities - CDS entities { Interfaces, QueueSnapshots, Alerts }
 * @param {string|Object} targetInterface - Interface UUID or Interface entity record
 * @param {Object} [options={}]
 * @param {number} [options.windowSize=20] - Number of recent snapshots to evaluate
 * @returns {Promise<Array<Object>>} Array of predictive forecast objects
 */
async function evaluateInterfacePredictions(entities, targetInterface, options = {}) {
    const { Interfaces, QueueSnapshots } = entities;
    const windowSize = options.windowSize || DEFAULT_MAX_OBSERVATIONS;

    let iface = targetInterface;
    if (typeof targetInterface === 'string') {
        iface = await SELECT.one.from(Interfaces).where({ ID: targetInterface });
    }
    if (!iface) return [];

    // Load recent snapshots in chronological ascending order
    const snapshots = await SELECT.from(QueueSnapshots)
        .where({ interface_ID: iface.ID })
        .orderBy('capturedAt desc')
        .limit(windowSize);

    // Re-order to chronological ascending (t0 -> tLatest)
    snapshots.reverse();

    const retryLimit = Number(iface.maxRetryThreshold) || 100;
    const queueLimit = Number(iface.queueGrowthLimit) || 200;
    const ageLimit = Number(iface.oldMessageAgeLimitSeconds) || 600;

    const retryObs = snapshots.map(s => ({ timestamp: s.capturedAt, value: s.retryAttempts }));
    const queueObs = snapshots.map(s => ({ timestamp: s.capturedAt, value: s.pendingCount }));
    const ageObs = snapshots.map(s => ({ timestamp: s.capturedAt, value: s.oldestPendingAgeSeconds }));

    const retryForecast = calculateLinearForecast(retryObs, retryLimit, options);
    const queueForecast = calculateLinearForecast(queueObs, queueLimit, options);
    const ageForecast = calculateLinearForecast(ageObs, ageLimit, options);

    const results = [
        {
            interfaceId: iface.ID,
            interfaceName: iface.name,
            metric: 'retryAttempts',
            metricLabel: 'Cumulative Retries',
            ruleCode: 'RETRY_STORM',
            ...retryForecast
        },
        {
            interfaceId: iface.ID,
            interfaceName: iface.name,
            metric: 'pendingCount',
            metricLabel: 'Queue Backlog',
            ruleCode: 'QUEUE_GROWTH',
            ...queueForecast
        },
        {
            interfaceId: iface.ID,
            interfaceName: iface.name,
            metric: 'oldestPendingAgeSeconds',
            metricLabel: 'Oldest Message Age',
            ruleCode: 'PERSISTENT_BACKLOG',
            ...ageForecast
        }
    ];

    return results;
}

/**
 * Evaluates predictive forecasts across all active interfaces in the landscape.
 *
 * @param {Object} entities - CDS entities { Interfaces, QueueSnapshots, Alerts }
 * @param {Object} [options={}]
 * @returns {Promise<Array<Object>>} Filtered and priority-sorted predictions
 */
async function evaluateLandscapePredictions(entities, options = {}) {
    const { Interfaces } = entities;
    const allInterfaces = await SELECT.from(Interfaces).where({ active: true });

    const allPredictions = [];
    for (const iface of allInterfaces) {
        const predictions = await evaluateInterfacePredictions(entities, iface, options);
        allPredictions.push(...predictions);
    }

    // Priority sorting: PREDICTIVE_WARNING first, sorted by ascending ETA (most urgent first)
    allPredictions.sort((a, b) => {
        const priorityOrder = {
            'PREDICTIVE_WARNING': 1,
            'ELEVATED_TREND': 2,
            'THRESHOLD_BREACHED': 3,
            'LOW_CONFIDENCE': 4,
            'OUT_OF_HORIZON': 5,
            'STABLE': 6,
            'STALE_TELEMETRY': 7,
            'INSUFFICIENT_DATA': 8
        };
        const pA = priorityOrder[a.status] || 99;
        const pB = priorityOrder[b.status] || 99;
        if (pA !== pB) return pA - pB;

        const etaA = a.estimatedSecondsToBreach !== null ? a.estimatedSecondsToBreach : 9999;
        const etaB = b.estimatedSecondsToBreach !== null ? b.estimatedSecondsToBreach : 9999;
        return etaA - etaB;
    });

    return allPredictions;
}

module.exports = {
    calculateLinearForecast,
    evaluateInterfacePredictions,
    evaluateLandscapePredictions,
    DEFAULT_MIN_OBSERVATIONS,
    DEFAULT_MAX_OBSERVATIONS,
    DEFAULT_STALE_THRESHOLD_SECONDS,
    DEFAULT_MAX_HORIZON_SECONDS,
    DEFAULT_WARNING_FRACTION
};
