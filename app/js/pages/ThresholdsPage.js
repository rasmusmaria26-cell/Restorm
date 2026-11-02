/**
 * ThresholdsPage.js — Threshold policy management page.
 *
 * Lists all interfaces with their current threshold policies. Provides an
 * edit form per interface (admin only) for:
 *   maxRetryThreshold (1-10000), queueGrowthLimit (1-100000),
 *   oldMessageAgeLimitSeconds (10-2592000), recoveryStalledBacklog (1-100000).
 * Save calls configureThresholds backend action (admin only; non-admin gets
 * 403 Forbidden from the backend).
 *
 * Exports render(container, context) and cleanup(). context provides:
 *   api, getState, setState, userRoles, currentUser
 */

import { LoadingState } from '../components/LoadingState.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';

const BOUNDS = {
    maxRetryThreshold: { min: 1, max: 10000, label: 'Max retry threshold' },
    queueGrowthLimit: { min: 1, max: 100000, label: 'Queue growth limit' },
    oldMessageAgeLimitSeconds: { min: 10, max: 2592000, label: 'Old message age limit (seconds)' },
    recoveryStalledBacklog: { min: 1, max: 100000, label: 'Recovery stalled backlog' }
};

const FIELDS = [
    'maxRetryThreshold',
    'queueGrowthLimit',
    'oldMessageAgeLimitSeconds',
    'recoveryStalledBacklog'
];

