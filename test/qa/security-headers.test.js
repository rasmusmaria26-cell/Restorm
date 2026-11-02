/**
 * test/qa/security-headers.test.js
 *
 * Stage 4 remediation — HTTP security header verification.
 *
 * Starts an HTTP server with the security-headers middleware and makes real
 * HTTP requests to verify security headers are returned in actual responses.
 *
 * Also includes unit tests for the middleware logic (HSTS behavior).
 *
 * Runs with: node --test test/qa/security-headers.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const securityHeaders = require('../../srv/security-headers.js');

let server;
let serverPort;

/**
 * Case-insensitive header getter for mock response objects.
 */
function mockGetHeader(headers, name) {
    const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : undefined;
}

/**
 * Start a simple HTTP server with the security-headers middleware.
 */
async function startServer() {
    server = http.createServer((req, res) => {
        securityHeaders(req, res, () => {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end('OK');
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    serverPort = server.address().port;
}

/**
 * Make an HTTP GET request and return { statusCode, headers, body }.
 */
function request(reqPath, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: serverPort,
            path: reqPath,
            method: 'GET',
            headers: { 'Accept': '*/*', ...extraHeaders }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Make an HTTP GET request with a spoofed x-forwarded-proto: https header.
 */
function requestWithSpoofedProto(reqPath) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: serverPort,
            path: reqPath,
            method: 'GET',
            headers: {
                'Accept': '*/*',
                'x-forwarded-proto': 'https'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

describe('HTTP Security Headers (Stage 4)', () => {
    before(async () => {
        await startServer();
    });

    after(async () => {
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
    });

    describe('Actual HTTP response headers', () => {
        it('returns Content-Security-Policy header', async () => {
            const res = await request('/odata/v4/monitoring/$metadata');
            assert.ok(res.headers['content-security-policy'], 'CSP header missing');
        });

        it('CSP has no unsafe-inline in style-src', async () => {
            const res = await request('/odata/v4/monitoring/$metadata');
            const csp = res.headers['content-security-policy'];
            const styleMatch = csp.match(/style-src[^;]*/);
            assert.ok(styleMatch, 'style-src directive missing');
            assert.ok(!styleMatch[0].includes('unsafe-inline'), `style-src contains unsafe-inline: ${styleMatch[0]}`);
        });

        it('CSP has no unsafe-inline or unsafe-eval in script-src', async () => {
            const res = await request('/odata/v4/monitoring/$metadata');
            const csp = res.headers['content-security-policy'];
            const scriptMatch = csp.match(/script-src[^;]*/);
            assert.ok(scriptMatch, 'script-src directive missing');
            assert.ok(!scriptMatch[0].includes('unsafe-inline'), `script-src contains unsafe-inline: ${scriptMatch[0]}`);
            assert.ok(!scriptMatch[0].includes('unsafe-eval'), `script-src contains unsafe-eval: ${scriptMatch[0]}`);
        });

        it('CSP contains frame-ancestors self', async () => {
            const res = await request('/odata/v4/monitoring/$metadata');
            const csp = res.headers['content-security-policy'];
            assert.ok(csp.includes("frame-ancestors 'self'"), `CSP missing frame-ancestors self: ${csp}`);
        });

        it('returns X-Content-Type-Options: nosniff', async () => {
            const res = await request('/odata/v4/monitoring/$metadata');
            assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
        });

        it('returns Referrer-Policy: strict-origin-when-cross-origin', async () => {
            const res = await request('/odata/v4/monitoring/$metadata');
            assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
        });

        it('does NOT set HSTS on plain HTTP', async () => {
            const res = await request('/odata/v4/monitoring/$metadata');
            assert.ok(!res.headers['strict-transport-security'], 'HSTS should not be set on plain HTTP');
        });

        it('does not enable HSTS when x-forwarded-proto: https is spoofed', async () => {
            const res = await requestWithSpoofedProto('/odata/v4/monitoring/Interfaces');
            assert.ok(!res.headers['strict-transport-security'],
                'HSTS must not be triggered by spoofed x-forwarded-proto header');
        });
    });
});

/**
 * Unit tests for security-headers middleware logic (HSTS behavior).
 * These test the middleware directly without an HTTP server.
 */
describe('security-headers middleware logic', () => {
    it('sets HSTS when req.secure is true (genuine HTTPS)', () => {
        const req = { secure: true, headers: {} };
        const res = {
            headers: {},
            setHeader(name, value) { this.headers[name] = value; },
            getHeader(name) { return mockGetHeader(this.headers, name); }
        };
        const next = () => {};
        securityHeaders(req, res, next);
        assert.strictEqual(mockGetHeader(res.headers, 'strict-transport-security'), 'max-age=31536000; includeSubDomains');
    });

    it('does not set HSTS when req.secure is false (plain HTTP)', () => {
        const req = { secure: false, headers: {} };
        const res = {
            headers: {},
            setHeader(name, value) { this.headers[name] = value; },
            getHeader(name) { return mockGetHeader(this.headers, name); }
        };
        const next = () => {};
        securityHeaders(req, res, next);
        assert.ok(!mockGetHeader(res.headers, 'strict-transport-security'), 'HSTS should not be set on plain HTTP');
    });

    it('does not set HSTS when x-forwarded-proto: https is spoofed (untrusted)', () => {
        const req = { secure: false, headers: { 'x-forwarded-proto': 'https' } };
        const res = {
            headers: {},
            setHeader(name, value) { this.headers[name] = value; },
            getHeader(name) { return mockGetHeader(this.headers, name); }
        };
        const next = () => {};
        securityHeaders(req, res, next);
        assert.ok(!mockGetHeader(res.headers, 'strict-transport-security'),
            'Spoofed x-forwarded-proto must not trigger HSTS');
    });

    it('sets CSP, X-Content-Type-Options, and Referrer-Policy on all requests', () => {
        const req = { secure: false, headers: {} };
        const res = {
            headers: {},
            setHeader(name, value) { this.headers[name] = value; },
            getHeader(name) { return mockGetHeader(this.headers, name); }
        };
        const next = () => {};
        securityHeaders(req, res, next);
        assert.ok(mockGetHeader(res.headers, 'content-security-policy'), 'CSP header missing');
        assert.strictEqual(mockGetHeader(res.headers, 'x-content-type-options'), 'nosniff');
        assert.strictEqual(mockGetHeader(res.headers, 'referrer-policy'), 'strict-origin-when-cross-origin');
    });
});
