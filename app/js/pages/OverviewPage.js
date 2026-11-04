/**
 * OverviewPage.js — Operational overview page.
 *
 * Renders:
 *   - KPI cards: total interfaces, open alerts, critical alerts, high alerts,
 *     total pending, total retries (computed from live backend data)
 *   - Headline banner showing highest open severity across estate in a slim strip
 *   - Interface cards grid: sorted by severity (critical/high first, healthy last),
 *     unhealthy interfaces get full card with sparkline, healthy get compact rows
 *   - Active incident summary: alerts grouped by interface+ruleCode
 *   - Bottom section: Backlog trend chart and Recent retries table
 *
 * All metrics computed from real backend data via fetchInterfaces + fetchAlerts.
 *
 * Exports render(container, context), computeKPIs(interfaces, alerts),
 * and groupIncidents(alerts, interfaces).
 */

import { LoadingState } from '../components/LoadingState.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';
import { Sparkline } from '../components/Sparkline.js';
import { getState } from '../store.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function latestSnapshot(iface) {
    const snaps = iface.snapshots || [];
    return snaps.length ? snaps[snaps.length - 1] : null;
}

/**
 * Determine interface operational status matching deterministic detection rules:
 * - Rule A: EXCESSIVE_RETRIES (Critical)
 * - Rule B: QUEUE_GROWTH (High)
 * - Rule C: OLD_MESSAGE_AGE (High)
 * - Rule D: RECOVERY_STALLED (High)
 * Also checks any open alerts for this interface.
 */
export function getInterfaceStatus(iface, alerts = []) {
    // 1. Check open alerts directly linked to this interface
    if (alerts && alerts.length) {
        const ifaceAlerts = alerts.filter(a => a.interface_ID === iface.ID && a.status === 'Open');
        if (ifaceAlerts.some(a => a.severity === 'Critical')) return 'critical';
        if (ifaceAlerts.some(a => a.severity === 'High')) return 'high';
        if (ifaceAlerts.some(a => a.severity === 'Warning')) return 'predictive-warning';
    }

    // 2. Evaluate latest snapshot against configured thresholds
    const snap = latestSnapshot(iface);
    if (!snap) return 'healthy';
    const pending = Number(snap.pendingCount) || 0;
    const retry = Number(snap.retryAttempts) || 0;
    const age = Number(snap.oldestPendingAgeSeconds) || 0;
    const limit = Number(iface.queueGrowthLimit) || 200;
    const retryLimit = Number(iface.maxRetryThreshold) || 100;
    const ageLimit = Number(iface.oldMessageAgeLimitSeconds) || 600;

    // Rule A: Excessive retries -> Critical (Confirmed incident)
    if (retry >= retryLimit) return 'critical';
    // Rules B & C: Queue growth or old message age -> High (Confirmed incident)
    if (pending >= limit || age >= ageLimit) return 'high';
    // Warning threshold (70%) -> Predictive Warning (pre-breach warning zone)
    if (pending >= limit * 0.7 || retry >= retryLimit * 0.7 || age >= ageLimit * 0.7) return 'predictive-warning';

    return 'healthy';
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
    const map = {
        healthy: 'Healthy',
        high: 'High Incident',
        critical: 'Critical Incident',
        'predictive-warning': 'Predictive Warning'
    };
    return map[status] || 'Healthy';
}

function severityRank(sev) {
    const w = { Critical: 3, High: 2, Warning: 1, Info: 0 };
    return w[sev] || 0;
}

