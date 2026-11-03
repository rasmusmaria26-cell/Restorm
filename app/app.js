/**
 * app.js — Retry Storm Sentinel application bootstrap (Phase 5 Foundation).
 *
 * Modular entry point that wires together:
 *   - Centralized OData API client (api-client.js)
 *   - Global observable state store (store.js)
 *   - Hash-based client router (router.js)
 *   - Shared UI components (components/)
 *   - Page shells (pages/)
 *
 * This file replaces the previous monolithic app.js (1722 lines). All backend
 * interaction flows through the API client; all state lives in the store; all
 * navigation is handled by the router. Existing endpoint URLs, auth behavior,
 * and role-based permissions are preserved exactly.
 */

import {
    fetchInterfaces,
    fetchAlerts,
    fetchTopology,
    acknowledgeAlert,
    resolveAlert,
    explainAlert,
    exportIncidentReport,
    triggerSimulation,
    configureThresholds,
    resetToCleanSeed,
    login,
    logout,
    hasCredentials
} from './js/api-client.js?v=5.1';

import {
    subscribe,
    setState,
    getState,
    setInterfaces,
    setAlerts,
    setTopology,
    setCurrentUser,
    setUserRoles,
    setIsAuthenticated,
    setAuthError,
    clearAuthError,
    logout as storeLogout,
    setViewMode,
    setTopologyFilter,
    setExplainAlertId,
    setLiveStreamActive,
    setError,
    setLoading,
    clearError
} from './js/store.js';

import { navigate, onRouteChange, start, getCurrentRoute } from './js/router.js';

// --- DOM element refs (lazily resolved) ---
let appOutlet;
let loginScreen;
let mainApp;
let loginForm;
let loginUsername;
let loginPassword;
let loginError;
let loginSubmit;
let loginBtnText;
let loginBtnSpinner;
let liveToggle;
let liveLabel;
let sidebar;
let sidebarOverlay;
let menuToggle;
let explainDrawer;
let explainDrawerCloseX;
let explainDrawerCloseBtn;
let explainDrawerExportBtn;
let thresholdModal;
let thresholdModalCloseX;
let thresholdModalCancel;
let thresholdModalSave;
let thresholdInterfaceSelect;
let thresholdFeedback;

// --- Runtime state ---
let isLiveStreamActive = false;
let liveStreamTimer = null;
let activeExplainAlertId = null;

// --- Friendly rule titles (UI-only mirror; detection authority remains backend) ---
const FRIENDLY_RULE_TITLES = {
    EXCESSIVE_RETRIES: 'Too many retries',
    QUEUE_GROWTH: 'Queue growing fast',
    OLD_MESSAGE_AGE: 'Messages waiting too long',
    RECOVERY_STALLED: 'Recovery not progressing'
};

const SEVERITY_WEIGHT = { Critical: 3, High: 2, Warning: 1, Info: 0 };

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDurationSeconds(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) return '0s';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const remainingSecs = Math.floor(seconds % 60);
    if (remainingSecs === 0) return `${mins}m`;
    return `${mins}m ${remainingSecs}s`;
}

function formatShortTime(isoString) {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return isoString;
    }
}

function getFriendlyErrorMessage(err, actionContext) {
    const { currentUser, userRoles } = getState();
    const userName = currentUser || 'user';
    const isAdmin = userRoles.includes('SimulatorAdmin');
    const isOperator = userRoles.includes('SupportOperator');
    const isViewer = userRoles.includes('SupportViewer');

    if (err.status === 403) {
        if (actionContext === 'simulation') {
            return `${userName} can't run simulations. Support Operator or Simulator Admin permissions required.`;
        }
        if (actionContext === 'acknowledge') {
            return `${userName} can't acknowledge alerts. Support Operator or Simulator Admin permissions required.`;
        }
        if (actionContext === 'resolve') {
            return `${userName} can't resolve alerts. Support Operator or Simulator Admin permissions required.`;
        }
        if (actionContext === 'thresholds') {
            return `${userName} can't configure thresholds. Simulator Admin permissions required.`;
        }
        return `${userName} doesn't have permission for this action.`;
    }
    if (err.status === 401) {
        return 'Authentication required. Please sign in again.';
    }
    if (err.status === 404) {
        return 'The requested interface or alert could not be found.';
    }
    if (err.status === 409) {
        return 'This action conflicts with the current alert state (already acknowledged or resolved).';
    }
    return `Operation could not complete: ${err.message || 'Network error'}`;
}

