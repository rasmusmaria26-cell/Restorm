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

    const spinner = document.createElement('div');
    spinner.className = 'spinner';

    const text = document.createElement('div');
    text.textContent = message;
    text.className = 'loading-text';

    wrapper.append(spinner, text);
    return wrapper;
}
