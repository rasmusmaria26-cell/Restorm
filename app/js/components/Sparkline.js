/**
 * Sparkline.js — SVG pressure line chart.
 *
 * Extracted from the original createPressureLineSVG in app.js with the same
 * behavior: draws a dashed threshold line at the limit value, a polyline of
 * pending counts, and a highlight dot on the latest snapshot.
 *
 * Usage:
 *   import { Sparkline } from './components/Sparkline.js';
 *   const svgEl = Sparkline({ snapshots, limitValue, width: 220, height: 40 });
 *   container.appendChild(svgEl);
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function Sparkline({
    snapshots = [],
    limitValue = 200,
    width = 220,
    height = 40
} = {}) {
    const padX = 6;
    const padY = 6;
    const effW = width - padX * 2;
    const effH = height - padY * 2;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'sparkline-svg');
    svg.setAttribute('aria-hidden', 'true');

    // If no snapshots, render flat baseline
    if (!snapshots || snapshots.length === 0) {
        const line = document.createElementNS(SVG_NS, 'line');
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
    const pointsData = snapshots.map((s) => Number(s.pendingCount) || 0);
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
    const limitLine = document.createElementNS(SVG_NS, 'line');
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

    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('points', coords.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', isOverLimit ? 'var(--color-critical)' : 'var(--color-harbor)');
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);

    // 3. Highlight dot on the latest snapshot point
    const lastCoord = coords[coords.length - 1].split(',');
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', lastCoord[0]);
    dot.setAttribute('cy', lastCoord[1]);
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', isOverLimit ? 'var(--color-critical)' : 'var(--color-harbor)');
    svg.appendChild(dot);

    return svg;
}