function showFeedback(message, type = 'info') {
    const feedback = document.getElementById('scenarioFeedback');
    if (!feedback) return;
    feedback.className = `scenario-feedback-bar${type ? ' has-' + type : ''}`;
    feedback.textContent = message;
}

function resolveEls() {
    appOutlet = document.getElementById('app-outlet');
    loginScreen = document.getElementById('login-screen');
    mainApp = document.getElementById('main-app');
    loginForm = document.getElementById('login-form');
    loginUsername = document.getElementById('login-username');
    loginPassword = document.getElementById('login-password');
    loginError = document.getElementById('login-error');
    loginSubmit = document.getElementById('login-submit');
    loginBtnText = document.getElementById('login-btn-text');
    loginBtnSpinner = document.getElementById('login-btn-spinner');
    liveToggle = document.getElementById('liveStreamToggle');
    liveLabel = document.getElementById('liveStreamLabel');
    sidebar = document.getElementById('sidebar');
    sidebarOverlay = document.getElementById('sidebarOverlay');
    menuToggle = document.querySelector('.menu-toggle');
    explainDrawer = document.getElementById('explainDrawer');
    explainDrawerCloseX = document.getElementById('drawerCloseX');
    explainDrawerCloseBtn = document.getElementById('drawerCloseBtn');
    explainDrawerExportBtn = document.getElementById('drawerExportBtn');
    thresholdModal = document.getElementById('thresholdModal');
    thresholdModalCloseX = document.getElementById('thresholdModalCloseX');
    thresholdModalCancel = document.getElementById('thresholdModalCancel');
    thresholdModalSave = document.getElementById('thresholdModalSave');
    thresholdInterfaceSelect = document.getElementById('thresholdInterfaceSelect');
    thresholdFeedback = document.getElementById('thresholdModalFeedback');
}

/* ------------------------------------------------------------------ */
/* Data refresh                                                       */
/* ------------------------------------------------------------------ */

async function refreshData() {
    if (!getState().isAuthenticated) {
        setLoading(false);
        return;
    }

    setLoading(true);
    clearError();
    try {
        const ifacesData = await fetchInterfaces();
        setInterfaces(ifacesData.value || []);

        const alertsData = await fetchAlerts();
        setAlerts(alertsData.value || []);

        try {
            const topoRes = await fetchTopology();
            const raw = topoRes.value ?? topoRes;
            const topology = typeof raw === 'string' ? JSON.parse(raw) : raw;
            setTopology(topology);
        } catch (e) {
            console.warn('[Topology] Failed to fetch topology graph:', e);
        }

        setLoading(false);

        // Re-render the active route with freshly fetched data
        const current = getCurrentRoute();
        const routeName = current ? (current.name || 'overview') : 'overview';
        await renderRoute(routeName, current ? current.params : {});
    } catch (err) {
        setLoading(false);
        if (err.status === 401) {
            // Credentials no longer valid, show login
            handleLogout();
        } else {
            setError(getFriendlyErrorMessage(err, 'read'));
        }
    }
}

/* ------------------------------------------------------------------ */
/* Page routing                                                       */
/* ------------------------------------------------------------------ */

let currentPage = null;

