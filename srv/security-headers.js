/**
 * security-headers.js — Express middleware for HTTP security headers
 *
 * Sets security-related response headers for all requests served by the
 * CDS/CAP server. Frame-ancestors is enforced via HTTP response header
 * (not meta tag) as required by the CSP specification.
 *
 * HSTS is only set for verified HTTPS connections (req.secure).
 *
 * PROXY TRUST NOTE: This middleware does NOT trust x-forwarded-proto headers
 * from clients. A malicious client could spoof x-forwarded-proto: https over
 * plain HTTP and trigger HSTS. For SAP BTP production deployments behind the
 * platform proxy, HSTS should be configured at the platform ingress (SAP
 * Application Router / Cloud Platform) rather than here. If you need
 * req.secure to work behind a trusted proxy, configure Express trust proxy
 * separately for verified proxy IPs only.
 */

// Content Security Policy — no unsafe-inline, frame-ancestors via HTTP header
const CSP_POLICY =
    "default-src 'self'; " +
    "script-src 'self'; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "style-src 'self' https://fonts.googleapis.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'self';";

// Content Security Policy for SAP Fiori Elements webapp (allows SAPUI5 CDN resources and dynamic styling)
const FIORI_CSP_POLICY =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://ui5.sap.com; " +
    "style-src 'self' 'unsafe-inline' https://ui5.sap.com https://fonts.googleapis.com; " +
    "font-src 'self' https://ui5.sap.com https://fonts.gstatic.com data:; " +
    "img-src 'self' data: https://ui5.sap.com; " +
    "connect-src 'self' https://ui5.sap.com; " +
    "frame-ancestors 'self';";

module.exports = function securityHeaders(req, res, next) {
    // MIME sniffing protection
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Content Security Policy: serve Fiori-tailored CSP for Fiori webapp and SAP ICF mocks
    const reqPath = (req && typeof req.path === 'string') ? req.path : '';
    const isFiori = reqPath.startsWith('/fiori') || reqPath.startsWith('/sap/bc/');
    res.setHeader('Content-Security-Policy', isFiori ? FIORI_CSP_POLICY : CSP_POLICY);

    // HSTS only for verified HTTPS connections (req.secure).
    // x-forwarded-proto is intentionally NOT trusted — it can be spoofed by clients.
    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
};
