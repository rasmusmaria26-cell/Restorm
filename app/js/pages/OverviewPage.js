/**
 * OverviewPage.js — Operational overview page.
 *
 * Renders:
 *   - KPI cards: total interfaces, open alerts, critical alerts, high alerts,
 *     total pending, total retries (computed from live backend data)
 *   - Headline banner showing worst status across the estate
 *   - Interface cards grid: latest pending, retry count, status badge, sparkline
 *   - Active incident summary: alerts grouped by interface+ruleCode,
 *     sorted by severity then newest
 *
 * All metrics computed from real backend data via fetchInterfaces + fetchAlerts.
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
    if (pending >= limit || retry >= retryLimit || age >= ageLimit) return 'critical';
    if (pending >= limit * 0.7 || retry >= retryLimit * 0.7 || age >= ageLimit * 0.7) return 'high';
    return 'healthy';
}

function statusLabel(status) {
    const map = { healthy: 'Healthy', high: 'Warning', critical: 'Critical' };
    return map[status] || 'Healthy';
}

function severityRank(sev) {
    const w = { Critical: 3, High: 2, Warning: 1, Info: 0 };
    return w[sev] || 0;
}

function worstStatus(statuses) {
    if (!statuses.length) return 'healthy';
    const order = { critical: 3, high: 2, healthy: 1 };
    let worst = 'healthy';
    for (const s of statuses) {
        if (order[s] > (order[worst] || 0)) worst = s;
    }
    return worst;
}

function formatAge(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) return '—';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const r = Math.floor(seconds % 60);
    return r ? `${m}m ${r}s` : `${m}m`;
}

function formatNumber(n) {
    return (typeof n === 'number' && !isNaN(n)) ? String(Math.floor(n)) : '0';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

/* ------------------------------------------------------------------ */
/* Metric computation                                                 */
/* ------------------------------------------------------------------ */

/** Compute KPI summary from interfaces + alerts. */
export function computeKPIs(interfaces, alerts) {
    const totalInterfaces = interfaces.length;
    const openAlerts = alerts.filter(a => a.status === 'Open');
    const criticalAlerts = openAlerts.filter(a => a.severity === 'Critical').length;
    const highAlerts = openAlerts.filter(a => a.severity === 'High').length;

    let totalPending = 0;
    let totalRetries = 0;
    for (const iface of interfaces) {
        const snap = latestSnapshot(iface);
        totalPending += snap ? Number(snap.pendingCount) || 0 : 0;
        totalRetries += snap ? Number(snap.retryAttempts) || 0 : 0;
    }

    return {
        totalInterfaces,
        openAlerts: openAlerts.length,
        criticalAlerts,
        highAlerts,
        totalPending,
        totalRetries
    };
}

/** Group open alerts by interface + ruleCode, sorted by severity then newest. */
export function groupIncidents(alerts, interfaces) {
    const ifaceById = new Map(interfaces.map(i => [i.ID, i]));
    const groups = new Map();

    for (const a of alerts) {
        if (a.status !== 'Open') continue;
        const key = `${a.interface_ID}|${a.ruleCode}`;
        if (!groups.has(key)) {
            groups.set(key, {
                interfaceId: a.interface_ID,
                interface: ifaceById.get(a.interface_ID) || null,
                ruleCode: a.ruleCode,
                severity: a.severity,
                alerts: [],
                newestDetectedAt: a.detectedAt
            });
        }
        const g = groups.get(key);
        g.alerts.push(a);
        if (a.detectedAt > g.newestDetectedAt) g.newestDetectedAt = a.detectedAt;
        if (severityRank(a.severity) > severityRank(g.severity)) g.severity = a.severity;
    }

    return Array.from(groups.values())
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity)
            || new Date(b.newestDetectedAt) - new Date(a.newestDetectedAt));
}

/* ------------------------------------------------------------------ */
/* Renderers                                                          */
/* ------------------------------------------------------------------ */

function renderKpiCard(label, value, sub, status = 'healthy') {
    const card = Card({ className: `kpi-card is-${status}` });
    card.innerHTML = `
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="kpi-value">${escapeHtml(value)}</div>
        ${sub ? `<div class="kpi-sub">${escapeHtml(sub)}</div>` : ''}
    `;
    return card;
}

function renderHeadline(kpis, worst) {
    const card = Card({ className: `headline-card is-${worst}` });
    const titles = {
        critical: 'Critical incidents detected — immediate attention required',
        high: 'High-severity backlog growth across interfaces',
        healthy: 'All interfaces operating within thresholds'
    };
    const subs = {
        critical: `${kpis.criticalAlerts} critical, ${kpis.highAlerts} high open alerts`,
        high: `${kpis.highAlerts} high open alerts`,
        healthy: `No active critical or high alerts across ${kpis.totalInterfaces} interfaces`
    };

    card.innerHTML = `
        <div class="headline-content">
            <h2 class="headline-title">${escapeHtml(titles[worst] || titles.healthy)}</h2>
            <p class="headline-subtitle">${escapeHtml(subs[worst] || subs.healthy)}</p>
        </div>
        <div class="headline-actions">
            <div class="kpi-summary">
                <div><strong>${kpis.openAlerts}</strong> open</div>
                <div><strong>${kpis.totalPending}</strong> pending</div>
            </div>
            <button id="btnRefreshOverview" class="btn btn-quiet" type="button" title="Refresh data">Refresh</button>
        </div>
    `;
    return card;
}