function computeBannerSeverity(kpis, interfaces, alerts) {
    if (kpis.criticalAlerts > 0) return 'critical';
    if (kpis.highAlerts > 0) return 'high';
    if (kpis.openAlerts > 0) return 'high';

    // Check store predictions for active warning
    try {
        const storeState = typeof getState === 'function' ? getState() : null;
        const predictions = storeState?.predictions || [];
        const activePred = predictions.find(p => p.status === 'PREDICTIVE_WARNING');
        if (activePred) return 'predictive-warning';
    } catch (e) {
        // Fallback
    }

    const ifaceStatuses = interfaces.map(i => getInterfaceStatus(i, alerts));
    if (ifaceStatuses.includes('critical')) return 'critical';
    if (ifaceStatuses.includes('high')) return 'high';
    if (ifaceStatuses.includes('predictive-warning')) return 'predictive-warning';
    return 'healthy';
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

const priorKpiValues = new Map();

export function animateCounter(element, startVal, endVal, duration = 380) {
    if (!element) return;
    const start = Number(startVal) || 0;
    const end = Number(endVal) || 0;
    if (element.dataset) {
        element.dataset.val = String(end);
    }

    const prefersReducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReducedMotion || duration <= 0 || start === end) {
        element.textContent = formatNumber(end);
        return;
    }

    if (typeof requestAnimationFrame !== 'function') {
        element.textContent = formatNumber(end);
        return;
    }

    const startTime = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();

    function step(currentTime) {
        const now = currentTime || ((typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now());
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // easeOutQuad
        const ease = 1 - (1 - progress) * (1 - progress);
        const currentVal = Math.round(start + (end - start) * ease);
        element.textContent = formatNumber(currentVal);

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            element.textContent = formatNumber(end);
        }
    }

    requestAnimationFrame(step);
}

function renderKpiCard(label, value, sub, status = 'healthy') {
    const card = document.createElement('div');
    card.className = `kpi-card is-${status}`;
    const numValue = Number(value) || 0;
    const startVal = priorKpiValues.has(label) ? priorKpiValues.get(label) : numValue;
    priorKpiValues.set(label, numValue);

    card.innerHTML = `
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="kpi-value" data-val="${escapeHtml(String(numValue))}">${escapeHtml(formatNumber(startVal))}</div>
        <div class="kpi-sub">${escapeHtml(sub || ' ')}</div>
    `;

    const valueEl = (typeof card.querySelector === 'function') ? card.querySelector('.kpi-value') : null;
    if (valueEl) {
        animateCounter(valueEl, startVal, numValue, 380);
    }

    return card;
}

function renderHeadline(kpis, severity) {
    const strip = document.createElement('div');
    strip.className = `headline-strip is-${severity}`;

    let iconSvg = '';
    if (severity === 'critical') {
        iconSvg = `<svg class="headline-icon is-critical" viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/>
        </svg>`;
    } else if (severity === 'high') {
        iconSvg = `<svg class="headline-icon is-high" viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
            <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
        </svg>`;
    } else if (severity === 'predictive-warning') {
        iconSvg = `<svg class="headline-icon is-predictive" viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm.75 4.75a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zm-.75 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
        </svg>`;
    } else {
        iconSvg = `<svg class="headline-icon is-healthy" viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/>
        </svg>`;
    }

    let activeWarning = null;
    try {
        const storeState = typeof getState === 'function' ? getState() : null;
        const predictions = storeState?.predictions || [];
        activeWarning = predictions.find(p => p.status === 'PREDICTIVE_WARNING');
    } catch (e) {}

    const messages = {
        critical: `Critical incident detected — ${kpis.criticalAlerts} critical, ${kpis.highAlerts} high open alert${kpis.openAlerts > 1 ? 's' : ''}`,
        high: `Confirmed incident: high-severity backlog growth across interfaces — ${kpis.highAlerts} high open alert${kpis.highAlerts > 1 ? 's' : ''}`,
        'predictive-warning': activeWarning
            ? `Predictive Warning — Impending ${activeWarning.metricLabel || 'threshold'} breach on ${activeWarning.interfaceName} in ~${activeWarning.estimatedSecondsToBreach}s (+${activeWarning.growthRatePerSecond}/s, Confidence: ${Math.round(activeWarning.confidence * 100)}%)`
            : `Predictive warning — Interface approaching threshold, storm imminent`,
        healthy: `All ${kpis.totalInterfaces} interfaces operating normally within thresholds`
    };

    const text = messages[severity] || messages.healthy;

    strip.innerHTML = `
        <div class="headline-left">
            <span class="headline-icon-wrap">${iconSvg}</span>
            <span class="headline-text">${escapeHtml(text)}</span>
        </div>
        <div class="headline-right">
            <button id="btnViewIncidents" class="btn btn-sm btn-harbor" type="button">View incident${kpis.openAlerts === 1 ? '' : 's'}</button>
        </div>
    `;

    const viewBtn = strip.querySelector('#btnViewIncidents');
    if (viewBtn) {
        viewBtn.addEventListener('click', () => {
            window.location.hash = '#incidents';
        });
    }

    return strip;
}

