/**
 * TopologyGraph.js — SVG topology graph.
 *
 * Extracted from the original renderTopologySvg in app.js with the same
 * behavior: renders edges/channels with clickable hit paths and badges, plus
 * system landscape nodes with alert badges. Supports node/edge filtering via
 * onNodeToggle and onEdgeToggle callbacks.
 *
 * Usage:
 *   import { TopologyGraph } from './components/TopologyGraph.js';
 *   const svgEl = TopologyGraph({
 *     topology,
 *     selectedFilter,        // { type, id, name, interfaceId? } or null
 *     onNodeToggle(node),    // called when a node is clicked
 *     onEdgeToggle(edge)     // called when an edge/channel is clicked
 *   });
 *   container.replaceChildren(svgEl);
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// Fixed channel geometries for the three monitored interfaces
const EDGE_GEOMETRIES = {
    '11111111-1111-1111-1111-111111111111': {
        d: 'M 205 67 C 320 18, 380 18, 487 67',
        labelX: 350,
        labelY: 20
    },
    '22222222-2222-2222-2222-222222222222': {
        d: 'M 540 99 C 490 142, 490 142, 540 183',
        labelX: 475,
        labelY: 142
    },
    '33333333-3333-3333-3333-333333333333': {
        d: 'M 205 217 C 235 217, 235 155, 252 155',
        labelX: 200,
        labelY: 180
    }
};

// Fixed coordinates for the five system landscape nodes
const TOPO_COORDS = {
    WEBSHOP: { x: 30, y: 35, width: 175, height: 64 },
    WMS: { x: 30, y: 185, width: 175, height: 64 },
    CPI: { x: 260, y: 105, width: 180, height: 75 },
    S4HANA: { x: 495, y: 35, width: 175, height: 64 },
    PAYGATE: { x: 495, y: 185, width: 175, height: 64 }
};

/**
 * Build an SVG topology graph element.
 */
