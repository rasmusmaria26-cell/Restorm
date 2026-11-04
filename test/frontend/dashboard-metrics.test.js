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
    const el = (tag) => ({
        tag,
        children: [],
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; if (k === 'class') this.className = v; },
        getAttribute(k) { return this.attributes[k]; },
        appendChild(c) { this.children.push(c); return c; },
        append(...nodes) { for (const n of nodes) this.children.push(n); },
        replaceChildren() { this.children = []; },
        addEventListener() {},
        querySelectorAll(selector) {
            const res = [];
            const walk = (node) => {
                if (!node) return;
                if (selector.startsWith('.') && node.className && node.className.includes(selector.slice(1))) {
                    res.push(node);
                } else if (node.tag === selector) {
                    res.push(node);
                }
                for (const ch of (node.children || [])) walk(ch);
            };
            walk(this);
            return res;
        },
        querySelector(selector) {
            const list = this.querySelectorAll(selector);
            return list.length ? list[0] : null;
        },
        className: '',
        style: {},
        innerHTML: '',
        textContent: '',
        value: '',
        title: ''
    });

    if (!global.document) {
        const doc = {
            createElement: (tag) => el(tag),
            createElementNS: (ns, tag) => el(tag),
            getElementById: () => null,
            querySelectorAll: () => [],
            querySelector: () => null,
            head: { appendChild() {}, insertBefore() {} },
            body: { appendChild() {} },
            documentElement: { appendChild() {} },
            addEventListener() {},
            location: { hash: '' }
        };
        global.document = doc;
    } else {
        if (!global.document.createElementNS) {
            global.document.createElementNS = (ns, tag) => el(tag);
        }
    }

    if (!global.window) {
        global.window = {
            location: { hash: '' },
            addEventListener() {},
            dispatchEvent() {},
            matchMedia: () => ({ matches: false })
        };
    } else if (!global.window.matchMedia) {
        global.window.matchMedia = () => ({ matches: false });
    }

    if (!global.Element) global.Element = function Element() {};
    if (!global.Node) global.Node = { ELEMENT_NODE: 1 };
    if (!global.HTMLElement) global.HTMLElement = function HTMLElement() {};
}

installDOMShim();

let OverviewPage;
let SparklineMod;
let InterfaceDetailPage;
let appMod;

