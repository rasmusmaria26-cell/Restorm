/**
 * TopologyPage.js — Integration Topology page.
 *
 * Phase 5 Agent 4 (Topology Specialist).
 *
 * Renders the integration landscape topology backed by the real getTopology()
 * OData function. All node relationships come from the backend; nothing is
 * invented here.
 *
 * Features:
 *   - Fetch topology via api.fetchTopology() on mount
 *   - SVG topology visualization (reuses shared TopologyGraph component)
 *   - Node selection: click a node to filter to that system (filter banner)
 *   - Interface navigation: click an edge to navigate to #interface/:interfaceId
 *   - Health indicators: color-coded nodes and edges (healthy/warning/critical)
 *   - Incident highlighting: alert badges on nodes/edges with active alerts
 *   - Search filter: filter nodes/edges by name (system, interface, component)
 *   - Health filters: show only healthy/warning/critical
 *   - Summary pills: healthy/warning/critical counts from topology.summary
 *   - Empty / error / loading states
 *   - Responsive: SVG scales, container overflow-x auto
 *
 * Exports render(container, context) and cleanup().
 * The `api` object is provided by app.js via context.api (fetchTopology, etc.).
 */

import { TopologyGraph } from '../components/TopologyGraph.js';
import { LoadingState } from '../components/LoadingState.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { setLoading, setError, clearError } from '../store.js';

const STATUS_COLORS = {
    Healthy: '#2E8B6A',
    Warning: '#E08A00',
    Critical: '#D93A2F'
};

const STATUS_LABELS = {
    Healthy: 'Healthy',
    Warning: 'Warning',
    Critical: 'Critical'
};

/* ------------------------------------------------------------------ */
/* Data transformation                                                */
/* ------------------------------------------------------------------ */

/**
 * Normalize the backend getTopology() response (LargeString JSON) into a
 * plain topology object. Handles string bodies, wrapped { value } payloads,
 * and missing/malformed data defensively.
 */
export function normalizeTopology(raw) {
    if (raw === null || raw === undefined) {
        return { nodes: [], edges: [], summary: { totalSystems: 0, totalConnections: 0, healthyCount: 0, warningCount: 0, criticalCount: 0 } };
    }

    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (e) { return emptyTopology(); }
    } else if (raw.value !== undefined && typeof raw.value === 'string') {
        try { parsed = JSON.parse(raw.value); } catch (e) { return emptyTopology(); }
    } else if (raw.value !== undefined && typeof raw.value === 'object') {
        parsed = raw.value;
    }

    if (!parsed || typeof parsed !== 'object') return emptyTopology();

    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const edges = Array.isArray(parsed.edges) ? parsed.edges : [];

    const summary = parsed.summary || {};
    return {
        generatedAt: parsed.generatedAt || null,
        nodes,
        edges,
        summary: {
            totalSystems: Number(summary.totalSystems) || nodes.length,
            totalConnections: Number(summary.totalConnections) || edges.length,
            healthyCount: Number(summary.healthyCount) || 0,
            warningCount: Number(summary.warningCount) || 0,
            criticalCount: Number(summary.criticalCount) || 0
        }
    };
}

function emptyTopology() {
    return {
        generatedAt: null,
        nodes: [],
        edges: [],
        summary: { totalSystems: 0, totalConnections: 0, healthyCount: 0, warningCount: 0, criticalCount: 0 }
    };
}

/**
 * Build the filtered view-model: applies search text + health filter to nodes
 * and edges. Search matches system name / code, interface name / component.
 * Health filter keeps only nodes/edges matching the selected status.
 */
