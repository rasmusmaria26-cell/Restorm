/**
 * InterfaceDetailPage.js — Interface details page.
 *
 * Renders:
 *   - Interface header: name, source → target, schedule, description, active badge
 *   - Threshold policy display: maxRetryThreshold, queueGrowthLimit,
 *     oldMessageAgeLimitSeconds, recoveryStalledBacklog
 *   - Historical queue chart: SVG line chart of snapshots over time
 *     (pendingCount + retryAttempts)
 *   - Latest metrics table
 *   - Active alerts for this interface with permission-aware ack/resolve buttons
 *     that call the real backend via api.acknowledgeAlert / api.resolveAlert
 *
 * All data from backend via api.fetchInterfaces + api.fetchAlerts.
 *
 * Exports render(container, context) and cleanup().
 * context provides: { params, getState, setState, api, formatShortTime,
 *   FRIENDLY_RULE_TITLES, SEVERITY_WEIGHT, userRoles, currentUser }
 */

import { LoadingState } from '../components/LoadingState.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';
import { Sparkline } from '../components/Sparkline.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function findInterface(interfaces, id) {
    return interfaces.find(i => i.ID === id) || null;
}

function latestSnapshot(iface) {
    const snaps = iface.snapshots || [];
    return snaps.length ? snaps[snaps.length - 1] : null;
}

function statusForSnapshot(snap, iface) {
    if (!snap) return 'healthy';
    const pending = Number(snap.pendingCount) || 0;
    const retry = Number(snap.retryAttempts) || 0;
    const age = Number(snap.oldestPendingAgeSeconds) || 0;
    const limit = Number(iface.queueGrowthLimit) || 200;
    const retryLimit = Number(iface.maxRetryThreshold) || 100;
    const ageLimit = Number(iface.oldMessageAgeLimitSeconds) || 600;
    if (retry >= retryLimit) return 'critical';
    if (pending >= limit || age >= ageLimit) return 'high';
    if (pending >= limit * 0.7 || retry >= retryLimit * 0.7 || age >= ageLimit * 0.7) return 'predictive-warning';
    return 'healthy';
}

function statusLabel(status) {
    return {
        healthy: 'Healthy',
        high: 'High',
        critical: 'Critical',
        'predictive-warning': 'Predictive Warning'
    }[status] || 'Healthy';
}

function formatAge(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const r = Math.floor(seconds % 60);
    return r ? `${m}m ${r}s` : `${m}m`;
}