before(async () => {
    OverviewPage = await import('../../app/js/pages/OverviewPage.js');
    SparklineMod = await import('../../app/js/components/Sparkline.js');
    InterfaceDetailPage = await import('../../app/js/pages/InterfaceDetailPage.js');
    appMod = await import('../../app/app.js');
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

describe('20-Point Rolling Window Chart Contracts', () => {
    it('F1: Sparkline trims snapshots to at most 20 points (CHART_WINDOW_SIZE = 20)', () => {
        assert.equal(SparklineMod.CHART_WINDOW_SIZE, 20, 'CHART_WINDOW_SIZE must be exactly 20');

        // 1. Given 45 snapshots, Sparkline trims to latest 20 points
        const manySnapshots = Array.from({ length: 45 }, (_, i) => ({
            capturedAt: new Date(Date.now() - (45 - i) * 1000).toISOString(),
            pendingCount: 10 + i * 2,
            retryAttempts: 1 + i,
            failedCount: 0,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        }));

        const svg = SparklineMod.Sparkline({ snapshots: manySnapshots, limitValue: 200, width: 220, height: 40 });
        assert.ok(svg, 'Sparkline must return SVG element');

        const polyline = svg.children.find(c => c.getAttribute('class') === 'sparkline-polyline-live');
        assert.ok(polyline, 'Sparkline must contain live polyline');
        const pointsStr = polyline.getAttribute('points').trim();
        const coords = pointsStr.split(/\s+/);
        assert.equal(coords.length, 20, 'Polyline points count must be exactly sliced to 20 points');

        // Latest highlight dot exists and reflects the latest (45th) snapshot
        const dot = svg.children.find(c => c.getAttribute('class') === 'sparkline-dot-latest');
        assert.ok(dot, 'Highlight dot must exist for latest snapshot point');
        const lastCoord = coords[coords.length - 1].split(',');
        assert.equal(dot.getAttribute('cx'), lastCoord[0]);
        assert.equal(dot.getAttribute('cy'), lastCoord[1]);

        // 2. Given <= 20 snapshots (e.g. 5 snapshots), Sparkline preserves all 5 points
        const fewSnapshots = manySnapshots.slice(0, 5);
        const svgFew = SparklineMod.Sparkline({ snapshots: fewSnapshots, limitValue: 200 });
        const polylineFew = svgFew.children.find(c => c.getAttribute('class') === 'sparkline-polyline-live');
        const coordsFew = polylineFew.getAttribute('points').trim().split(/\s+/);
        assert.equal(coordsFew.length, 5, 'Polyline preserves all points when snapshot count is <= 20');

        // 3. Given 0 snapshots, Sparkline renders flat baseline line
        const svgEmpty = SparklineMod.Sparkline({ snapshots: [], limitValue: 200 });
        const baseLine = svgEmpty.children.find(c => c.tag === 'line');
        assert.ok(baseLine, 'Empty snapshots must render flat baseline line');
    });

    it('F2: OverviewPage backlog trend card trims snapshot points to at most 20 points', async () => {
        const container = document.createElement('div');
        const manySnapshots = Array.from({ length: 45 }, (_, i) => ({
            snapshotTime: `T-${45 - i}`,
            pendingCount: 10 + i * 2,
            retryAttempts: 1 + i,
            failedCount: 0,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        }));

        const ifaces = [
            makeInterface({ ID: 'iface-1', name: 'Order Processing', snapshots: manySnapshots }),
            makeInterface({ ID: 'iface-2', name: 'Billing Integration', snapshots: manySnapshots })
        ];

        OverviewPage.render(container, {
            api: {
                fetchInterfaces: async () => ({ value: ifaces }),
                fetchAlerts: async () => ({ value: [] })
            }
        });

        // Allow async load to complete
        await new Promise(r => setTimeout(r, 25));

        const trendCards = container.querySelectorAll('.trend-chart-card');
        assert.equal(trendCards.length, 1, 'OverviewPage must render trend-chart-card');
        const circles = trendCards[0].innerHTML.match(/<circle/g);
        assert.ok(circles, 'Trend chart must contain point circles');
        assert.equal(circles.length, 20, 'Trend chart circles must be strictly bounded to latest 20 points');
    });

    it('F3: InterfaceDetailPage history chart trims snapshot points to at most 20 points', async () => {
        const container = document.createElement('div');
        const manySnapshots = Array.from({ length: 45 }, (_, i) => ({
            snapshotTime: `T-${45 - i}`,
            pendingCount: 10 + i * 2,
            retryAttempts: 1 + i,
            failedCount: 0,
            successCount: 100,
            oldestPendingAgeSeconds: 10
        }));

        const ifaces = [
            makeInterface({ ID: 'iface-1', name: 'Order Processing', snapshots: manySnapshots })
        ];

        InterfaceDetailPage.render(container, {
            params: { id: 'iface-1' },
            userRoles: ['SupportViewer'],
            currentUser: 'alice',
            api: {
                fetchInterfaces: async () => ({ value: ifaces }),
                fetchAlerts: async () => ({ value: [] })
            }
        });

        await new Promise(r => setTimeout(r, 25));

        const svgList = container.querySelectorAll('.history-svg');
        assert.ok(svgList.length >= 1, 'InterfaceDetailPage must render .history-svg');
        const polylines = svgList[0].children.filter(c => c.tag === 'polyline');
        assert.ok(polylines.length >= 1, 'History chart must contain polylines');
        const points = polylines[0].getAttribute('points').trim().split(/\s+/);
        assert.equal(points.length, 20, 'History chart polylines must be strictly bounded to latest 20 points');
    });
});

describe('Predictive Warning Status Contracts (getInterfaceStatus)', () => {
    const baseInterface = {
        ID: 'iface-1',
        name: 'Order-to-Cash',
        maxRetryThreshold: 100,
        queueGrowthLimit: 200,
        oldMessageAgeLimitSeconds: 600
    };

    it('F4: getInterfaceStatus returns "predictive-warning" when metrics enter 70% threshold warning zone', () => {
        // Warning zone via retryAttempts (70% of 100 = 70)
        const ifaceRetryWarning = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 70, pendingCount: 20, oldestPendingAgeSeconds: 30 })]
        };
        assert.equal(OverviewPage.getInterfaceStatus(ifaceRetryWarning), 'predictive-warning');

        // Warning zone via pendingCount (70% of 200 = 140)
        const ifaceQueueWarning = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 10, pendingCount: 140, oldestPendingAgeSeconds: 30 })]
        };
        assert.equal(OverviewPage.getInterfaceStatus(ifaceQueueWarning), 'predictive-warning');

        // Warning zone via oldestPendingAgeSeconds (70% of 600 = 420)
        const ifaceAgeWarning = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 10, pendingCount: 20, oldestPendingAgeSeconds: 420 })]
        };
        assert.equal(OverviewPage.getInterfaceStatus(ifaceAgeWarning), 'predictive-warning');

        // Warning zone via linked open alert with Warning severity
        const ifaceCleanMetrics = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 5, pendingCount: 10, oldestPendingAgeSeconds: 15 })]
        };
        const warningAlert = makeAlert({ interface_ID: 'iface-1', severity: 'Warning', status: 'Open' });
        assert.equal(OverviewPage.getInterfaceStatus(ifaceCleanMetrics, [warningAlert]), 'predictive-warning');
    });

    it('F5: getInterfaceStatus clearly distinguishes predictive-warning from confirmed incidents and healthy state', () => {
        // Confirmed Critical incident: retries exceed 100
        const ifaceCriticalRetries = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 100, pendingCount: 50, oldestPendingAgeSeconds: 100 })]
        };
        assert.equal(OverviewPage.getInterfaceStatus(ifaceCriticalRetries), 'critical');

        // Confirmed Critical incident via open Critical alert
        const criticalAlert = makeAlert({ interface_ID: 'iface-1', severity: 'Critical', status: 'Open' });
        assert.equal(OverviewPage.getInterfaceStatus(baseInterface, [criticalAlert]), 'critical');

        // Confirmed High incident: pending queue exceeds 200
        const ifaceHighPending = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 50, pendingCount: 200, oldestPendingAgeSeconds: 100 })]
        };
        assert.equal(OverviewPage.getInterfaceStatus(ifaceHighPending), 'high');

        // Confirmed High incident: oldest message age exceeds 600
        const ifaceHighAge = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 50, pendingCount: 50, oldestPendingAgeSeconds: 600 })]
        };
        assert.equal(OverviewPage.getInterfaceStatus(ifaceHighAge), 'high');

        // Confirmed High incident via open High alert
        const highAlert = makeAlert({ interface_ID: 'iface-1', severity: 'High', status: 'Open' });
        assert.equal(OverviewPage.getInterfaceStatus(baseInterface, [highAlert]), 'high');

        // Healthy state: metrics strictly below 70% warning zone
        const ifaceHealthy = {
            ...baseInterface,
            snapshots: [makeSnapshot({ retryAttempts: 30, pendingCount: 80, oldestPendingAgeSeconds: 150 })]
        };
        assert.equal(OverviewPage.getInterfaceStatus(ifaceHealthy), 'healthy');

        // Interface without snapshots defaults to healthy
        assert.equal(OverviewPage.getInterfaceStatus({ ...baseInterface, snapshots: [] }), 'healthy');
    });
});

describe('Frontend Simulation Polling & Animation Configuration Contracts', () => {
    it('F6: app.js exports SIMULATION_POLL_INTERVAL_MS = 500 ms', () => {
        assert.equal(
            appMod.SIMULATION_POLL_INTERVAL_MS,
            500,
            'Frontend simulation polling cadence must be exactly 500 ms for responsive updates'
        );
    });

    it('F7: KPI counter animation duration is configured in OverviewPage (350-400ms range)', () => {
        assert.equal(typeof OverviewPage.animateCounter, 'function');
        const src = OverviewPage.animateCounter.toString();
        const match = src.match(/duration\s*=\s*(\d+)/);
        assert.ok(match, 'animateCounter must define default duration parameter');
        const duration = Number(match[1]);
        assert.ok(
            duration >= 350 && duration <= 400,
            `KPI counter animation duration (${duration}ms) must be between 350ms and 400ms`
        );
        assert.equal(duration, 380, 'Default duration is set to 380ms');
    });
});