function renderInterfaceCard(iface, snap, status) {
    const card = Card({ className: `interface-card${status !== 'healthy' ? ' has-alert' : ''}` });
    const pending = snap ? Number(snap.pendingCount) || 0 : 0;
    const retries = snap ? Number(snap.retryAttempts) || 0 : 0;
    const age = snap ? Number(snap.oldestPendingAgeSeconds) || 0 : 0;
    const overLimit = status !== 'healthy';

    const name = escapeHtml(iface.name || 'Unnamed Interface');
    const path = escapeHtml(`${iface.sourceSystem || '—'} → ${iface.targetSystem || '—'}`);
    const schedule = escapeHtml(iface.expectedSchedule || '—');

    const sparklineContent = pending === 0
        ? `<div class="no-backlog-placeholder"><span class="no-backlog-badge">No backlog</span></div>`
        : Sparkline({ snapshots: iface.snapshots || [], limitValue: Number(iface.queueGrowthLimit) || 200, width: 200, height: 40 }).outerHTML;

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
                ${sparklineContent}
            </div>
            <div class="pressure-summary">
                <div class="pressure-count${overLimit ? ' is-over-limit' : ''}">${formatNumber(pending)}</div>
                <div class="pressure-count-label">pending</div>
            </div>
        </div>
        <div class="interface-footer-caption">
            <span class="footer-stat">${formatNumber(retries)} retries</span>
            <span class="footer-sep" aria-hidden="true">•</span>
            <span class="footer-stat">${age ? formatAge(age) : '—'} oldest</span>
            <span class="footer-sep" aria-hidden="true">•</span>
            <span class="footer-stat">${schedule}</span>
        </div>
    `;

    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
        window.location.hash = `#interface/${iface.ID}`;
    });

    return card;
}

function renderInterfaceCompactRow(iface, snap) {
    const row = document.createElement('div');
    row.className = 'interface-compact-row';
    const retries = snap ? Number(snap.retryAttempts) || 0 : 0;
    const age = snap ? Number(snap.oldestPendingAgeSeconds) || 0 : 0;
    const schedule = escapeHtml(iface.expectedSchedule || '—');
    const name = escapeHtml(iface.name || 'Unnamed Interface');
    const path = escapeHtml(`${iface.sourceSystem || '—'} → ${iface.targetSystem || '—'}`);

    row.innerHTML = `
        <div class="compact-main">
            <span class="status-dot healthy-dot" aria-hidden="true"></span>
            <div class="compact-titles">
                <span class="compact-name">${name}</span>
                <span class="compact-path">${path}</span>
            </div>
        </div>
        <div class="compact-backlog">
            <span class="no-backlog-pill">No backlog</span>
        </div>
        <div class="compact-telemetry">
            <span class="footer-stat">${formatNumber(retries)} retries</span>
            <span class="footer-sep" aria-hidden="true">•</span>
            <span class="footer-stat">${age ? formatAge(age) : '—'} oldest</span>
            <span class="footer-sep" aria-hidden="true">•</span>
            <span class="footer-stat">${schedule}</span>
        </div>
        <span class="status-badge healthy">
            <span class="status-dot"></span>Healthy
        </span>
    `;

    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
        window.location.hash = `#interface/${iface.ID}`;
    });

    return row;
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

