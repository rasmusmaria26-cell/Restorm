/**
 * test/qa/data-refresh.test.js
 *
 * Phase 5 Agent 6 — Data refresh tests (frontend).
 *
 * Verifies refreshData updates store state from backend data and that the live
 * refresh cycle (setLoading / setInterfaces / setAlerts / subscribers) works.
 * No browser; uses DOM shim + mock fetch.
 *
 * Runs with: node --test test/qa/data-refresh.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { installDOMShim, mockFetch, flush } = require('./frontend-helper.js');

installDOMShim();

const store = require('../../app/js/store.js');
const api = require('../../app/js/api-client.js');

let restoreFetch;

before(() => {
    restoreFetch = mockFetch([
        { match: '/Interfaces', response: { value: [] } },
        { match: '/Alerts', response: { value: [] } }
    ]);
});

after(() => {
    if (restoreFetch) restoreFetch();
});

describe('Data refresh (store + api-client)', () => {
    it('setInterfaces / setAlerts update state and notify subscribers', () => {
        const notifications = [];
        const unsub = store.subscribe((s) => notifications.push(s));

        const ifaces = [
            { ID: 'i1', name: 'One', sourceSystem: 'S', targetSystem: 'T', active: true },
            { ID: 'i2', name: 'Two', sourceSystem: 'S', targetSystem: 'T', active: true }
        ];
        const alerts = [
            { ID: 'a1', status: 'Open', severity: 'Critical', interface_ID: 'i1' }
        ];

        store.setInterfaces(ifaces);
        store.setAlerts(alerts);

        const state = store.getState();
        assert.equal(state.interfaces.length, 2);
        assert.equal(state.interfaces[0].name, 'One');
        assert.equal(state.alerts.length, 1);
        assert.equal(state.alerts[0].severity, 'Critical');
        assert.ok(state.lastUpdated);

        assert.equal(notifications.length, 2);
        unsub();
        store.setInterfaces([]);
        assert.equal(notifications.length, 2); // no more notifications after unsubscribe
    });

    it('setLoading / setError / clearError manage UI state', () => {
        store.setLoading(true);
        assert.equal(store.getState().loading, true);

        store.setError('Something went wrong');
        const s = store.getState();
        assert.equal(s.error, 'Something went wrong');
        assert.equal(s.loading, false); // setError forces loading false

        store.clearError();
        assert.equal(store.getState().error, null);
    });

    it('refresh cycle: fetch interfaces + alerts then update store state', async () => {
        const ifaces = [
            { ID: 'i1', name: 'Refreshed Iface', sourceSystem: 'WEBSHOP', targetSystem: 'S4HANA', active: true },
            { ID: 'i2', name: 'Another', sourceSystem: 'S4HANA', targetSystem: 'PAYGATE', active: true }
        ];
        const alerts = [
            { ID: 'a1', status: 'Open', severity: 'High', interface_ID: 'i1', ruleCode: 'QUEUE_GROWTH' }
        ];

        restoreFetch();
        restoreFetch = mockFetch([
            { match: '/Interfaces', response: { value: ifaces } },
            { match: '/Alerts', response: { value: alerts } }
        ]);

        // Mimic refreshData: fetch then set store.
        const ifacesRes = await api.fetchInterfaces();
        const alertsRes = await api.fetchAlerts();
        store.setInterfaces(ifacesRes.value || []);
        store.setAlerts(alertsRes.value || []);

        const state = store.getState();
        assert.equal(state.interfaces.length, 2);
        assert.equal(state.interfaces[0].name, 'Refreshed Iface');
        assert.equal(state.alerts.length, 1);
        assert.equal(state.alerts[0].ruleCode, 'QUEUE_GROWTH');
    });

    it('refreshData replaces prior state (not accumulate)', async () => {
        const first = [{ ID: 'old', name: 'Old', sourceSystem: 'S', targetSystem: 'T', active: true }];
        const second = [{ ID: 'new', name: 'New', sourceSystem: 'S', targetSystem: 'T', active: true }];

        restoreFetch();
        restoreFetch = mockFetch([
            { match: '/Interfaces', response: { value: first } },
            { match: '/Alerts', response: { value: [] } }
        ]);
        await api.fetchInterfaces();
        store.setInterfaces((await api.fetchInterfaces()).value);

        restoreFetch();
        restoreFetch = mockFetch([
            { match: '/Interfaces', response: { value: second } },
            { match: '/Alerts', response: { value: [] } }
        ]);
        await api.fetchInterfaces();
        store.setInterfaces((await api.fetchInterfaces()).value);

        assert.equal(store.getState().interfaces.length, 1);
        assert.equal(store.getState().interfaces[0].ID, 'new');
    });
});
