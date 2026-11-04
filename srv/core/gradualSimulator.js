/**
 * gradualSimulator.js — Multi-Stage Gradual Telemetry Simulation Engine
 * (Clean Architecture - Simulation Core)
 *
 * Simulates real-world integration incident progression over multiple sequential stages
 * using continuous S-curve (normalized logistic sigmoid) dynamics, causal phase lags,
 * and Mulberry32 seeded PRNG jitter.
 *
 * MATHEMATICAL MODEL & PHYSICAL PHASE LAGS:
 * 1. Normalized Sigmoid:
 *    S(tau; tau0, k) = 1 / (1 + exp(-k * (tau - tau0)))
 *    S_norm(tau) = (S(tau) - S(0)) / (S(1) - S(0))
 *    guarantees exact bounds [0, 1] over normalized time tau in [0, 1].
 * 2. Causal Phase Ordering (Real-world CPI/JMS incident progression):
 *    - Retry Attempts (R): Rises first (tau0 = 0.35, k = 10.0). Worker threads retry on remote timeouts.
 *    - Processing Throughput (S): Drops early (tau0 = 0.38, k = 8.5) as workers lock up in retry cycles.
 *    - Pending Queue (Q): Backlog accumulates with delay (tau0 = 0.50, k = 8.0) after worker saturation.
 *    - Failed Count (F): Dead letters accumulate as max retries exhaust (tau0 = 0.55, k = 8.0).
 *    - Oldest Message Age (A): Accumulates as queue sits blocked (tau0 = 0.60, k = 7.0).
 * 3. Monotonic Cumulative Retries via Delta-Jitter:
 *    Delta_R_raw(i) = max(0, R_raw(tau_i) - R_raw(tau_{i-1})) >= 0
 *    Delta_R_jittered = max(0, round(Delta_R_raw * (1 + eta_i))) where eta_i in [-0.10, +0.10]
 *    R(i) = R(i-1) + Delta_R_jittered
 *    Guarantees R(i) >= R(i-1) across all steps with mathematical certainty!
 * 4. Seeded Determinism:
 *    32-bit Mulberry32 PRNG ensures presentation and automated test repeatability.
 * 5. Architectural Isolation (Phase 2 vs Phase 3):
 *    Simulator strictly generates and persists raw telemetry snapshots.
 *    Zero prediction logic, regression slope calculation, or ETA estimation is embedded here.
 */

const crypto = require('crypto');
const { processSnapshotAndEvaluate } = require('./ingestionPipeline');
const { ALLOWED_SCENARIOS } = require('./simulator');

// Maximum number of finished (COMPLETED / FAILED / CANCELLED) sessions retained in memory
const MAX_RETAINED_SESSIONS = 50;

// Default and boundary values for interval between simulation stages
const DEFAULT_STEP_INTERVAL_MS = 2000;
const MIN_STEP_INTERVAL_MS = 10;
const MAX_STEP_INTERVAL_MS = 60000;

// In-memory session registry: sessionId -> SimulationSession
const sessionsById = new Map();

// Active simulation tracking: interfaceId -> sessionId (or 'ALL' -> sessionId)
const activeSessionByInterface = new Map();

/**
 * 32-bit Mulberry32 Seeded Pseudo-Random Number Generator.
 * Provides deterministic, repeatable floating-point values in [0, 1).
 *
 * @param {number} [seed=0x5EED] - 32-bit integer seed
 * @returns {() => number} Generator function returning uniform float in [0, 1)
 */