function renderInterfaceCard(iface, snap) {
    const card = Card({ className: `interface-card${snap && statusForSnapshot(snap, iface) !== 'healthy' ? ' has-alert' : ''}` });
    const status = snap ? statusForSnapshot(snap, iface) : 'healthy';
    const pending = snap ? Number(snap.pendingCount) || 0 : 0;
    const retries = snap ? Number(snap.retryAttempts) || 0 : 0;
    const age = snap ? Number(snap.oldestPendingAgeSeconds) || 0 : 0;
    const overLimit = status !== 'healthy';

    const name = escapeHtml(iface.name || 'Unnamed Interface');
    const path = escapeHtml(`${iface.sourceSystem || '—'} → ${iface.targetSystem || '—'}`);
    const schedule = escapeHtml(iface.expectedSchedule || '—');

    card.innerHTML = `
        <div class="interface-card-header">
            <div class="interface-title-group">
                <h3 class="interface-name">${name}</h3>
                <div class="interface-path">${path}</div>
            </div>
            <span class="status-badge ${status}" title="${statusLabel(status)}">
                <span class="status-dot"></span>${statusLabel(status)}
            </span>
        </div>
        <div class="pressure-block">
            <div class="pressure-sparkline-wrap">
                <div class="pressure-label">pending backlog</div>
                ${Sparkline({ snapshots: iface.snapshots || [], limitValue: Number(iface.queueGrowthLimit) || 200, width: 200, height: 40 }).outerHTML}
            </div>
            <div class="pressure-summary">
                <div class="pressure-count${overLimit ? ' is-over-limit' : ''}">${formatNumber(pending)}</div>
                <div class="pressure-count-label">pending</div>
            </div>
        </div>
        <div class="interface-footer-caption">
            <span>${formatNumber(retries)} retries</span>
            <span>${age ? formatAge(age) : '—'} oldest</span>
            <span>${schedule}</span>
        </div>
    `;

    // Make card clickable -> detail page
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
        window.location.hash = `#interface/${iface.ID}`;
    });

    return card;
}

function renderIncidentCard(incident) {
    const card = Card({ className: `alert-card is-${incident.severity.toLowerCase()}` });
    const iface = incident.interface;
    const ifaceName = iface ? escapeHtml(`${iface.name} (${iface.sourceSystem} → ${iface.targetSystem})`) : 'Unknown interface';
    const friendlyTitle = (window.FRIENDLY_RULE_TITLES && window.FRIENDLY_RULE_TITLES[incident.ruleCode]) || incident.ruleCode;
    const alertCount = incident.alerts.length;
    const newest = incident.alerts.reduce((latest, a) => (a.detectedAt > latest.detectedAt ? a : latest), incident.alerts[0]);

    card.innerHTML = `
        <div class="alert-card-header">
            <div class="alert-titles-wrap">
                <h4 class="alert-friendly-title">${escapeHtml(friendlyTitle)}</h4>
                <div class="alert-rule-subcode">${escapeHtml(incident.ruleCode)} • ${alertCount} event${alertCount > 1 ? 's' : ''}</div>
            </div>
            <span class="status-badge ${incident.severity.toLowerCase()}">${escapeHtml(incident.severity)}</span>
        </div>
        <div class="alert-interface-tag">${ifaceName}</div>
        <div class="evidence-line">
            ${escapeHtml(newest.summary || `${alertCount} detection${alertCount > 1 ? 's' : ''} for ${incident.ruleCode}`)}
        </div>
        <div class="incident-meta-row">
            <span class="ongoing-incident-tag">Open</span>
            <span>Detected ${newest.detectedAt ? new Date(newest.detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </div>
    `;
    return card;
}

/* ------------------------------------------------------------------ */
/* Page render                                                        */
/* ------------------------------------------------------------------ */