function renderBacklogTrendCard(interfaces) {
    const card = Card({ className: 'trend-chart-card' });

    let allPoints = [];
    const maxSnapshots = Math.max(...interfaces.map(i => (i.snapshots || []).length), 0);

    if (maxSnapshots > 0) {
        for (let idx = 0; idx < maxSnapshots; idx++) {
            let totalPending = 0;
            let timeLabel = '';
            for (const iface of interfaces) {
                const snaps = iface.snapshots || [];
                if (snaps[idx]) {
                    totalPending += Number(snaps[idx].pendingCount) || 0;
                    if (!timeLabel && snaps[idx].snapshotTime) {
                        timeLabel = snaps[idx].snapshotTime;
                    }
                }
            }
            allPoints.push({ index: idx, pending: totalPending, time: timeLabel });
        }
        allPoints = allPoints.slice(-20);
    } else {
        allPoints = [{ index: 0, pending: 0, time: 'now' }];
    }

    const maxVal = Math.max(...allPoints.map(p => p.pending), 100);
    const chartW = 480;
    const chartH = 140;
    const padL = 36;
    const padR = 16;
    const padT = 16;
    const padB = 26;
    const plotW = chartW - padL - padR;
    const plotH = chartH - padT - padB;

    const coords = allPoints.map((p, i) => {
        const x = allPoints.length === 1
            ? padL + plotW / 2
            : padL + (i / (allPoints.length - 1)) * plotW;
        const y = padT + plotH - (p.pending / maxVal) * plotH;
        return { x: Math.round(x), y: Math.round(y), p };
    });

    const pointsStr = coords.map(c => `${c.x},${c.y}`).join(' ');
    const areaPoints = [
        `${coords[0].x},${padT + plotH}`,
        ...coords.map(c => `${c.x},${c.y}`),
        `${coords[coords.length - 1].x},${padT + plotH}`
    ].join(' ');

    const latestVal = allPoints.length ? allPoints[allPoints.length - 1].pending : 0;

    card.innerHTML = `
        <div class="card-header-clean">
            <div class="header-titles">
                <h4 class="card-title-sm">Backlog trend</h4>
                <p class="card-subtitle-sm">Aggregate queue accumulation across estate</p>
            </div>
            <span class="trend-current-badge">${formatNumber(latestVal)} total pending</span>
        </div>
        <div class="chart-container">
            <svg class="trend-chart-svg" viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="backlogTrendGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#1B365D" stop-opacity="0.25"/>
                        <stop offset="100%" stop-color="#1B365D" stop-opacity="0.02"/>
                    </linearGradient>
                </defs>
                <line x1="${padL}" y1="${padT}" x2="${chartW - padR}" y2="${padT}" stroke="#E5E7EB" stroke-dasharray="3,3" />
                <line x1="${padL}" y1="${padT + plotH / 2}" x2="${chartW - padR}" y2="${padT + plotH / 2}" stroke="#E5E7EB" stroke-dasharray="3,3" />
                <line x1="${padL}" y1="${padT + plotH}" x2="${chartW - padR}" y2="${padT + plotH}" stroke="#D1D5DB" />

                <text x="${padL - 6}" y="${padT + 4}" font-size="10" fill="#9CA3AF" text-anchor="end">${maxVal}</text>
                <text x="${padL - 6}" y="${padT + plotH / 2 + 3}" font-size="10" fill="#9CA3AF" text-anchor="end">${Math.round(maxVal / 2)}</text>
                <text x="${padL - 6}" y="${padT + plotH + 3}" font-size="10" fill="#9CA3AF" text-anchor="end">0</text>

                <polygon points="${areaPoints}" fill="url(#backlogTrendGrad)" />
                <polyline points="${pointsStr}" fill="none" stroke="#1B365D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

                ${coords.map(c => `
                    <circle cx="${c.x}" cy="${c.y}" r="3.5" fill="#FFFFFF" stroke="#1B365D" stroke-width="2">
                        <title>${c.p.pending} pending</title>
                    </circle>
                `).join('')}

                <text x="${padL}" y="${chartH - 8}" font-size="10" fill="#9CA3AF" text-anchor="start">T-10</text>
                <text x="${padL + plotW / 2}" y="${chartH - 8}" font-size="10" fill="#9CA3AF" text-anchor="middle">T-5</text>
                <text x="${chartW - padR}" y="${chartH - 8}" font-size="10" fill="#9CA3AF" text-anchor="end">Now</text>
            </svg>
        </div>
    `;

    return card;
}

