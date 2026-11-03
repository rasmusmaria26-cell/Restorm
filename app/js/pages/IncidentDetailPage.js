/**
 * IncidentDetailPage.js — Incident detail page (route: #incident/:id).
 *
 * Full incident detail: ID, ruleCode, severity, status, detectedAt,
 * windowStart/End, repeatCount, observedMetrics table, summary.
 * Interface info: name, source → target.
 * Timeline: detected → acknowledged → resolved (with actors and timestamps).
 * Acknowledge/Resolve buttons (permission-aware, call actual backend).
 * Explain button: calls explain action, shows AI-grounded explanation with
 * hypotheses clearly labeled as unproven.
 * Export Report button: downloads markdown postmortem.
 * Runbook references: cited runbook IDs with titles.
 *
 * Exports render(container, context) and cleanup(). context provides:
 *   api, getState, setState, params, FRIENDLY_RULE_TITLES, SEVERITY_WEIGHT,
 *   userRoles, currentUser, formatDurationSeconds, formatShortTime
 */

import { LoadingState } from '../components/LoadingState.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';
import { BASE_URL } from '../api-client.js';

function severityClass(severity) {
    switch (severity) {
        case 'Critical': return 'is-critical';
        case 'High': return 'is-high';
        default: return '';
    }
}

function statusClass(status) {
    switch (status) {
        case 'Open': return 'status-badge critical';
        case 'Acknowledged': return 'status-badge high';
        case 'Resolved': return 'status-badge healthy';
        default: return 'status-badge';
    }
}

function parseMetrics(observedMetrics) {
    if (!observedMetrics) return {};
    if (typeof observedMetrics === 'object') return observedMetrics;
    try { return JSON.parse(observedMetrics); } catch (e) { return { raw: String(observedMetrics) }; }
}

async function fetchRunbooks() {
    try {
        const data = await api.fetchRunbooks();
        return Array.isArray(data.value) ? data.value : (Array.isArray(data) ? data : []);
    } catch {
        return [];
    }
}

function runbookTitleById(runbooks, id) {
    const entry = runbooks.find(r => r.ID === id);
    return entry ? entry.title : id;
}