function updateRoleUI() {
    const { currentUser, userRoles = [], isAuthenticated } = getState();
    const userName = currentUser || '';
    const isAdmin = userRoles.includes('SimulatorAdmin');
    const isOperator = userRoles.includes('SupportOperator');
    const isViewer = userRoles.includes('SupportViewer');
    const canSimulate = isAdmin || isOperator;
    const canAcknowledge = isAdmin || isOperator;
    const canResolve = isAdmin || isOperator;
    const canReset = isAdmin;

    const userAuthInfo = document.getElementById('userAuthInfo');
    const userAuthName = document.getElementById('userAuthName');
    const userAvatarCircle = document.getElementById('userAvatarCircle');
    const userAuthRole = document.getElementById('userAuthRole');
    if (userAuthInfo) {
        if (isAuthenticated) {
            userAuthInfo.classList.remove('hidden');
            userAuthInfo.style.display = 'flex';
        } else {
            userAuthInfo.classList.add('hidden');
            userAuthInfo.style.display = 'none';
        }
    }
    if (userAvatarCircle) {
        const initial = (userName.charAt(0) || 'U').toUpperCase();
        userAvatarCircle.textContent = initial;
    }
    const roleLabel = isAdmin ? 'Simulator admin' : isOperator ? 'Support operator' : isViewer ? 'Support viewer' : '';
    if (userAuthRole) {
        userAuthRole.textContent = roleLabel ? `(${roleLabel})` : '';
    }
    if (userAuthName) {
        if (userAuthRole) {
            userAuthName.textContent = userName;
        } else {
            userAuthName.textContent = roleLabel ? `${userName} (${roleLabel})` : userName;
        }
    }

    const hint = document.getElementById('scenariosRoleHint');
    if (hint) {
        hint.textContent = canSimulate ? `Ready to simulate as ${userName}.` : `${userName} is in view-only mode. Scenario buttons are disabled.`;
        if (canSimulate) {
            hint.classList.remove('is-viewer');
        } else {
            hint.classList.add('is-viewer');
        }
    }

    // Disable/enable scenario buttons based on permissions
    document.querySelectorAll('.sim-btn[data-scenario]').forEach(btn => {
        btn.disabled = !canSimulate;
        if (!canSimulate) {
            btn.title = 'Simulations require Support Operator or Simulator Admin permissions';
        } else {
            btn.removeAttribute('title');
        }
    });

    const btnReset = document.getElementById('btnResetSeed');
    if (btnReset) {
        btnReset.disabled = !canReset;
        btnReset.title = canReset ? 'Reset database to clean seed' : 'Reset requires Simulator Admin role';
    }

    const btnThresholdModal = document.getElementById('btnOpenThresholdModal');
    if (btnThresholdModal) {
        btnThresholdModal.disabled = !canReset;
        btnThresholdModal.title = canReset ? 'Configure per-interface threshold policies' : 'Thresholds require Simulator Admin role';
    }

    const thresholdNotice = document.getElementById('thresholdPermissionNotice');
    if (thresholdNotice) {
        if (!isAdmin) {
            thresholdNotice.style.display = 'block';
            thresholdNotice.textContent = `Signed in as ${userName} (${userRoles.join(', ') || 'viewer'}). Threshold configuration requires Simulator Admin permissions. Saving changes will be rejected with 403 Forbidden.`;
        } else {
            thresholdNotice.style.display = 'none';
        }
    }
}