function renderRecentRetriesCard(interfaces, alerts) {
    const card = Card({ className: 'recent-retries-card' });

    const rowsData = [...interfaces].map(iface => {
        const snap = latestSnapshot(iface);
        const retries = snap ? Number(snap.retryAttempts) || 0 : 0;
        const pending = snap ? Number(snap.pendingCount) || 0 : 0;
        const age = snap ? Number(snap.oldestPendingAgeSeconds) || 0 : 0;
        const status = getInterfaceStatus(iface, alerts);
        return { iface, snap, retries, pending, age, status };
    }).sort((a, b) => b.retries - a.retries || b.pending - a.pending);

    card.innerHTML = `
        <div class="card-header-clean">
            <div class="header-titles">
                <h4 class="card-title-sm">Recent retries</h4>
                <p class="card-subtitle-sm">Interface retry pressure &amp; delivery status</p>
            </div>
        </div>
        <div class="table-wrap-clean">
            <table class="recent-retries-table">
                <thead>
                    <tr>
                        <th>Interface</th>
                        <th>Target</th>
                        <th class="text-right">Retries</th>
                        <th class="text-right">Oldest</th>
                        <th class="text-right">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsData.map(r => `
                        <tr class="clickable-row" data-id="${escapeHtml(r.iface.ID)}">
                            <td class="font-medium">${escapeHtml(r.iface.name)}</td>
                            <td class="text-muted">${escapeHtml(r.iface.targetSystem || '—')}</td>
                            <td class="text-right font-medium${r.retries > 0 ? ' text-amber' : ''}">${formatNumber(r.retries)}</td>
                            <td class="text-right text-muted">${r.age ? formatAge(r.age) : '—'}</td>
                            <td class="text-right">
                                <span class="status-badge ${r.status}">
                                    <span class="status-dot"></span>${statusLabel(r.status)}
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    card.querySelectorAll('.clickable-row').forEach(row => {
        row.addEventListener('click', () => {
            const id = row.getAttribute('data-id');
            if (id) window.location.hash = `#interface/${id}`;
        });
    });

    return card;
}

/* ------------------------------------------------------------------ */
/* Page render                                                        */
/* ------------------------------------------------------------------ */

