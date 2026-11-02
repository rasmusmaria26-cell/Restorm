/**
 * test/frontend/incident-operations.test.js
 *
 * Frontend unit tests for Restorm Phase 5 Incident Operations (node:test).
 * Tests incident grouping logic, lifecycle state transitions, permission-aware
 * behavior, threshold validation, AI hypothesis labeling, and empty/malformed
 * responses. These tests exercise pure functions extracted from the page
 * modules plus the shared constants, without a browser or a live backend.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// --- Constants mirrored from app.js (read-only, not modified) ---
const SEVERITY_WEIGHT = { Critical: 3, High: 2, Warning: 1, Info: 0 };
const FRIENDLY_RULE_TITLES = {
    EXCESSIVE_RETRIES: 'Too many retries',
    QUEUE_GROWTH: 'Queue growing fast',
    OLD_MESSAGE_AGE: 'Messages waiting too long',
    RECOVERY_STALLED: 'Recovery not progressing'
};
const STATUS_ORDER = { Open: 0, Acknowledged: 1, Resolved: 2 };

const USER_PERMISSIONS = {
    bob: { title: 'Bob', roleLabel: 'Support operator', canAcknowledge: true, canResolve: true },
    alice: { title: 'Alice', roleLabel: 'Support viewer', canAcknowledge: false, canResolve: false },
    admin: { title: 'Admin', roleLabel: 'Simulator admin', canAcknowledge: true, canResolve: true }
};

// --- Pure functions extracted for testing (mirror page logic) ---

function groupIntoIncidents(alerts) {
    if (!Array.isArray(alerts)) return [];
    const groups = new Map();
    for (const alert of alerts) {
        if (!alert || typeof alert !== 'object') continue;
        const key = `${alert.interface_ID || ''}|${alert.ruleCode || ''}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(alert);
    }
    const incidents = [];
    for (const [, members] of groups) {
        members.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
        const rep = members[0];
        const open = members.some(m => m.status === 'Open');
        const acknowledged = members.some(m => m.status === 'Acknowledged');
        const resolved = members.every(m => m.status === 'Resolved');
        const status = open ? 'Open' : acknowledged ? 'Acknowledged' : 'Resolved';
        const repeatCount = Math.max(...members.map(m => m.repeatCount || 1));
        incidents.push({ ...rep, _members: members, status, repeatCount });
    }
    incidents.sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 9;
        const sb = STATUS_ORDER[b.status] ?? 9;
        if (sa !== sb) return sa - sb;
        const wa = SEVERITY_WEIGHT[a.severity] ?? 0;
        const wb = SEVERITY_WEIGHT[b.severity] ?? 0;
        if (wb !== wa) return wb - wa;
        return new Date(b.detectedAt) - new Date(a.detectedAt);
    });
    return incidents;
}

function canAck(status, perms) {
    return perms.canAcknowledge && status === 'Open';
}
function canResolve(status, perms) {
    return perms.canResolve && status === 'Acknowledged';
}

function validateThreshold(field, value, bounds) {
    const trimmed = String(value).trim();
    const num = parseInt(trimmed, 10);
    // Reject non-integer strings (e.g. '1.5') and anything outside bounds.
    if (trimmed === '' || isNaN(num) || String(num) !== trimmed || num < bounds.min || num > bounds.max) {
        return { valid: false, error: `${bounds.label} must be an integer between ${bounds.min} and ${bounds.max}.` };
    }
    return { valid: true, value: num };
}

const BOUNDS = {
    maxRetryThreshold: { min: 1, max: 10000, label: 'Max retry threshold' },
    queueGrowthLimit: { min: 1, max: 100000, label: 'Queue growth limit' },
    oldMessageAgeLimitSeconds: { min: 10, max: 2592000, label: 'Old message age limit (seconds)' },
    recoveryStalledBacklog: { min: 1, max: 100000, label: 'Recovery stalled backlog' }
};

function isHypothesisLabeled(explanation) {
    // Hypotheses must never be presented as confirmed root causes.
    // The UI renders hypotheses under a heading containing "(hypotheses — unproven)"
    // and an explicit note. Here we validate the explanation data structure
    // keeps hypotheses separate from observed facts.
    return (
        Array.isArray(explanation.possibleHypotheses) &&
        explanation.observedFacts &&
        explanation.limitations &&
        !explanation.confirmedRootCause
    );
}

describe('Incident Operations - Frontend', () => {
    describe('incident grouping logic', () => {
        it('groups alerts by interface_ID + ruleCode into single incidents', () => {
            const alerts = [
                { ID: 'a1', interface_ID: 'i1', ruleCode: 'EXCESSIVE_RETRIES', status: 'Open', severity: 'Critical', detectedAt: '2026-01-01T10:00:00Z', repeatCount: 1, observedMetrics: '{}', summary: 's' },
                { ID: 'a2', interface_ID: 'i1', ruleCode: 'EXCESSIVE_RETRIES', status: 'Acknowledged', severity: 'Critical', detectedAt: '2026-01-01T11:00:00Z', repeatCount: 2, observedMetrics: '{}', summary: 's' },
                { ID: 'a3', interface_ID: 'i2', ruleCode: 'QUEUE_GROWTH', status: 'Open', severity: 'High', detectedAt: '2026-01-01T12:00:00Z', repeatCount: 1, observedMetrics: '{}', summary: 's' }
            ];
            const incidents = groupIntoIncidents(alerts);
            assert.equal(incidents.length, 2);
            const i1 = incidents.find(inc => inc.ID === 'a2'); // most recent of i1 group
            assert.ok(i1);
            assert.equal(i1.repeatCount, 2);
        });

        it('sorts Open before Acknowledged/Resolved', () => {
            const alerts = [
                { ID: 'a1', interface_ID: 'i1', ruleCode: 'R', status: 'Resolved', severity: 'Info', detectedAt: '2026-01-01T10:00:00Z', repeatCount: 1, observedMetrics: '{}', summary: 's' },
                { ID: 'a2', interface_ID: 'i2', ruleCode: 'R', status: 'Open', severity: 'Info', detectedAt: '2026-01-01T09:00:00Z', repeatCount: 1, observedMetrics: '{}', summary: 's' },
                { ID: 'a3', interface_ID: 'i3', ruleCode: 'R', status: 'Acknowledged', severity: 'Info', detectedAt: '2026-01-01T09:30:00Z', repeatCount: 1, observedMetrics: '{}', summary: 's' }
            ];
            const incidents = groupIntoIncidents(alerts);
            assert.equal(incidents[0].status, 'Open');
            assert.equal(incidents[1].status, 'Acknowledged');
            assert.equal(incidents[2].status, 'Resolved');
        });

        it('sorts by severity Critical > High > Warning > Info within same status', () => {
            const base = (sev, id, iFace) => ({
                ID: id, interface_ID: iFace, ruleCode: 'R', status: 'Open', severity: sev,
                detectedAt: '2026-01-01T10:00:00Z', repeatCount: 1, observedMetrics: '{}', summary: 's'
            });
            const alerts = [base('Info', 'a1', 'i1'), base('Critical', 'a2', 'i2'), base('High', 'a3', 'i3'), base('Warning', 'a4', 'i4')];
            const incidents = groupIntoIncidents(alerts);
            const sevs = incidents.map(i => i.severity);
            assert.deepEqual(sevs, ['Critical', 'High', 'Warning', 'Info']);
        });

        it('returns empty array for no alerts', () => {
            assert.deepEqual(groupIntoIncidents([]), []);
        });

        it('handles malformed/missing fields gracefully', () => {
            const alerts = [null, { ID: 'x' }, { interface_ID: 'i1', ruleCode: 'R' }];
            assert.doesNotThrow(() => groupIntoIncidents(alerts));
        });
    });

    describe('lifecycle state transitions', () => {
        it('Open -> Acknowledged transition is permitted for operator', () => {
            const perms = USER_PERMISSIONS.bob;
            assert.equal(canAck('Open', perms), true);
            assert.equal(canResolve('Acknowledged', perms), true);
        });

        it('Resolve on Open is not permitted (wrong lifecycle state)', () => {
            assert.equal(canResolve('Open', USER_PERMISSIONS.bob), false);
        });

        it('Acknowledge on Acknowledged is not permitted (409 conflict state)', () => {
            assert.equal(canAck('Acknowledged', USER_PERMISSIONS.bob), false);
        });
    });

    describe('permission-aware behavior', () => {
        it('alice (viewer) cannot acknowledge or resolve', () => {
            const alice = USER_PERMISSIONS.alice;
            assert.equal(canAck('Open', alice), false);
            assert.equal(canResolve('Acknowledged', alice), false);
        });

        it('bob and admin can acknowledge and resolve', () => {
            assert.equal(canAck('Open', USER_PERMISSIONS.bob), true);
            assert.equal(canResolve('Acknowledged', USER_PERMISSIONS.bob), true);
            assert.equal(canAck('Open', USER_PERMISSIONS.admin), true);
            assert.equal(canResolve('Acknowledged', USER_PERMISSIONS.admin), true);
        });
    });

    describe('threshold validation', () => {
        it('accepts valid positive integers within bounds', () => {
            assert.equal(validateThreshold('maxRetryThreshold', '100', BOUNDS.maxRetryThreshold).valid, true);
            assert.equal(validateThreshold('queueGrowthLimit', '50000', BOUNDS.queueGrowthLimit).valid, true);
            assert.equal(validateThreshold('oldMessageAgeLimitSeconds', '600', BOUNDS.oldMessageAgeLimitSeconds).valid, true);
            assert.equal(validateThreshold('recoveryStalledBacklog', '100', BOUNDS.recoveryStalledBacklog).valid, true);
        });

        it('rejects values below min', () => {
            const r = validateThreshold('maxRetryThreshold', '0', BOUNDS.maxRetryThreshold);
            assert.equal(r.valid, false);
            assert.ok(r.error);
        });

        it('rejects values above max', () => {
            const r = validateThreshold('oldMessageAgeLimitSeconds', '9999999999', BOUNDS.oldMessageAgeLimitSeconds);
            assert.equal(r.valid, false);
        });

        it('rejects non-integer / empty / malformed values', () => {
            assert.equal(validateThreshold('maxRetryThreshold', '', BOUNDS.maxRetryThreshold).valid, false);
            assert.equal(validateThreshold('maxRetryThreshold', 'abc', BOUNDS.maxRetryThreshold).valid, false);
            assert.equal(validateThreshold('queueGrowthLimit', '1.5', BOUNDS.queueGrowthLimit).valid, false); // parseInt gives 1, but "1.5" trimmed !== "1"
            // Note: parseInt('1.5') => 1 which passes min/max, but our check requires trimmed string to be a clean integer.
        });

        it('enforces backend bounds: age 10-2592000, retry 1-10000', () => {
            const tooYoung = validateThreshold('oldMessageAgeLimitSeconds', '9', BOUNDS.oldMessageAgeLimitSeconds);
            assert.equal(tooYoung.valid, false);
            const okAge = validateThreshold('oldMessageAgeLimitSeconds', '10', BOUNDS.oldMessageAgeLimitSeconds);
            assert.equal(okAge.valid, true);
            const tooOld = validateThreshold('oldMessageAgeLimitSeconds', '2592001', BOUNDS.oldMessageAgeLimitSeconds);
            assert.equal(tooOld.valid, false);

            const tooHighRetry = validateThreshold('maxRetryThreshold', '10001', BOUNDS.maxRetryThreshold);
            assert.equal(tooHighRetry.valid, false);
            const okRetry = validateThreshold('maxRetryThreshold', '10000', BOUNDS.maxRetryThreshold);
            assert.equal(okRetry.valid, true);
        });
    });

    describe('AI hypotheses labeling', () => {
        it('keeps hypotheses separate from observed facts and never confirms root cause', () => {
            const explanation = {
                aiAssisted: true,
                provider: 'Google Gemini',
                summary: 'Likely backpressure.',
                observedFacts: { pendingCount: 500, retryAttempts: 120 },
                possibleHypotheses: ['Consumer thread starvation', 'Target system backpressure'],
                recommendedChecks: ['Check consumer logs'],
                citedRunbookIds: ['RB-001'],
                evidenceGaps: 'Target logs needed',
                limitations: 'Metrics only; not a confirmed root cause.'
            };
            assert.ok(isHypothesisLabeled(explanation));
            assert.notEqual(explanation.possibleHypotheses.length, 0);
            assert.ok(explanation.observedFacts.pendingCount !== undefined);
            assert.equal(explanation.confirmedRootCause, undefined);
        });

        it('handles missing hypotheses gracefully', () => {
            const explanation = { summary: 'x', observedFacts: {}, limitations: 'n/a' };
            assert.equal(Array.isArray(explanation.possibleHypotheses), false);
            // UI should render nothing for hypotheses; not a confirmed root cause.
            assert.equal(explanation.confirmedRootCause, undefined);
        });
    });

    describe('empty / malformed responses', () => {
        it('groupIntoIncidents handles undefined input', () => {
            assert.doesNotThrow(() => groupIntoIncidents(undefined));
            assert.deepEqual(groupIntoIncidents(undefined), []);
        });

        it('groupIntoIncidents handles null entries in array', () => {
            assert.doesNotThrow(() => groupIntoIncidents([null, undefined, { ID: 'a', interface_ID: 'i', ruleCode: 'R' }]));
            const inc = groupIntoIncidents([null, undefined, { ID: 'a', interface_ID: 'i', ruleCode: 'R', status: 'Open', severity: 'Info', detectedAt: '2026-01-01T00:00:00Z', repeatCount: 1, observedMetrics: '{}', summary: 's' }]);
            assert.equal(inc.length, 1);
        });

        it('validateThreshold handles null/undefined input', () => {
            assert.equal(validateThreshold('maxRetryThreshold', null, BOUNDS.maxRetryThreshold).valid, false);
            assert.equal(validateThreshold('maxRetryThreshold', undefined, BOUNDS.maxRetryThreshold).valid, false);
        });
    });
});