async function renderRoute(route, params) {
    if (!appOutlet) return;
    const routeName = (typeof route === 'object' && route !== null) ? (route.name || 'overview') : (route || 'overview');
    appOutlet.innerHTML = '';

    if (currentPage && currentPage.cleanup) {
        try { currentPage.cleanup(); } catch (e) { console.warn('[Router] page cleanup error', e); }
    }

    let pageModule;
    try {
        switch (routeName) {
            case 'overview':
                pageModule = await import('./js/pages/OverviewPage.js?v=5.2');
                break;
            case 'interface-inventory':
                pageModule = await import('./js/pages/InterfaceInventoryPage.js?v=5.2');
                break;
            case 'interface-detail':
                pageModule = await import('./js/pages/InterfaceDetailPage.js?v=5.2');
                break;
            case 'topology':
                pageModule = await import('./js/pages/TopologyPage.js?v=5.2');
                break;
            case 'incidents':
                pageModule = await import('./js/pages/IncidentsPage.js?v=5.2');
                break;
            case 'incident-detail':
                pageModule = await import('./js/pages/IncidentDetailPage.js?v=5.2');
                break;
            case 'thresholds':
                pageModule = await import('./js/pages/ThresholdsPage.js?v=5.2');
                break;
            default:
                pageModule = await import('./js/pages/OverviewPage.js?v=5.2');
        }
    } catch (err) {
        appOutlet.innerHTML = `<div class="empty-card"><p class="empty-card-title">Page not available</p><p class="empty-card-subtitle">${err.message}</p></div>`;
        return;
    }

    currentPage = pageModule;
    if (pageModule.render) {
        try {
            const { currentUser, userRoles } = getState();
            pageModule.render(appOutlet, { params, getState, setState, api: {
                fetchInterfaces, fetchAlerts, fetchTopology,
                acknowledgeAlert, resolveAlert, explainAlert, exportIncidentReport,
                triggerSimulation, configureThresholds, resetToCleanSeed
            }, formatDurationSeconds, formatShortTime, FRIENDLY_RULE_TITLES, SEVERITY_WEIGHT, userRoles, currentUser });
        } catch (err) {
            appOutlet.innerHTML = `<div class="empty-card"><p class="empty-card-title">Page render error</p><p class="empty-card-subtitle">${err.message}</p></div>`;
            console.error('[Router] Page render error:', err);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Live stream                                                        */
/* ------------------------------------------------------------------ */

function toggleLiveStream() {
    isLiveStreamActive = !isLiveStreamActive;
    if (liveToggle) {
        if (isLiveStreamActive) {
            liveToggle.classList.add('is-active');
            liveToggle.setAttribute('aria-pressed', 'true');
        } else {
            liveToggle.classList.remove('is-active');
            liveToggle.setAttribute('aria-pressed', 'false');
        }
    }
    if (liveLabel) liveLabel.textContent = `Live stream: ${isLiveStreamActive ? 'ON' : 'OFF'}`;

    if (isLiveStreamActive) {
        showFeedback('Live NOC stream active. Telemetry polling every 4 seconds.', 'success');
        startLiveStream();
    } else {
        stopLiveStream();
    }
}

function startLiveStream() {
    stopLiveStream();
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
}

/* ------------------------------------------------------------------ */
/* Operator actions                                                   */
/* ------------------------------------------------------------------ */

async function handleAcknowledgeAlert(alertId) {
    const { userRoles, currentUser } = getState();
    const userName = currentUser || 'user';
    const canAcknowledge = userRoles.includes('SimulatorAdmin') || userRoles.includes('SupportOperator');
    if (!canAcknowledge) {
        showFeedback(`${userName} has view-only permissions. Sign in as an operator to acknowledge alerts.`, 'error');
        return;
    }
    try {
        await acknowledgeAlert(alertId, userName);
        showFeedback(`Alert acknowledged by ${userName}.`, 'success');
        await refreshData();
    } catch (err) {
        showFeedback(getFriendlyErrorMessage(err, 'acknowledge'), 'error');
    }
}

async function handleResolveAlert(alertId) {
    const { userRoles, currentUser } = getState();
    const userName = currentUser || 'user';
    const canResolve = userRoles.includes('SimulatorAdmin') || userRoles.includes('SupportOperator');
    if (!canResolve) {
        showFeedback(`${userName} has view-only permissions. Sign in as an operator to resolve incidents.`, 'error');
        return;
    }
    try {
        await resolveAlert(alertId, userName);
        showFeedback(`Incident resolved by ${userName}.`, 'success');
        await refreshData();
    } catch (err) {
        showFeedback(getFriendlyErrorMessage(err, 'resolve'), 'error');
    }
}

async function handleResetDatabase() {
    const { userRoles, currentUser } = getState();
    const userName = currentUser || 'user';
    const canReset = userRoles.includes('SimulatorAdmin');
    if (!canReset) {
        showFeedback(`${userName} cannot reset baseline. Sign in as Simulator Admin to perform database reset.`, 'error');
        return;
    }
    try {
        showFeedback('Resetting queues and alerts to pristine factory baseline...', 'info');
        const result = await resetToCleanSeed();
        showFeedback(result.value || 'Database restored to clean baseline.', 'success');
        await refreshData();
    } catch (err) {
        showFeedback(getFriendlyErrorMessage(err, 'reset'), 'error');
    }
}

async function handleTriggerSimulation(scenario, interfaceId) {
    const { userRoles, currentUser } = getState();
    const userName = currentUser || 'user';
    const canSimulate = userRoles.includes('SimulatorAdmin') || userRoles.includes('SupportOperator');
    if (!canSimulate) {
        showFeedback(`${userName} can't run simulations. Sign in as an operator or admin to trigger scenarios.`, 'error');
        return;
    }
    try {
        showFeedback(`Injecting scenario [${scenario}]...`, 'info');
        await triggerSimulation(scenario, interfaceId);
        showFeedback(`Simulation [${scenario}] completed.`, 'success');
        await refreshData();
    } catch (err) {
        showFeedback(getFriendlyErrorMessage(err, 'simulation'), 'error');
    }
}

async function handleSaveThresholds() {
    const interfaceId = thresholdInterfaceSelect ? thresholdInterfaceSelect.value : null;
    if (!interfaceId) return;
    const maxRetryThreshold = parseInt(document.getElementById('maxRetryThreshold').value, 10);
    const queueGrowthLimit = parseInt(document.getElementById('queueGrowthLimit').value, 10);
    const oldMessageAgeLimitSeconds = parseInt(document.getElementById('oldMessageAgeLimitSeconds').value, 10);
    const recoveryStalledBacklog = parseInt(document.getElementById('recoveryStalledBacklog').value, 10);

    if (isNaN(maxRetryThreshold) || isNaN(queueGrowthLimit) || isNaN(oldMessageAgeLimitSeconds) || isNaN(recoveryStalledBacklog)) {
        thresholdFeedback.style.display = 'block';
        thresholdFeedback.style.backgroundColor = '#FBE3E0';
        thresholdFeedback.style.color = '#9C1F17';
        thresholdFeedback.textContent = 'Please enter valid numbers for all threshold fields.';
        return;
    }

    try {
        thresholdFeedback.style.display = 'block';
        thresholdFeedback.style.backgroundColor = '#FCEFD9';
        thresholdFeedback.style.color = '#7A4A00';
        thresholdFeedback.textContent = 'Saving threshold policy...';
        await configureThresholds({
            interfaceId,
            maxRetryThreshold,
            queueGrowthLimit,
            oldMessageAgeLimitSeconds,
            recoveryStalledBacklog
        });
        thresholdFeedback.style.backgroundColor = '#E1F4EC';
        thresholdFeedback.style.color = '#1F7A5A';
        thresholdFeedback.textContent = 'Threshold policy updated successfully! Refreshing data...';
        await refreshData();
        setTimeout(() => closeThresholdModal(), 1200);
    } catch (err) {
        thresholdFeedback.style.backgroundColor = '#FBE3E0';
        thresholdFeedback.style.color = '#9C1F17';
        thresholdFeedback.textContent = getFriendlyErrorMessage(err, 'thresholds');
    }
}

/* ------------------------------------------------------------------ */
/* Threshold modal                                                    */
/* ------------------------------------------------------------------ */

function openThresholdModal() {
    if (!thresholdModal) return;
    thresholdModal.classList.add('is-open');
    thresholdModal.setAttribute('aria-hidden', 'false');
    syncThresholdInterfaceSelect();
    updateThresholdModalPermissions();
}

function closeThresholdModal() {
    if (!thresholdModal) return;
    thresholdModal.classList.remove('is-open');
    thresholdModal.setAttribute('aria-hidden', 'true');
    if (thresholdFeedback) thresholdFeedback.style.display = 'none';
}

function syncThresholdInterfaceSelect() {
    if (!thresholdInterfaceSelect) return;
    const currentSelected = thresholdInterfaceSelect.value;
    thresholdInterfaceSelect.innerHTML = '';
    const { interfaces } = getState();
    for (const iface of interfaces) {
        const opt = document.createElement('option');
        opt.value = iface.ID;
        opt.textContent = `${iface.name} (${iface.sourceSystem} → ${iface.targetSystem})`;
        thresholdInterfaceSelect.appendChild(opt);
    }
    if (currentSelected && interfaces.some(i => i.ID === currentSelected)) {
        thresholdInterfaceSelect.value = currentSelected;
    }
    populateSelectedInterfaceThresholds();
}

function populateSelectedInterfaceThresholds() {
    const { interfaces } = getState();
    const iface = interfaces.find(i => i.ID === thresholdInterfaceSelect.value);
    if (!iface) return;
    const maxRetry = document.getElementById('maxRetryThreshold');
    const queueGrowth = document.getElementById('queueGrowthLimit');
    const oldAge = document.getElementById('oldMessageAgeLimitSeconds');
    const recovery = document.getElementById('recoveryStalledBacklog');
    if (maxRetry) maxRetry.value = iface.maxRetryThreshold ?? 100;
    if (queueGrowth) queueGrowth.value = iface.queueGrowthLimit ?? 200;
    if (oldAge) oldAge.value = iface.oldMessageAgeLimitSeconds ?? 600;
    if (recovery) recovery.value = iface.recoveryStalledBacklog ?? 100;
}

function updateThresholdModalPermissions() {
    const notice = document.getElementById('thresholdPermissionNotice');
    const { userRoles, currentUser } = getState();
    const userName = currentUser || 'user';
    const isAdmin = userRoles.includes('SimulatorAdmin');
    if (notice) {
        if (!isAdmin) {
            notice.style.display = 'block';
            notice.textContent = `Signed in as ${userName} (${userRoles.join(', ') || 'viewer'}). Threshold configuration requires Simulator Admin permissions. Saving changes will be rejected with 403 Forbidden.`;
        } else {
            notice.style.display = 'none';
        }
    }
}

/* ------------------------------------------------------------------ */
/* Explain drawer                                                     */
/* ------------------------------------------------------------------ */

function openExplainDrawer(alertId) {
    activeExplainAlertId = alertId;
    if (!explainDrawer) return;
    explainDrawer.classList.add('is-open');
    explainDrawer.setAttribute('aria-hidden', 'false');

    const body = document.getElementById('drawerBody');
    body.replaceChildren();
    const loadingMsg = document.createElement('div');
    loadingMsg.textContent = 'Generating grounded explanation from runbook and queue metrics...';
    body.appendChild(loadingMsg);

    explainAlert(alertId)
        .then(data => {
            let explanation = data.value;
            if (typeof explanation === 'string') {
                try { explanation = JSON.parse(explanation); } catch (e) { explanation = { summary: explanation }; }
            }
            renderExplainContent(explanation || data);
        })
        .catch(err => {
            const body2 = document.getElementById('drawerBody');
            body2.replaceChildren();
            const errBox = document.createElement('div');
            errBox.style.color = 'var(--color-critical-text)';
            errBox.textContent = getFriendlyErrorMessage(err, 'explain');
            body2.appendChild(errBox);
        });
}

function closeExplainDrawer() {
    if (!explainDrawer) return;
    explainDrawer.classList.remove('is-open');
    explainDrawer.setAttribute('aria-hidden', 'true');
    activeExplainAlertId = null;
}

function renderExplainContent(explanation) {
    const body = document.getElementById('drawerBody');
    body.replaceChildren();

    // Provider badge
    const providerBadge = document.createElement('div');
    providerBadge.className = explanation.aiAssisted ? 'ai-provider-badge is-gemini' : 'ai-provider-badge is-fallback';
    providerBadge.textContent = explanation.aiAssisted
        ? `AI-Assisted Advisory (${explanation.provider || 'Google Gemini'}) • Grounded in Curated Runbook`
        : `Grounded Runbook Advisory (${explanation.provider || 'Offline Mode'})`;
    body.appendChild(providerBadge);

    // Summary
    const secSummary = document.createElement('div');
    const hSummary = document.createElement('h4');
    hSummary.className = 'drawer-section-title';
    hSummary.textContent = 'Summary';
    const pSummary = document.createElement('p');
    pSummary.style.margin = '0';
    pSummary.textContent = explanation.summary || 'Incident analysis generated based on deterministic detection metrics.';
    secSummary.append(hSummary, pSummary);
    body.appendChild(secSummary);

    // Observed facts
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

    // Hypotheses
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

    // Recommended checks
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

    // Runbooks
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

    // Limitations
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

/* ------------------------------------------------------------------ */
/* Event wiring                                                       */
/* ------------------------------------------------------------------ */

function initializeEvents() {
    // Router: render the current page on every route change (only when authenticated)
    onRouteChange((route, params) => {
        if (!getState().isAuthenticated) {
            return;
        }
        const routeName = (typeof route === 'object' && route !== null) ? (route.name || 'overview') : (route || 'overview');
        renderRoute(routeName, params);

        // Highlight matching sidebar nav item
        document.querySelectorAll('.sidebar-item').forEach(link => {
            const dataRoute = link.getAttribute('data-route');
            const isActive = (dataRoute === '' && routeName === 'overview') ||
                             (dataRoute === 'interfaces' && (routeName === 'interface-inventory' || routeName === 'interface-detail')) ||
                             (dataRoute === 'topology' && routeName === 'topology') ||
                             (dataRoute === 'incidents' && (routeName === 'incidents' || routeName === 'incident-detail')) ||
                             (dataRoute === 'thresholds' && routeName === 'thresholds');
            if (isActive) {
                link.classList.add('is-active');
            } else {
                link.classList.remove('is-active');
            }
        });
    });

    // Prototype scenario injection buttons
    document.querySelectorAll('.sim-btn[data-scenario]').forEach(btn => {
        btn.addEventListener('click', () => {
            const scenario = btn.getAttribute('data-scenario');
            const targetSelect = document.getElementById('simulationInterfaceSelect');
            const targetInterfaceId = targetSelect ? targetSelect.value : 'ALL';
            handleTriggerSimulation(scenario, targetInterfaceId);
        });
    });

    // Reset baseline button
    const btnReset = document.getElementById('btnResetSeed');
    if (btnReset) {
        btnReset.addEventListener('click', handleResetDatabase);
    }

    // Configure thresholds modal button
    const btnOpenThreshold = document.getElementById('btnOpenThresholdModal');
    if (btnOpenThreshold) {
        btnOpenThreshold.addEventListener('click', openThresholdModal);
    }

    // Live stream toggle
    if (liveToggle) liveToggle.addEventListener('click', toggleLiveStream);

    // Login form submit
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Toggle password visibility
    const togglePasswordBtn = document.getElementById('login-toggle-password');
    if (togglePasswordBtn && loginPassword) {
        togglePasswordBtn.addEventListener('click', () => {
            const isPassword = loginPassword.type === 'password';
            loginPassword.type = isPassword ? 'text' : 'password';
            togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        });
    }

    // Logout button (in sidebar)
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogout();
        });
    }

    // Manual refresh
    const refreshBtn = document.getElementById('btnRefreshTop');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshData);

    // Sidebar toggle (mobile)
    if (menuToggle) menuToggle.addEventListener('click', () => {
        const open = sidebar.classList.toggle('is-open');
        sidebarOverlay.classList.toggle('is-open');
        menuToggle.setAttribute('aria-expanded', String(open));
    });
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => {
        sidebar.classList.remove('is-open');
        sidebarOverlay.classList.remove('is-open');
        if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    });

    // Sidebar nav links
    document.querySelectorAll('.sidebar-item[data-route]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const route = link.getAttribute('data-route');
            navigate(route);
            sidebar.classList.remove('is-open');
            sidebarOverlay.classList.remove('is-open');
            if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
        });
    });

    // Explain drawer close
    if (explainDrawerCloseX) explainDrawerCloseX.addEventListener('click', closeExplainDrawer);
    if (explainDrawerCloseBtn) explainDrawerCloseBtn.addEventListener('click', closeExplainDrawer);
    if (explainDrawerExportBtn) {
        explainDrawerExportBtn.addEventListener('click', () => {
            if (activeExplainAlertId) {
                const alerts = getState().alerts;
                const alert = alerts.find(a => a.ID === activeExplainAlertId);
                exportIncidentReport(activeExplainAlertId, alert ? alert.ruleCode : 'INCIDENT')
                    .then(data => {
                        const markdownContent = data.value || data;
                        const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        const ruleCode = alert ? alert.ruleCode : 'INCIDENT';
                        a.download = `Incident-Postmortem-${ruleCode}-${String(activeExplainAlertId).slice(0, 8)}.md`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    })
                    .catch(err => {
                        console.error('Failed to export incident postmortem:', err);
                        alert('Could not download incident report: ' + (err.message || 'Error'));
                    });
            }
        });
    }
    if (explainDrawer) {
        explainDrawer.addEventListener('click', (e) => {
            if (e.target === explainDrawer) closeExplainDrawer();
        });
    }

    // Threshold modal events
    if (thresholdModalCloseX) thresholdModalCloseX.addEventListener('click', closeThresholdModal);
    if (thresholdModalCancel) thresholdModalCancel.addEventListener('click', closeThresholdModal);
    if (thresholdModalSave) thresholdModalSave.addEventListener('click', handleSaveThresholds);
    if (thresholdInterfaceSelect) thresholdInterfaceSelect.addEventListener('change', populateSelectedInterfaceThresholds);
    if (thresholdModal) {
        thresholdModal.addEventListener('click', (e) => {
            if (e.target === thresholdModal) closeThresholdModal();
        });
    }

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (explainDrawer && explainDrawer.classList.contains('is-open')) closeExplainDrawer();
            if (thresholdModal && thresholdModal.classList.contains('is-open')) closeThresholdModal();
        }
    });
}

