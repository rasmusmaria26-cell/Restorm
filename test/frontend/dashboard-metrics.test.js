/**
 * test/frontend/dashboard-metrics.test.js
 *
 * Frontend metric-computation tests for the Dashboard & Analytics feature
 * (Agent 3). Uses node:test (no frontend test runner / build step).
 *
 * Covers:
 *   - computeKPIs: sums derived from synthetic backend data (not hardcoded)
 *   - groupIncidents: alert grouping by interface + ruleCode, severity sort
 *   - No hardcoded metrics: empty/all-zero input yields zero metrics
 *
 * The page modules import shared components that touch `document`, so a
 * minimal DOM shim is installed before dynamic import.
 */

// ------------------------------------------------------------------
// Minimal DOM shim so ES module imports of components resolve in node
// ------------------------------------------------------------------
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

function installDOMShim() {
    if (global.document) return;
    const el = (tag) => ({
        tag,
        children: [],
        setAttribute() {},
        appendChild(c) { this.children.push(c); return c; },
        replaceChildren() { this.children = []; },
        addEventListener() {},
        className: '',
        style: {},
        innerHTML: '',
        textContent: '',
        value: '',
        title: ''
    });
    const doc = {
        createElement: (tag) => el(tag),
        createElementNS: () => el('svg'),
        getElementById: () => null,
        head: { appendChild() {}, insertBefore() {} },
        body: { appendChild() {} },
        documentElement: { appendChild() {} },
        addEventListener() {},
        location: { hash: '' }
    };
    global.document = doc;
    global.window = { location: { hash: '' }, addEventListener() {}, dispatchEvent() {} };
    global.Element = function Element() {};
    global.Node = { ELEMENT_NODE: 1 };
    global.HTMLElement = function HTMLElement() {};
}

installDOMShim();

let OverviewPage;

before(async () => {
    OverviewPage = await import('../../app/js/pages/OverviewPage.js');
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

describe('OverviewPage metric computations', () => {
    describe('computeKPIs', () => {
        it('returns zeros for empty input (no hardcoded metrics)', () => {
            const kpis = OverviewPage.computeKPIs([], []);
            assert.equal(kpis.totalInterfaces, 0);
            assert.equal(kpis.openAlerts, 0);
            assert.equal(kpis.criticalAlerts, 0);
            assert.equal(kpis.highAlerts, 0);
            assert.equal(kpis.totalPending, 0);
            assert.equal(kpis.totalRetries, 0);
        });

        it('counts interfaces and open alerts', () => {
            const ifaces = [makeInterface(), makeInterface({ ID: 'iface-2', name: 'Procure-to-Pay' })];
            const alerts = [
                makeAlert({ ID: 'a1', status: 'Open', severity: 'Critical' }),
                makeAlert({ ID: 'a2', status: 'Open', severity: 'High' }),
                makeAlert({ ID: 'a3', status: 'Resolved', severity: 'Critical' })
            ];
            const kpis = OverviewPage.computeKPIs(ifaces, alerts);
            assert.equal(kpis.totalInterfaces, 2);
            assert.equal(kpis.openAlerts, 2);
            assert.equal(kpis.criticalAlerts, 1);
            assert.equal(kpis.highAlerts, 1);
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
                    snapshots: [
                        makeSnapshot({ pendingCount: 30, retryAttempts: 5, capturedAt: 't1' })
                    ]
                }),
                makeInterface({ ID: 'iface-3', snapshots: [] }) // no snapshot -> contributes 0
            ];
            const kpis = OverviewPage.computeKPIs(ifaces, []);
            // latest per iface: 100+20, 30+5, 0+0
            assert.equal(kpis.totalPending, 130);
            assert.equal(kpis.totalRetries, 25);
        });

        it('does not hardcode any metric value', () => {
            // With synthetic data producing known sums, verify output tracks
            // the input precisely — proving metrics are computed, not fixed.
            const ifaces = [makeInterface({ snapshots: [makeSnapshot({ pendingCount: 7, retryAttempts: 3 })] })];
            const kpis = OverviewPage.computeKPIs(ifaces, []);
            assert.equal(kpis.totalPending, 7);
            assert.equal(kpis.totalRetries, 3);
        });
    });

    describe('groupIncidents', () => {
        it('groups open alerts by interface + ruleCode', () => {
            const ifaces = [makeInterface({ ID: 'iface-1' })];
            const alerts = [
                makeAlert({ ID: 'a1', interface_ID: 'iface-1', ruleCode: 'EXCESSIVE_RETRIES', severity: 'Critical', detectedAt: '2026-10-30T09:00:00Z' }),
                makeAlert({ ID: 'a2', interface_ID: 'iface-1', ruleCode: 'EXCESSIVE_RETRIES', severity: 'High', detectedAt: '2026-10-30T09:30:00Z' }),
                makeAlert({ ID: 'a3', interface_ID: 'iface-1', ruleCode: 'QUEUE_GROWTH', severity: 'Warning', detectedAt: '2026-10-30T09:15:00Z' }),
                makeAlert({ ID: 'a4', interface_ID: 'iface-1', ruleCode: 'EXCESSIVE_RETRIES', status: 'Resolved', severity: 'Critical' })
            ];
            const groups = OverviewPage.groupIncidents(alerts, ifaces);
            // a4 is Resolved -> excluded; 3 open groups: 2 EXCESSIVE_RETRIES + 1 QUEUE_GROWTH
            assert.equal(groups.length, 2);
            const exGroup = groups.find(g => g.ruleCode === 'EXCESSIVE_RETRIES');
            assert.ok(exGroup);
            assert.equal(exGroup.alerts.length, 2);
            assert.equal(exGroup.severity, 'Critical'); // worst severity in group
            const qgGroup = groups.find(g => g.ruleCode === 'QUEUE_GROWTH');
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
            const groups = OverviewPage.groupIncidents(alerts, ifaces);
            assert.equal(groups.length, 3);
            // Criticals first; among criticals, newest (a3 at 09:00) before a2 (08:00)
            assert.equal(groups[0].ruleCode, 'R3');
            assert.equal(groups[1].ruleCode, 'R2');
            assert.equal(groups[2].ruleCode, 'R1');
        });

        it('returns empty array when there are no open alerts', () => {
            const alerts = [makeAlert({ status: 'Resolved' }), makeAlert({ status: 'Acknowledged' })];
            assert.equal(OverviewPage.groupIncidents(alerts, []).length, 0);
        });
    });
});
