/**
 * EmptyState.js — empty state illustration.
 *
 * Usage:
 *   import { EmptyState } from './components/EmptyState.js';
 *   const el = EmptyState({
 *     title: 'No interfaces monitored',
 *     subtitle: 'Active integration endpoints will appear here once registered.'
 *   });
 *   container.appendChild(el);
 */

export function EmptyState({
    title = 'No data available',
    subtitle = '',
    className = ''
} = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = ['empty-card', className].filter(Boolean).join(' ');

    if (title) {
        const titleEl = document.createElement('p');
        titleEl.className = 'empty-card-title';
        titleEl.textContent = title;
        wrapper.appendChild(titleEl);
    }

    if (subtitle) {
        const subEl = document.createElement('p');
        subEl.className = 'empty-card-subtitle';
        subEl.textContent = subtitle;
        wrapper.appendChild(subEl);
    }

    return wrapper;
}
