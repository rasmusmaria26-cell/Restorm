/**
 * Button.js — reusable button component.
 *
 * Usage:
 *   import { Button } from './components/Button.js';
 *   const btn = Button({ text: 'Refresh', variant: 'quiet', onClick: () => ..., disabled: false });
 *   container.appendChild(btn);
 */

export function Button({
    text = '',
    variant = 'quiet', // 'harbor' | 'quiet' | 'healthy' | 'scenario'
    onClick,
    disabled = false,
    type = 'button',
    className = '',
    title = '',
    'data-scenario': dataScenario
} = {}) {
    const btn = document.createElement('button');
    btn.type = type;
    btn.disabled = disabled;
    btn.textContent = text;
    if (title) btn.title = title;
    if (dataScenario !== undefined) btn.setAttribute('data-scenario', dataScenario);

    const base = 'btn';
    btn.className = [base, `btn-${variant}`, className].filter(Boolean).join(' ');

    if (onClick) {
        btn.addEventListener('click', (e) => {
            if (disabled) return;
            onClick(e);
        });
    }

    return btn;
}