export function buildViewModel(topology, { searchText, healthFilter, nodeFilter } = {}) {
    const nodes = topology.nodes || [];
    const edges = topology.edges || [];

    const searchLower = (searchText || '').toLowerCase().trim();

    // Determine node filter (by selected system id)
    const selectedNodeId = (nodeFilter && nodeFilter.type === 'node') ? nodeFilter.id : null;

    // Filter nodes
    const filteredNodes = nodes.filter((node) => {
        const matchesSearch = !searchLower
            || String(node.name || '').toLowerCase().includes(searchLower)
            || String(node.id || '').toLowerCase().includes(searchLower)
            || String(node.category || '').toLowerCase().includes(searchLower);
        const matchesHealth = !healthFilter || node.status === healthFilter;
        const matchesNodeFilter = !selectedNodeId || node.id === selectedNodeId;
        return matchesSearch && matchesHealth && matchesNodeFilter;
    });

    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

    // Filter edges: keep edges whose source/target are in filtered node set
    // (when a node is selected) OR match search/health directly.
    const filteredEdges = edges.filter((edge) => {
        const matchesSearch = !searchLower
            || String(edge.name || '').toLowerCase().includes(searchLower)
            || String(edge.component || '').toLowerCase().includes(searchLower)
            || String(edge.source || '').toLowerCase().includes(searchLower)
            || String(edge.target || '').toLowerCase().includes(searchLower);
        const matchesHealth = !healthFilter || edge.status === healthFilter;
        const matchesNodeFilter = !selectedNodeId
            || edge.source === selectedNodeId
            || edge.target === selectedNodeId;
        return matchesSearch && matchesHealth && matchesNodeFilter;
    });

    return {
        ...topology,
        nodes: filteredNodes,
        edges: filteredEdges,
        filteredNodeIds,
        searchText: searchText || '',
        healthFilter: healthFilter || null,
        nodeFilter: nodeFilter || null
    };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

export function render(container, context = {}) {
    const api = context.api || {};
    const fetchTopology = api.fetchTopology;

    container.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'topology-page';

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'headline-card';
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.gap = '12px';
    header.style.padding = '18px 24px';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'headline-content';
    const title = document.createElement('h2');
    title.className = 'headline-title';
    title.textContent = 'Integration Topology';
    const subtitle = document.createElement('p');
    subtitle.className = 'headline-subtitle';
    subtitle.textContent = 'System landscape and integration channel health';
    titleWrap.append(title, subtitle);
    header.appendChild(titleWrap);
    page.appendChild(header);

    // --- Controls: search + health filters ---
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '10px';
    controls.style.flexWrap = 'wrap';
    controls.style.alignItems = 'center';

    const searchLabel = document.createElement('label');
    searchLabel.textContent = 'Search';
    searchLabel.style.fontSize = '0.75rem';
    searchLabel.style.color = 'var(--color-slate)';
    searchLabel.style.marginRight = '6px';
    controls.appendChild(searchLabel);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'System, interface, component…';
    searchInput.className = 'form-select-sm';
    searchInput.style.padding = '6px 10px';
    searchInput.style.borderRadius = '6px';
    searchInput.style.border = '1px solid var(--color-divider)';
    searchInput.style.backgroundColor = 'var(--color-mist)';
    searchInput.style.color = 'var(--color-ink)';
    searchInput.style.minWidth = '220px';
    controls.appendChild(searchInput);

    const healthLabel = document.createElement('label');
    healthLabel.textContent = 'Health';
    healthLabel.style.fontSize = '0.75rem';
    healthLabel.style.color = 'var(--color-slate)';
    healthLabel.style.marginRight = '6px';
    healthLabel.style.marginLeft = '12px';
    controls.appendChild(healthLabel);

    const healthSelect = document.createElement('select');
    healthSelect.className = 'form-select-sm';
    healthSelect.style.padding = '6px 10px';
    healthSelect.style.borderRadius = '6px';
    healthSelect.style.border = '1px solid var(--color-divider)';
    healthSelect.style.backgroundColor = 'var(--color-mist)';
    healthSelect.style.color = 'var(--color-ink)';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All';
    healthSelect.appendChild(allOpt);
    ['Healthy', 'Warning', 'Critical'].forEach((status) => {
        const opt = document.createElement('option');
        opt.value = status;
        opt.textContent = status;
        healthSelect.appendChild(opt);
    });
    controls.appendChild(healthSelect);

    const clearBtn = Button({
        text: 'Clear filters',
        variant: 'quiet',
        onClick: () => {
            searchInput.value = '';
            healthSelect.value = '';
            applyFilters();
        },
        disabled: true
    });
    controls.appendChild(clearBtn);
    page.appendChild(controls);

    // --- Filter banner (shown when a node is selected) ---
    const banner = document.createElement('div');
    banner.className = 'topology-filter-banner';
    banner.style.display = 'none';
    const bannerText = document.createElement('span');
    bannerText.className = 'topology-filter-text';
    const clearFilterBtn = Button({
        text: 'Clear selection',
        variant: 'quiet',
        onClick: () => {
            setNodeFilter(null);
            renderTopology();
        }
    });
    banner.append(bannerText, clearFilterBtn);
    page.appendChild(banner);

    // --- Summary pills ---
    const pillsWrap = document.createElement('div');
    pillsWrap.className = 'topology-summary-bar';
    const pillsRow = document.createElement('div');
    pillsRow.className = 'topology-pills-row';
    const pillTotal = document.createElement('span');
    pillTotal.style.fontSize = '0.75rem';
    pillTotal.style.color = 'var(--color-slate)';
    const pillHealthy = document.createElement('span');
    pillHealthy.className = 'topology-pill is-healthy';
    const pillWarning = document.createElement('span');
    pillWarning.className = 'topology-pill is-warning';
    const pillCritical = document.createElement('span');
    pillCritical.className = 'topology-pill is-critical';
    pillsRow.append(pillTotal, pillHealthy, pillWarning, pillCritical);
    pillsWrap.appendChild(pillsRow);
    page.appendChild(pillsWrap);

    // --- Topology visualization container ---
    const svgWrap = document.createElement('div');
    svgWrap.className = 'topology-svg-container';
    page.appendChild(svgWrap);

    // --- Bottom: legend / count line ---
    const countLine = document.createElement('div');
    countLine.style.marginTop = '8px';
    countLine.style.fontSize = '0.75rem';
    countLine.style.color = 'var(--color-slate)';
    countLine.style.display = 'flex';
    countLine.style.gap = '16px';
    countLine.style.justifyContent = 'space-between';
    countLine.style.flexWrap = 'wrap';
    page.appendChild(countLine);

    container.appendChild(page);

    /* ------------------------------------------------------------------ */
    /* State                                                              */
    /* ------------------------------------------------------------------ */

    let topology = emptyTopology();
    let viewModel = emptyTopology();
    let loading = false;
    let error = null;
    let nodeFilter = null;

    const mounted = new Set();

    /* ------------------------------------------------------------------ */
    /* Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function statusColor(status) {
        return STATUS_COLORS[status] || '#5B6B7A';
    }

    function updateSummaryPills(vm) {
        const s = vm.summary || {};
        pillTotal.textContent = `${s.totalSystems || 0} systems • ${s.totalConnections || 0} connections`;
        pillHealthy.textContent = `● ${s.healthyCount || 0} healthy`;
        pillWarning.textContent = `● ${s.warningCount || 0} warning`;
        pillCritical.textContent = `● ${s.criticalCount || 0} critical`;
        pillHealthy.className = 'topology-pill is-healthy';
        pillWarning.className = 'topology-pill is-warning';
        pillCritical.className = 'topology-pill is-critical';
    }

    function updateCountLine(vm) {
        const n = vm.nodes.length;
        const e = vm.edges.length;
        const alertNodes = (vm.nodes || []).filter((nd) => (nd.activeAlertCount || 0) > 0).length;
        const alertEdges = (vm.edges || []).filter((ed) => (ed.activeAlertCount || 0) > 0).length;
        countLine.innerHTML = '';
        const left = document.createElement('span');
        left.textContent = `${n} node${n !== 1 ? 's' : ''} • ${e} connection${e !== 1 ? 's' : ''}`;
        const right = document.createElement('span');
        right.textContent = `${alertNodes} node${alertNodes !== 1 ? 's' : ''} with alerts • ${alertEdges} connection${alertEdges !== 1 ? 's' : ''} with incidents`;
        countLine.append(left, right);
    }

    function renderTopology() {
        svgWrap.replaceChildren();
        if (error) {
            svgWrap.appendChild(ErrorState({
                message: error || 'Failed to load topology',
                onRetry: loadTopology,
                retryLabel: 'Retry'
            }));
            updateSummaryPills(emptyTopology());
            updateCountLine(emptyTopology());
            return;
        }
        if (loading) {
            svgWrap.appendChild(LoadingState({ message: 'Loading topology…' }));
            updateSummaryPills(emptyTopology());
            updateCountLine(emptyTopology());
            return;
        }

        const vm = viewModel;
        const hasData = (vm.nodes.length > 0 || vm.edges.length > 0);
        if (!hasData) {
            svgWrap.appendChild(EmptyState({
                title: 'No topology data',
                subtitle: 'No systems or integration connections are available.'
            }));
            updateSummaryPills(vm);
            updateCountLine(vm);
            return;
        }

        const svg = TopologyGraph({
            topology: vm,
            selectedFilter: nodeFilter,
            onNodeToggle: (node) => setNodeFilter({ type: 'node', id: node.id, name: node.name }),
            onEdgeToggle: (edge) => {
                if (edge && edge.interfaceId) {
                    navigateToInterface(edge.interfaceId);
                }
            }
        });
        svgWrap.appendChild(svg);
        updateSummaryPills(vm);
        updateCountLine(vm);
    }

    function setNodeFilter(filter) {
        nodeFilter = filter;
        if (filter) {
            banner.style.display = 'flex';
            bannerText.textContent = `Filtered to system: ${filter.name || filter.id} — click an edge to open its interface, or "Clear selection" to show all systems.`;
        } else {
            banner.style.display = 'none';
        }
        renderTopology();
    }

    function applyFilters() {
        const searchText = searchInput.value;
        const healthFilter = healthSelect.value || null;
        viewModel = buildViewModel(topology, { searchText, healthFilter, nodeFilter });
        clearBtn.disabled = !(searchText || healthFilter || nodeFilter);
        renderTopology();
    }

    function navigateToInterface(interfaceId) {
        const navigate = context.navigate;
        if (navigate) {
            navigate(`interface/${interfaceId}`);
        } else if (typeof window !== 'undefined' && window.location) {
            window.location.hash = `interface/${interfaceId}`;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Data load                                                          */
    /* ------------------------------------------------------------------ */

    async function loadTopology() {
        if (!fetchTopology) {
            error = 'Topology API not available';
            loading = false;
            renderTopology();
            return;
        }
        loading = true;
        error = null;
        setLoading(true);
        clearError();
        renderTopology();
        try {
            const raw = await fetchTopology();
            topology = normalizeTopology(raw);
            viewModel = buildViewModel(topology, {
                searchText: searchInput.value,
                healthFilter: healthSelect.value || null,
                nodeFilter
            });
            clearBtn.disabled = !(searchInput.value || healthSelect.value || nodeFilter);
            loading = false;
            error = null;
            setLoading(false);
            renderTopology();
        } catch (err) {
            loading = false;
            setLoading(false);
            error = err && err.message ? err.message : String(err);
            setError(error);
            renderTopology();
        }
    }

    /* Wire filter inputs */
    searchInput.addEventListener('input', applyFilters);
    healthSelect.addEventListener('change', applyFilters);

    /* Kick off load */
    loadTopology();

    return { cleanup };
}

export function cleanup() {
    // No persistent listeners/timers at this level; inputs are bound to the
    // DOM which is replaced on route change. Nothing to teardown.
}