export function render(container, context = {}) {
    container.innerHTML = '';
    const {
        api,
        getState,
        userRoles,
        currentUser
    } = context;

    const userName = currentUser || 'user';
    const isAdmin = userRoles.includes('SimulatorAdmin');

    const page = document.createElement('div');
    page.className = 'thresholds-page';

    const heading = document.createElement('h1');
    heading.className = 'headline-title';
    heading.textContent = 'Threshold Policies';
    page.appendChild(heading);

    // Permission notice for non-admin users
    if (!isAdmin) {
        const notice = document.createElement('div');
        notice.style.padding = '10px 14px';
        notice.style.marginBottom = '16px';
        notice.style.border = '1px solid var(--color-divider)';
        notice.style.borderRadius = 'var(--border-radius-sm)';
        notice.style.background = 'var(--color-high-badge-bg)';
        notice.style.color = 'var(--color-high-badge-text)';
        notice.textContent = `Signed in as ${userName} (${userRoles.join(', ') || 'viewer'}). Threshold configuration requires Simulator Admin permissions. Save attempts will be rejected with 403 Forbidden.`;
        page.appendChild(notice);
    }

    const content = document.createElement('div');
    content.className = 'thresholds-content';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '16px';
    page.appendChild(content);
    container.appendChild(page);

    let mounted = true;
    let editingInterfaceId = null;
    let interfacesSnapshot = [];

    async function load() {
        content.replaceChildren();
        content.appendChild(LoadingState({ message: 'Loading interfaces…' }));
        try {
            const data = await api.fetchInterfaces();
            const interfaces = Array.isArray(data) ? data : (data.value || []);
            if (!mounted) return;
            interfacesSnapshot = interfaces;
            renderList(interfaces);
        } catch (err) {
            if (!mounted) return;
            content.replaceChildren();
            content.appendChild(ErrorState({
                message: err.message || 'Failed to load interfaces',
                onRetry: load,
                retryLabel: 'Retry'
            }));
        }
    }

    function renderList(interfaces) {
        content.replaceChildren();
        if (interfaces.length === 0) {
            content.appendChild(EmptyState({
                title: 'No interfaces',
                subtitle: 'No monitored interfaces found.'
            }));
            return;
        }
        const frag = document.createDocumentFragment();
        for (const iface of interfaces) {
            frag.appendChild(renderInterfaceRow(iface));
        }
        content.appendChild(frag);
    }

    function renderInterfaceRow(iface) {
        const card = Card({ className: 'interface-card' });
        card.style.position = 'relative';

        // Header
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'flex-start';
        header.style.gap = '12px';
        header.style.flexWrap = 'wrap';

        const name = document.createElement('h3');
        name.style.margin = '0';
        name.style.fontSize = '1rem';
        name.textContent = iface.name || 'Unnamed interface';

        const path = document.createElement('div');
        path.style.fontSize = '0.8125rem';
        path.style.color = 'var(--color-slate)';
        path.textContent = `${iface.sourceSystem || 'Source'} → ${iface.targetSystem || 'Target'}`;

        const idText = document.createElement('div');
        idText.style.fontSize = '0.75rem';
        idText.style.color = 'var(--color-slate)';
        idText.style.fontFamily = 'monospace';
        idText.textContent = iface.ID;

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.flexDirection = 'column';
        left.style.gap = '2px';
        left.append(name, path, idText);

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.gap = '6px';
        right.style.flexShrink = '0';
        right.style.flexWrap = 'wrap';

        const editBtn = Button({
            text: 'Edit policy',
            variant: 'quiet',
            disabled: !isAdmin,
            title: !isAdmin ? 'Simulator Admin required to edit thresholds' : 'Edit threshold policy',
            onClick: () => { editingInterfaceId = iface.ID; renderList(interfaces); }
        });
        right.appendChild(editBtn);

        if (editingInterfaceId === iface.ID && isAdmin) {
            const form = buildEditForm(iface);
            right.appendChild(form);
        }

        header.append(left, right);
        card.appendChild(header);

        // Current thresholds display
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.marginTop = '10px';
        table.style.fontSize = '0.875rem';
        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        ['Policy', 'Current value', 'Allowed range'].forEach(h => {
            const th = document.createElement('th');
            th.style.textAlign = 'left';
            th.style.padding = '6px 8px';
            th.style.color = 'var(--color-slate)';
            th.style.fontSize = '0.75rem';
            th.textContent = h;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const field of FIELDS) {
            const b = BOUNDS[field];
            const tr = document.createElement('tr');
            const tdL = document.createElement('td');
            tdL.style.padding = '6px 8px';
            tdL.style.color = 'var(--color-ink)';
            tdL.textContent = b.label;
            const tdV = document.createElement('td');
            tdV.style.padding = '6px 8px';
            tdV.style.verticalAlign = 'top';
            tdV.className = 'tabular-nums';
            tdV.textContent = String(iface[field] ?? '—');
            const tdR = document.createElement('td');
            tdR.style.padding = '6px 8px';
            tdR.style.verticalAlign = 'top';
            tdR.style.fontSize = '0.75rem';
            tdR.style.color = 'var(--color-slate)';
            tdR.textContent = `${b.min} – ${b.max}`;
            tr.append(tdL, tdV, tdR);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        card.appendChild(table);

        return card;
    }

    function buildEditForm(iface) {
        const form = document.createElement('div');
        form.style.border = '1px solid var(--color-divider)';
        form.style.borderRadius = 'var(--border-radius-sm)';
        form.style.padding = '12px';
        form.style.background = 'var(--color-card-bg)';
        form.style.marginTop = '10px';
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '8px';
        form.style.width = 'min(560px, 100%)';

        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.fontSize = '0.875rem';
        title.textContent = `Edit threshold policy — ${iface.name}`;
        form.appendChild(title);

        const inputs = {};
        for (const field of FIELDS) {
            const b = BOUNDS[field];
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.flexDirection = 'column';
            row.style.gap = '4px';

            const label = document.createElement('label');
            label.style.fontSize = '0.75rem';
            label.style.color = 'var(--color-slate)';
            label.textContent = `${b.label} (${b.min}–${b.max})`;

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '1';
            input.value = iface[field] ?? '';
            input.min = String(b.min);
            input.max = String(b.max);
            input.style.padding = '5px 8px';
            input.style.border = '1px solid var(--color-divider)';
            input.style.borderRadius = '4px';
            input.style.fontSize = '0.8125rem';
            inputs[field] = input;

            row.append(label, input);
            form.appendChild(row);
        }

        const feedback = document.createElement('div');
        feedback.style.fontSize = '0.75rem';
        feedback.style.minHeight = '1.25rem';
        form.appendChild(feedback);

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.gap = '8px';
        btns.style.justifyContent = 'flex-end';
        btns.style.marginTop = '6px';

        const cancel = Button({
            text: 'Cancel',
            variant: 'quiet',
            onClick: () => { editingInterfaceId = null; renderList(interfacesSnapshot); }
        });

        const save = Button({
            text: 'Save',
            variant: 'harbor',
            onClick: () => doSave(iface.ID, inputs, feedback)
        });

        btns.append(cancel, save);
        form.appendChild(btns);

        return form;
    }

    async function doSave(interfaceId, inputs, feedback) {
        feedback.textContent = '';
        let valid = true;
        const values = {};
        for (const field of FIELDS) {
            const b = BOUNDS[field];
            const trimmed = String(inputs[field].value).trim();
            const parsed = parseInt(trimmed, 10);
            // Reject empty, non-integer strings (e.g. '1.5'), and out-of-bounds values.
            if (trimmed === '' || isNaN(parsed) || String(parsed) !== trimmed || parsed < b.min || parsed > b.max) {
                valid = false;
                inputs[field].style.borderColor = 'var(--color-critical-text)';
                feedback.textContent = `${b.label} must be an integer between ${b.min} and ${b.max}.`;
                return;
            } else {
                inputs[field].style.borderColor = '';
                values[field] = parsed;
            }
        }
        if (!valid) return;

        feedback.style.color = 'var(--color-slate)';
        feedback.textContent = 'Saving threshold policy…';

        try {
            await api.configureThresholds({
                interfaceId,
                maxRetryThreshold: values.maxRetryThreshold,
                queueGrowthLimit: values.queueGrowthLimit,
                oldMessageAgeLimitSeconds: values.oldMessageAgeLimitSeconds,
                recoveryStalledBacklog: values.recoveryStalledBacklog
            });
            feedback.style.color = 'var(--color-healthy-text)';
            feedback.textContent = 'Threshold policy updated successfully! Refreshing…';
            editingInterfaceId = null;
            await load();
        } catch (err) {
            feedback.style.color = 'var(--color-critical-text)';
            if (err.status === 403) {
                feedback.textContent = `403 Forbidden: ${userName} is not authorized to configure thresholds (Simulator Admin required).`;
            } else if (err.status === 404) {
                feedback.textContent = 'Interface not found.';
            } else if (err.status === 400) {
                feedback.textContent = `Validation failed: ${err.message || 'Invalid threshold values.'}`;
            } else {
                feedback.textContent = `Save failed: ${err.message || 'Network error'}`;
            }
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