/* ------------------------------------------------------------------ */
/* Authentication                                                     */
/* ------------------------------------------------------------------ */

async function handleLogin(e) {
    e.preventDefault();
    const username = loginUsername ? loginUsername.value.trim() : '';
    const password = loginPassword ? loginPassword.value : '';

    if (!username || !password) {
        if (loginError) {
            loginError.textContent = 'Please enter both username and password.';
            loginError.style.display = 'block';
        }
        return;
    }

    // Set loading state
    if (loginSubmit) loginSubmit.disabled = true;
    if (loginBtnText) loginBtnText.textContent = 'Signing in...';
    if (loginBtnSpinner) loginBtnSpinner.style.display = 'inline-block';
    if (loginError) loginError.style.display = 'none';
    clearAuthError();

    try {
        const result = await login(username, password);
        // Store auth state from backend (sole source of truth for roles)
        setCurrentUser(result.userId);
        setUserRoles(result.roles);
        setIsAuthenticated(true);

        // Hide login, show main app
        if (loginScreen) {
            loginScreen.classList.add('hidden');
            loginScreen.style.display = 'none';
        }
        if (mainApp) {
            mainApp.classList.remove('hidden');
            mainApp.style.display = 'block';
        }

        // Update UI for authenticated user
        updateRoleUI();

        // Initial data load
        await refreshData();
    } catch (err) {
        if (loginScreen) {
            loginScreen.classList.remove('hidden');
            loginScreen.style.display = 'flex';
        }
        if (mainApp) {
            mainApp.classList.add('hidden');
            mainApp.style.display = 'none';
        }
        const msg = err.status === 401 ? 'Invalid username or password.' : `Login failed (${err.status || err.message}). Please try again.`;
        if (loginError) {
            loginError.textContent = msg;
            loginError.style.display = 'block';
        }
        setAuthError(msg);
    } finally {
        if (loginSubmit) loginSubmit.disabled = false;
        if (loginBtnText) loginBtnText.textContent = 'Sign in';
        if (loginBtnSpinner) loginBtnSpinner.style.display = 'none';
    }
}