export function TopologyGraph({
    topology,
    selectedFilter = null,
    onNodeToggle,
    onEdgeToggle
} = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 700 285');
    svg.setAttribute('class', 'topology-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Integration system landscape topology map');

    if (!topology) return svg;

    // --- Defs: Arrowhead markers ---
    const defs = document.createElementNS(SVG_NS, 'defs');
    function createArrowMarker(id, fill) {
        const marker = document.createElementNS(SVG_NS, 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M 0 1.5 L 8 5 L 0 8.5 z');
        path.setAttribute('fill', fill);
        marker.appendChild(path);
        return marker;
    }
    defs.appendChild(createArrowMarker('arrow-healthy', '#2E8B6A'));
    defs.appendChild(createArrowMarker('arrow-warning', '#E08A00'));
    defs.appendChild(createArrowMarker('arrow-critical', '#D93A2F'));
    svg.appendChild(defs);

    // --- Edges / Channels ---
    const edgesGroup = document.createElementNS(SVG_NS, 'g');
    edgesGroup.setAttribute('class', 'topo-edges-group');

    for (const edge of topology.edges || []) {
        const isSelected = selectedFilter
            && selectedFilter.type === 'edge'
            && selectedFilter.interfaceId === edge.interfaceId;
        const statusColor = edge.status === 'Critical'
            ? '#D93A2F'
            : edge.status === 'Warning'
                ? '#E08A00'
                : '#2E8B6A';
        const markerUrl = edge.status === 'Critical'
            ? 'url(#arrow-critical)'
            : edge.status === 'Warning'
                ? 'url(#arrow-warning)'
                : 'url(#arrow-healthy)';

        const gEdge = document.createElementNS(SVG_NS, 'g');
        gEdge.setAttribute('class', `topo-edge ${
            edge.status === 'Critical' ? 'is-critical' : ''
        } ${isSelected ? 'is-selected' : ''}`);

        const geom = EDGE_GEOMETRIES[edge.interfaceId] || {
            d: 'M 205 67 L 490 67',
            labelX: 350,
            labelY: 67
        };

        // Underlying hit path for easy clicking
        const hitPath = document.createElementNS(SVG_NS, 'path');
        hitPath.setAttribute('d', geom.d);
        hitPath.setAttribute('fill', 'none');
        hitPath.setAttribute('stroke', 'transparent');
        hitPath.setAttribute('stroke-width', '20');
        hitPath.style.cursor = 'pointer';
        hitPath.addEventListener('click', () => {
            if (onEdgeToggle) onEdgeToggle(edge);
        });
        gEdge.appendChild(hitPath);

        // Visible connection line
        const linePath = document.createElementNS(SVG_NS, 'path');
        linePath.setAttribute('class', 'topo-edge-line');
        linePath.setAttribute('d', geom.d);
        linePath.setAttribute('fill', 'none');
        linePath.setAttribute('stroke', statusColor);
        linePath.setAttribute('stroke-width', '2.5');
        linePath.setAttribute('marker-end', markerUrl);
        linePath.addEventListener('click', () => {
            if (onEdgeToggle) onEdgeToggle(edge);
        });
        gEdge.appendChild(linePath);

        // Edge Channel Badge
        const metrics = edge.metrics || { pendingCount: 0, retryAttempts: 0 };
        const badgeW = 120;
        const badgeH = 28;
        const badgeX = geom.labelX - badgeW / 2;
        const badgeY = geom.labelY - badgeH / 2;

        const badgeBg = document.createElementNS(SVG_NS, 'rect');
        badgeBg.setAttribute('x', String(badgeX));
        badgeBg.setAttribute('y', String(badgeY));
        badgeBg.setAttribute('width', String(badgeW));
        badgeBg.setAttribute('height', String(badgeH));
        badgeBg.setAttribute('rx', '4');
        badgeBg.setAttribute('ry', '4');
        badgeBg.setAttribute('fill', edge.status === 'Critical'
            ? '#FBE3E0'
            : edge.status === 'Warning'
                ? '#FCEFD9'
                : '#FFFFFF');
        badgeBg.setAttribute('stroke', statusColor);
        badgeBg.setAttribute('stroke-width', isSelected ? '2' : '1');
        badgeBg.style.cursor = 'pointer';
        badgeBg.addEventListener('click', () => {
            if (onEdgeToggle) onEdgeToggle(edge);
        });
        gEdge.appendChild(badgeBg);

        const labelTitle = document.createElementNS(SVG_NS, 'text');
        labelTitle.setAttribute('x', String(geom.labelX));
        labelTitle.setAttribute('y', String(badgeY + 11));
        labelTitle.setAttribute('font-size', '9');
        labelTitle.setAttribute('font-weight', '600');
        labelTitle.setAttribute('text-anchor', 'middle');
        labelTitle.setAttribute('fill', edge.status === 'Critical'
            ? '#9C1F17'
            : edge.status === 'Warning'
                ? '#7A4A00'
                : '#17212B');
        labelTitle.style.pointerEvents = 'none';
        labelTitle.textContent = edge.name;
        gEdge.appendChild(labelTitle);

        const labelSub = document.createElementNS(SVG_NS, 'text');
        labelSub.setAttribute('x', String(geom.labelX));
        labelSub.setAttribute('y', String(badgeY + 22));
        labelSub.setAttribute('font-size', '8.5');
        labelSub.setAttribute('text-anchor', 'middle');
        labelSub.setAttribute('fill', edge.status === 'Critical'
            ? '#C62E24'
            : '#5B6B7A');
        labelSub.style.pointerEvents = 'none';
        labelSub.textContent = `${metrics.pendingCount} queued • ${metrics.retryAttempts} retries`;
        gEdge.appendChild(labelSub);

        edgesGroup.appendChild(gEdge);
    }
    svg.appendChild(edgesGroup);

    // --- System Landscape Nodes ---
    const nodesGroup = document.createElementNS(SVG_NS, 'g');
    nodesGroup.setAttribute('class', 'topo-nodes-group');

    for (const node of topology.nodes || []) {
        const coords = TOPO_COORDS[node.id] || { x: 30, y: 35, width: 175, height: 64 };
        const isSelected = selectedFilter
            && selectedFilter.type === 'node'
            && selectedFilter.id === node.id;
        const nodeColor = node.status === 'Critical'
            ? '#D93A2F'
            : node.status === 'Warning'
                ? '#E08A00'
                : '#2E8B6A';

        const gNode = document.createElementNS(SVG_NS, 'g');
        gNode.setAttribute('class', `topo-node ${isSelected ? 'is-selected' : ''}`);
        gNode.addEventListener('click', () => {
            if (onNodeToggle) onNodeToggle(node);
        });

        // Node card rect
        const nodeRect = document.createElementNS(SVG_NS, 'rect');
        nodeRect.setAttribute('class', 'topo-node-rect');
        nodeRect.setAttribute('x', String(coords.x));
        nodeRect.setAttribute('y', String(coords.y));
        nodeRect.setAttribute('width', String(coords.width));
        nodeRect.setAttribute('height', String(coords.height));
        nodeRect.setAttribute('rx', '8');
        nodeRect.setAttribute('ry', '8');
        nodeRect.setAttribute('fill', '#FFFFFF');
        nodeRect.setAttribute('stroke', isSelected ? 'var(--color-harbor)' : nodeColor);
        nodeRect.setAttribute('stroke-width', isSelected ? '2.5'
            : (node.status === 'Critical' ? '2' : '1.5'));
        gNode.appendChild(nodeRect);

        // Category Tag
        const catText = document.createElementNS(SVG_NS, 'text');
        catText.setAttribute('x', String(coords.x + 12));
        catText.setAttribute('y', String(coords.y + 18));
        catText.setAttribute('font-size', '9');
        catText.setAttribute('font-weight', '600');
        catText.setAttribute('fill', '#5B6B7A');
        catText.setAttribute('letter-spacing', '0.5');
        catText.textContent = (node.category || 'SYSTEM').toUpperCase();
        gNode.appendChild(catText);

        // Health status indicator dot
        const statusDot = document.createElementNS(SVG_NS, 'circle');
        statusDot.setAttribute('cx', String(coords.x + coords.width - 16));
        statusDot.setAttribute('cy', String(coords.y + 15));
        statusDot.setAttribute('r', '4.5');
        statusDot.setAttribute('fill', nodeColor);
        gNode.appendChild(statusDot);

        // System Name
        const nameText = document.createElementNS(SVG_NS, 'text');
        nameText.setAttribute('x', String(coords.x + 12));
        nameText.setAttribute('y', String(coords.y + 36));
        nameText.setAttribute('font-size', '12');
        nameText.setAttribute('font-weight', '600');
        nameText.setAttribute('fill', '#17212B');
        nameText.textContent = node.name;
        gNode.appendChild(nameText);

        // Subtitle: Code • Tier
        const subText = document.createElementNS(SVG_NS, 'text');
        subText.setAttribute('x', String(coords.x + 12));
        subText.setAttribute('y', String(coords.y + 51));
        subText.setAttribute('font-size', '9.5');
        subText.setAttribute('fill', '#5B6B7A');
        subText.textContent = `${node.id} • ${node.tier}`;
        gNode.appendChild(subText);

        // Alert badge if node has active alerts
        if (node.activeAlertCount > 0) {
            const alertBadgeW = 58;
            const alertBadgeH = 16;
            const alertBadgeX = coords.x + coords.width - alertBadgeW - 10;
            const alertBadgeY = coords.y + coords.height - alertBadgeH - 8;

            const aBadge = document.createElementNS(SVG_NS, 'rect');
            aBadge.setAttribute('x', String(alertBadgeX));
            aBadge.setAttribute('y', String(alertBadgeY));
            aBadge.setAttribute('width', String(alertBadgeW));
            aBadge.setAttribute('height', String(alertBadgeH));
            aBadge.setAttribute('rx', '4');
            aBadge.setAttribute('ry', '4');
            aBadge.setAttribute('fill', '#FBE3E0');
            aBadge.setAttribute('stroke', '#D93A2F');
            aBadge.setAttribute('stroke-width', '0.8');
            gNode.appendChild(aBadge);

            const aText = document.createElementNS(SVG_NS, 'text');
            aText.setAttribute('x', String(alertBadgeX + alertBadgeW / 2));
            aText.setAttribute('y', String(alertBadgeY + 11));
            aText.setAttribute('font-size', '8.5');
            aText.setAttribute('font-weight', '600');
            aText.setAttribute('text-anchor', 'middle');
            aText.setAttribute('fill', '#9C1F17');
            aText.textContent = `! ${node.activeAlertCount} alert`;
            gNode.appendChild(aText);
        }

        nodesGroup.appendChild(gNode);
    }
    svg.appendChild(nodesGroup);

    return svg;
}
