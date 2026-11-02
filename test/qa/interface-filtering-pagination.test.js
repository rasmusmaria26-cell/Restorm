/**
 * test/qa/interface-filtering-pagination.test.js
 *
 * Phase 5 Agent 6 — Interface filtering and pagination tests (frontend).
 *
 * Renders the real InterfaceInventoryPage against a mocked backend and verifies
 * filtering by status / source / target, column sorting, and result bounds.
 * No browser; uses the shared DOM shim + mock fetch.
 *
 * Runs with: node --test test/qa/interface-filtering-pagination.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim, mockFetch, flush } = require('./frontend-helper.js');

installDOMShim();

let InterfaceInventoryPage;
before(async () => {
    InterfaceInventoryPage = await import('../../app/js/pages/InterfaceInventoryPage.js');
});

// Status is computed from latest snapshot vs thresholds:
//   pending >= 200 || retry >= 100 || age >= 600  -> critical
//   pending >= 140 || retry >= 70  || age >= 420  -> high
//   otherwise                                     -> healthy
function makeInterface(overrides = {}) {
    return {
        ID: 'iface-1',
        name: 'Alpha Interface',
        sourceSystem: 'WEBSHOP',
        targetSystem: 'S4HANA',
        active: true,
        expectedSchedule: 'Continuous',
        maxRetryThreshold: 100,
        queueGrowthLimit: 200,
        oldMessageAgeLimitSeconds: 600,
        recoveryStalledBacklog: 100,
        snapshots: [],
        ...overrides
    };
}

function snapshot(overrides = {}) {
    return {
        capturedAt: '2026-10-30T10:00:00Z',
        pendingCount: 10,
        failedCount: 0,
        retryAttempts: 1,
        successCount: 100,
        oldestPendingAgeSeconds: 30,
        ...overrides
    };
}

function strip(html) {
    return String(html).replace(/<[^>]*>/g, ' ');
}

async function renderWith(ifaces, alerts = []) {
    const restore = mockFetch([
        { match: '/Interfaces', response: { value: ifaces } },
        { match: '/Alerts', response: { value: alerts } }
    ]);
    const container = document.createElement('div');
    const cleanup = InterfaceInventoryPage.render(container, {
        api: {
            fetchInterfaces: () => fetch('/odata/v4/monitoring/Interfaces').then((r) => r.json()),
            fetchAlerts: () => fetch('/odata/v4/monitoring/Alerts').then((r) => r.json())
        }
    });
    await flush();
    await flush();
    return { container, cleanup, restore };
}

function rowCount(container) {
    return container.querySelectorAll('tbody tr').length;
}

function listedCount(container) {
    const m = container.textContent.match(/(\d+) interface[s]? listed/);
    return m ? parseInt(m[1], 10) : null;
}

describe('Interface filtering, sorting and bounds', () => {
    it('renders all interfaces when no filter is applied', async () => {
        const ifaces = [
            makeInterface({ ID: 'i1', name: 'Zeta', snapshots: [snapshot({ pendingCount: 250 })] }), // critical
            makeInterface({ ID: 'i2', name: 'Alpha', snapshots: [snapshot({ pendingCount: 150 })] }), // high
            makeInterface({ ID: 'i3', name: 'Beta', snapshots: [snapshot({ pendingCount: 10 })] }),   // healthy
            makeInterface({ ID: 'i4', name: 'Gamma', snapshots: [] })                                 // healthy
        ];
        const { container, cleanup, restore } = await renderWith(ifaces);
        try {
            assert.equal(rowCount(container), 4);
            assert.equal(listedCount(container), 4);
        } finally {
            cleanup();
            restore();
        }
    });

    it('filters by status (critical / high / healthy)', async () => {
        const ifaces = [
            makeInterface({ ID: 'i1', snapshots: [snapshot({ pendingCount: 250 })] }), // critical
            makeInterface({ ID: 'i2', snapshots: [snapshot({ pendingCount: 150 })] }), // high
            makeInterface({ ID: 'i3', snapshots: [snapshot({ pendingCount: 10 })] }),   // healthy
            makeInterface({ ID: 'i4', snapshots: [snapshot({ pendingCount: 10 })] })    // healthy
        ];
        const { container, cleanup, restore } = await renderWith(ifaces);
        try {
            const statusSelect = container.querySelector('select');
            assert.ok(statusSelect, 'status filter select must exist');

            statusSelect.value = 'critical';
            statusSelect.dispatchEvent(new Event('change'));
            await flush();
            await flush();
            assert.equal(rowCount(container), 1);
            assert.equal(listedCount(container), 1);

            statusSelect.value = 'high';
            statusSelect.dispatchEvent(new Event('change'));
            await flush();
            assert.equal(rowCount(container), 1);
            assert.equal(listedCount(container), 1);

            statusSelect.value = 'healthy';
            statusSelect.dispatchEvent(new Event('change'));
            await flush();
            assert.equal(rowCount(container), 2);
            assert.equal(listedCount(container), 2);

            statusSelect.value = 'all';
            statusSelect.dispatchEvent(new Event('change'));
            await flush();
            assert.equal(rowCount(container), 4);
            assert.equal(listedCount(container), 4);
        } finally {
            cleanup();
            restore();
        }
    });

    it('filter by status that matches nothing returns zero rows (bounds)', async () => {
        const ifaces = [
            makeInterface({ ID: 'i1', snapshots: [snapshot({ pendingCount: 10 })] }) // healthy
        ];
        const { container, cleanup, restore } = await renderWith(ifaces);
        try {
            const statusSelect = container.querySelector('select');
            statusSelect.value = 'critical';
            statusSelect.dispatchEvent(new Event('change'));
            await flush();
            await flush();
            // Filtering to a non-existent status yields zero listed rows (a single
            // placeholder row is rendered) and the empty message is shown.
            assert.equal(listedCount(container), 0);
            assert.ok(/No interfaces match/i.test(container.textContent));
        } finally {
            cleanup();
            restore();
        }
    });

    it('filters by text (name / source / target)', async () => {
        const ifaces = [
            makeInterface({ ID: 'i1', name: 'Order-to-Cash', sourceSystem: 'WEBSHOP', targetSystem: 'S4HANA' }),
            makeInterface({ ID: 'i2', name: 'Invoice Outbound', sourceSystem: 'S4HANA', targetSystem: 'PAYGATE' }),
            makeInterface({ ID: 'i3', name: 'Inventory Replication', sourceSystem: 'WMS', targetSystem: 'CPI' })
        ];
        const { container, cleanup, restore } = await renderWith(ifaces);
        try {
            const input = container.querySelector('input');
            assert.ok(input, 'text filter input must exist');

            input.value = 'S4HANA';
            input.dispatchEvent(new Event('input'));
            await flush();
            await flush();
            assert.equal(rowCount(container), 2); // WEBSHOP->S4HANA and S4HANA->PAYGATE

            input.value = 'CPI';
            input.dispatchEvent(new Event('input'));
            await flush();
            assert.equal(rowCount(container), 1);

            input.value = '';
            input.dispatchEvent(new Event('input'));
            await flush();
            assert.equal(rowCount(container), 3);
        } finally {
            cleanup();
            restore();
        }
    });

    it('sorts by column (name ascending then descending)', async () => {
        const ifaces = [
            makeInterface({ ID: 'i1', name: 'Zeta Interface' }),
            makeInterface({ ID: 'i2', name: 'Alpha Interface' }),
            makeInterface({ ID: 'i3', name: 'Mid Interface' })
        ];
        const { container, cleanup, restore } = await renderWith(ifaces);
        try {
            const headers = container.querySelectorAll('th');
            const nameHeader = headers[0];
            assert.ok(nameHeader, 'name column header must exist');

            // Default sort is ascending by name.
            let rows = container.querySelectorAll('tbody tr');
            assert.equal(rows.length, 3);
            assert.equal(strip(rows[0].querySelector('td').textContent).trim(), 'Alpha Interface');
            assert.equal(strip(rows[2].querySelector('td').textContent).trim(), 'Zeta Interface');

            // Click -> descending.
            nameHeader.dispatchEvent(new Event('click'));
            await flush();
            await flush();
            rows = container.querySelectorAll('tbody tr');
            assert.equal(strip(rows[0].querySelector('td').textContent).trim(), 'Zeta Interface');
            assert.equal(strip(rows[2].querySelector('td').textContent).trim(), 'Alpha Interface');

            // Click again -> ascending.
            nameHeader.dispatchEvent(new Event('click'));
            await flush();
            rows = container.querySelectorAll('tbody tr');
            assert.equal(strip(rows[0].querySelector('td').textContent).trim(), 'Alpha Interface');
        } finally {
            cleanup();
            restore();
        }
    });

    it('sorts by source and target columns', async () => {
        const ifaces = [
            makeInterface({ ID: 'i1', name: 'A', sourceSystem: 'ZZZ', targetSystem: 'AAA' }),
            makeInterface({ ID: 'i2', name: 'B', sourceSystem: 'AAA', targetSystem: 'ZZZ' })
        ];
        const { container, cleanup, restore } = await renderWith(ifaces);
        try {
            const headers = container.querySelectorAll('th');
            // source is index 1, target is index 2.
            headers[1].dispatchEvent(new Event('click')); // source asc
            await flush();
            await flush();
            let rows = container.querySelectorAll('tbody tr');
            assert.equal(strip(rows[0].children[1].textContent).trim(), 'AAA');

            headers[2].dispatchEvent(new Event('click')); // target asc
            await flush();
            rows = container.querySelectorAll('tbody tr');
            assert.equal(strip(rows[0].children[2].textContent).trim(), 'AAA');
        } finally {
            cleanup();
            restore();
        }
    });

    it('row bounds never exceed the total interface count', async () => {
        const total = 7;
        const ifaces = Array.from({ length: total }, (_, i) =>
            makeInterface({ ID: `i${i}`, name: `Iface ${i}`, snapshots: [snapshot({ pendingCount: 10 })] })
        );
        const { container, cleanup, restore } = await renderWith(ifaces);
        try {
            assert.equal(rowCount(container), total);
            assert.equal(listedCount(container), total);
            // Filtering can only shrink, never grow beyond total.
            const statusSelect = container.querySelector('select');
            statusSelect.value = 'nonexistent';
            statusSelect.dispatchEvent(new Event('change'));
            await flush();
            assert.equal(listedCount(container), 0);
            assert.ok(rowCount(container) <= total);
            assert.ok(/No interfaces match/i.test(container.textContent));
        } finally {
            cleanup();
            restore();
        }
    });
});
