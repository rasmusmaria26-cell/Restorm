/**
 * LoadingState.js — loading spinner / skeleton UI.
 *
 * Usage:
 *   import { LoadingState } from './components/LoadingState.js';
 *   const el = LoadingState({ message: 'Loading interfaces...' });
 *   container.appendChild(el);
 *   // el.remove() when done
 */

export function LoadingState({ message = 'Loading…' } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'loading-state';
    wrapper.setAttribute('aria-busy', 'true');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '10px';
    wrapper.style.padding = '24px';
    wrapper.style.textAlign = 'center';
    wrapper.style.color = 'var(--color-slate)';

    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.style.width = '28px';
    spinner.style.height = '28px';
    spinner.style.border = '3px solid var(--color-divider-light)';
    spinner.style.borderTopColor = 'var(--color-harbor)';
    spinner.style.borderRadius = '50%';
    spinner.style.animation = 'spin 0.8s linear infinite';

    const text = document.createElement('div');
    text.textContent = message;
    text.style.fontSize = '0.875rem';

    wrapper.append(spinner, text);
    return wrapper;
}

// Keyframe injected once
if (!document.getElementById('loading-state-styles')) {
    const style = document.createElement('style');
    style.id = 'loading-state-styles';
    style.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
}
