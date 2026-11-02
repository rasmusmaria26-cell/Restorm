/**
 * InterfaceInventoryPage.js — Interface inventory page.
 *
 * Renders a sortable / filterable table of all monitored interfaces:
 *   name, source → target, schedule, active status, latest pending count,
 *   latest retry attempts, status (healthy / warning / critical based on
 *   latest snapshot vs thresholds + active alerts).
 *
 * Each row links to the interface detail page (#interface/:id).
 *
 * All data from backend via api.fetchInterfaces + api.fetchAlerts.
 * Uses LoadingState / ErrorState / EmptyState and existing CSS table classes.
 *
 * Exports render(container, context) and cleanup().
 */

import { LoadingState } from '../components/LoadingState.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { Card } from '../components/Card.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function latestSnapshot(iface) {
    const snaps = iface.snapshots || [];
    return snaps.length ? snaps[snaps.length - 1] : null;
}

function computeStatus(snap, iface, activeAlertCount) {
    if (!snap) return activeAlertCount > 0 ? 'high' : 'healthy';
    const pending = Number(snap.pendingCount) || 0;
    const retry = Number(snap.retryAttempts) || 0;
    const age = Number(snap.oldestPendingAgeSeconds) || 0;
    const limit = Number(iface.queueGrowthLimit) || 200;
    const retryLimit = Number(iface.maxRetryThreshold) || 100;
    const ageLimit = Number(iface.oldMessageAgeLimitSeconds) || 600;

    const overLimit = pending >= limit || retry >= retryLimit || age >= ageLimit;
    if (overLimit || activeAlertCount > 0) return 'critical';
    if (pending >= limit * 0.7 || retry >= retryLimit * 0.7 || age >= ageLimit * 0.7) return 'high';
    return 'healthy';
}

function statusLabel(status) {
    return { healthy: 'Healthy', high: 'Warning', critical: 'Critical' }[status] || 'Healthy';
}

