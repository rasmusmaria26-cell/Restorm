/**
 * test/qa/security-xss.test.js
 *
 * Phase 5 Agent 6 — XSS and sensitive-data-exposure tests (frontend/static).
 *
 * Verifies: no innerHTML of untrusted data, CSP meta present, textContent used
 * for dynamic content, auth header not logged, no eval / string setTimeout /
 * new Function. Static analysis of source + index.html; no browser.
 *
 * Runs with: node --test test/qa/security-xss.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readJsFiles(dir) {
    const out = [];
    function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) out.push({ file: path.relative(dir, full), content: fs.readFileSync(full, 'utf8') });
        }
    }
    walk(dir);
    return out;
}

const appDir = path.resolve('app');
const html = fs.readFileSync(path.resolve(appDir, 'index.html'), 'utf8');
const jsFiles = readJsFiles(path.join(appDir, 'js'));

describe('Security: XSS & sensitive data exposure', () => {
    it('CSP meta tag is present in index.html', () => {
        assert.ok(/<meta[^>]+http-equiv=["']Content-Security-Policy["']/i.test(html) ||
            /<meta[^>]+name=["']Content-Security-Policy["']/i.test(html),
            'Expected a Content-Security-Policy meta tag in index.html');
    });

    it('CSP restricts connect-src and script-src to self', () => {
        const cspMeta = html.match(/<meta[^>]+(?:http-equiv|name)=["']Content-Security-Policy["'][^>]*>/i);
        assert.ok(cspMeta, 'Expected a Content-Security-Policy meta tag');
        const content = cspMeta[0].match(/content="([^"]*)"/i);
        assert.ok(content, 'Expected CSP meta to have a content attribute');
        const policy = content[1];
        assert.ok(/connect-src\s+'self'/.test(policy), 'Expected connect-src \'self\' in CSP');
        assert.ok(/script-src\s+'self'/.test(policy), 'Expected script-src \'self\' in CSP');
    });

    it('textContent is used for dynamic content', () => {
        let textContentCount = 0;
        for (const { content } of jsFiles) {
            textContentCount += (content.match(/\.textContent\s*=/g) || []).length;
        }
        assert.ok(textContentCount > 0, 'Expected textContent assignments for dynamic content');
    });

    it('the Authorization header is never logged to the console', () => {
        const apiClient = jsFiles.find((f) => f.file === 'api-client.js');
        assert.ok(apiClient, 'api-client.js must exist');
        const content = apiClient.content;
        const consoleCalls = content.match(/console\.(log|info|debug|warn|error)\s*\([^)]*\)/g) || [];
        for (const call of consoleCalls) {
            assert.ok(!/authorization|getauthheader|btoa/.test(call.toLowerCase()),
                `Console call must not log auth header: ${call}`);
        }
        assert.ok(/Authorization/.test(content), 'Authorization header is constructed for requests');
        assert.ok(!/console\.[a-z]+\s*\([^)]*Authorization/.test(content),
            'Authorization must not be passed to console');
    });

    it('no eval(), string setTimeout/setInterval, or new Function() in frontend code', () => {
        for (const { file, content } of jsFiles) {
            assert.ok(!/\beval\s*\(/.test(content), `${file}: eval() must not be used`);
            assert.ok(!/setTimeout\s*\(\s*['"]/.test(content), `${file}: string setTimeout must not be used`);
            assert.ok(!/setInterval\s*\(\s*['"]/.test(content), `${file}: string setInterval must not be used`);
            assert.ok(!/new\s+Function\s*\(/.test(content), `${file}: new Function() must not be used`);
        }
    });

    it('pages that build HTML with innerHTML templates use escapeHtml', () => {
        const pageFiles = jsFiles.filter((f) => f.file.startsWith('pages/'));
        for (const { file, content } of pageFiles) {
            if (content.includes('.innerHTML = `')) {
                assert.ok(content.includes('escapeHtml'),
                    `${file}: innerHTML template literal must use escapeHtml for untrusted data`);
            }
        }
    });

    it('no document.write in frontend code', () => {
        for (const { file, content } of jsFiles) {
            assert.ok(!/\bdocument\.write\s*\(/.test(content), `${file}: document.write must not be used`);
        }
    });
});
