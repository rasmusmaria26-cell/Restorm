        // Configuration & Metadata Constants
        const GLOBAL_QUEUE_ALERT_LIMIT = 200; // From detection engine Rule B: QUEUE_GROWTH_LIMIT

        const USER_PERMISSIONS = {
            bob: {
                title: 'Bob',
                roleLabel: 'Support operator',
                badgeText: 'Can acknowledge, resolve & simulate',
                canSimulate: true,
                canAcknowledge: true,
                canResolve: true,
                canReset: false
            },
            alice: {
                title: 'Alice',
                roleLabel: 'Support viewer',
                badgeText: 'View-only access',
                canSimulate: false,
                canAcknowledge: false,
                canResolve: false,
                canReset: false
            },
            admin: {
                title: 'Admin',
                roleLabel: 'Simulator admin',
                badgeText: 'Full prototype & admin access',
                canSimulate: true,
                canAcknowledge: true,
                canResolve: true,
                canReset: true
            }
        };

        const FRIENDLY_RULE_TITLES = {
            EXCESSIVE_RETRIES: 'Too many retries',
            QUEUE_GROWTH: 'Queue growing fast',
            OLD_MESSAGE_AGE: 'Messages waiting too long',
            RECOVERY_STALLED: 'Recovery not progressing'
        };

        const SEVERITY_WEIGHT = {
            Critical: 3,
            High: 2,
            Warning: 1,
            Info: 0
        };

        // Runtime State
        let currentUsername = 'bob';
        let latestInterfaces = [];
        let latestAlerts = [];
        let activeExplainAlertId = null;
        let isLiveStreamActive = false;
        let liveStreamTimer = null;

        // Basic Authentication Header
        function getAuthHeader() {
            const userSelect = document.getElementById('userSelect');
            currentUsername = userSelect ? userSelect.value : 'bob';
            return 'Basic ' + btoa(currentUsername + ':');
        }

        // Safe Network Fetch Wrapper
        async function fetchJSON(url, options = {}) {
            options.headers = options.headers || {};
            options.headers['Authorization'] = getAuthHeader();
            const res = await fetch(url, options);
            if (!res.ok) {
                let errorBodyText = '';
                try {
                    errorBodyText = await res.text();
                } catch (e) {
                    errorBodyText = res.statusText;
                }
                const errorObj = new Error(errorBodyText);
                errorObj.status = res.status;
                throw errorObj;
            }
            return await res.json();
        }

        // Friendly Error Mapper
        function getFriendlyErrorMessage(err, actionContext) {
            const user = USER_PERMISSIONS[currentUsername] || { title: currentUsername };
            if (err.status === 403) {
                if (actionContext === 'simulation') {
                    return `${user.title} can’t run simulations with viewer permissions. Switch to Bob or Admin to trigger scenarios.`;
                }
                if (actionContext === 'acknowledge') {
                    return `${user.title} can’t acknowledge alerts with viewer permissions. Switch to Bob or Admin.`;
                }
                return `${user.title} doesn’t have permission for this action. Switch to a role that can.`;
            }
            if (err.status === 401) {
                return 'Authentication required. Please select a valid operator.';
            }
            if (err.status === 404) {
                return 'The requested interface or alert could not be found.';
            }
            return `Operation could not complete: ${err.message || 'Network error'}`;
        }

        // Format Seconds into friendly time (e.g. 13m 20s or 45s)
        function formatDurationSeconds(seconds) {
            if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) return '0s';
            if (seconds < 60) return `${Math.floor(seconds)}s`;
            const mins = Math.floor(seconds / 60);
            const remainingSecs = Math.floor(seconds % 60);
            if (remainingSecs === 0) return `${mins}m`;
            return `${mins}m ${remainingSecs}s`;
        }

        // Format ISO date into local HH:MM
        function formatShortTime(isoString) {
            if (!isoString) return '';
            try {
                const date = new Date(isoString);
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                return isoString;
            }
        }

        // Render Inline SVG Pressure Line
        function createPressureLineSVG(snapshots, limitValue) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const width = 220;
            const height = 40;
            const padX = 6;
            const padY = 6;
            const effW = width - padX * 2;
            const effH = height - padY * 2;

            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            svg.setAttribute('class', 'sparkline-svg');
            svg.setAttribute('aria-hidden', 'true');

            // If no snapshots, render flat baseline
            if (!snapshots || snapshots.length === 0) {
                const line = document.createElementNS(svgNS, 'line');
                line.setAttribute('x1', String(padX));
                line.setAttribute('y1', String(height - padY));
                line.setAttribute('x2', String(width - padX));
                line.setAttribute('y2', String(height - padY));
                line.setAttribute('stroke', 'var(--color-divider)');
                line.setAttribute('stroke-width', '1.5');
                svg.appendChild(line);
                return svg;
            }

            // Extract pending counts
            const pointsData = snapshots.map(s => Number(s.pendingCount) || 0);
            const latestValue = pointsData[pointsData.length - 1] || 0;
            const isOverLimit = latestValue >= limitValue;

            // Compute Y-scale with headroom so limit line is clearly visible
            const maxVal = Math.max(limitValue * 1.25, ...pointsData, 50);

            function getY(val) {
                const clamped = Math.max(0, Math.min(val, maxVal));
                return padY + effH - (clamped / maxVal) * effH;
            }

            // 1. Draw dashed threshold line at limitValue
            const limitY = getY(limitValue);
            const limitLine = document.createElementNS(svgNS, 'line');
            limitLine.setAttribute('x1', String(padX));
            limitLine.setAttribute('y1', String(limitY));
            limitLine.setAttribute('x2', String(width - padX));
            limitLine.setAttribute('y2', String(limitY));
            limitLine.setAttribute('stroke', isOverLimit ? 'var(--color-critical)' : 'var(--color-divider)');
            limitLine.setAttribute('stroke-dasharray', '3 3');
            limitLine.setAttribute('stroke-width', '1.2');
            limitLine.setAttribute('opacity', '0.75');
            svg.appendChild(limitLine);

            // 2. Build points for SVG polyline
            const coords = pointsData.map((val, idx) => {
                const x = pointsData.length === 1
                    ? padX + effW / 2
                    : padX + (idx / (pointsData.length - 1)) * effW;
                const y = getY(val);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            });

            // If single snapshot, duplicate to form a visible line segment
            if (pointsData.length === 1) {
                coords.unshift(`${padX},${getY(latestValue).toFixed(1)}`);
                coords.push(`${width - padX},${getY(latestValue).toFixed(1)}`);
            }

            const polyline = document.createElementNS(svgNS, 'polyline');
            polyline.setAttribute('points', coords.join(' '));
            polyline.setAttribute('fill', 'none');
            polyline.setAttribute('stroke', isOverLimit ? 'var(--color-critical)' : 'var(--color-harbor)');
            polyline.setAttribute('stroke-width', '2');
            polyline.setAttribute('stroke-linecap', 'round');
            polyline.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(polyline);

            // 3. Highlight dot on the latest snapshot point
            const lastCoord = coords[coords.length - 1].split(',');
            const dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('cx', lastCoord[0]);
            dot.setAttribute('cy', lastCoord[1]);
            dot.setAttribute('r', '3.5');
            dot.setAttribute('fill', isOverLimit ? 'var(--color-critical)' : 'var(--color-harbor)');
            svg.appendChild(dot);

            return svg;
        }

        // Render Interfaces Column
        function renderInterfaces(interfaces) {
            const container = document.getElementById('interfacesContainer');
            const countBadge = document.getElementById('interfacesCount');
            container.replaceChildren();

            countBadge.textContent = String(interfaces ? interfaces.length : 0);

            if (!interfaces || interfaces.length === 0) {
                const emptyCard = document.createElement('div');
                emptyCard.className = 'empty-card';
                const emptyTitle = document.createElement('p');
                emptyTitle.className = 'empty-card-title';
                emptyTitle.textContent = 'No interfaces monitored';
                const emptySubtitle = document.createElement('p');
                emptySubtitle.className = 'empty-card-subtitle';
                emptySubtitle.textContent = 'Active integration endpoints will appear here once registered.';
                emptyCard.append(emptyTitle, emptySubtitle);
                container.appendChild(emptyCard);
                return;
            }

            for (const iface of interfaces) {
                // Check if interface has active/open alerts
                const activeAlerts = latestAlerts.filter(a =>
                    a.interface_ID === iface.ID && a.status === 'Open'
                );
                const hasCritical = activeAlerts.some(a => a.severity === 'Critical');
                const hasHigh = activeAlerts.some(a => a.severity === 'High');

                const card = document.createElement('article');
                card.className = 'interface-card' + (activeAlerts.length > 0 ? ' has-alert' : '');

                // Header: Title & Status
                const cardHeader = document.createElement('div');
                cardHeader.className = 'interface-card-header';

                const titleGroup = document.createElement('div');
                titleGroup.className = 'interface-title-group';

                const nameEl = document.createElement('h4');
                nameEl.className = 'interface-name';
                nameEl.textContent = iface.name || 'Unnamed interface';

                const pathEl = document.createElement('span');
                pathEl.className = 'interface-path';
                pathEl.textContent = `From ${iface.sourceSystem || 'Unknown'} to ${iface.targetSystem || 'Unknown'}`;

                titleGroup.append(nameEl, pathEl);

                // Status Badge
                const statusBadge = document.createElement('span');
                const dot = document.createElement('span');
                dot.className = 'status-dot';
                const statusText = document.createElement('span');

                if (hasCritical) {
                    statusBadge.className = 'status-badge critical';
                    statusText.textContent = 'Under pressure';
                } else if (hasHigh) {
                    statusBadge.className = 'status-badge high';
                    statusText.textContent = 'Elevated backlog';
                } else {
                    statusBadge.className = 'status-badge healthy';
                    statusText.textContent = 'Operating normally';
                }

                statusBadge.append(dot, statusText);
                cardHeader.append(titleGroup, statusBadge);

                // Pressure Line Block
                const pressureBlock = document.createElement('div');
                pressureBlock.className = 'pressure-block';

                const sparklineWrap = document.createElement('div');
                sparklineWrap.className = 'pressure-sparkline-wrap';

                // Sort snapshots in chronological order for the line
                const snapshots = Array.isArray(iface.snapshots)
                    ? [...iface.snapshots].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))
                    : [];

                const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
                const latestPending = latestSnapshot ? latestSnapshot.pendingCount : 0;
                const interfaceLimit = (typeof iface.queueGrowthLimit === 'number' && iface.queueGrowthLimit > 0)
                    ? iface.queueGrowthLimit
                    : GLOBAL_QUEUE_ALERT_LIMIT;
                const isOverLimit = latestPending >= interfaceLimit;

                const svgSparkline = createPressureLineSVG(snapshots, interfaceLimit);
                sparklineWrap.appendChild(svgSparkline);

                const pressureSummary = document.createElement('div');
                pressureSummary.className = 'pressure-summary';

                const pressureCount = document.createElement('span');
                pressureCount.className = 'pressure-count tabular-nums' + (isOverLimit ? ' is-over-limit' : '');
                pressureCount.textContent = String(latestPending);

                const pressureCountLabel = document.createElement('span');
                pressureCountLabel.className = 'pressure-count-label';
                pressureCountLabel.textContent = `queued (limit ${interfaceLimit})`;

                pressureSummary.append(pressureCount, pressureCountLabel);
                pressureBlock.append(sparklineWrap, pressureSummary);

                // Footer Caption
                const footerCaption = document.createElement('div');
                footerCaption.className = 'interface-footer-caption tabular-nums';

                const metricsSpan = document.createElement('span');
                if (latestSnapshot) {
                    metricsSpan.textContent = `${latestSnapshot.retryAttempts || 0} retries (limit ${iface.maxRetryThreshold || 100}) • Oldest: ${formatDurationSeconds(latestSnapshot.oldestPendingAgeSeconds)}`;
                } else {
                    metricsSpan.textContent = 'No queue metrics recorded yet';
                }

                const scheduleSpan = document.createElement('span');
                scheduleSpan.textContent = iface.expectedSchedule || 'Scheduled';

                footerCaption.append(metricsSpan, scheduleSpan);

                card.append(cardHeader, pressureBlock, footerCaption);
                container.appendChild(card);
            }
        }

        // Group alerts into ongoing incidents (deduplicating same rule on same interface)
        function groupAlertsIntoIncidents(alerts, interfaces) {
            if (!alerts || alerts.length === 0) return [];

            const interfaceMap = new Map();
            if (interfaces) {
                for (const iface of interfaces) {
                    interfaceMap.set(iface.ID, iface);
                }
            }

            const groups = new Map();

            for (const alert of alerts) {
                const key = `${alert.interface_ID || 'global'}_${alert.ruleCode || 'unknown'}`;

                if (!groups.has(key)) {
                    groups.set(key, {
                        primaryAlert: alert,
                        interface: alert.interface || interfaceMap.get(alert.interface_ID),
                        allRecords: [alert],
                        openCount: alert.status === 'Open' ? 1 : 0,
                        earliestDetectedAt: alert.detectedAt || alert.windowStart || alert.createdAt,
                        latestDetectedAt: alert.detectedAt || alert.windowEnd || alert.createdAt,
                        highestSeverity: alert.severity || 'Info'
                    });
                } else {
                    const group = groups.get(key);
                    group.allRecords.push(alert);
                    if (alert.status === 'Open') group.openCount++;

                    // Track earliest detected time
                    const alertDate = new Date(alert.detectedAt || alert.windowStart || alert.createdAt);
                    const currEarliest = new Date(group.earliestDetectedAt);
                    if (alertDate < currEarliest) {
                        group.earliestDetectedAt = alert.detectedAt || alert.windowStart;
                    }

                    // Promote primary alert to an Open one if available
                    if (group.primaryAlert.status !== 'Open' && alert.status === 'Open') {
                        group.primaryAlert = alert;
                    }

                    // Track highest severity
                    if (SEVERITY_WEIGHT[alert.severity] > SEVERITY_WEIGHT[group.highestSeverity]) {
                        group.highestSeverity = alert.severity;
                    }
                }
            }

            // Convert groups to sorted array: Worst first (Critical > High > Warning > Info), then newest
            return Array.from(groups.values()).sort((a, b) => {
                // 1. Open before Acknowledged
                const aOpen = a.primaryAlert.status === 'Open' ? 1 : 0;
                const bOpen = b.primaryAlert.status === 'Open' ? 1 : 0;
                if (aOpen !== bOpen) return bOpen - aOpen;

                // 2. Severity weight
                const wA = SEVERITY_WEIGHT[a.highestSeverity] || 0;
                const wB = SEVERITY_WEIGHT[b.highestSeverity] || 0;
                if (wA !== wB) return wB - wA;

                // 3. Newest first
                return new Date(b.latestDetectedAt) - new Date(a.latestDetectedAt);
            });
        }

        // Render Needs Attention (Alerts) Column
        function renderAlerts(alerts, interfaces) {
            const container = document.getElementById('alertsContainer');
            const countBadge = document.getElementById('alertsCount');
            container.replaceChildren();

            const openAlerts = alerts ? alerts.filter(a => a.status === 'Open') : [];
            countBadge.textContent = String(openAlerts.length);

            if (openAlerts.length > 0) {
                countBadge.classList.add('has-attention');
            } else {
                countBadge.classList.remove('has-attention');
            }

            const incidentGroups = groupAlertsIntoIncidents(alerts, interfaces);

            if (incidentGroups.length === 0) {
                const emptyCard = document.createElement('div');
                emptyCard.className = 'empty-card';
                const emptyTitle = document.createElement('p');
                emptyTitle.className = 'empty-card-title';
                emptyTitle.textContent = 'All clear — no alerts';
                const emptySubtitle = document.createElement('p');
                emptySubtitle.className = 'empty-card-subtitle';
                emptySubtitle.textContent = 'Queue sizes and retry frequencies are operating within normal tolerances.';
                emptyCard.append(emptyTitle, emptySubtitle);
                container.appendChild(emptyCard);
                return;
            }

            for (const group of incidentGroups) {
                const alert = group.primaryAlert;
                const isAck = alert.status === 'Acknowledged';
                const isResolved = alert.status === 'Resolved';
                const isCritical = alert.severity === 'Critical';
                const isHigh = alert.severity === 'High';

                const card = document.createElement('article');
                card.className = 'alert-card' +
                    (isAck || isResolved ? ' is-acknowledged' : '') +
                    (isCritical ? ' is-critical' : isHigh ? ' is-high' : '');

                // Header
                const cardHeader = document.createElement('div');
                cardHeader.className = 'alert-card-header';

                const titleWrap = document.createElement('div');
                titleWrap.className = 'alert-titles-wrap';

                const friendlyTitle = document.createElement('h4');
                friendlyTitle.className = 'alert-friendly-title';
                friendlyTitle.textContent = FRIENDLY_RULE_TITLES[alert.ruleCode] || alert.ruleCode || 'Anomaly detected';

                const ruleSubcode = document.createElement('span');
                ruleSubcode.className = 'alert-rule-subcode';
                ruleSubcode.textContent = `Rule: ${alert.ruleCode || 'CUSTOM'}`;

                titleWrap.append(friendlyTitle, ruleSubcode);

                // Interface tag
                const ifaceName = group.interface ? group.interface.name : 'Unknown interface';
                const ifaceTag = document.createElement('span');
                ifaceTag.className = 'alert-interface-tag';
                ifaceTag.textContent = ifaceName;

                cardHeader.append(titleWrap, ifaceTag);

                // Evidence Line
                const evidenceLine = document.createElement('div');
                evidenceLine.className = 'evidence-line tabular-nums';

                // Parse observed metrics cleanly
                let evidenceText = alert.summary || 'Metrics threshold reached';
                try {
                    const metrics = JSON.parse(alert.observedMetrics || '{}');
                    if (metrics.retryAttempts !== undefined && metrics.pendingCount !== undefined) {
                        evidenceText = `${metrics.pendingCount} queued • ${metrics.retryAttempts} retries`;
                        if (metrics.oldestPendingAgeSeconds) {
                            evidenceText += ` • Oldest: ${formatDurationSeconds(metrics.oldestPendingAgeSeconds)}`;
                        }
                    }
                } catch (e) {
                    // Fallback to alert.summary
                }
                evidenceLine.textContent = evidenceText;

                // Incident Meta Row (Ongoing since HH:MM • Seen N times)
                const metaRow = document.createElement('div');
                metaRow.className = 'incident-meta-row tabular-nums';

                const ongoingTag = document.createElement('span');
                ongoingTag.className = 'ongoing-incident-tag';

                const occurrences = alert.repeatCount || group.allRecords.length;
                const startTime = formatShortTime(group.earliestDetectedAt);
                ongoingTag.textContent = `Ongoing since ${startTime} • Seen ${occurrences} ${occurrences === 1 ? 'time' : 'times'}`;
                metaRow.appendChild(ongoingTag);

                if (isResolved) {
                    const resolvedStamp = document.createElement('span');
                    resolvedStamp.className = 'resolved-tag';
                    resolvedStamp.textContent = `✓ Resolved by ${alert.resolvedBy || 'Operator'}${alert.resolvedAt ? ' at ' + formatShortTime(alert.resolvedAt) : ''}`;
                    metaRow.appendChild(resolvedStamp);
                } else if (isAck && alert.acknowledgedBy) {
                    const ackStamp = document.createElement('span');
                    ackStamp.className = 'ack-stamp';
                    ackStamp.textContent = `✓ Acknowledged by ${alert.acknowledgedBy} at ${formatShortTime(alert.acknowledgedAt)}`;
                    metaRow.appendChild(ackStamp);
                }

                // Actions Row
                const actionsRow = document.createElement('div');
                actionsRow.className = 'alert-actions-row';

                const userPerms = USER_PERMISSIONS[currentUsername] || { canAcknowledge: false, canResolve: false };

                // Acknowledge Button (if Open)
                if (alert.status === 'Open') {
                    const btnAck = document.createElement('button');
                    btnAck.className = 'btn-harbor';
                    btnAck.type = 'button';
                    btnAck.textContent = 'Acknowledge';
                    btnAck.disabled = !userPerms.canAcknowledge;
                    btnAck.title = userPerms.canAcknowledge ? 'Acknowledge this alert' : 'Only Support Operators can acknowledge';
                    btnAck.addEventListener('click', () => handleAcknowledgeAlert(alert.ID));
                    actionsRow.appendChild(btnAck);
                } else if (alert.status === 'Acknowledged') {
                    // Resolve Button (if Acknowledged)
                    const btnResolve = document.createElement('button');
                    btnResolve.className = 'btn-healthy';
                    btnResolve.type = 'button';
                    btnResolve.textContent = 'Resolve incident';
                    btnResolve.disabled = !userPerms.canResolve;
                    btnResolve.title = userPerms.canResolve ? 'Mark incident as resolved' : 'Only Support Operators can resolve';
                    btnResolve.addEventListener('click', () => handleResolveAlert(alert.ID));
                    actionsRow.appendChild(btnResolve);
                }

                // Explain Button
                const btnExplain = document.createElement('button');
                btnExplain.className = 'btn-quiet';
                btnExplain.type = 'button';
                btnExplain.textContent = 'Explain';
                btnExplain.addEventListener('click', () => openExplainDrawer(alert.ID));
                actionsRow.appendChild(btnExplain);

                // Export Postmortem Report Button
                const btnReport = document.createElement('button');
                btnReport.className = 'btn-quiet';
                btnReport.type = 'button';
                btnReport.textContent = 'Report (.md)';
                btnReport.title = 'Download official incident postmortem report';
                btnReport.addEventListener('click', () => handleDownloadReport(alert.ID, alert.ruleCode));
                actionsRow.appendChild(btnReport);

                card.append(cardHeader, evidenceLine, metaRow, actionsRow);
                container.appendChild(card);
            }
        }

        // Render Dynamic Headline Sentence
        function renderHeadline(interfaces, alerts) {
            const headlineCard = document.getElementById('headlineCard');
            const titleEl = document.getElementById('headlineTitle');
            const subtitleEl = document.getElementById('headlineSubtitle');
            const updatedEl = document.getElementById('lastUpdatedText');

            const openAlerts = alerts ? alerts.filter(a => a.status === 'Open') : [];
            const criticalAlerts = openAlerts.filter(a => a.severity === 'Critical');
            const highAlerts = openAlerts.filter(a => a.severity === 'High');

            headlineCard.classList.remove('is-critical', 'is-high');

            if (criticalAlerts.length > 0) {
                headlineCard.classList.add('is-critical');
                const worstAlert = criticalAlerts[0];
                const iface = interfaces ? interfaces.find(i => i.ID === worstAlert.interface_ID) : null;
                const ifaceName = iface ? iface.name : 'An interface';

                titleEl.textContent = openAlerts.length === 1
                    ? 'One interface is under severe pressure.'
                    : `${openAlerts.length} interfaces require immediate attention.`;
                subtitleEl.textContent = `${ifaceName} has breached retry safety limits. Immediate operator review recommended.`;
            } else if (highAlerts.length > 0) {
                headlineCard.classList.add('is-high');
                const worstAlert = highAlerts[0];
                const iface = interfaces ? interfaces.find(i => i.ID === worstAlert.interface_ID) : null;
                const ifaceName = iface ? iface.name : 'An interface';

                titleEl.textContent = openAlerts.length === 1
                    ? 'One interface has elevated backlog.'
                    : `${openAlerts.length} interfaces have warning alerts.`;
                subtitleEl.textContent = `${ifaceName} backlog is accumulating. Monitoring queue drain rate.`;
            } else {
                titleEl.textContent = 'All interfaces are operating normally.';
                subtitleEl.textContent = 'Message queues are within safe limits and no retries are stalled.';
            }

            const now = new Date();
            updatedEl.textContent = `Updated at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        }

        // Export Official Incident Postmortem Markdown Document
        async function handleDownloadReport(alertId, ruleCode = 'INCIDENT') {
            if (!alertId) return;
            try {
                const data = await fetchJSON(`/odata/v4/monitoring/Alerts(${encodeURIComponent(alertId)})/MonitoringService.exportIncidentReport`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ format: 'markdown' })
                });

                const markdownContent = data.value || data;
                const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Incident-Postmortem-${ruleCode}-${String(alertId).slice(0, 8)}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Failed to export incident postmortem:', err);
                alert('Could not download incident report: ' + (err.message || 'Error'));
            }
        }

        // Grounded Incident Explanation Drawer Logic
        async function openExplainDrawer(alertId) {
            activeExplainAlertId = alertId;
            const drawer = document.getElementById('explainDrawer');
            const body = document.getElementById('drawerBody');
            drawer.classList.add('is-open');
            drawer.setAttribute('aria-hidden', 'false');

            // Render Loading State Safely
            body.replaceChildren();
            const loadingMsg = document.createElement('div');
            loadingMsg.textContent = 'Generating grounded explanation from runbook and queue metrics...';
            body.appendChild(loadingMsg);

            try {
                const data = await fetchJSON(`/odata/v4/monitoring/Alerts(${encodeURIComponent(alertId)})/MonitoringService.explain`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                let explanation = data.value;
                if (typeof explanation === 'string') {
                    try { explanation = JSON.parse(explanation); } catch (e) { explanation = { summary: explanation }; }
                }

                renderExplainContent(explanation || data);
            } catch (err) {
                body.replaceChildren();
                const errBox = document.createElement('div');
                errBox.style.color = 'var(--color-critical-text)';
                errBox.textContent = getFriendlyErrorMessage(err, 'explain');
                body.appendChild(errBox);
            }
        }

        function closeExplainDrawer() {
            const drawer = document.getElementById('explainDrawer');
            drawer.classList.remove('is-open');
            drawer.setAttribute('aria-hidden', 'true');
            activeExplainAlertId = null;
        }

        function renderExplainContent(explanation) {
            const body = document.getElementById('drawerBody');
            body.replaceChildren();

            // 0. AI Provider Badge
            const providerBadge = document.createElement('div');
            providerBadge.className = explanation.aiAssisted ? 'ai-provider-badge is-gemini' : 'ai-provider-badge is-fallback';
            providerBadge.textContent = explanation.aiAssisted 
                ? `✨ AI-Assisted Advisory (${explanation.provider || 'Google Gemini'}) • Grounded in Curated Runbook`
                : `📘 Grounded Runbook Advisory (${explanation.provider || 'Offline Mode'})`;
            body.appendChild(providerBadge);

            // 1. Summary
            const secSummary = document.createElement('div');
            const hSummary = document.createElement('h4');
            hSummary.className = 'drawer-section-title';
            hSummary.textContent = 'Summary';
            const pSummary = document.createElement('p');
            pSummary.style.margin = '0';
            pSummary.textContent = explanation.summary || 'Incident analysis generated based on deterministic detection metrics.';
            secSummary.append(hSummary, pSummary);
            body.appendChild(secSummary);

            // 2. Observed Facts
            if (explanation.observedFacts && typeof explanation.observedFacts === 'object') {
                const secFacts = document.createElement('div');
                const hFacts = document.createElement('h4');
                hFacts.className = 'drawer-section-title';
                hFacts.textContent = 'Observed facts';

                const factsGrid = document.createElement('div');
                factsGrid.className = 'facts-grid';

                const factLabels = {
                    pendingCount: 'Pending messages',
                    retryAttempts: 'Retry attempts',
                    failedCount: 'Failed messages',
                    successCount: 'Successful messages',
                    oldestPendingAgeSeconds: 'Oldest message age'
                };

                for (const [key, label] of Object.entries(factLabels)) {
                    if (explanation.observedFacts[key] !== undefined) {
                        const card = document.createElement('div');
                        card.className = 'fact-card';
                        const lbl = document.createElement('span');
                        lbl.className = 'fact-name';
                        lbl.textContent = label;

                        const val = document.createElement('span');
                        val.className = 'fact-val tabular-nums';
                        val.textContent = key === 'oldestPendingAgeSeconds'
                            ? formatDurationSeconds(explanation.observedFacts[key])
                            : String(explanation.observedFacts[key]);

                        card.append(lbl, val);
                        factsGrid.appendChild(card);
                    }
                }

                secFacts.append(hFacts, factsGrid);
                body.appendChild(secFacts);
            }

            // 3. Possible Explanations (Hypotheses)
            if (Array.isArray(explanation.possibleHypotheses) && explanation.possibleHypotheses.length > 0) {
                const secHyp = document.createElement('div');
                const hHyp = document.createElement('h4');
                hHyp.className = 'drawer-section-title';
                hHyp.textContent = 'Possible explanations';

                const ul = document.createElement('ul');
                ul.className = 'drawer-list';
                for (const hyp of explanation.possibleHypotheses) {
                    const li = document.createElement('li');
                    li.textContent = hyp;
                    ul.appendChild(li);
                }

                secHyp.append(hHyp, ul);
                body.appendChild(secHyp);
            }

            // 4. Recommended Checks
            if (Array.isArray(explanation.recommendedChecks) && explanation.recommendedChecks.length > 0) {
                const secChecks = document.createElement('div');
                const hChecks = document.createElement('h4');
                hChecks.className = 'drawer-section-title';
                hChecks.textContent = 'Recommended checks to perform';

                const ol = document.createElement('ol');
                ol.className = 'drawer-list';
                for (const chk of explanation.recommendedChecks) {
                    const li = document.createElement('li');
                    li.textContent = chk;
                    ol.appendChild(li);
                }

                secChecks.append(hChecks, ol);
                body.appendChild(secChecks);
            }

            // 5. Curated Runbook References
            if (Array.isArray(explanation.citedRunbookIds) && explanation.citedRunbookIds.length > 0) {
                const secRunbooks = document.createElement('div');
                const hRunbooks = document.createElement('h4');
                hRunbooks.className = 'drawer-section-title';
                hRunbooks.textContent = 'Curated runbooks';

                const wrap = document.createElement('div');
                for (const id of explanation.citedRunbookIds) {
                    const badge = document.createElement('span');
                    badge.className = 'runbook-badge-item';
                    badge.textContent = id;
                    wrap.appendChild(badge);
                }

                secRunbooks.append(hRunbooks, wrap);
                body.appendChild(secRunbooks);
            }

            // 6. Evidence Gaps & Operational Limitations
            const secLimitations = document.createElement('div');
            const limitationsBox = document.createElement('div');
            limitationsBox.className = 'limitations-callout';

            const strongLim = document.createElement('strong');
            strongLim.textContent = 'Evidence gaps & limitations: ';
            const spanLim = document.createElement('span');
            spanLim.textContent = explanation.limitations || 'Metrics describe queue backlog and retry frequency; direct root causes require target system log inspection. Automatic remediation is strictly disabled.';

            limitationsBox.append(strongLim, spanLim);
            secLimitations.appendChild(limitationsBox);
            body.appendChild(secLimitations);
        }

        // Actions: Acknowledge Alert
        async function handleAcknowledgeAlert(alertId) {
            const user = USER_PERMISSIONS[currentUsername] || { title: currentUsername, canAcknowledge: false };
            const feedback = document.getElementById('scenarioFeedback');

            if (!user.canAcknowledge) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = `${user.title} has view-only permissions. Switch to Bob or Admin to acknowledge alerts.`;
                return;
            }

            try {
                await fetchJSON(`/odata/v4/monitoring/Alerts(${encodeURIComponent(alertId)})/MonitoringService.acknowledge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acknowledgedBy: `${user.title} (${user.roleLabel})` })
                });

                feedback.className = 'scenario-feedback-bar has-success';
                feedback.textContent = `Alert acknowledged by ${user.title}.`;
                await refreshData();
            } catch (err) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = getFriendlyErrorMessage(err, 'acknowledge');
            }
        }

        // Actions: Resolve Incident Alert
        async function handleResolveAlert(alertId) {
            const user = USER_PERMISSIONS[currentUsername] || { title: currentUsername, canResolve: false };
            const feedback = document.getElementById('scenarioFeedback');

            if (!user.canResolve) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = `${user.title} has view-only permissions. Switch to Bob or Admin to resolve incidents.`;
                return;
            }

            try {
                await fetchJSON(`/odata/v4/monitoring/Alerts(${encodeURIComponent(alertId)})/MonitoringService.resolveAlert`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resolvedBy: `${user.title} (${user.roleLabel})` })
                });

                feedback.className = 'scenario-feedback-bar has-success';
                feedback.textContent = `Incident resolved by ${user.title}.`;
                await refreshData();
            } catch (err) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = getFriendlyErrorMessage(err, 'resolve');
            }
        }

        // Administrative Action: Reset Database to Clean Baseline
        async function handleResetDatabase() {
            const user = USER_PERMISSIONS[currentUsername] || { title: currentUsername, canReset: false };
            const feedback = document.getElementById('scenarioFeedback');

            if (!user.canReset) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = `${user.title} cannot reset baseline. Switch to Admin (Simulator Admin) to perform database reset.`;
                return;
            }

            try {
                feedback.className = 'scenario-feedback-bar';
                feedback.textContent = 'Resetting queues and alerts to pristine factory baseline...';

                const result = await fetchJSON('/odata/v4/monitoring/resetToCleanSeed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                feedback.className = 'scenario-feedback-bar has-success';
                feedback.textContent = result.value || 'Database restored to clean baseline.';
                await refreshData();
            } catch (err) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = getFriendlyErrorMessage(err, 'reset');
            }
        }

        // Live NOC Auto-Poll Stream
        function toggleLiveStream() {
            isLiveStreamActive = !isLiveStreamActive;
            const btn = document.getElementById('liveStreamToggle');
            const label = document.getElementById('liveStreamLabel');

            if (isLiveStreamActive) {
                if (btn) {
                    btn.classList.add('is-active');
                    btn.setAttribute('aria-pressed', 'true');
                }
                if (label) label.textContent = 'Live stream: ON';
                startLiveStream();
            } else {
                if (btn) {
                    btn.classList.remove('is-active');
                    btn.setAttribute('aria-pressed', 'false');
                }
                if (label) label.textContent = 'Live stream: OFF';
                stopLiveStream();
            }
        }

        function startLiveStream() {
            stopLiveStream();
            const feedback = document.getElementById('scenarioFeedback');
            if (feedback) {
                feedback.className = 'scenario-feedback-bar has-success';
                feedback.textContent = 'Live NOC stream active. Telemetry polling every 4 seconds.';
            }

            liveStreamTimer = setInterval(async () => {
                if (!isLiveStreamActive) return;
                try {
                    await refreshData();
                } catch (e) {
                    console.warn('[Live Stream] Stream poll error:', e);
                }
            }, 4000);
        }

        function stopLiveStream() {
            if (liveStreamTimer) {
                clearInterval(liveStreamTimer);
                liveStreamTimer = null;
            }
            const feedback = document.getElementById('scenarioFeedback');
            if (feedback && feedback.textContent.includes('Live NOC stream active')) {
                feedback.textContent = '';
            }
        }

        // Actions: Trigger Simulation Scenario
        async function handleTriggerSimulation(scenario) {
            const feedback = document.getElementById('scenarioFeedback');
            const user = USER_PERMISSIONS[currentUsername] || { title: currentUsername, canSimulate: false };

            if (!user.canSimulate) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = `${user.title} can’t run simulations with viewer permissions. Switch to Bob or Admin.`;
                return;
            }

            feedback.className = 'scenario-feedback-bar';
            feedback.textContent = `Injecting scenario [${scenario}]...`;

            try {
                const res = await fetchJSON('/odata/v4/monitoring/triggerSimulation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scenario: scenario })
                });

                feedback.className = 'scenario-feedback-bar has-success';
                feedback.textContent = res.value || 'Simulation completed and queue snapshot recorded.';
                await refreshData();
            } catch (err) {
                feedback.className = 'scenario-feedback-bar has-error';
                feedback.textContent = getFriendlyErrorMessage(err, 'simulation');
            }
        }

        // Primary Data Refresh Loop
        async function refreshData() {
            try {
                // Fetch interfaces with expanded recent snapshots (ordered asc for chronological sparkline)
                const ifacesData = await fetchJSON('/odata/v4/monitoring/Interfaces?$expand=snapshots($orderby=capturedAt asc)');
                latestInterfaces = ifacesData.value || [];

                // Fetch alerts ordered newest first
                const alertsData = await fetchJSON('/odata/v4/monitoring/Alerts?$expand=interface&$orderby=detectedAt desc');
                latestAlerts = alertsData.value || [];

                renderHeadline(latestInterfaces, latestAlerts);
                renderInterfaces(latestInterfaces);
                renderAlerts(latestAlerts, latestInterfaces);
            } catch (err) {
                const headlineTitle = document.getElementById('headlineTitle');
                const headlineSubtitle = document.getElementById('headlineSubtitle');
                if (headlineTitle) headlineTitle.textContent = 'Could not refresh monitoring data';
                if (headlineSubtitle) headlineSubtitle.textContent = getFriendlyErrorMessage(err, 'read');
            }
        }

        // Update UI based on selected user role
        function updateRoleUI() {
            const userSelect = document.getElementById('userSelect');
            currentUsername = userSelect ? userSelect.value : 'bob';
            const user = USER_PERMISSIONS[currentUsername] || USER_PERMISSIONS.bob;

            const badge = document.getElementById('roleCapsBadge');
            if (badge) badge.textContent = user.badgeText;

            const hint = document.getElementById('scenariosRoleHint');
            const simButtons = document.querySelectorAll('.sim-btn');
            const resetBtn = document.getElementById('btnResetSeed');

            if (!user.canSimulate) {
                if (hint) {
                    hint.textContent = `${user.title} is in view-only mode. Scenario buttons are disabled.`;
                    hint.className = 'scenarios-role-hint is-viewer';
                }
                simButtons.forEach(btn => btn.setAttribute('disabled', 'true'));
            } else {
                if (hint) {
                    hint.textContent = `Ready to simulate as ${user.title}. Select a scenario below.`;
                    hint.className = 'scenarios-role-hint';
                }
                simButtons.forEach(btn => btn.removeAttribute('disabled'));
            }

            if (resetBtn) {
                if (user.canReset) {
                    resetBtn.removeAttribute('disabled');
                    resetBtn.title = 'Reset database queues and clear alerts to clean starting baseline';
                } else {
                    resetBtn.setAttribute('disabled', 'true');
                    resetBtn.title = 'Only Simulator Admin (Admin) can reset database to baseline';
                }
            }

            refreshData();
        }

        // Setup Event Listeners
        function initializeEvents() {
            // Live NOC Stream Toggle
            const liveToggle = document.getElementById('liveStreamToggle');
            if (liveToggle) {
                liveToggle.addEventListener('click', toggleLiveStream);
            }

            // User role switcher
            const userSelect = document.getElementById('userSelect');
            if (userSelect) {
                userSelect.addEventListener('change', updateRoleUI);
            }

            // Manual refresh buttons
            const refreshTop = document.getElementById('btnRefreshTop');
            if (refreshTop) {
                refreshTop.addEventListener('click', refreshData);
            }

            // Simulator buttons
            document.querySelectorAll('.sim-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const scenario = btn.getAttribute('data-scenario');
                    if (scenario) handleTriggerSimulation(scenario);
                });
            });

            // Database Reset Button
            const resetBtn = document.getElementById('btnResetSeed');
            if (resetBtn) {
                resetBtn.addEventListener('click', handleResetDatabase);
            }

            // Explain Drawer close events
            const drawer = document.getElementById('explainDrawer');
            const closeX = document.getElementById('drawerCloseX');
            const closeBtn = document.getElementById('drawerCloseBtn');
            const exportBtn = document.getElementById('drawerExportBtn');

            if (closeX) closeX.addEventListener('click', closeExplainDrawer);
            if (closeBtn) closeBtn.addEventListener('click', closeExplainDrawer);
            if (exportBtn) {
                exportBtn.addEventListener('click', () => {
                    if (activeExplainAlertId) {
                        const alert = latestAlerts.find(a => a.ID === activeExplainAlertId);
                        handleDownloadReport(activeExplainAlertId, alert ? alert.ruleCode : 'INCIDENT');
                    }
                });
            }

            if (drawer) {
                drawer.addEventListener('click', (e) => {
                    if (e.target === drawer) closeExplainDrawer();
                });
            }

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && drawer && drawer.classList.contains('is-open')) {
                    closeExplainDrawer();
                }
            });
        }

        // Bootstrapping
        initializeEvents();
        updateRoleUI();