function formatAge(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const r = Math.floor(seconds % 60);
    return r ? `${m}m ${r}s` : `${m}m`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

/* ------------------------------------------------------------------ */
/* Page render                                                        */
/* ------------------------------------------------------------------ */

export function render(container, context = {}) {
    const { api } = context;
    const fetchInterfaces = api && api.fetchInterfaces;
    const fetchAlerts = api && api.fetchAlerts;

    container.innerHTML = '';
    container.className = 'page-container';

    const shell = document.createElement('div');
    shell.className = 'interface-inventory-page';
    container.appendChild(shell);

    let mounted = true;

    // State
    let interfaces = [];
    let alerts = [];
    let sort = { key: 'name', dir: 'asc' }; // key: name | status | source | target | pending | retries
    let filterText = '';
    let filterStatus = 'all';

    async function load() {
        if (!mounted) return;
        shell.innerHTML = '';
        shell.appendChild(LoadingState({ message: 'Loading interface inventory…' }));

        try {
            const [ifacesRes, alertsRes] = await Promise.all([
                fetchInterfaces ? fetchInterfaces() : Promise.resolve({ value: [] }),
                fetchAlerts ? fetchAlerts() : Promise.resolve({ value: [] })
            ]);
            interfaces = ifacesRes.value || [];
            alerts = alertsRes.value || [];
        } catch (err) {
            if (!mounted) return;
            shell.innerHTML = '';
            shell.appendChild(ErrorState({
                message: err.message || 'Failed to load interface inventory',
                onRetry: load,
                retryLabel: 'Retry'
            }));
            return;
        }
        if (!mounted) return;
        renderTable();
    }

    function openAlertCountFor(ifaceId) {
        return alerts.filter(a => a.interface_ID === ifaceId && a.status === 'Open').length;
    }

    function rowStatus(iface) {
        const snap = latestSnapshot(iface);
        const activeAlerts = openAlertCountFor(iface.ID);
        return computeStatus(snap, iface, activeAlerts);
    }

    function filteredSorted() {
        let list = interfaces.slice();

        // Filter by text
        const ft = filterText.toLowerCase();
        if (ft) {
            list = list.filter(i =>
                (i.name || '').toLowerCase().includes(ft) ||
                (i.sourceSystem || '').toLowerCase().includes(ft) ||
                (i.targetSystem || '').toLowerCase().includes(ft)
            );
        }

        // Filter by status
        if (filterStatus !== 'all') {
            list = list.filter(i => rowStatus(i) === filterStatus);
        }

        // Sort
        list.sort((a, b) => {
            let av, bv;
            switch (sort.key) {
                case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break;
                case 'source': av = (a.sourceSystem || '').toLowerCase(); bv = (b.sourceSystem || '').toLowerCase(); break;
                case 'target': av = (a.targetSystem || '').toLowerCase(); bv = (b.targetSystem || '').toLowerCase(); break;
                case 'pending': {
                    const sa = latestSnapshot(a); const sb = latestSnapshot(b);
                    av = sa ? Number(sa.pendingCount) || 0 : 0;
                    bv = sb ? Number(sb.pendingCount) || 0 : 0;
                    break;
                }
                case 'retries': {
                    const sa = latestSnapshot(a); const sb = latestSnapshot(b);
                    av = sa ? Number(sa.retryAttempts) || 0 : 0;
                    bv = sb ? Number(sb.retryAttempts) || 0 : 0;
                    break;
                }
                case 'status': av = rowStatus(a); bv = rowStatus(b); break;
                default: av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase();
            }
            if (av < bv) return sort.dir === 'asc' ? -1 : 1;
            if (av > bv) return sort.dir === 'asc' ? 1 : -1;
            return 0;
        });

        return list;
    }

    function statusBadgeHtml(status) {
        return `<span class="status-badge ${status}" title="${statusLabel(status)}">${statusLabel(status)}</span>`;
    }

    function renderTable() {
        shell.innerHTML = '';

        if (!interfaces.length && !alerts.length) {
            shell.appendChild(EmptyState({
                title: 'No interfaces monitored',
                subtitle: 'Registered integration endpoints will appear here once telemetry is ingested.'
            }));
            return;
        }

        // Header
        const header = document.createElement('div');
        header.className = 'inventory-header';
        header.style.marginBottom = '14px';
        header.style.display = 'flex';
        header.style.flexDirection = 'column';
        header.style.gap = '10px';

        const titleWrap = document.createElement('div');
        titleWrap.style.display = 'flex';
        titleWrap.style.justifyContent = 'space-between';
        titleWrap.style.alignItems = 'center';
        titleWrap.innerHTML = `
            <h2 class="inventory-title">Interface Inventory</h2>
            <span class="inventory-count">${interfaces.length} monitored</span>
        `;
        header.appendChild(titleWrap);

        // Filter controls
        const filterWrap = document.createElement('div');
        filterWrap.style.display = 'flex';
        filterWrap.style.gap = '10px';
        filterWrap.style.flexWrap = 'wrap';
        filterWrap.style.alignItems = 'center';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Filter by name, source or target…';
        input.className = 'form-select-sm';
        input.style.padding = '6px 10px';
        input.style.borderRadius = '6px';
        input.style.border = '1px solid var(--color-divider)';
        input.style.background = 'var(--color-card-bg)';
        input.style.color = 'var(--color-ink)';
        input.style.width = '260px';
        input.value = filterText;
        input.addEventListener('input', (e) => {
            filterText = e.target.value;
            renderTable();
        });

        const statusSelect = document.createElement('select');
        statusSelect.className = 'form-select-sm';
        statusSelect.style.padding = '6px 10px';
        statusSelect.style.borderRadius = '6px';
        statusSelect.style.border = '1px solid var(--color-divider)';
        statusSelect.innerHTML = `
            <option value="all">All statuses</option>
            <option value="critical">Critical</option>
            <option value="high">Warning</option>
            <option value="healthy">Healthy</option>
        `;
        statusSelect.value = filterStatus;
        statusSelect.addEventListener('change', (e) => {
            filterStatus = e.target.value;
            renderTable();
        });

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.className = 'btn btn-quiet';
        refreshBtn.addEventListener('click', load);

        filterWrap.append(input, statusSelect, refreshBtn);
        header.appendChild(filterWrap);
        shell.appendChild(header);

        // Table card
        const card = Card({ className: 'inventory-table-card' });
        const tableWrap = document.createElement('div');
        tableWrap.style.overflowX = 'auto';

        const table = document.createElement('table');
        table.className = 'inventory-table';
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.fontSize = '0.875rem';

        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        trHead.style.borderBottom = '2px solid var(--color-divider)';

        const headers = [
            { key: 'name', label: 'Interface' },
            { key: 'source', label: 'Source' },
            { key: 'target', label: 'Target' },
            { key: 'schedule', label: 'Schedule' },
            { key: 'active', label: 'Active' },
            { key: 'pending', label: 'Pending' },
            { key: 'retries', label: 'Retries' },
            { key: 'status', label: 'Status' }
        ];

        for (const h of headers) {
            const th = document.createElement('th');
            th.textContent = h.label;
            th.style.textAlign = 'left';
            th.style.padding = '10px 12px';
            th.style.fontWeight = '600';
            th.style.color = 'var(--color-slate)';
            th.style.cursor = 'pointer';
            th.style.userSelect = 'none';
            th.style.borderBottom = '2px solid var(--color-divider)';
            if (sort.key === h.key) {
                th.textContent += ` ${sort.dir === 'asc' ? '▲' : '▼'}`;
                th.style.color = 'var(--color-harbor)';
            }
            th.addEventListener('click', () => {
                if (sort.key === h.key) {
                    sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    sort.key = h.key;
                    sort.dir = 'asc';
                }
                renderTable();
            });
            trHead.appendChild(th);
        }
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const list = filteredSorted();

        if (!list.length) {
            const emptyRow = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = headers.length;
            td.style.padding = '24px';
            td.style.textAlign = 'center';
            td.style.color = 'var(--color-slate)';
            td.textContent = 'No interfaces match the current filters.';
            emptyRow.appendChild(td);
            tbody.appendChild(emptyRow);
        } else {
            for (const iface of list) {
                const snap = latestSnapshot(iface);
                const status = rowStatus(iface);
                const pending = snap ? Number(snap.pendingCount) || 0 : 0;
                const retries = snap ? Number(snap.retryAttempts) || 0 : 0;
                const age = snap ? Number(snap.oldestPendingAgeSeconds) || 0 : 0;

                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--color-divider-light)';
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => {
                    window.location.hash = `#interface/${iface.ID}`;
                });

                const activeLabel = iface.active ? 'Yes' : 'No';
                const activeClass = iface.active ? '' : ' text-muted';

                tr.innerHTML = `
                    <td class="table-cell-ink">${escapeHtml(iface.name || '—')}</td>
                    <td class="table-cell-slate">${escapeHtml(iface.sourceSystem || '—')}</td>
                    <td class="table-cell-slate">${escapeHtml(iface.targetSystem || '—')}</td>
                    <td class="table-cell-slate-sm">${escapeHtml(iface.expectedSchedule || '—')}</td>
                    <td class="table-cell-slate ${activeClass.trim()}">${activeLabel}</td>
                    <td class="table-cell-num">${Math.floor(pending)}</td>
                    <td class="table-cell-num">${Math.floor(retries)}</td>
                    <td class="table-cell-empty">${statusBadgeHtml(status)}</td>
                `;

                // Age tooltip / detail
                const ageCell = document.createElement('td');
                ageCell.style.padding = '12px';
                ageCell.style.color = 'var(--color-slate)';
                ageCell.style.fontSize = '0.8rem';
                ageCell.textContent = age ? formatAge(age) : '—';
                // Insert age between retries and status? Keep table to 8 cols; put age in title attr instead.
                tr.querySelector('td:last-child').title = `Oldest pending: ${age ? formatAge(age) : '—'}`;
                tr.querySelector('td:nth-child(6)').title = `Oldest pending: ${age ? formatAge(age) : '—'}`;

                tbody.appendChild(tr);
            }
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        card.appendChild(tableWrap);
        shell.appendChild(card);

        // Summary footer
        const footer = document.createElement('div');
        footer.style.marginTop = '12px';
        footer.style.display = 'flex';
        footer.style.gap = '16px';
        footer.style.fontSize = '0.8125rem';
        footer.style.color = 'var(--color-slate)';
        const openAlerts = alerts.filter(a => a.status === 'Open').length;
        footer.innerHTML = `
            <span><strong>${list.length}</strong> interface${list.length !== 1 ? 's' : ''} listed</span>
            <span><strong>${openAlerts}</strong> open alert${openAlerts !== 1 ? 's' : ''}</span>
        `;
        shell.appendChild(footer);
    }

    load();

    return function cleanup() {
        mounted = false;
    };
}

export default { render, cleanup: () => {} };
