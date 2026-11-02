/**
 * Card.js — reusable card container.
 *
 * Usage:
 *   import { Card } from './components/Card.js';
 *   const card = Card({ className: 'interface-card has-alert' });
 *   card.appendChild(someElement);
 *   container.appendChild(card);
 */

export function Card({
    className = '',
    tag = 'article'
} = {}) {
    const card = document.createElement(tag);
    card.className = ['card', className].filter(Boolean).join(' ');
    return card;
}