export function render(container, context = {}) {
    const {
        api,
        formatShortTime,
        FRIENDLY_RULE_TITLES,
        SEVERITY_WEIGHT,
        userRoles,
        currentUser
    } = context;

    container.innerHTML = '';
    container.className = 'page-container';

    const apiMod = api || {};
    const fetchInterfaces = apiMod.fetchInterfaces;
    const fetchAlerts = apiMod.fetchAlerts;

    const shell = document.createElement('div');
    shell.className = 'overview-page';
    container.appendChild(shell);

    let mounted = true;

    async function load() {
        if (!mounted) return;
        shell.innerHTML = '';
        shell.appendChild(LoadingState({ message: 'Loading operational overview…' }));

        let interfaces = [];
        let alerts = [];

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
                message: err.message || 'Failed to load operational data',
                onRetry: load,
                retryLabel: 'Retry'
            }));
            return;
        }

        if (!mounted) return;
        shell.innerHTML = '';

        if (!interfaces.length && !alerts.length) {
            shell.appendChild(EmptyState({
                title: 'No operational data',
                subtitle: 'Interfaces and alerts will appear here once telemetry is ingested.'
            }));
            return;
        }

        const kpis = computeKPIs(interfaces, alerts);
        const incidents = groupIncidents(alerts, interfaces);
        const worst = worstStatus(interfaces.map(i => {
            const s = latestSnapshot(i);
            return s ? statusForSnapshot(s, i) : 'healthy';
        }));

        // --- KPI strip ---
        const kpiStrip = document.createElement('div');
        kpiStrip.className = 'kpi-strip';
        kpiStrip.style.display = 'grid';
        kpiStrip.style.gridTemplateColumns = 'repeat(auto-fit, minmax(150px, 1fr))';
        kpiStrip.style.gap = '12px';
        kpiStrip.style.marginBottom = '8px';

        kpiStrip.appendChild(renderKpiCard('Interfaces', kpis.totalInterfaces));
        kpiStrip.appendChild(renderKpiCard('Open Alerts', kpis.openAlerts, kpis.criticalAlerts > 0 ? `${kpis.criticalAlerts} critical` : null, kpis.criticalAlerts > 0 ? 'critical' : 'healthy'));
        kpiStrip.appendChild(renderKpiCard('Critical', kpis.criticalAlerts, kpis.criticalAlerts > 0 ? 'requires attention' : null, 'critical'));
        kpiStrip.appendChild(renderKpiCard('High', kpis.highAlerts, kpis.highAlerts > 0 ? 'backlog growth' : null, kpis.highAlerts > 0 ? 'high' : 'healthy'));
        kpiStrip.appendChild(renderKpiCard('Pending', formatNumber(kpis.totalPending), 'across latest snapshots'));
        kpiStrip.appendChild(renderKpiCard('Retries', formatNumber(kpis.totalRetries), 'retry attempts total'));
        shell.appendChild(kpiStrip);

        // --- Headline ---
        shell.appendChild(renderHeadline(kpis, worst));

        const refreshBtn = shell.querySelector('#btnRefreshOverview');
        if (refreshBtn) refreshBtn.addEventListener('click', load);

        // --- Control board grid ---
        const board = document.createElement('div');
        board.className = 'control-board-grid';
        shell.appendChild(board);

        // Left column: Interface cards
        const leftCol = document.createElement('div');
        leftCol.className = 'board-column';

        const ifaceHeader = document.createElement('div');
        ifaceHeader.className = 'column-header';
        ifaceHeader.innerHTML = '<h3 class="column-title">Interface Status</h3><span class="column-count">' + interfaces.length + '</span>';
        leftCol.appendChild(ifaceHeader);

        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'interface-cards-grid';
        cardsWrap.style.display = 'grid';
        cardsWrap.style.gridTemplateColumns = 'repeat(auto-fill, minmax(260px, 1fr))';
        cardsWrap.style.gap = '16px';
        cardsWrap.style.marginTop = '12px';

        if (!interfaces.length) {
            cardsWrap.appendChild(EmptyState({ title: 'No interfaces monitored', subtitle: 'Registered integration endpoints will appear here.' }));
        } else {
            for (const iface of interfaces) {
                const snap = latestSnapshot(iface);
                cardsWrap.appendChild(renderInterfaceCard(iface, snap));
            }
        }
        leftCol.appendChild(cardsWrap);
        board.appendChild(leftCol);

        // Right column: Active incidents
        const rightCol = document.createElement('div');
        rightCol.className = 'board-column';

        const incHeader = document.createElement('div');
        incHeader.className = 'column-header';
        const openCount = alerts.filter(a => a.status === 'Open').length;
        incHeader.innerHTML = `<h3 class="column-title">Active Incidents</h3><span class="column-count${openCount ? ' has-attention' : ''}">${openCount}</span>`;
        rightCol.appendChild(incHeader);

        const incidentsWrap = document.createElement('div');
        incidentsWrap.className = 'incidents-list';
        incidentsWrap.style.marginTop = '12px';
        incidentsWrap.style.display = 'flex';
        incidentsWrap.style.flexDirection = 'column';
        incidentsWrap.style.gap = '10px';

        if (!incidents.length) {
            incidentsWrap.appendChild(EmptyState({ title: 'No active incidents', subtitle: 'All alerts are acknowledged or resolved.' }));
        } else {
            for (const inc of incidents) {
                incidentsWrap.appendChild(renderIncidentCard(inc));
            }
        }
        rightCol.appendChild(incidentsWrap);
        board.appendChild(rightCol);

        shell.appendChild(board);
    }

    load();

    return function cleanup() {
        mounted = false;
    };
}

export default { render, cleanup: () => {} };