export function render(container, context = {}) {
    container.innerHTML = '';
    const {
        api,
        getState,
        params,
        FRIENDLY_RULE_TITLES,
        SEVERITY_WEIGHT,
        userRoles,
        currentUser,
        formatDurationSeconds,
        formatShortTime
    } = context;

    const alertId = params && params.id ? params.id : null;
    const roles = Array.isArray(userRoles) ? userRoles : [];
    const userName = currentUser || 'user';
    const isAdmin = roles.includes('SimulatorAdmin');
    const isOperator = roles.includes('SupportOperator');
    const canAcknowledge = isAdmin || isOperator;
    const canResolve = isAdmin || isOperator;
    const perms = { canAcknowledge, canResolve, isAdmin, isOperator };
    const friendly = FRIENDLY_RULE_TITLES || {};
    const fmtDur = typeof formatDurationSeconds === 'function' ? formatDurationSeconds : (s) => String(s);
    const fmtTime = typeof formatShortTime === 'function' ? formatShortTime : (s) => (s || '');

    let mounted = true;
    let runbooks = [];

    // --- Shell ---
    const page = document.createElement('div');
    page.className = 'incident-detail-page';

    const back = Button({
        text: '← Back to incidents',
        variant: 'quiet',
        onClick: () => { window.location.hash = '#incidents'; }
    });
    page.appendChild(back);

    const heading = document.createElement('h1');
    heading.className = 'headline-title';
    heading.textContent = 'Incident Detail';
    page.appendChild(heading);

    const content = document.createElement('div');
    content.className = 'detail-content';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '20px';
    page.appendChild(content);
    container.appendChild(page);

    const loader = LoadingState({ message: 'Loading incident…' });
    content.appendChild(loader);

    async function load() {
        content.replaceChildren();
        content.appendChild(LoadingState({ message: 'Loading incident…' }));
        try {
            if (!alertId) {
                content.replaceChildren();
                content.appendChild(ErrorState({ message: 'No incident ID specified.' }));
                return;
            }

            const data = await api.fetchAlerts();
            const alerts = Array.isArray(data) ? data : (data.value || []);
            const alert = alerts.find(a => a.ID === alertId);
            if (!alert) {
                content.replaceChildren();
                content.appendChild(ErrorState({ message: `Incident ${alertId} not found.` }));
                return;
            }

            runbooks = await fetchRunbooks().catch(() => []);
            renderDetail(alert);
        } catch (err) {
            if (!mounted) return;
            content.replaceChildren();
            content.appendChild(ErrorState({
                message: err.message || 'Failed to load incident',
                onRetry: load,
                retryLabel: 'Retry'
            }));
        }
    }

    function renderDetail(alert) {
        content.replaceChildren();
        const {
            ID, ruleCode, severity, status, detectedAt, windowStart, windowEnd,
            repeatCount, summary, observedMetrics, interface: iface,
            acknowledgedAt, acknowledgedBy, resolvedAt, resolvedBy
        } = alert;

        // Header row: title + status
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'flex-start';
        header.style.gap = '16px';
        header.style.flexWrap = 'wrap';

        const titleWrap = document.createElement('div');
        const friendlyTitle = document.createElement('h2');
        friendlyTitle.className = 'headline-title';
        friendlyTitle.textContent = friendly[ruleCode] || ruleCode.replace(/_/g, ' ').toLowerCase();
        const ruleCodeEl = document.createElement('div');
        ruleCodeEl.style.fontSize = '0.75rem';
        ruleCodeEl.style.color = 'var(--color-slate)';
        ruleCodeEl.style.fontFamily = 'monospace';
        ruleCodeEl.textContent = `Rule: ${ruleCode}`;
        titleWrap.append(friendlyTitle, ruleCodeEl);

        const badge = document.createElement('span');
        badge.className = statusClass(status);
        badge.textContent = status;

        header.append(titleWrap, badge);
        content.appendChild(header);

        // Incident info card
        const infoCard = Card();
        const infoHead = document.createElement('h3');
        infoHead.className = 'drawer-section-title';
        infoHead.textContent = 'Incident';
        infoCard.appendChild(infoHead);

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.fontSize = '0.875rem';
        const rows = [
            ['ID', ID],
            ['Severity', severity],
            ['Status', status],
            ['Detected at', fmtTime(detectedAt)],
            ['Window start', fmtTime(windowStart)],
            ['Window end', fmtTime(windowEnd)],
            ['Repeat count', String(repeatCount || 1)],
            ['Summary', summary || '—']
        ];
        for (const [label, value] of rows) {
            const tr = document.createElement('tr');
            const tdL = document.createElement('td');
            tdL.style.padding = '6px 8px';
            tdL.style.color = 'var(--color-slate)';
            tdL.style.verticalAlign = 'top';
            tdL.textContent = label;
            const tdV = document.createElement('td');
            tdV.style.padding = '6px 8px';
            tdV.style.verticalAlign = 'top';
            tdV.textContent = value;
            tr.append(tdL, tdV);
            table.appendChild(tr);
        }
        infoCard.appendChild(table);
        content.appendChild(infoCard);

        // Observed metrics table
        const metrics = parseMetrics(observedMetrics);
        const metricKeys = Object.keys(metrics);
        if (metricKeys.length > 0) {
            const metricsCard = Card();
            const mHead = document.createElement('h3');
            mHead.className = 'drawer-section-title';
            mHead.textContent = 'Observed metrics';
            metricsCard.appendChild(mHead);
            const mt = document.createElement('table');
            mt.style.width = '100%';
            mt.style.borderCollapse = 'collapse';
            mt.style.fontSize = '0.875rem';
            for (const key of metricKeys) {
                const tr = document.createElement('tr');
                const tdL = document.createElement('td');
                tdL.style.padding = '6px 8px';
                tdL.style.color = 'var(--color-slate)';
                tdL.style.verticalAlign = 'top';
                tdL.textContent = key;
                const tdV = document.createElement('td');
                tdV.style.padding = '6px 8px';
                tdV.style.verticalAlign = 'top';
                tdV.className = 'tabular-nums';
                let val = metrics[key];
                if (key === 'oldestPendingAgeSeconds') val = fmtDur(val);
                tdV.textContent = String(val);
                tr.append(tdL, tdV);
                mt.appendChild(tr);
            }
            metricsCard.appendChild(mt);
            content.appendChild(metricsCard);
        }

        // Interface info card
        const ifaceCard = Card();
        const ifaceHead = document.createElement('h3');
        ifaceHead.className = 'drawer-section-title';
        ifaceHead.textContent = 'Interface';
        ifaceCard.appendChild(ifaceHead);
        const ifaceName = document.createElement('p');
        ifaceName.style.margin = '4px 0 2px 0';
        ifaceName.style.fontWeight = '600';
        ifaceName.textContent = iface ? iface.name : 'Unknown interface';
        const ifacePath = document.createElement('p');
        ifacePath.style.margin = '0';
        ifacePath.style.color = 'var(--color-slate)';
        ifacePath.textContent = iface
            ? `${iface.sourceSystem || 'Source'} → ${iface.targetSystem || 'Target'}`
            : '—';
        ifaceCard.appendChild(ifaceName);
        ifaceCard.appendChild(ifacePath);
        content.appendChild(ifaceCard);

        // Timeline card
        const timelineCard = Card();
        const tHead = document.createElement('h3');
        tHead.className = 'drawer-section-title';
        tHead.textContent = 'Timeline';
        timelineCard.appendChild(tHead);
        const tl = document.createElement('div');
        tl.style.display = 'flex';
        tl.style.flexDirection = 'column';
        tl.style.gap = '10px';

        function timelineEvent(title, time, actor, note) {
            const ev = document.createElement('div');
            ev.style.display = 'flex';
            ev.style.gap = '10px';
            ev.style.alignItems = 'flex-start';
            const dot = document.createElement('div');
            dot.style.width = '8px';
            dot.style.height = '8px';
            dot.style.borderRadius = '50%';
            dot.style.backgroundColor = 'var(--color-harbor)';
            dot.style.marginTop = '6px';
            const body = document.createElement('div');
            const t = document.createElement('div');
            t.style.fontWeight = '600';
            t.textContent = title;
            const meta = document.createElement('div');
            meta.style.fontSize = '0.8125rem';
            meta.textContent = time
                ? `${fmtTime(time)}` + (actor ? `  •  ${actor}` : '') + (note ? `  •  ${note}` : '')
                : (note || '—');
            body.append(t, meta);
            ev.append(dot, body);
            return ev;
        }

        tl.appendChild(timelineEvent('Detected', detectedAt, null, `Rule ${ruleCode} • ${severity}`));
        if (acknowledgedAt) {
            tl.appendChild(timelineEvent('Acknowledged', acknowledgedAt, acknowledgedBy || '—', 'Support operator'));
        } else {
            tl.appendChild(timelineEvent('Acknowledged', null, null, 'Pending'));
        }
        if (resolvedAt) {
            tl.appendChild(timelineEvent('Resolved', resolvedAt, resolvedBy || '—', 'Support operator'));
        } else if (status === 'Open' || status === 'Acknowledged') {
            tl.appendChild(timelineEvent('Resolved', null, null, 'Pending'));
        }
        timelineCard.appendChild(tl);
        content.appendChild(timelineCard);

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'alert-actions-row';
        actions.style.justifyContent = 'flex-start';
        actions.style.gap = '8px';
        actions.style.flexWrap = 'wrap';

        const canAck = perms.canAcknowledge && status === 'Open';
        const canResolve = perms.canResolve && status === 'Acknowledged';

        const ackBtn = Button({
            text: 'Acknowledge',
            variant: 'harbor',
            disabled: !canAck,
            title: !perms.canAcknowledge ? 'Viewer role cannot acknowledge' : (status !== 'Open' ? 'Only Open incidents can be acknowledged' : ''),
            onClick: () => doAction('acknowledge')
        });

        const resolveBtn = Button({
            text: 'Resolve',
            variant: 'healthy',
            disabled: !canResolve,
            title: !perms.canResolve ? 'Viewer role cannot resolve' : (status !== 'Acknowledged' ? 'Only Acknowledged incidents can be resolved' : ''),
            onClick: () => doAction('resolve')
        });

        const explainBtn = Button({
            text: 'Explain',
            variant: 'quiet',
            onClick: () => doAction('explain')
        });

        const exportBtn = Button({
            text: 'Export Report',
            variant: 'quiet',
            onClick: () => doAction('export')
        });

        actions.append(ackBtn, resolveBtn, explainBtn, exportBtn);
        content.appendChild(actions);

        // Inline explanation drawer (rendered below actions)
        const explainSection = document.createElement('div');
        explainSection.id = 'incident-explain-section';
        explainSection.style.display = 'none';
        explainSection.style.marginTop = '16px';
        explainSection.style.border = '1px solid var(--color-divider)';
        explainSection.style.borderRadius = 'var(--border-radius-lg)';
        explainSection.style.padding = '16px';
        explainSection.style.background = 'var(--color-card-muted-bg)';
        content.appendChild(explainSection);

        async function doAction(action) {
            explainSection.style.display = 'none';
            explainSection.replaceChildren();
            try {
                if (action === 'acknowledge') {
                    if (!canAcknowledge) throw new Error('Viewer role cannot acknowledge alerts.');
                    await api.acknowledgeAlert(ID, userName);
                    await load();
                } else if (action === 'resolve') {
                    if (!canResolve) throw new Error('Viewer role cannot resolve alerts.');
                    await api.resolveAlert(ID, userName);
                    await load();
                } else if (action === 'explain') {
                    await showExplain(ID);
                } else if (action === 'export') {
                    await exportReport(ID);
                }
            } catch (err) {
                explainSection.style.display = 'block';
                explainSection.replaceChildren();
                const errBox = document.createElement('div');
                errBox.style.color = 'var(--color-critical-text)';
                errBox.style.padding = '10px';
                errBox.textContent = getFriendlyErrorMessage(err, action);
                explainSection.appendChild(errBox);
            }
        }

        async function showExplain(id) {
            explainSection.style.display = 'block';
            explainSection.replaceChildren();
            const loading = document.createElement('div');
            loading.textContent = 'Generating grounded explanation…';
            explainSection.appendChild(loading);

            try {
                const data = await api.explainAlert(id);
                let explanation = data.value;
                if (typeof explanation === 'string') {
                    try { explanation = JSON.parse(explanation); } catch (e) { explanation = { summary: explanation }; }
                }
                explanation = explanation || {};
                renderExplain(explainSection, explanation);
            } catch (err) {
                explainSection.replaceChildren();
                const errBox = document.createElement('div');
                errBox.style.color = 'var(--color-critical-text)';
                errBox.style.padding = '10px';
                errBox.textContent = getFriendlyErrorMessage(err, 'explain');
                explainSection.appendChild(errBox);
            }
        }

        function renderExplain(root, explanation) {
            root.replaceChildren();
            root.style.display = 'block';

            const providerBadge = document.createElement('div');
            providerBadge.className = explanation.aiAssisted ? 'ai-provider-badge is-gemini' : 'ai-provider-badge is-fallback';
            providerBadge.textContent = explanation.aiAssisted
                ? `AI-Assisted Advisory (${explanation.provider || 'Google Gemini'})`
                : `Grounded Runbook Advisory (${explanation.provider || 'Offline Mode'})`;
            root.appendChild(providerBadge);

            const summary = document.createElement('div');
            const h = document.createElement('h4');
            h.className = 'drawer-section-title';
            h.textContent = 'Summary';
            const p = document.createElement('p');
            p.style.margin = '0';
            p.textContent = explanation.summary || 'No summary available.';
            summary.append(h, p);
            root.appendChild(summary);

            // Observed facts (verified)
            if (explanation.observedFacts && typeof explanation.observedFacts === 'object' && Object.keys(explanation.observedFacts).length) {
                const sec = document.createElement('div');
                const h4 = document.createElement('h4');
                h4.className = 'drawer-section-title';
                h4.textContent = 'Observed facts (verified metrics)';
                const grid = document.createElement('div');
                grid.className = 'facts-grid';
                for (const [key, val] of Object.entries(explanation.observedFacts)) {
                    if (val === undefined) continue;
                    const card = document.createElement('div');
                    card.className = 'fact-card';
                    const lbl = document.createElement('span');
                    lbl.className = 'fact-name';
                    lbl.textContent = key;
                    const v = document.createElement('span');
                    v.className = 'fact-val tabular-nums';
                    v.textContent = key === 'oldestPendingAgeSeconds' ? fmtDur(val) : String(val);
                    card.append(lbl, v);
                    grid.appendChild(card);
                }
                sec.append(h4, grid);
                root.appendChild(sec);
            }

            // Hypotheses — clearly labeled UNPROVEN
            if (Array.isArray(explanation.possibleHypotheses) && explanation.possibleHypotheses.length) {
                const sec = document.createElement('div');
                const h4 = document.createElement('h4');
                h4.className = 'drawer-section-title';
                h4.textContent = 'Possible explanations (hypotheses — unproven)';
                const note = document.createElement('p');
                note.style.fontSize = '0.8125rem';
                note.style.color = 'var(--color-slate)';
                note.style.fontStyle = 'italic';
                note.textContent = 'These are hypotheses, not confirmed root causes. Verify with target system logs.';
                const ul = document.createElement('ul');
                ul.className = 'drawer-list';
                for (const hyp of explanation.possibleHypotheses) {
                    const li = document.createElement('li');
                    li.textContent = hyp;
                    ul.appendChild(li);
                }
                sec.append(h4, note, ul);
                root.appendChild(sec);
            }

            // Recommended checks
            if (Array.isArray(explanation.recommendedChecks) && explanation.recommendedChecks.length) {
                const sec = document.createElement('div');
                const h4 = document.createElement('h4');
                h4.className = 'drawer-section-title';
                h4.textContent = 'Recommended checks';
                const ol = document.createElement('ol');
                ol.className = 'drawer-list';
                for (const chk of explanation.recommendedChecks) {
                    const li = document.createElement('li');
                    li.textContent = chk;
                    ol.appendChild(li);
                }
                sec.append(h4, ol);
                root.appendChild(sec);
            }

            // Runbook references (cited IDs + titles)
            if (Array.isArray(explanation.citedRunbookIds) && explanation.citedRunbookIds.length) {
                const sec = document.createElement('div');
                const h4 = document.createElement('h4');
                h4.className = 'drawer-section-title';
                h4.textContent = 'Curated runbook references';
                const wrap = document.createElement('div');
                wrap.style.display = 'flex';
                wrap.style.flexWrap = 'wrap';
                wrap.style.gap = '6px';
                for (const id of explanation.citedRunbookIds) {
                    const badge = document.createElement('span');
                    badge.className = 'runbook-badge-item';
                    badge.textContent = `${id} — ${runbookTitleById(runbooks, id)}`;
                    wrap.appendChild(badge);
                }
                sec.append(h4, wrap);
                root.appendChild(sec);
            }

            // Limitations / evidence gaps
            const sec = document.createElement('div');
            const box = document.createElement('div');
            box.className = 'limitations-callout';
            const strong = document.createElement('strong');
            strong.textContent = 'Evidence gaps & limitations: ';
            const span = document.createElement('span');
            span.textContent = explanation.limitations || 'Metrics describe queue state; direct root cause requires system log inspection. Automatic remediation is strictly disabled.';
            box.append(strong, span);
            sec.appendChild(box);
            root.appendChild(sec);
        }

        async function exportReport(id) {
            try {
                const data = await api.exportIncidentReport(id, 'markdown');
                const markdown = data.value || data || '';
                const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const rule = alert.ruleCode || 'INCIDENT';
                a.download = `Incident-Postmortem-${rule}-${String(id).slice(0, 8)}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                explainSection.style.display = 'block';
                explainSection.replaceChildren();
                const errBox = document.createElement('div');
                errBox.style.color = 'var(--color-critical-text)';
                errBox.style.padding = '10px';
                errBox.textContent = getFriendlyErrorMessage(err, 'export');
                explainSection.appendChild(errBox);
            }
        }

        if (params && (params.explain === '1' || params.explain === 'true')) {
            showExplain(ID);
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
    }

    load();

    return function unload() {
        mounted = false;
    };
}

export function cleanup() {
    // No persistent listeners/timers.
}
