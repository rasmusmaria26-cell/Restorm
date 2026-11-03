/**
 * IncidentsPage.js — Incident listing page.
 *
 * Lists all alerts grouped into incidents (by interface_ID + ruleCode),
 * sorted: Open before Acknowledged/Resolved, then severity (Critical > High
 * > Warning > Info), then newest detectedAt.
 *
 * Action buttons per permission: Acknowledge (Open), Resolve (Acknowledged),
 * Explain, Export Report. Permission-aware: alice (viewer) sees buttons
 * disabled; bob/admin can act. All state changes call actual backend
 * operations via the api client — never frontend-only lifecycle changes.
 *
 * Exports render(container, context) and cleanup(). context provides:
 *   api, getState, setState, FRIENDLY_RULE_TITLES, SEVERITY_WEIGHT,
 *   userRoles, currentUser, formatDurationSeconds, formatShortTime
 */

import { LoadingState } from '../components/LoadingState.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';

const STATUS_ORDER = { Open: 0, Acknowledged: 1, Resolved: 2 };

export function render(container, context = {}) {
    container.innerHTML = '';
    const {
        api,
        getState,
        setState,
        FRIENDLY_RULE_TITLES = {},
        SEVERITY_WEIGHT = { Critical: 3, High: 2, Warning: 1, Info: 0 },
        userRoles,
        currentUser,
        formatDurationSeconds,
        formatShortTime
    } = context;

    const roles = Array.isArray(userRoles) ? userRoles : [];
    const userName = currentUser || 'user';
    const isAdmin = roles.includes('SimulatorAdmin');
    const isOperator = roles.includes('SupportOperator');
    const canAcknowledge = isAdmin || isOperator;
    const canResolve = isAdmin || isOperator;
    const perms = { canAcknowledge, canResolve, isAdmin, isOperator };
    const fmtDur = typeof formatDurationSeconds === 'function' ? formatDurationSeconds : (s) => String(s);
    const fmtTime = typeof formatShortTime === 'function' ? formatShortTime : (s) => (s || '');

    function getFriendlyTitle(ruleCode) {
        return FRIENDLY_RULE_TITLES[ruleCode] || ruleCode.replace(/_/g, ' ').toLowerCase();
    }

    function statusClass(status) {
        switch (status) {
            case 'Open': return 'status-badge critical';
            case 'Acknowledged': return 'status-badge high';
            case 'Resolved': return 'status-badge healthy';
            default: return 'status-badge';
        }
    }

    function severityClass(severity) {
        switch (severity) {
            case 'Critical': return 'is-critical';
            case 'High': return 'is-high';
            default: return '';
        }
    }

    function detectSort(a, b) {
        return new Date(b.detectedAt) - new Date(a.detectedAt);
    }

    function severitySort(a, b) {
        const wa = SEVERITY_WEIGHT[a.severity] ?? 0;
        const wb = SEVERITY_WEIGHT[b.severity] ?? 0;
        return wb - wa;
    }

    /**
     * Group alerts into incidents by (interface_ID + ruleCode).
     * Each incident representative is the most recent alert in the group.
     */
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
            members.sort(detectSort);
            const rep = members[0];
            const open = members.some(m => m.status === 'Open');
            const acknowledged = members.some(m => m.status === 'Acknowledged');
            const resolved = members.every(m => m.status === 'Resolved');
            const status = open ? 'Open' : acknowledged ? 'Acknowledged' : 'Resolved';
            const repeatCount = Math.max(...members.map(m => m.repeatCount || 1));
            incidents.push({ ...rep, _members: members, status, repeatCount, ongoingSince: rep.detectedAt });
        }

        incidents.sort((a, b) => {
            const sa = STATUS_ORDER[a.status] ?? 9;
            const sb = STATUS_ORDER[b.status] ?? 9;
            if (sa !== sb) return sa - sb;
            const sevCmp = severitySort(a, b);
            if (sevCmp !== 0) return sevCmp;
            return detectSort(a, b);
        });
        return incidents;
    }

    function renderIncidentCard(incident, handleAction) {
        const { interface: iface, ruleCode, severity, status, summary, detectedAt, repeatCount, ongoingSince, ID } = incident;
        const ifaceName = iface ? iface.name : 'Unknown interface';
        const ifacePath = iface ? `${iface.sourceSystem || 'Source'} → ${iface.targetSystem || 'Target'}` : '';

        const card = Card({ className: `alert-card ${severityClass(severity)} ${status === 'Acknowledged' ? 'is-acknowledged' : ''}` });
        card.dataset.incidentId = ID;

        const header = document.createElement('div');
        header.className = 'alert-card-header';

        const titles = document.createElement('div');
        titles.className = 'alert-titles-wrap';
        const friendly = document.createElement('h3');
        friendly.className = 'alert-friendly-title';
        friendly.textContent = getFriendlyTitle(ruleCode);
        const rule = document.createElement('div');
        rule.className = 'alert-rule-subcode';
        rule.textContent = ruleCode;
        titles.append(friendly, rule);

        const badge = document.createElement('span');
        badge.className = statusClass(status);
        badge.textContent = status;
        header.append(titles, badge);

        const ifaceTag = document.createElement('div');
        ifaceTag.className = 'alert-interface-tag';
        ifaceTag.textContent = ifaceName;
        if (ifacePath) ifaceTag.textContent += `  •  ${ifacePath}`;

        const evidence = document.createElement('div');
        evidence.className = 'evidence-line';
        let evidenceText = '';
        try {
            const metrics = typeof incident.observedMetrics === 'string'
                ? JSON.parse(incident.observedMetrics || '{}')
                : (incident.observedMetrics || {});
            const parts = [];
            if (metrics.pendingCount !== undefined) parts.push(`pending: ${metrics.pendingCount}`);
            if (metrics.retryAttempts !== undefined) parts.push(`retries: ${metrics.retryAttempts}`);
            if (metrics.oldestPendingAgeSeconds !== undefined) parts.push(`age: ${fmtDur(metrics.oldestPendingAgeSeconds)}`);
            evidenceText = parts.length ? parts.join('  •  ') : 'No observed metrics';
        } catch (e) {
            evidenceText = 'Malformed metrics';
        }
        evidence.textContent = evidenceText;

        const meta = document.createElement('div');
        meta.className = 'incident-meta-row';
        const ongoing = document.createElement('span');
        ongoing.className = 'ongoing-incident-tag';
        ongoing.textContent = `Ongoing since ${fmtTime(detectedAt)}`;
        const repeat = document.createElement('span');
        repeat.textContent = `Repeat count: ${repeatCount}`;
        meta.append(ongoing, repeat);

        const summaryEl = document.createElement('p');
        summaryEl.style.margin = '0';
        summaryEl.style.fontSize = '0.8125rem';
        summaryEl.style.color = 'var(--color-slate)';
        summaryEl.textContent = summary || 'No summary available.';

        const actions = document.createElement('div');
        actions.className = 'alert-actions-row';

        const canAck = perms.canAcknowledge && status === 'Open';
        const canResolve = perms.canResolve && status === 'Acknowledged';

        const ackBtn = Button({
            text: 'Acknowledge',
            variant: 'harbor',
            disabled: !canAck,
            title: !perms.canAcknowledge ? 'Viewer role cannot acknowledge incidents' : (status !== 'Open' ? 'Only Open incidents can be acknowledged' : ''),
            onClick: () => handleAction('acknowledge', ID)
        });

        const resolveBtn = Button({
            text: 'Resolve',
            variant: 'healthy',
            disabled: !canResolve,
            title: !perms.canResolve ? 'Viewer role cannot resolve incidents' : (status !== 'Acknowledged' ? 'Only Acknowledged incidents can be resolved' : ''),
            onClick: () => handleAction('resolve', ID)
        });

        const explainBtn = Button({
            text: 'Explain',
            variant: 'quiet',
            onClick: () => handleAction('explain', ID)
        });

        const exportBtn = Button({
            text: 'Export Report',
            variant: 'quiet',
            onClick: () => handleAction('export', ID)
        });

        actions.append(ackBtn, resolveBtn, explainBtn, exportBtn);

        card.append(header, ifaceTag, evidence, meta, summaryEl, actions);
        return card;
    }

    function getFriendlyErrorMessage(err, actionContext) {
        if (err.status === 403) {
            if (actionContext === 'acknowledge') return `${userName} can't acknowledge alerts. Support Operator or Simulator Admin permissions required.`;
            if (actionContext === 'resolve') return `${userName} can't resolve alerts. Support Operator or Simulator Admin permissions required.`;
            return `${userName} doesn't have permission for this action.`;
        }
        if (err.status === 401) return 'Authentication required. Please select a valid operator.';
        if (err.status === 404) return 'The requested alert could not be found.';
        if (err.status === 409) return 'This action conflicts with the current alert state.';
        return `Operation could not complete: ${err.message || 'Network error'}`;
    }

    const heading = document.createElement('h2');
    heading.className = 'column-title';
    heading.textContent = 'Incidents';
    const countBadge = document.createElement('span');
    countBadge.className = 'column-count';
    countBadge.textContent = '0 incidents';
    const headerRow = document.createElement('div');
    headerRow.className = 'column-header';
    headerRow.append(heading, countBadge);
    container.appendChild(headerRow);

    const list = document.createElement('div');
    list.className = 'incidents-list';
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '12px';
    container.appendChild(list);

    let mounted = true;

    async function load() {
        list.replaceChildren();
        list.appendChild(LoadingState({ message: 'Loading incidents…' }));
        try {
            const data = await api.fetchAlerts();
            const alerts = Array.isArray(data) ? data : (data.value || []);
            if (!mounted) return;
            const incidents = groupIntoIncidents(alerts);
            countBadge.textContent = `${incidents.length} incident${incidents.length !== 1 ? 's' : ''}`;
            renderIncidents(incidents);
        } catch (err) {
            if (!mounted) return;
            list.replaceChildren();
            list.appendChild(ErrorState({
                message: err.message || 'Failed to load incidents',
                onRetry: load,
                retryLabel: 'Retry'
            }));
        }
    }

    function renderIncidents(incidents) {
        list.replaceChildren();
        if (incidents.length === 0) {
            list.appendChild(EmptyState({
                title: 'No incidents',
                subtitle: 'All monitored interfaces are healthy. No active alerts detected.'
            }));
            return;
        }
        const frag = document.createDocumentFragment();
        for (const incident of incidents) {
            frag.appendChild(renderIncidentCard(incident, handleAction));
        }
        list.appendChild(frag);
    }

    async function handleAction(action, alertId) {
        if (action === 'acknowledge' && !canAcknowledge) {
            showPageError(`${userName} cannot acknowledge alerts (view-only).`);
            return;
        }
        if (action === 'resolve' && !canResolve) {
            showPageError(`${userName} cannot resolve alerts (view-only).`);
            return;
        }

        try {
            const actor = userName;
            if (action === 'acknowledge') {
                await api.acknowledgeAlert(alertId, actor);
                await load();
            } else if (action === 'resolve') {
                await api.resolveAlert(alertId, actor);
                await load();
            } else if (action === 'explain') {
                window.location.hash = `#incident/${alertId}?explain=1`;
            } else if (action === 'export') {
                await exportReport(alertId);
            }
        } catch (err) {
            showPageError(getFriendlyErrorMessage(err, action));
        }
    }

    async function exportReport(alertId) {
        try {
            const data = await api.exportIncidentReport(alertId, 'markdown');
            const markdown = data.value || data || '';
            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Incident-Postmortem-${alertId}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            showPageError(getFriendlyErrorMessage(err, 'export'));
        }
    }

    function showPageError(message) {
        const existing = container.querySelector('.page-error');
        if (existing) existing.remove();
        const box = document.createElement('div');
        box.className = 'page-error';
        box.style.color = 'var(--color-critical-text)';
        box.style.padding = '10px 14px';
        box.style.marginBottom = '12px';
        box.style.border = '1px solid var(--color-divider)';
        box.style.borderRadius = '6px';
        box.style.background = 'var(--color-critical-badge-bg)';
        box.textContent = message;
        container.insertBefore(box, list);
        setTimeout(() => box.remove(), 5000);
    }

    load();

    return function unload() {
        mounted = false;
    };
}

export function cleanup() {
    // No persistent listeners/timers.
}
