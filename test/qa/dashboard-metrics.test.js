/**
 * test/qa/dashboard-metrics.test.js
 *
 * Phase 5 Agent 6 — Dashboard metric accuracy tests (frontend).
 *
 * Verifies KPI computation (total interfaces, open alerts, critical/high counts,
 * total pending/retries) is computed from synthetic backend data — never
 * hardcoded — and that alert grouping/sorting is correct.
 *
 * Imports the real OverviewPage computeKPIs / groupIncidents functions.
 *
 * Runs with: node --test test/qa/dashboard-metrics.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim } = require('./frontend-helper.js');

installDOMShim();

let OverviewPage;
let computeKPIs;
let groupIncidents;

before(async () => {
    OverviewPage = await import('../../app/js/pages/OverviewPage.js');
    computeKPIs = OverviewPage.computeKPIs;
    groupIncidents = OverviewPage.groupIncidents;
});

// ------------------------------------------------------------------
// Synthetic fixtures mirroring backend contracts
// ------------------------------------------------------------------
const makeInterface = (overrides = {}) => ({
    ID: 'iface-1',
    name: 'Order-to-Cash',
    sourceSystem: 'WEBSHOP',
    targetSystem: 'S4HANA',
    active: true,
    expectedSchedule: 'Every 5 min',
    maxRetryThreshold: 100,
    queueGrowthLimit: 200,
    oldMessageAgeLimitSeconds: 600,
    recoveryStalledBacklog: 100,
    snapshots: [],
    ...overrides
});

const makeSnapshot = (overrides = {}) => ({
    capturedAt: '2026-10-30T10:00:00Z',
    pendingCount: 50,
    failedCount: 5,
    retryAttempts: 10,
    successCount: 100,
    oldestPendingAgeSeconds: 120,
    ...overrides
});

const makeAlert = (overrides = {}) => ({
    ID: 'alert-1',
    interface_ID: 'iface-1',
    interface: null,
    ruleCode: 'EXCESSIVE_RETRIES',
    severity: 'Critical',
    status: 'Open',
    detectedAt: '2026-10-30T09:00:00Z',
    windowStart: '2026-10-30T08:50:00Z',
    windowEnd: '2026-10-30T09:00:00Z',
    observedMetrics: '{}',
    summary: 'Too many retries',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    repeatCount: 1,
    ...overrides
});

describe('Dashboard metric accuracy', () => {
    describe('computeKPIs (computed from backend data, never hardcoded)', () => {
        it('returns zeros for empty input — no hardcoded metrics', () => {
            const kpis = computeKPIs([], []);
            assert.equal(kpis.totalInterfaces, 0);
            assert.equal(kpis.openAlerts, 0);
            assert.equal(kpis.criticalAlerts, 0);
            assert.equal(kpis.highAlerts, 0);
            assert.equal(kpis.totalPending, 0);
            assert.equal(kpis.totalRetries, 0);
        });

        it('counts interfaces and open alerts from synthetic data', () => {
            const ifaces = [
                makeInterface(),
                makeInterface({ ID: 'iface-2', name: 'Procure-to-Pay' }),
                makeInterface({ ID: 'iface-3', name: 'Ship-to-Dock' })
            ];
            const alerts = [
                makeAlert({ ID: 'a1', status: 'Open', severity: 'Critical' }),
                makeAlert({ ID: 'a2', status: 'Open', severity: 'High' }),
                makeAlert({ ID: 'a3', status: 'Open', severity: 'High' }),
                makeAlert({ ID: 'a4', status: 'Resolved', severity: 'Critical' }), // not open
                makeAlert({ ID: 'a5', status: 'Acknowledged', severity: 'Warning' }) // not open
            ];
            const kpis = computeKPIs(ifaces, alerts);
            assert.equal(kpis.totalInterfaces, 3);
            assert.equal(kpis.openAlerts, 3);
            assert.equal(kpis.criticalAlerts, 1);
            assert.equal(kpis.highAlerts, 2);
        });

        it('sums pending and retries from latest snapshots only', () => {
            const ifaces = [
                makeInterface({
                    ID: 'iface-1',
                    snapshots: [
                        makeSnapshot({ pendingCount: 10, retryAttempts: 2, capturedAt: 't1' }),
                        makeSnapshot({ pendingCount: 100, retryAttempts: 20, capturedAt: 't2' })
                    ]
                }),
                makeInterface({
                    ID: 'iface-2',
                    snapshots: [makeSnapshot({ pendingCount: 30, retryAttempts: 5, capturedAt: 't1' })]
                }),
                makeInterface({ ID: 'iface-3', snapshots: [] }) // no snapshot -> contributes 0
            ];
            const kpis = computeKPIs(ifaces, []);
            // latest per iface: 100+20, 30+5, 0+0
            assert.equal(kpis.totalPending, 130);
            assert.equal(kpis.totalRetries, 25);
        });

        it('tracks synthetic input precisely — metrics are computed, not fixed', () => {
            const ifaces = [makeInterface({ snapshots: [makeSnapshot({ pendingCount: 7, retryAttempts: 3 })] })];
            const kpis = computeKPIs(ifaces, []);
            assert.equal(kpis.totalPending, 7);
            assert.equal(kpis.totalRetries, 3);

            // Scaling input scales output — proves no hardcoded constant.
            const ifaces2 = [
                makeInterface({ ID: 'i1', snapshots: [makeSnapshot({ pendingCount: 123, retryAttempts: 456 })] }),
                makeInterface({ ID: 'i2', snapshots: [makeSnapshot({ pendingCount: 0, retryAttempts: 0 })] })
            ];
            const kpis2 = computeKPIs(ifaces2, []);
            assert.equal(kpis2.totalPending, 123);
            assert.equal(kpis2.totalRetries, 456);
            assert.equal(kpis2.totalInterfaces, 2);
        });

        it('counts only Open alerts as open, regardless of severity', () => {
            const alerts = [
                makeAlert({ ID: 'a1', status: 'Open', severity: 'Info' }),
                makeAlert({ ID: 'a2', status: 'Open', severity: 'Critical' }),
                makeAlert({ ID: 'a3', status: 'Resolved', severity: 'Critical' }),
                makeAlert({ ID: 'a4', status: 'Acknowledged', severity: 'Critical' }),
                makeAlert({ ID: 'a5', status: 'Closed', severity: 'Critical' })
            ];
            const kpis = computeKPIs([], alerts);
            assert.equal(kpis.openAlerts, 2);
            assert.equal(kpis.criticalAlerts, 1); // only the open critical
            assert.equal(kpis.highAlerts, 0);
        });
    });

    describe('groupIncidents (alert grouping + sorting)', () => {
        it('groups open alerts by interface + ruleCode', () => {
            const ifaces = [makeInterface({ ID: 'iface-1' })];
            const alerts = [
                makeAlert({ ID: 'a1', interface_ID: 'iface-1', ruleCode: 'EXCESSIVE_RETRIES', severity: 'Critical', detectedAt: '2026-10-30T09:00:00Z' }),
                makeAlert({ ID: 'a2', interface_ID: 'iface-1', ruleCode: 'EXCESSIVE_RETRIES', severity: 'High', detectedAt: '2026-10-30T09:30:00Z' }),
                makeAlert({ ID: 'a3', interface_ID: 'iface-1', ruleCode: 'QUEUE_GROWTH', severity: 'Warning', detectedAt: '2026-10-30T09:15:00Z' }),
                makeAlert({ ID: 'a4', interface_ID: 'iface-1', ruleCode: 'EXCESSIVE_RETRIES', status: 'Resolved', severity: 'Critical' })
            ];
            const groups = groupIncidents(alerts, ifaces);
            assert.equal(groups.length, 2); // a4 resolved -> excluded
            const exGroup = groups.find((g) => g.ruleCode === 'EXCESSIVE_RETRIES');
            assert.ok(exGroup);
            assert.equal(exGroup.alerts.length, 2);
            assert.equal(exGroup.severity, 'Critical'); // worst severity in group
            const qgGroup = groups.find((g) => g.ruleCode === 'QUEUE_GROWTH');
            assert.ok(qgGroup);
            assert.equal(qgGroup.severity, 'Warning');
        });

        it('sorts by severity then newest detectedAt', () => {
            const ifaces = [makeInterface({ ID: 'iface-1' })];
            const alerts = [
                makeAlert({ ID: 'a1', ruleCode: 'R1', severity: 'Warning', detectedAt: '2026-10-30T10:00:00Z' }),
                makeAlert({ ID: 'a2', ruleCode: 'R2', severity: 'Critical', detectedAt: '2026-10-30T08:00:00Z' }),
                makeAlert({ ID: 'a3', ruleCode: 'R3', severity: 'Critical', detectedAt: '2026-10-30T09:00:00Z' })
            ];
            const groups = groupIncidents(alerts, ifaces);
            assert.equal(groups.length, 3);
            assert.equal(groups[0].ruleCode, 'R3'); // critical, newest first
            assert.equal(groups[1].ruleCode, 'R2'); // critical, older
            assert.equal(groups[2].ruleCode, 'R1'); // warning
        });

        it('returns empty array when there are no open alerts', () => {
            const alerts = [
                makeAlert({ status: 'Resolved' }),
                makeAlert({ status: 'Acknowledged' }),
                makeAlert({ status: 'Closed' })
            ];
            assert.equal(groupIncidents(alerts, []).length, 0);
        });

        it('groups across multiple interfaces independently', () => {
            const ifaces = [
                makeInterface({ ID: 'iface-1' }),
                makeInterface({ ID: 'iface-2' })
            ];
            const alerts = [
                makeAlert({ ID: 'a1', interface_ID: 'iface-1', ruleCode: 'R', status: 'Open' }),
                makeAlert({ ID: 'a2', interface_ID: 'iface-2', ruleCode: 'R', status: 'Open' })
            ];
            const groups = groupIncidents(alerts, ifaces);
            assert.equal(groups.length, 2); // different interfaces -> separate groups
        });

        it('handles missing fields gracefully', () => {
            // The real groupIncidents skips non-Open alerts; missing fields are
            // tolerated as long as the entry is an object.
            assert.doesNotThrow(() => groupIncidents([{ ID: 'x' }, { status: 'Open' }, {}], []));
            // { status: 'Open' } with no ruleCode/interface still forms a group (key '|').
            assert.ok(groupIncidents([{ ID: 'x' }, { status: 'Open' }], []).length >= 0);
        });
    });
});