function formatDateTime(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString([], {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        return String(iso);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function permissionContext(context) {
    const { userRoles, currentUser } = context;
    const user = currentUser || 'user';
    const isAdmin = userRoles.includes('SimulatorAdmin');
    const isOperator = userRoles.includes('SupportOperator');
    return {
        user,
        canAcknowledge: isAdmin || isOperator,
        canResolve: isAdmin || isOperator,
        canSimulate: isAdmin || isOperator
    };
}

/* ------------------------------------------------------------------ */
/* Historical queue chart (inline SVG, pending + retry lines)         */
/* ------------------------------------------------------------------ */

function renderHistoryChart(snapshots, width, height) {
    const recent = (snapshots || []).slice(-20);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'history-svg');
    svg.setAttribute('aria-label', 'Historical queue depth and retry attempts');

    const padX = 56; // room for y-axis labels
    const padY = 30; // room for x-axis labels + title
    const effW = width - padX - 30;
    const effH = height - padY - 24;

    if (!recent || recent.length === 0) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', padX); line.setAttribute('y1', height - padY);
        line.setAttribute('x2', width - 30); line.setAttribute('y2', height - padY);
        line.setAttribute('stroke', 'var(--color-divider)');
        line.setAttribute('stroke-width', '1.5');
        svg.appendChild(line);
        return svg;
    }

    const pendingVals = recent.map(s => Number(s.pendingCount) || 0);
    const retryVals = recent.map(s => Number(s.retryAttempts) || 0);
    const maxVal = Math.max(...pendingVals, ...retryVals, 10);
    const scaleY = (val) => padY + effH - (val / maxVal) * effH;

    // Y axis labels
    const yMaxLabel = Math.ceil(maxVal / 10) * 10 || 10;
    for (let i = 0; i <= 4; i++) {
        const val = (yMaxLabel * i) / 4;
        const y = scaleY(val);
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', padX - 8);
        label.setAttribute('y', y + 4);
        label.setAttribute('font-size', '9');
        label.setAttribute('fill', 'var(--color-slate)');
        label.setAttribute('text-anchor', 'end');
        label.textContent = Math.round(val);
        svg.appendChild(label);
    }

    // X axis labels (first, middle, last)
    const xLabels = [0, Math.floor((recent.length - 1) / 2), recent.length - 1];
    for (const idx of xLabels) {
        const x = padX + (idx / (recent.length - 1 || 1)) * effW;
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', height - padY + 16);
        label.setAttribute('font-size', '9');
        label.setAttribute('fill', 'var(--color-slate)');
        label.setAttribute('text-anchor', 'middle');
        const capAt = recent[idx] ? recent[idx].capturedAt : null;
        label.textContent = capAt ? new Date(capAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
        svg.appendChild(label);
    }

    // Lines: pendingCount
    function polyline(vals, stroke) {
        const pts = vals.map((v, idx) => {
            const x = padX + (idx / (recent.length - 1 || 1)) * effW;
            const y = scaleY(v);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const pl = document.createElementNS(SVG_NS, 'polyline');
        pl.setAttribute('points', pts);
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', stroke);
        pl.setAttribute('stroke-width', '2');
        pl.setAttribute('stroke-linecap', 'round');
        pl.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(pl);
    }

    polyline(pendingVals, 'var(--color-harbor)');
    polyline(retryVals, 'var(--color-high)');

    // Latest dots
    const lastIdx = recent.length - 1;
    const lastX = padX + effW;
    const pendingDot = document.createElementNS(SVG_NS, 'circle');
    pendingDot.setAttribute('cx', lastX);
    pendingDot.setAttribute('cy', scaleY(pendingVals[lastIdx]));
    pendingDot.setAttribute('r', '3');
    pendingDot.setAttribute('fill', 'var(--color-harbor)');
    svg.appendChild(pendingDot);

    const retryDot = document.createElementNS(SVG_NS, 'circle');
    retryDot.setAttribute('cx', lastX);
    retryDot.setAttribute('cy', scaleY(retryVals[lastIdx]));
    retryDot.setAttribute('r', '3');
    retryDot.setAttribute('fill', 'var(--color-high)');
    svg.appendChild(retryDot);

    // Axis lines
    const xAxis = document.createElementNS(SVG_NS, 'line');
    xAxis.setAttribute('x1', padX); xAxis.setAttribute('y1', height - padY);
    xAxis.setAttribute('x2', width - 30); xAxis.setAttribute('y2', height - padY);
    xAxis.setAttribute('stroke', 'var(--color-divider)'); xAxis.setAttribute('stroke-width', '1');
    svg.appendChild(xAxis);

    const yAxis = document.createElementNS(SVG_NS, 'line');
    yAxis.setAttribute('x1', padX); yAxis.setAttribute('y1', padY + effH);
    yAxis.setAttribute('x2', padX); yAxis.setAttribute('y2', height - padY);
    yAxis.setAttribute('stroke', 'var(--color-divider)'); yAxis.setAttribute('stroke-width', '1');
    svg.appendChild(yAxis);

    return svg;
}

/* ------------------------------------------------------------------ */
/* Page render                                                        */
/* ------------------------------------------------------------------ */

export function render(container, context = {}) {
    const {
        params,
        api,
        formatShortTime,
        FRIENDLY_RULE_TITLES,
        SEVERITY_WEIGHT,
        userRoles,
        currentUser
    } = context;

    const interfaceId = params && params.id ? String(params.id) : null;
    const perm = permissionContext(context);

    container.innerHTML = '';
    container.className = 'page-container';

    const shell = document.createElement('div');
    shell.className = 'interface-detail-page';
    container.appendChild(shell);

    let mounted = true;

    let interfaces = [];
    let alerts = [];

    async function load() {
        if (!mounted) return;
        shell.innerHTML = '';
        shell.appendChild(LoadingState({ message: 'Loading interface details…' }));

        try {
            const [ifacesRes, alertsRes] = await Promise.all([
                api.fetchInterfaces ? api.fetchInterfaces() : Promise.resolve({ value: [] }),
                api.fetchAlerts ? api.fetchAlerts() : Promise.resolve({ value: [] })
            ]);
            interfaces = ifacesRes.value || [];
            alerts = alertsRes.value || [];
        } catch (err) {
            if (!mounted) return;
            shell.innerHTML = '';
            shell.appendChild(ErrorState({
                message: err.message || 'Failed to load interface details',
                onRetry: load,
                retryLabel: 'Retry'
            }));
            return;
        }
        if (!mounted) return;
        renderDetail();
    }

    function renderDetail() {
        shell.innerHTML = '';

        const iface = interfaceId ? findInterface(interfaces, interfaceId) : null;

        if (!iface) {
            shell.appendChild(EmptyState({
                title: 'Interface not found',
                subtitle: `No monitored interface with ID ${escapeHtml(interfaceId || '—')} was found.`
            }));
            const back = document.createElement('button');
            back.type = 'button';
            back.textContent = 'Back to inventory';
            back.className = 'btn btn-quiet';
            back.addEventListener('click', () => { window.location.hash = '#interfaces'; });
            shell.appendChild(back);
            return;
        }

        const snap = latestSnapshot(iface);
        const status = snap ? statusForSnapshot(snap, iface) : 'healthy';
        const ifaceAlerts = alerts.filter(a => a.interface_ID === iface.ID && a.status === 'Open');

        // Back link + title bar
        const bar = document.createElement('div');
        bar.style.display = 'flex';
        bar.style.justifyContent = 'space-between';
        bar.style.alignItems = 'center';
        bar.style.marginBottom = '16px';
        bar.style.flexWrap = 'wrap';
        bar.style.gap = '10px';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.textContent = '← Back to inventory';
        backBtn.className = 'btn btn-quiet';
        backBtn.addEventListener('click', () => { window.location.hash = '#interfaces'; });

        const titleWrap = document.createElement('div');
        titleWrap.style.display = 'flex';
        titleWrap.style.flexDirection = 'column';
        titleWrap.style.gap = '2px';
        titleWrap.innerHTML = `
            <h1 class="detail-title">${escapeHtml(iface.name || 'Unnamed Interface')}</h1>
            <div class="detail-path">${escapeHtml(`${iface.sourceSystem || '—'} → ${iface.targetSystem || '—'}`)}</div>
        `;

        const statusBadge = document.createElement('span');
        statusBadge.className = `status-badge ${status}`;
        statusBadge.title = statusLabel(status);
        statusBadge.textContent = `${statusLabel(status)} ${iface.active ? '' : '(inactive)'}`;

        bar.append(backBtn, titleWrap, statusBadge);
        shell.appendChild(bar);

        // --- Interface header card ---
        const headerCard = Card({ className: 'detail-header-card' });
        headerCard.style.display = 'grid';
        headerCard.style.gridTemplateColumns = '1fr 1fr';
        headerCard.style.gap = '16px';
        headerCard.innerHTML = `
            <div class="header-section">
                <h3 class="section-label-sm">Interface</h3>
                <p class="body-text-sm"><strong>Source → Target:</strong> ${escapeHtml(`${iface.sourceSystem || '—'} → ${iface.targetSystem || '—'}`)}</p>
                <p class="body-text-sm"><strong>Schedule:</strong> ${escapeHtml(iface.expectedSchedule || '—')}</p>
                <p class="body-text-sm"><strong>Active:</strong> <span class="${iface.active ? 'status-color-active' : 'status-color-inactive'}">${iface.active ? 'Yes' : 'No'}</span></p>
                ${iface.description ? `<p class="small-text-slate"><strong>Description:</strong> ${escapeHtml(iface.description)}</p>` : ''}
            </div>
            <div class="header-section">
                <h3 class="section-label-sm">Status</h3>
                <p class="body-text-sm"><strong>Latest status:</strong> ${statusLabel(status)}</p>
                <p class="body-text-sm"><strong>Latest pending:</strong> ${snap ? Math.floor(Number(snap.pendingCount) || 0) : '—'}</p>
                <p class="body-text-sm"><strong>Latest retries:</strong> ${snap ? Math.floor(Number(snap.retryAttempts) || 0) : '—'}</p>
                <p class="small-text-slate"><strong>Oldest pending:</strong> ${snap && snap.oldestPendingAgeSeconds ? formatAge(snap.oldestPendingAgeSeconds) : '—'}</p>
            </div>
        `;
        shell.appendChild(headerCard);

        // --- Threshold policy card ---
        const policyCard = Card({ className: 'detail-policy-card' });
        policyCard.innerHTML = `
            <h3 class="section-label-md">Threshold Policy</h3>
            <table class="policy-table">
                <tr><td class="policy-cell-label">Max Retry Threshold (Rule A)</td><td class="policy-cell-value">${Math.floor(Number(iface.maxRetryThreshold) || 0)}</td></tr>
                <tr><td class="policy-cell-label">Queue Growth Limit (Rule B)</td><td class="policy-cell-value">${Math.floor(Number(iface.queueGrowthLimit) || 0)}</td></tr>
                <tr><td class="policy-cell-label">Old Message Age Limit (Rule C)</td><td class="policy-cell-value">${Math.floor(Number(iface.oldMessageAgeLimitSeconds) || 0)}s</td></tr>
                <tr><td class="policy-cell-label">Recovery Stalled Backlog (Rule D)</td><td class="policy-cell-value">${Math.floor(Number(iface.recoveryStalledBacklog) || 0)}</td></tr>
            </table>
            <p class="threshold-note">Thresholds define alert detection limits per rule. Critical when latest snapshot meets or exceeds the limit.</p>
        `;
        shell.appendChild(policyCard);

        // --- Historical queue chart ---
        const chartCard = Card({ className: 'detail-chart-card' });
        chartCard.style.marginTop = '16px';
        chartCard.innerHTML = `
            <h3 class="section-label-md">Historical Queue & Retries</h3>
        `;
        const chartWrap = document.createElement('div');
        chartWrap.style.display = 'flex';
        chartWrap.style.justifyContent = 'center';
        chartWrap.style.padding = '12px 0';
        chartWrap.appendChild(renderHistoryChart(iface.snapshots || [], 700, 260));
        chartCard.appendChild(chartWrap);
        shell.appendChild(chartCard);

        // --- Legend for chart ---
        const legend = document.createElement('div');
        legend.style.marginTop = '6px';
        legend.style.fontSize = '0.75rem';
        legend.style.color = 'var(--color-slate)';
        legend.innerHTML = `
            <span class="chart-legend-row">
                <span class="chart-legend-dot harbor"></span> Pending backlog
            </span>
            <span class="chart-legend-row">
                <span class="chart-legend-dot high"></span> Retry attempts
            </span>
        `;
        shell.appendChild(legend);

        // --- Latest metrics table ---
        const metricsCard = Card({ className: 'detail-metrics-card' });
        metricsCard.style.marginTop = '16px';
        metricsCard.innerHTML = `
            <h3 class="section-label-md">Latest Snapshot Metrics</h3>
        `;
        const metaWrap = document.createElement('div');
        metaWrap.style.overflowX = 'auto';
        const metaTable = document.createElement('table');
        metaTable.className = 'metrics-table';
        const rows = [
            ['Captured at', snap ? formatDateTime(snap.capturedAt) : '—'],
            ['Pending count', snap ? Math.floor(Number(snap.pendingCount) || 0) : '—'],
            ['Failed count', snap ? Math.floor(Number(snap.failedCount) || 0) : '—'],
            ['Retry attempts', snap ? Math.floor(Number(snap.retryAttempts) || 0) : '—'],
            ['Success count', snap ? Math.floor(Number(snap.successCount) || 0) : '—'],
            ['Oldest pending age', snap && snap.oldestPendingAgeSeconds ? formatAge(snap.oldestPendingAgeSeconds) : '—']
        ];
        metaTable.innerHTML = rows.map(([k, v]) => `
            <tr class="metrics-row">
                <td class="metrics-cell-label">${escapeHtml(k)}</td>
                <td class="metrics-cell-value">${escapeHtml(String(v))}</td>
            </tr>
        `).join('');
        metaWrap.appendChild(metaTable);
        metricsCard.appendChild(metaWrap);
        shell.appendChild(metricsCard);

        // --- Active alerts ---
        const alertsCard = Card({ className: `detail-alerts-card${ifaceAlerts.length ? ' has-alert' : ''}` });
        alertsCard.style.marginTop = '16px';
        const alertTitle = document.createElement('h3');
        alertTitle.style.fontSize = '0.875rem';
        alertTitle.style.fontWeight = '600';
        alertTitle.style.textTransform = 'uppercase';
        alertTitle.style.letterSpacing = '0.05em';
        alertTitle.style.color = 'var(--color-slate)';
        alertTitle.style.margin = '0 0 10px 0';
        alertTitle.textContent = `Active Alerts (${ifaceAlerts.length})`;
        alertsCard.appendChild(alertTitle);

        if (!ifaceAlerts.length) {
            alertsCard.appendChild(EmptyState({ title: 'No active alerts', subtitle: 'All alerts for this interface are acknowledged or resolved.' }));
        } else {
            const listWrap = document.createElement('div');
            listWrap.style.display = 'flex';
            listWrap.style.flexDirection = 'column';
            listWrap.style.gap = '8px';

            for (const a of ifaceAlerts) {
                const item = document.createElement('div');
                item.className = `alert-card is-${a.severity.toLowerCase()}`;
                item.style.padding = '12px';
                item.style.display = 'flex';
                item.style.flexDirection = 'column';
                item.style.gap = '8px';

                const friendly = (FRIENDLY_RULE_TITLES && FRIENDLY_RULE_TITLES[a.ruleCode]) || a.ruleCode;

                const head = document.createElement('div');
                head.style.display = 'flex';
                head.style.justifyContent = 'space-between';
                head.style.alignItems = 'flex-start';
                head.style.gap = '8px';
                head.innerHTML = `
                    <div class="flex-1">
                        <div class="font-weight-600">${escapeHtml(friendly)}</div>
                        <div class="meta-text-mono">${escapeHtml(a.ruleCode)} • detected ${a.detectedAt ? formatDateTime(a.detectedAt) : '—'}</div>
                    </div>
                    <span class="status-badge ${a.severity.toLowerCase()}">${escapeHtml(a.severity)}</span>
                `;
                item.appendChild(head);

                if (a.summary) {
                    const sum = document.createElement('div');
                    sum.className = 'evidence-line';
                    sum.textContent = escapeHtml(a.summary);
                    item.appendChild(sum);
                }

                const actions = document.createElement('div');
                actions.className = 'alert-actions-row';

                const ackBtn = Button({
                    text: 'Acknowledge',
                    variant: perm.canAcknowledge ? 'harbor' : 'quiet',
                    disabled: !perm.canAcknowledge || a.status !== 'Open',
                    title: perm.canAcknowledge ? `Acknowledge ${friendly}` : 'View-only: acknowledge requires SupportOperator or SimulatorAdmin',
                    onClick: async (e) => {
                        e.preventDefault();
                        try {
                            await api.acknowledgeAlert(a.ID, `${perm.user === 'bob' ? 'Bob (Support operator)' : perm.user === 'admin' ? 'Admin (Simulator admin)' : perm.user}`);
                            load(); // refresh
                        } catch (err) {
                            alert('Acknowledge failed: ' + (err.message || 'Unknown error'));
                        }
                    }
                });

                const resolveBtn = Button({
                    text: 'Resolve',
                    variant: perm.canResolve ? 'harbor' : 'quiet',
                    disabled: !perm.canResolve || a.status !== 'Open',
                    title: perm.canResolve ? `Resolve ${friendly}` : 'View-only: resolve requires SupportOperator or SimulatorAdmin',
                    onClick: async (e) => {
                        e.preventDefault();
                        try {
                            await api.resolveAlert(a.ID, `${perm.user === 'bob' ? 'Bob (Support operator)' : perm.user === 'admin' ? 'Admin (Simulator admin)' : perm.user}`);
                            load(); // refresh
                        } catch (err) {
                            alert('Resolve failed: ' + (err.message || 'Unknown error'));
                        }
                    }
                });

                actions.appendChild(ackBtn);
                actions.appendChild(resolveBtn);
                item.appendChild(actions);

                listWrap.appendChild(item);
            }
            alertsCard.appendChild(listWrap);
        }
        shell.appendChild(alertsCard);
    }

    load();

    return function cleanup() {
        mounted = false;
    };
}

export default { render, cleanup: () => {} };
