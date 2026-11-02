/**
 * ErrorState.js — error display with retry.
 *
 * Usage:
 *   import { ErrorState } from './components/ErrorState.js';
 *   const el = ErrorState({
 *     message: 'Could not refresh data',
 *     onRetry: () => refresh(),
 *     retryLabel: 'Retry'
 *   });
 *   container.appendChild(el);
 */

export function ErrorState({
    message = 'An error occurred',
    onRetry,
    retryLabel = 'Retry',
    className = ''
} = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = ['error-state', className].filter(Boolean).join(' ');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '10px';
    wrapper.style.padding = '24px';
    wrapper.style.textAlign = 'center';
    wrapper.style.color = 'var(--color-critical-text)';

    const text = document.createElement('div');
    text.textContent = message;
    text.style.fontSize = '0.875rem';
    wrapper.appendChild(text);

    if (onRetry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = retryLabel;
        btn.className = 'btn btn-harbor';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            onRetry(e);
        });
        wrapper.appendChild(btn);
    }

    return wrapper;
}