function createPRNG(seed = 0x5EED) {
    let s = (typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : 0x5EED) | 0;
    return function next() {
        s |= 0;
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Derives a deterministic 32-bit integer seed from a string or number.
 * Uses FNV-1a hashing on string inputs.
 *
 * @param {string|number} input
 * @param {number} [defaultSeed=0x5EED]
 * @returns {number} 32-bit integer seed
 */
function hashSeed(input, defaultSeed = 0x5EED) {
    if (typeof input === 'number' && Number.isFinite(input)) {
        return Math.floor(input) | 0;
    }
    if (typeof input === 'string' && input.length > 0) {
        let h = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h | 0;
    }
    return defaultSeed | 0;
}

/**
 * Normalized Logistic Sigmoid mapping tau in [0, 1] to [0, 1].
 * Guarantees S(0) = 0 and S(1) = 1 while preserving the S-curve inflection.
 *
 * @param {number} tau - Normalized time in [0, 1]
 * @param {number} tau0 - Inflection point center in [0, 1]
 * @param {number} k - Steepness / growth rate factor
 * @returns {number} Normalized value strictly in [0, 1]
 */
function normalizedSigmoid(tau, tau0, k) {
    if (tau <= 0) return 0;
    if (tau >= 1) return 1;
    const raw = (t) => 1 / (1 + Math.exp(-k * (t - tau0)));
    const minVal = raw(0);
    const maxVal = raw(1);
    const val = raw(tau);
    const norm = (val - minVal) / (maxVal - minVal);
    return Math.max(0, Math.min(1, norm));
}

/**
 * Curated progressive stage names for 20-stage continuous simulations.
 */
const CONTINUOUS_STAGE_NAMES = {
    RETRY_STORM: [
        'Normal Baseline',
        'Nominal Operation',
        'Transient Network Jitter',
        'Downstream Latency Blip',
        'Minor Remote Timeouts',
        'Initial Retry Backoff',
        'Consumer Retries Initiated',
        'Worker Thread Contention',
        'Outflow Throughput Straining',
        'Retries Accumulating',
        'Throughput Decay Accelerating',
        'Warning Zone — Rapid Growth',
        'Imminent Threshold Breach',
        'Near-Threshold Saturation',
        'Threshold Crossed — Storm Active',
        'Queue Limit Breached',
        'Worker Pool Near Exhaustion',
        'Oldest Message SLA Breached',
        'Severe Cascade Congestion',
        'Full Cascade Gridlock'
    ],
    QUEUE_GROWTH: [
        'Normal Inflow',
        'Incoming Traffic Rising',
        'Batch Inflow Surge',
        'Consumer Threads Saturated',
        'Buffer Growth Beginning',
        'Consumer Capacity Strained',
        'Queue Backlog Accumulating',
        'Warning Zone Approached',
        'Queue Limit Imminent',
        'Queue Limit Breached',
        'Worker Saturation Continuing',
        'Backlog Escalating Rapidly',
        'Message Retention Climbing',
        'Throughput Depressing',
        'Wait Time Escalating',
        'Queue Buffers Under Stress',
        'Critical Buffer Capacity',
        'Peak Backlog Saturation',
        'Persistent Saturation',
        'Maximum Backlog Saturation'
    ],
    PERSISTENT_BACKLOG: [
        'Normal Ingestion',
        'Head-of-Line Latency',
        'Head-of-Line Message Blocked',
        'Lock Contention Developing',
        'Message Processing Frozen',
        'Wait Time Accumulating',
        'Backlog Stagnation Beginning',
        'Approaching SLA Warning',
        'Approaching SLA Limit',
        'SLA Limit Breached',
        'Poison Queue Confirmed',
        'Stagnation Deepening',
        'Message Age Doubling',
        'Queue Starvation Advancing',
        'Throughput Depressed',
        'Extreme Message Age Escalation',
        'Consumer Lock Persistent',
        'Critical Age Breach',
        'Stagnant Poison Queue',
        'Severe SLA Violation Gridlock'
    ],
    RECOVERY_STALLED: [
        'Active Incident Pre-Condition',
        'Downstream Partially Online',
        'Downstream Restored (Retries Declining)',
        'Retry Backoff Clearing',
        'System Health Clean (Failures Zero)',
        'Failures Cleared, Drain Awaited',
        'Consumer Allocation Initiated',
        'Drain Rate Lower Than Inflow',
        'Post-Recovery Drain Stalled',
        'Worker Thread Starvation Stalling',
        'Stalled Drain Persisting',
        'Elevated Backlog Locked',
        'Throughput Remains Depressed',
        'SLA Exceeded on Undrained Queue',
        'Backlog Depletion Suspended',
        'Partial Recovery Failure',
        'Drain Rate Insufficient',
        'Persisting Unacknowledged Queue',
        'Stalled Recovery Confirmed',
        'Severe Drain Paralysis'
    ],
    RECOVERY: [
        'Incident Backlog Active',
        'Downstream Health Probe Passing',
        'Downstream Online, Draining Started',
        'Worker Concurrency Increased',
        'Drain Rate Escalating Rapidly',
        'High Throughput Drain',
        'Backlog Halved Under Sustained Drain',
        'Throughput Peaking at Capacity',
        'Retries Exhausted & Cleared',
        'Failures Zeroed Out',
        'Queue Rapidly Normalizing',
        'Backlog Approaching Nominal',
        'Backlog Cleared to Nominal',
        'Oldest Message Wait Dropping',
        'Latency Returning to Baseline',
        'Consumer Pool Resuming Steady State',
        'Healthy Inflow Re-Established',
        'System Stabilization Complete',
        'All Clear Verified',
        'System Fully Healthy'
    ],
    NORMAL: [
        'Baseline Traffic',
        'Steady Operational Inflow',
        'Healthy Consumer Throughput',
        'Nominal Queue Depth',
        'Normal Response Latencies',
        'Steady Inflow',
        'Nominal Heartbeat Passing',
        'Standard Balanced Load',
        'Nominal Thread Allocation',
        'Routine Integration Traffic',
        'Stable Operation Baseline',
        'Optimal Message Processing',
        'Standard Operations',
        'Healthy Message Acknowledgment',
        'Nominal Execution Metrics',
        'Steady State Processing',
        'Standard Enterprise Traffic',
        'Balanced Ingestion Pace',
        'Nominal Health Verified',
        'Optimal Operational Baseline'
    ]
};

/**
 * Generates continuous synthetic telemetry curve points across totalStages steps
 * using normalized sigmoids, causal phase delays, and Mulberry32 seeded delta-jitter.
 *
 * @param {string} scenario - One of ALLOWED_SCENARIOS
 * @param {Object} [iface={}] - Target interface thresholds
 * @param {number} [totalStages=20] - Number of stages
 * @param {number} [seed=0x5EED] - PRNG seed
 * @returns {Array<Object>} Array of stage metric point objects
 */
function generateCurvePoints(scenario, iface = {}, totalStages = 20, seed = 0x5EED) {
    const prng = createPRNG(seed);
    const retryLimit = Number(iface.maxRetryThreshold) || 100;
    const queueLimit = Number(iface.queueGrowthLimit) || 200;
    const ageLimit = Number(iface.oldMessageAgeLimitSeconds) || 600;
    const stalledLimit = Number(iface.recoveryStalledBacklog) || 100;

    const names = CONTINUOUS_STAGE_NAMES[scenario] || CONTINUOUS_STAGE_NAMES.NORMAL;
    const points = [];

    let prevRetries = (scenario === 'RECOVERY' ? 95 : (scenario === 'RECOVERY_STALLED' ? 70 : 1));
    let prevRawR = prevRetries;
    let prevSuccess = 145;
    let prevRawS = 145;

    for (let i = 0; i < totalStages; i++) {
        const tau = totalStages > 1 ? i / (totalStages - 1) : 0;
        let pendingCount, failedCount, retryAttempts, successCount, oldestPendingAgeSeconds;

        switch (scenario) {
            case 'RETRY_STORM': {
                // 1. Retries rise with calibrated threshold breach at ~13.5s (tau0 = 0.72, k = 8.5)
                const rawR = 1 + (Math.round(retryLimit * 2.8) - 1) * normalizedSigmoid(tau, 0.73, 8.5);
                const deltaRawR = Math.max(0, rawR - prevRawR);
                prevRawR = rawR;
                const jitterR = (prng() * 0.16) - 0.08; // +/- 8% on step delta
                const stepDeltaR = Math.max(0, Math.round(deltaRawR * (1 + jitterR)));
                retryAttempts = i === 0 ? 1 : prevRetries + stepDeltaR;
                prevRetries = retryAttempts;

                // 2. Throughput degrades monotonically as worker threads get locked in retry loops (tau0 = 0.70, k = 7.5)
                const rawS = 2 + (145 - 2) * (1 - normalizedSigmoid(tau, 0.70, 7.5));
                const deltaRawS = Math.max(0, prevRawS - rawS);
                prevRawS = rawS;
                const jitterS = (prng() * 0.10) - 0.05; // +/- 5% on decrease rate
                const stepDeltaS = Math.max(0, Math.round(deltaRawS * (1 + jitterS)));
                successCount = i === 0 ? 145 : Math.max(2, prevSuccess - stepDeltaS);
                prevSuccess = successCount;

                // 3. Pending queue backlog follows with slight delay (tau0 = 0.81, k = 7.5)
                const rawQ = 12 + (Math.round(queueLimit * 2.1) - 12) * normalizedSigmoid(tau, 0.81, 7.5);
                const jitterQ = (prng() * 0.04) - 0.02; // +/- 2%
                pendingCount = Math.max(0, Math.round(rawQ * (1 + jitterQ)));

                // 4. Failed count increases as retries exhaust (tau0 = 0.82, k = 8.0)
                const rawF = 190 * normalizedSigmoid(tau, 0.82, 8.0);
                failedCount = Math.max(0, Math.round(rawF));

                // 5. Oldest message age accumulates as backlog sits stalled (tau0 = 0.88, k = 7.0)
                const rawA = 15 + (Math.round(ageLimit * 1.3) - 15) * normalizedSigmoid(tau, 0.88, 7.0);
                const jitterA = (prng() * 0.04) - 0.02; // +/- 2%
                oldestPendingAgeSeconds = Math.max(15, Math.round(rawA * (1 + jitterA)));
                break;
            }

            case 'QUEUE_GROWTH': {
                // Pending queue surges first (tau0 = 0.35, k = 9.0)
                const rawQ = 15 + (Math.round(queueLimit * 1.8) - 15) * normalizedSigmoid(tau, 0.35, 9.0);
                const jitterQ = (prng() * 0.08) - 0.04;
                pendingCount = Math.max(0, Math.round(rawQ * (1 + jitterQ)));

                // Message age increases as queue backs up (tau0 = 0.50, k = 8.0)
                const rawA = 20 + 400 * normalizedSigmoid(tau, 0.50, 8.0);
                const jitterA = (prng() * 0.04) - 0.02;
                oldestPendingAgeSeconds = Math.max(20, Math.round(rawA * (1 + jitterA)));

                // Consumer throughput drops under saturation (tau0 = 0.40, k = 8.0)
                const rawS = 20 + (120 - 20) * (1 - normalizedSigmoid(tau, 0.40, 8.0));
                const jitterS = (prng() * 0.10) - 0.05;
                successCount = Math.max(0, Math.round(rawS * (1 + jitterS)));

                // Retries remain minor (monotonic delta-jitter)
                const rawR = 1 + (40 - 1) * normalizedSigmoid(tau, 0.50, 7.0);
                const deltaRaw = Math.max(0, rawR - prevRawR);
                prevRawR = rawR;
                const jitterR = (prng() * 0.20) - 0.10;
                retryAttempts = i === 0 ? 1 : prevRetries + Math.max(0, Math.round(deltaRaw * (1 + jitterR)));
                prevRetries = retryAttempts;

                const rawF = 35 * normalizedSigmoid(tau, 0.55, 8.0);
                failedCount = Math.max(0, Math.round(rawF));
                break;
            }

            case 'PERSISTENT_BACKLOG': {
                // Oldest message age climbs steadily and breaches SLA (tau0 = 0.38, k = 9.0)
                const rawA = 25 + (Math.round(ageLimit * 2.2) - 25) * normalizedSigmoid(tau, 0.38, 9.0);
                const jitterA = (prng() * 0.04) - 0.02;
                oldestPendingAgeSeconds = Math.max(25, Math.round(rawA * (1 + jitterA)));

                // Queue backlog builds slowly
                const rawQ = 20 + (140 - 20) * normalizedSigmoid(tau, 0.45, 7.5);
                const jitterQ = (prng() * 0.08) - 0.04;
                pendingCount = Math.max(0, Math.round(rawQ * (1 + jitterQ)));

                // Throughput is suppressed
                const rawS = 10 + (110 - 10) * (1 - normalizedSigmoid(tau, 0.38, 8.0));
                const jitterS = (prng() * 0.10) - 0.05;
                successCount = Math.max(0, Math.round(rawS * (1 + jitterS)));

                // Occasional poison message retries (monotonic delta-jitter)
                const rawR = 1 + (20 - 1) * normalizedSigmoid(tau, 0.50, 7.0);
                const deltaRaw = Math.max(0, rawR - prevRawR);
                prevRawR = rawR;
                const jitterR = (prng() * 0.20) - 0.10;
                retryAttempts = i === 0 ? 1 : prevRetries + Math.max(0, Math.round(deltaRaw * (1 + jitterR)));
                prevRetries = retryAttempts;

                const rawF = 15 * normalizedSigmoid(tau, 0.50, 7.0);
                failedCount = Math.max(0, Math.round(rawF));
                break;
            }

            case 'RECOVERY_STALLED': {
                // Retries decline to normal baseline (inverted sigmoid)
                const rawR = 1 + (70 - 1) * (1 - normalizedSigmoid(tau, 0.25, 10.0));
                retryAttempts = Math.max(1, Math.round(rawR));

                // Failures drop to zero
                const rawF = 40 * (1 - normalizedSigmoid(tau, 0.30, 9.0));
                failedCount = Math.max(0, Math.round(rawF));

                // Backlog remains elevated (>= stalledLimit)
                const targetBacklog = Math.round(stalledLimit * 1.8);
                const rawQ = targetBacklog + Math.round(stalledLimit * 0.7) * (1 - normalizedSigmoid(tau, 0.30, 8.0));
                pendingCount = Math.max(0, Math.round(rawQ));

                // Throughput remains severely depressed (< 30, triggers Rule D)
                const rawS = 8 + (15 - 8) * (1 - normalizedSigmoid(tau, 0.35, 7.0));
                successCount = Math.max(0, Math.round(rawS));

                // Message age continues to climb because drain is stalled
                const rawA = 500 + 260 * normalizedSigmoid(tau, 0.40, 7.0);
                oldestPendingAgeSeconds = Math.max(500, Math.round(rawA));
                break;
            }

            case 'RECOVERY': {
                // Backlog drains from high to nominal baseline
                const rawQ = 8 + (240 - 8) * (1 - normalizedSigmoid(tau, 0.40, 8.0));
                pendingCount = Math.max(0, Math.round(rawQ));

                // Retries drop to zero
                const rawR = 95 * (1 - normalizedSigmoid(tau, 0.25, 10.0));
                retryAttempts = Math.max(0, Math.round(rawR));

                // Failures clear
                const rawF = 40 * (1 - normalizedSigmoid(tau, 0.25, 10.0));
                failedCount = Math.max(0, Math.round(rawF));

                // Throughput surges during drain
                const rawS = 10 + (300 - 10) * normalizedSigmoid(tau, 0.40, 8.0);
                successCount = Math.max(0, Math.round(rawS));

                // Message age drops rapidly
                const rawA = 15 + (450 - 15) * (1 - normalizedSigmoid(tau, 0.45, 8.0));
                oldestPendingAgeSeconds = Math.max(15, Math.round(rawA));
                break;
            }

            case 'NORMAL':
            default: {
                const jitterQ = (prng() * 4) - 2;
                pendingCount = Math.max(0, Math.round(8 + jitterQ));
                failedCount = 0;
                retryAttempts = prng() > 0.6 ? 1 : 0;
                const jitterS = (prng() * 20) - 10;
                successCount = Math.max(0, Math.round(145 + jitterS));
                const jitterA = (prng() * 4) - 2;
                oldestPendingAgeSeconds = Math.max(10, Math.round(15 + jitterA));
                break;
            }
        }

        const stageName = names[i] || `Stage ${i + 1}/${totalStages}`;
        const metrics = {
            pendingCount,
            failedCount,
            retryAttempts,
            successCount,
            oldestPendingAgeSeconds
        };

        points.push({
            stageIndex: i,
            stageName,
            name: stageName,
            pendingCount,
            failedCount,
            retryAttempts,
            successCount,
            oldestPendingAgeSeconds,
            metrics
        });
    }

    return points;
}

/**
 * Builds standard 5-stage milestone progression (or 3 for NORMAL).
 * Preserves exact test milestone values and backward compatibility with unit tests.
 *
 * @param {string} scenario - One of ALLOWED_SCENARIOS
 * @param {Object} iface - Target interface thresholds
 * @param {number} [stepIntervalMs=DEFAULT_STEP_INTERVAL_MS] - Step interval in ms
 * @returns {Array<Object>}
 */
function buildMilestoneStages(scenario, iface = {}, stepIntervalMs = DEFAULT_STEP_INTERVAL_MS) {
    const retryLimit = Number(iface.maxRetryThreshold) || 100;
    const queueLimit = Number(iface.queueGrowthLimit) || 200;
    const ageLimit = Number(iface.oldMessageAgeLimitSeconds) || 600;
    const stalledLimit = Number(iface.recoveryStalledBacklog) || 100;

    let stages;

    switch (scenario) {
        case 'RETRY_STORM':
            stages = [
                {
                    stageIndex: 0,
                    stageName: 'Normal Baseline',
                    metrics: {
                        pendingCount: 12,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 140,
                        oldestPendingAgeSeconds: 15
                    }
                },
                {
                    stageIndex: 1,
                    stageName: 'Transient Network Blip',
                    metrics: {
                        pendingCount: 35,
                        failedCount: 5,
                        retryAttempts: Math.round(retryLimit * 0.45),
                        successCount: 85,
                        oldestPendingAgeSeconds: 45
                    }
                },
                {
                    stageIndex: 2,
                    stageName: 'Elevated Retries (Warning Zone)',
                    metrics: {
                        pendingCount: Math.round(queueLimit * 0.55),
                        failedCount: 20,
                        retryAttempts: Math.round(retryLimit * 0.85),
                        successCount: 40,
                        oldestPendingAgeSeconds: 120
                    }
                },
                {
                    stageIndex: 3,
                    stageName: 'Threshold Crossed — Storm Active',
                    metrics: {
                        pendingCount: Math.round(queueLimit * 1.15),
                        failedCount: 85,
                        retryAttempts: Math.round(retryLimit * 1.35),
                        successCount: 8,
                        oldestPendingAgeSeconds: 320
                    }
                },
                {
                    stageIndex: 4,
                    stageName: 'Severe Cascade Congestion',
                    metrics: {
                        pendingCount: Math.round(queueLimit * 2.1),
                        failedCount: 190,
                        retryAttempts: Math.round(retryLimit * 2.8),
                        successCount: 2,
                        oldestPendingAgeSeconds: 780
                    }
                }
            ];
            break;

        case 'QUEUE_GROWTH':
            stages = [
                {
                    stageIndex: 0,
                    stageName: 'Normal Inflow',
                    metrics: {
                        pendingCount: 15,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 120,
                        oldestPendingAgeSeconds: 20
                    }
                },
                {
                    stageIndex: 1,
                    stageName: 'Batch Inflow Surge',
                    metrics: {
                        pendingCount: Math.round(queueLimit * 0.45),
                        failedCount: 4,
                        retryAttempts: 5,
                        successCount: 95,
                        oldestPendingAgeSeconds: 60
                    }
                },
                {
                    stageIndex: 2,
                    stageName: 'Consumer Capacity Strained',
                    metrics: {
                        pendingCount: Math.round(queueLimit * 0.82),
                        failedCount: 12,
                        retryAttempts: 15,
                        successCount: 65,
                        oldestPendingAgeSeconds: 150
                    }
                },
                {
                    stageIndex: 3,
                    stageName: 'Queue Limit Breached',
                    metrics: {
                        pendingCount: Math.round(queueLimit * 1.25),
                        failedCount: 22,
                        retryAttempts: 25,
                        successCount: 38,
                        oldestPendingAgeSeconds: 260
                    }
                },
                {
                    stageIndex: 4,
                    stageName: 'Peak Backlog Saturation',
                    metrics: {
                        pendingCount: Math.round(queueLimit * 1.8),
                        failedCount: 35,
                        retryAttempts: 40,
                        successCount: 20,
                        oldestPendingAgeSeconds: 420
                    }
                }
            ];
            break;

        case 'PERSISTENT_BACKLOG':
            stages = [
                {
                    stageIndex: 0,
                    stageName: 'Normal Ingestion',
                    metrics: {
                        pendingCount: 20,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 110,
                        oldestPendingAgeSeconds: 25
                    }
                },
                {
                    stageIndex: 1,
                    stageName: 'Head-of-Line Message Blocked',
                    metrics: {
                        pendingCount: 45,
                        failedCount: 2,
                        retryAttempts: 3,
                        successCount: 70,
                        oldestPendingAgeSeconds: Math.round(ageLimit * 0.45)
                    }
                },
                {
                    stageIndex: 2,
                    stageName: 'Approaching SLA Limit',
                    metrics: {
                        pendingCount: 75,
                        failedCount: 5,
                        retryAttempts: 6,
                        successCount: 40,
                        oldestPendingAgeSeconds: Math.round(ageLimit * 0.85)
                    }
                },
                {
                    stageIndex: 3,
                    stageName: 'SLA Age Limit Breached',
                    metrics: {
                        pendingCount: 110,
                        failedCount: 8,
                        retryAttempts: 12,
                        successCount: 18,
                        oldestPendingAgeSeconds: Math.round(ageLimit * 1.25)
                    }
                },
                {
                    stageIndex: 4,
                    stageName: 'Stagnant Poison Queue',
                    metrics: {
                        pendingCount: 140,
                        failedCount: 15,
                        retryAttempts: 20,
                        successCount: 10,
                        oldestPendingAgeSeconds: Math.round(ageLimit * 2.2)
                    }
                }
            ];
            break;

        case 'RECOVERY_STALLED':
            stages = [
                {
                    stageIndex: 0,
                    stageName: 'Active Incident Pre-Condition',
                    metrics: {
                        pendingCount: Math.round(stalledLimit * 2.5),
                        failedCount: 40,
                        retryAttempts: 70,
                        successCount: 5,
                        oldestPendingAgeSeconds: 500
                    }
                },
                {
                    stageIndex: 1,
                    stageName: 'Downstream Restored (Retries Declining)',
                    metrics: {
                        pendingCount: Math.round(stalledLimit * 2.2),
                        failedCount: 10,
                        retryAttempts: 18,
                        successCount: 15,
                        oldestPendingAgeSeconds: 580
                    }
                },
                {
                    stageIndex: 2,
                    stageName: 'System Health Clean (Failures Zero)',
                    metrics: {
                        pendingCount: Math.round(stalledLimit * 1.9),
                        failedCount: 0,
                        retryAttempts: 3,
                        successCount: 22,
                        oldestPendingAgeSeconds: 640
                    }
                },
                {
                    stageIndex: 3,
                    stageName: 'Post-Recovery Drain Stalled',
                    metrics: {
                        pendingCount: Math.round(stalledLimit * 1.8),
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 12,
                        oldestPendingAgeSeconds: 700
                    }
                },
                {
                    stageIndex: 4,
                    stageName: 'Stalled Drain Persisting',
                    metrics: {
                        pendingCount: Math.round(stalledLimit * 1.8),
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 8,
                        oldestPendingAgeSeconds: 760
                    }
                }
            ];
            break;

        case 'RECOVERY':
            stages = [
                {
                    stageIndex: 0,
                    stageName: 'Incident Backlog Active',
                    metrics: {
                        pendingCount: 240,
                        failedCount: 40,
                        retryAttempts: 95,
                        successCount: 10,
                        oldestPendingAgeSeconds: 450
                    }
                },
                {
                    stageIndex: 1,
                    stageName: 'Downstream Online, Draining Started',
                    metrics: {
                        pendingCount: 160,
                        failedCount: 5,
                        retryAttempts: 15,
                        successCount: 110,
                        oldestPendingAgeSeconds: 280
                    }
                },
                {
                    stageIndex: 2,
                    stageName: 'High Throughput Drain',
                    metrics: {
                        pendingCount: 75,
                        failedCount: 0,
                        retryAttempts: 2,
                        successCount: 230,
                        oldestPendingAgeSeconds: 120
                    }
                },
                {
                    stageIndex: 3,
                    stageName: 'Backlog Cleared to Nominal',
                    metrics: {
                        pendingCount: 20,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 270,
                        oldestPendingAgeSeconds: 45
                    }
                },
                {
                    stageIndex: 4,
                    stageName: 'System Fully Healthy',
                    metrics: {
                        pendingCount: 8,
                        failedCount: 0,
                        retryAttempts: 0,
                        successCount: 300,
                        oldestPendingAgeSeconds: 15
                    }
                }
            ];
            break;

        case 'NORMAL':
        default:
            stages = [
                {
                    stageIndex: 0,
                    stageName: 'Baseline Traffic',
                    metrics: {
                        pendingCount: 8,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 140,
                        oldestPendingAgeSeconds: 15
                    }
                },
                {
                    stageIndex: 1,
                    stageName: 'Steady Inflow',
                    metrics: {
                        pendingCount: 10,
                        failedCount: 0,
                        retryAttempts: 0,
                        successCount: 155,
                        oldestPendingAgeSeconds: 18
                    }
                },
                {
                    stageIndex: 2,
                    stageName: 'Standard Operations',
                    metrics: {
                        pendingCount: 7,
                        failedCount: 0,
                        retryAttempts: 1,
                        successCount: 135,
                        oldestPendingAgeSeconds: 14
                    }
                }
            ];
            break;
    }

    // Attach stepIntervalMs and alias 'name' to each stage for contract compliance
    for (const stage of stages) {
        stage.name = stage.stageName;
        stage.stepIntervalMs = stepIntervalMs;
    }

    return stages;
}

/**
 * Builds progressive metric stages tailored to the target interface's configured thresholds.
 *
 * Supports both:
 * 1. Default 5-stage milestone mode (3 for NORMAL) for full backward compatibility with unit tests.
 * 2. Continuous S-curve mode when totalStages (e.g. 20) is specified via options.
 *
 * @param {string} scenario - One of ALLOWED_SCENARIOS
 * @param {Object} [iface={}] - Target interface record
 * @param {Object|number} [options={}] - Options object or number of stages
 * @param {number} [options.totalStages] - Total stages count (e.g. 20 for 20s curve)
 * @param {number} [options.stageCount] - Alias for totalStages
 * @param {number} [options.seed] - Seed for Mulberry32 PRNG jitter
 * @param {number} [options.stepIntervalMs] - Step interval in ms
 * @returns {Array<Object>} Array of stage objects
 */
function buildGradualStages(scenario, iface = {}, options = {}) {
    const opts = typeof options === 'number'
        ? { totalStages: options }
        : (options || {});

    const totalStages = opts.totalStages || opts.stageCount;
    const seed = opts.seed !== undefined ? opts.seed : hashSeed(iface.ID || scenario, 0x5EED);
    const stepIntervalMs = opts.stepIntervalMs || (totalStages ? Math.round(20000 / totalStages) : DEFAULT_STEP_INTERVAL_MS);

    // If totalStages was not explicitly specified or matches default backward-compatible milestone counts:
    const isExplicitContinuous = typeof totalStages === 'number' && totalStages > 0 && totalStages !== (scenario === 'NORMAL' ? 3 : 5);

    if (!isExplicitContinuous) {
        return buildMilestoneStages(scenario, iface, stepIntervalMs);
    }

    // Generate continuous S-curve points
    const points = generateCurvePoints(scenario, iface, totalStages, seed);
    return points.map(pt => ({
        stageIndex: pt.stageIndex,
        stageName: pt.stageName,
        name: pt.stageName,
        stepIntervalMs,
        metrics: pt.metrics
    }));
}

/**
 * Promisified sleep helper that supports early abort via session cancellation.
 *
 * @param {number} ms - Milliseconds to sleep
 * @param {Object} session - Active simulation session
 * @returns {Promise<void>}
 */
function sleep(ms, session) {
    return new Promise((resolve) => {
        if (!session || session.status === 'CANCELLED') {
            return resolve();
        }
        const timer = setTimeout(() => {
            resolve();
        }, ms);

        // Keep reference so cancel can abort immediately
        if (session) {
            session._currentTimer = timer;
            session._timerResolver = resolve;
        }
    });
}

/**
 * Enforces in-memory retention limit by evicting the oldest finished sessions.
 */
function evictOldSessions() {
    if (sessionsById.size <= MAX_RETAINED_SESSIONS) return;

    const finished = [];
    for (const [id, session] of sessionsById.entries()) {
        if (session.status !== 'RUNNING') {
            finished.push({ id, startedAt: session.startedAt });
        }
    }

    finished.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    const excessCount = sessionsById.size - MAX_RETAINED_SESSIONS;
    for (let i = 0; i < Math.min(excessCount, finished.length); i++) {
        sessionsById.delete(finished[i].id);
    }
}

/**
 * Executes the sequential simulation loop across stages.
 * Runs in the background and updates session state on every step.
 *
 * @param {Object} session - Active simulation session
 * @param {Array<Object>} targetInterfaces - List of interfaces to process
 * @param {Object} entities - CDS entities { QueueSnapshots, Alerts, Interfaces }
 */
async function runSimulationLoop(session, targetInterfaces, entities) {
    const totalStages = session.totalStages;

    try {
        for (let stageIdx = 0; stageIdx < totalStages; stageIdx++) {
            if (session.status === 'CANCELLED') {
                break;
            }

            session.currentStage = stageIdx + 1;
            session.progressPercent = Math.round(((stageIdx + 1) / totalStages) * 100);

            // Execute stage across all target interfaces sequentially
            const stageResults = [];
            for (const iface of targetInterfaces) {
                if (session.status === 'CANCELLED') break;

                const stages = buildGradualStages(session.scenario, iface, {
                    totalStages: session.totalStages,
                    seed: session.seed,
                    stepIntervalMs: session.stepIntervalMs
                });
                const stageData = stages[stageIdx] || stages[stages.length - 1];
                session.stageName = stageData.stageName || stageData.name;

                // Defensive copy of synthetic metrics
                const snapshotData = {
                    interface_ID: iface.ID,
                    capturedAt: new Date().toISOString(),
                    pendingCount: stageData.metrics.pendingCount,
                    failedCount: stageData.metrics.failedCount,
                    retryAttempts: stageData.metrics.retryAttempts,
                    successCount: stageData.metrics.successCount,
                    oldestPendingAgeSeconds: stageData.metrics.oldestPendingAgeSeconds
                };

                try {
                    // Feed into the canonical ingestion pipeline (persists snapshot, runs detection rules)
                    const evalResult = await processSnapshotAndEvaluate(
                        entities,
                        iface,
                        snapshotData,
                        `Gradual [${session.scenario}] Stage ${stageIdx + 1}/${totalStages}`
                    );

                    stageResults.push({
                        interfaceId: iface.ID,
                        interfaceName: iface.name,
                        stageIndex: stageIdx,
                        stageName: stageData.stageName,
                        alertTriggered: evalResult.alertTriggered,
                        ruleCode: evalResult.ruleCode || null,
                        severity: evalResult.severity || null,
                        summary: evalResult.summary || null,
                        status: evalResult.status
                    });
                } catch (ifaceErr) {
                    console.error(`[GradualSimulator] Error processing ${iface.name} in stage ${stageIdx + 1}:`, ifaceErr.message);
                    stageResults.push({
                        interfaceId: iface.ID,
                        interfaceName: iface.name,
                        stageIndex: stageIdx,
                        stageName: stageData.stageName,
                        error: ifaceErr.message,
                        status: 'Error'
                    });
                }
            }

            session.results.push({
                stage: stageIdx + 1,
                stageName: session.stageName,
                timestamp: new Date().toISOString(),
                details: stageResults
            });

            session.message = `Stage ${stageIdx + 1}/${totalStages} (${session.stageName}) completed.`;

            // If not the final stage and not cancelled, await the configured delay
            if (stageIdx < totalStages - 1 && session.status !== 'CANCELLED') {
                await sleep(session.stepIntervalMs, session);
            }
        }

        if (session.status !== 'CANCELLED') {
            session.status = 'COMPLETED';
            session.completedAt = new Date().toISOString();
            session.message = `Gradual simulation [${session.scenario}] completed successfully through all ${totalStages} stages.`;
        }
    } catch (loopErr) {
        session.status = 'FAILED';
        session.completedAt = new Date().toISOString();
        session.error = loopErr.message || 'Simulation loop crashed';
        session.message = `Simulation failed at stage ${session.currentStage}: ${session.error}`;
        console.error(`[GradualSimulator] Session ${session.sessionId} failed:`, loopErr);
    } finally {
        activeSessionByInterface.delete(session.interfaceId);
        if (session.interfaceId === 'ALL') {
            for (const iface of targetInterfaces) {
                activeSessionByInterface.delete(iface.ID);
            }
        }
        delete session._currentTimer;
        delete session._timerResolver;
        evictOldSessions();
    }
}

/**
 * Starts a new gradual simulation session.
 *
 * @param {Object} options
 * @param {string} options.scenario - Scenario key
 * @param {string} [options.interfaceId='ALL'] - Interface UUID or 'ALL'
 * @param {number} [options.stepIntervalMs=2000] - Interval between stages in ms
 * @param {number} [options.totalStages] - Optional total stage count (e.g. 20)
 * @param {number} [options.seed] - Optional seed for deterministic PRNG jitter
 * @param {string} [options.user='Operator'] - Initiating user identity
 * @param {Array<Object>} options.targetInterfaces - Loaded interface entities
 * @param {Object} options.entities - CDS entities { QueueSnapshots, Alerts, Interfaces }
 * @returns {Object} Result { ok: boolean, conflict?: boolean, error?: string, session?: Object }
 */
function startGradualSimulation({
    scenario,
    interfaceId = 'ALL',
    stepIntervalMs = DEFAULT_STEP_INTERVAL_MS,
    totalStages,
    seed,
    user = 'Operator',
    targetInterfaces = [],
    entities
}) {
    // 1. Validate scenario
    if (!scenario || !ALLOWED_SCENARIOS.includes(scenario)) {
        return {
            ok: false,
            error: `Invalid scenario '${scenario}'. Allowed: ${ALLOWED_SCENARIOS.join(', ')}`
        };
    }

    if (!Array.isArray(targetInterfaces) || targetInterfaces.length === 0) {
        return {
            ok: false,
            error: 'No active target interfaces available for simulation'
        };
    }

    // 2. Validate interval
    const interval = typeof stepIntervalMs === 'number' && Number.isInteger(stepIntervalMs)
        ? Math.max(MIN_STEP_INTERVAL_MS, Math.min(stepIntervalMs, MAX_STEP_INTERVAL_MS))
        : DEFAULT_STEP_INTERVAL_MS;

    const targetKey = interfaceId === 'ALL' || !interfaceId ? 'ALL' : interfaceId;

    // 3. Conflict checks: prevent duplicate / overlapping simulations
    if (activeSessionByInterface.has('ALL')) {
        const activeId = activeSessionByInterface.get('ALL');
        const active = sessionsById.get(activeId);
        return {
            ok: false,
            conflict: true,
            error: `A landscape-wide simulation (${active?.scenario || 'ACTIVE'}) is already in progress (Session: ${activeId}).`
        };
    }

    if (targetKey === 'ALL' && activeSessionByInterface.size > 0) {
        return {
            ok: false,
            conflict: true,
            error: 'Cannot start a landscape-wide simulation while interface simulation(s) are actively running.'
        };
    }

    if (targetKey !== 'ALL' && activeSessionByInterface.has(targetKey)) {
        const activeId = activeSessionByInterface.get(targetKey);
        return {
            ok: false,
            conflict: true,
            error: `A simulation is already actively running on interface '${targetKey}' (Session: ${activeId}).`
        };
    }

    // 4. Resolve stage count and PRNG seed
    const resolvedStagesCount = (typeof totalStages === 'number' && totalStages >= 3)
        ? totalStages
        : (stepIntervalMs === 1000 ? 20 : (scenario === 'NORMAL' ? 3 : 5));

    const sessionSeed = seed !== undefined ? seed : hashSeed(interfaceId || scenario, 0x5EED);

    const sampleStages = buildGradualStages(scenario, targetInterfaces[0], {
        totalStages: resolvedStagesCount,
        seed: sessionSeed,
        stepIntervalMs: interval
    });
    const effectiveTotalStages = sampleStages.length;

    // 5. Create new session
    const sessionId = crypto.randomUUID();
    const session = {
        sessionId,
        scenario,
        interfaceId: targetKey,
        status: 'RUNNING',
        currentStage: 0,
        totalStages: effectiveTotalStages,
        seed: sessionSeed,
        stageName: sampleStages[0].stageName || sampleStages[0].name,
        progressPercent: 0,
        startedAt: new Date().toISOString(),
        completedAt: null,
        stepIntervalMs: interval,
        initiatedBy: user,
        error: null,
        message: `Simulation [${scenario}] started with ${effectiveTotalStages} progressive stages (${interval}ms interval).`,
        results: []
    };

    // 6. Register session
    sessionsById.set(sessionId, session);
    activeSessionByInterface.set(targetKey, sessionId);
    if (targetKey === 'ALL') {
        for (const iface of targetInterfaces) {
            activeSessionByInterface.set(iface.ID, sessionId);
        }
    }

    // 7. Kick off async loop in background without blocking caller
    setImmediate(() => {
        runSimulationLoop(session, targetInterfaces, entities);
    });

    return {
        ok: true,
        session: formatSessionOutput(session)
    };
}

/**
 * Cancels an active gradual simulation session.
 *
 * @param {string} sessionId
 * @returns {Object|null}
 */
function cancelSimulation(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return null;

    const session = sessionsById.get(sessionId);
    if (!session) return null;

    if (session.status === 'RUNNING') {
        session.status = 'CANCELLED';
        session.completedAt = new Date().toISOString();
        session.message = `Simulation cancelled by user at stage ${session.currentStage}/${session.totalStages}.`;

        if (session._currentTimer) {
            clearTimeout(session._currentTimer);
            if (typeof session._timerResolver === 'function') {
                session._timerResolver();
            }
        }

        activeSessionByInterface.delete(session.interfaceId);
    }

    return formatSessionOutput(session);
}

/**
 * Retrieves the status of a simulation session by ID or interface ID.
 *
 * @param {string} [sessionId]
 * @param {string} [interfaceId]
 * @returns {Object|null}
 */
function getSimulationStatus(sessionId, interfaceId) {
    if (sessionId && typeof sessionId === 'string' && sessionsById.has(sessionId)) {
        return formatSessionOutput(sessionsById.get(sessionId));
    }

    if (interfaceId && typeof interfaceId === 'string') {
        if (activeSessionByInterface.has(interfaceId)) {
            const activeId = activeSessionByInterface.get(interfaceId);
            return formatSessionOutput(sessionsById.get(activeId));
        }

        let latest = null;
        for (const session of sessionsById.values()) {
            if (session.interfaceId === interfaceId || session.interfaceId === 'ALL') {
                if (!latest || new Date(session.startedAt) > new Date(latest.startedAt)) {
                    latest = session;
                }
            }
        }
        if (latest) return formatSessionOutput(latest);
    }

    return null;
}

/**
 * Formats a session object for OData / API responses.
 */
function formatSessionOutput(session) {
    if (!session) return null;
    return {
        sessionId: session.sessionId,
        scenario: session.scenario,
        interfaceId: session.interfaceId,
        status: session.status,
        currentStage: session.currentStage,
        totalStages: session.totalStages,
        stageName: session.stageName || '',
        progressPercent: session.progressPercent || 0,
        startedAt: session.startedAt,
        completedAt: session.completedAt || '',
        error: session.error || '',
        message: session.message || ''
    };
}

/**
 * Resets simulation state (used in testing and database baseline reset).
 */
function resetSimulationState() {
    for (const session of sessionsById.values()) {
        if (session._currentTimer) {
            clearTimeout(session._currentTimer);
        }
    }
    sessionsById.clear();
    activeSessionByInterface.clear();
}

module.exports = {
    ALLOWED_SCENARIOS,
    DEFAULT_STEP_INTERVAL_MS,
    MIN_STEP_INTERVAL_MS,
    MAX_STEP_INTERVAL_MS,
    buildGradualStages,
    startGradualSimulation,
    cancelSimulation,
    getSimulationStatus,
    formatSessionOutput,
    resetSimulationState,
    createPRNG,
    normalizedSigmoid,
    generateCurvePoints,
    _internal: {
        sessionsById,
        activeSessionByInterface,
        createPRNG,
        normalizedSigmoid,
        generateCurvePoints,
        hashSeed,
        buildMilestoneStages
    }
};