export function render(container, context = {}) {
    const {
        api
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
        const bannerSeverity = computeBannerSeverity(kpis, interfaces, alerts);

        // --- KPI strip (Equal height, biggest number, small label above) ---
        const kpiStrip = document.createElement('div');
        kpiStrip.className = 'kpi-strip';
        kpiStrip.style.display = 'grid';
        kpiStrip.style.gridTemplateColumns = 'repeat(auto-fit, minmax(150px, 1fr))';
        kpiStrip.style.gap = '12px';
        kpiStrip.style.marginBottom = '16px';

        kpiStrip.appendChild(renderKpiCard('Interfaces', kpis.totalInterfaces, 'monitored endpoints'));
        kpiStrip.appendChild(renderKpiCard('Open Alerts', kpis.openAlerts, kpis.criticalAlerts > 0 ? `${kpis.criticalAlerts} critical` : (kpis.highAlerts > 0 ? `${kpis.highAlerts} high` : 'healthy estate'), kpis.criticalAlerts > 0 ? 'critical' : (kpis.highAlerts > 0 ? 'high' : 'healthy')));
        kpiStrip.appendChild(renderKpiCard('Critical', kpis.criticalAlerts, kpis.criticalAlerts > 0 ? 'requires attention' : 'none active', kpis.criticalAlerts > 0 ? 'critical' : 'healthy'));
        kpiStrip.appendChild(renderKpiCard('High', kpis.highAlerts, kpis.highAlerts > 0 ? 'backlog growth' : 'none active', kpis.highAlerts > 0 ? 'high' : 'healthy'));
        kpiStrip.appendChild(renderKpiCard('Pending', formatNumber(kpis.totalPending), 'latest snapshots'));
        kpiStrip.appendChild(renderKpiCard('Retries', formatNumber(kpis.totalRetries), 'attempts total'));
        shell.appendChild(kpiStrip);

        // --- Slim Headline Banner (Single line, severity icon, left aligned, View incident button) ---
        shell.appendChild(renderHeadline(kpis, bannerSeverity));

        // --- Control board grid (Interface Status + Active Incidents) ---
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

        // Sort interfaces by severity: critical -> high -> predictive-warning -> healthy, then name
        const severityRankOrder = { critical: 4, high: 3, 'predictive-warning': 2, healthy: 1 };
        const sortedInterfaces = [...interfaces].sort((a, b) => {
            const sevA = getInterfaceStatus(a, alerts);
            const sevB = getInterfaceStatus(b, alerts);
            const diff = (severityRankOrder[sevB] || 0) - (severityRankOrder[sevA] || 0);
            if (diff !== 0) return diff;
            return (a.name || '').localeCompare(b.name || '');
        });

        const unhealthyInterfaces = sortedInterfaces.filter(i => getInterfaceStatus(i, alerts) !== 'healthy');
        const healthyInterfaces = sortedInterfaces.filter(i => getInterfaceStatus(i, alerts) === 'healthy');

        if (!interfaces.length) {
            leftCol.appendChild(EmptyState({ title: 'No interfaces monitored', subtitle: 'Registered integration endpoints will appear here.' }));
        } else {
            // Unhealthy interfaces get full card with sparkline in a 3-column grid
            if (unhealthyInterfaces.length > 0) {
                const unhealthyGrid = document.createElement('div');
                unhealthyGrid.className = `interface-cards-grid${unhealthyInterfaces.length === 1 ? ' is-single-card' : (unhealthyInterfaces.length === 2 ? ' is-two-cards' : '')}`;
                for (const iface of unhealthyInterfaces) {
                    const snap = latestSnapshot(iface);
                    const status = getInterfaceStatus(iface, alerts);
                    unhealthyGrid.appendChild(renderInterfaceCard(iface, snap, status));
                }
                leftCol.appendChild(unhealthyGrid);
            }

            // Healthy interfaces render as compact rows
            if (healthyInterfaces.length > 0) {
                const healthyWrap = document.createElement('div');
                healthyWrap.className = 'healthy-interfaces-wrap';
                if (unhealthyInterfaces.length > 0) {
                    const subHead = document.createElement('div');
                    subHead.className = 'sub-column-title';
                    subHead.textContent = `Healthy interfaces (${healthyInterfaces.length})`;
                    healthyWrap.appendChild(subHead);
                }
                const compactList = document.createElement('div');
                compactList.className = 'interface-compact-list';
                for (const iface of healthyInterfaces) {
                    const snap = latestSnapshot(iface);
                    compactList.appendChild(renderInterfaceCompactRow(iface, snap));
                }
                healthyWrap.appendChild(compactList);
                leftCol.appendChild(healthyWrap);
            }
        }
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

        // --- Bottom section: Backlog trend chart + Recent retries table ---
        const bottomGrid = document.createElement('div');
        bottomGrid.className = 'overview-bottom-grid';
        bottomGrid.appendChild(renderBacklogTrendCard(interfaces));
        bottomGrid.appendChild(renderRecentRetriesCard(interfaces, alerts));
        shell.appendChild(bottomGrid);
    }

    load();

    return function cleanup() {
        mounted = false;
    };
}

export default { render, cleanup: () => {} };
