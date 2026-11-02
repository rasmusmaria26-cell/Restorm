/**
 * test/qa/responsive.test.js
 *
 * Phase 5 Agent 6 — Responsive behavior tests (frontend).
 *
 * Static analysis of the CSS: verifies media queries exist, the sidebar
 * collapses at 960px, and the grid stacks on mobile. No browser required.
 *
 * Runs with: node --test test/qa/responsive.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const cssPath = path.resolve('app/css/components.css');
const css = fs.readFileSync(cssPath, 'utf8');

/**
 * Extract the balanced-brace body of every @media block in the CSS.
 * Returns an array of { query, body } where body is the text inside { }.
 */
function mediaBlocks(source) {
    const blocks = [];
    const mediaRe = /@media\s*[^{]*\{/g;
    let m;
    while ((m = mediaRe.exec(source)) !== null) {
        const openIdx = m.index + m[0].indexOf('{');
        let depth = 0;
        let end = -1;
        for (let i = openIdx; i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        if (end > openIdx) {
            blocks.push({ query: m[0], body: source.slice(openIdx + 1, end) });
        }
    }
    return blocks;
}

const blocks = mediaBlocks(css);
const ninetySixtyBlocks = blocks.filter((b) => /max-width:\s*960px/.test(b.query));

describe('Responsive CSS', () => {
    it('contains at least one media query', () => {
        assert.ok(blocks.length > 0, 'Expected at least one @media rule in components.css');
    });

    it('sidebar collapses at 960px (transform translateX(-100%))', () => {
        assert.ok(ninetySixtyBlocks.length > 0, 'Expected a @media (max-width: 960px) block');
        const combined = ninetySixtyBlocks.map((b) => b.body).join('\n');
        assert.ok(/translateX\(-100%\)/.test(combined), 'Expected sidebar to collapse via translateX(-100%) at 960px');
        assert.ok(/\.sidebar\s*\{/.test(combined), 'Expected .sidebar rule inside the 960px media block');
    });

    it('grid stacks to a single column on mobile', () => {
        assert.ok(ninetySixtyBlocks.length > 0, 'Expected a @media (max-width: 960px) block');
        const combined = ninetySixtyBlocks.map((b) => b.body).join('\n');
        assert.ok(/\.control-board-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/.test(combined),
            'Expected control-board-grid to stack to 1fr at 960px');
    });

    it('sidebar menu toggle appears only at 960px and below', () => {
        assert.ok(ninetySixtyBlocks.length > 0, 'Expected a @media (max-width: 960px) block');
        const combined = ninetySixtyBlocks.map((b) => b.body).join('\n');
        assert.ok(/\.menu-toggle\s*\{[\s\S]*display:\s*inline-flex/.test(combined),
            'Expected .menu-toggle to display inline-flex at 960px');
    });

    it('design tokens file is present and defines breakpoints-relevant tokens', () => {
        const tokensPath = path.resolve('app/css/design-tokens.css');
        assert.ok(fs.existsSync(tokensPath), 'design-tokens.css must exist');
        const tokens = fs.readFileSync(tokensPath, 'utf8');
        assert.ok(/--spacing-lg/.test(tokens), 'Expected spacing tokens in design-tokens.css');
        assert.ok(/--border-radius-lg/.test(tokens), 'Expected border-radius tokens in design-tokens.css');
    });

    it('index.html has a viewport meta tag for responsive scaling', () => {
        const htmlPath = path.resolve('app/index.html');
        assert.ok(fs.existsSync(htmlPath), 'index.html must exist');
        const html = fs.readFileSync(htmlPath, 'utf8');
        assert.ok(/name="viewport"/.test(html), 'Expected viewport meta tag');
        assert.ok(/width=device-width/.test(html), 'Expected width=device-width viewport');
    });
});