async function handleLogout() {
    logout();
    storeLogout();

    // Hide main app, show login
    if (mainApp) {
        mainApp.classList.add('hidden');
        mainApp.style.display = 'none';
    }
    if (loginScreen) {
        loginScreen.classList.remove('hidden');
        loginScreen.style.display = 'flex';
    }

    // Clear form
    if (loginUsername) loginUsername.value = '';
    if (loginPassword) loginPassword.value = '';
    if (loginError) {
        loginError.textContent = '';
        loginError.style.display = 'none';
    }

    updateRoleUI();
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                          */
/* ------------------------------------------------------------------ */

async function bootstrap() {
    resolveEls();

    // Check authentication status from in-memory credentials
    const stored = hasCredentials();

    if (stored) {
        setIsAuthenticated(true);
        if (loginScreen) {
            loginScreen.classList.add('hidden');
            loginScreen.style.display = 'none';
        }
        if (mainApp) {
            mainApp.classList.remove('hidden');
            mainApp.style.display = 'block';
        }
        updateRoleUI();
    } else {
        // No credentials stored, show login
        if (loginScreen) {
            loginScreen.classList.remove('hidden');
            loginScreen.style.display = 'flex';
        }
        if (mainApp) {
            mainApp.classList.add('hidden');
            mainApp.style.display = 'none';
        }
    }

    // Start router
    start();

    // Only load data if authenticated
    if (getState().isAuthenticated) {
        await refreshData();
    }

    // Wire events
    initializeEvents();
}

bootstrap().catch(err => {
    console.error('[Bootstrap] Failed to initialize app:', err);
    const outlet = document.getElementById('app-outlet');
    if (outlet) {
        outlet.innerHTML = `<div class="empty-card"><p class="empty-card-title">Application failed to start</p><p class="empty-card-subtitle">${err.message}</p></div>`;
    }
});
