/**
 * rateLimiter.js — In-memory sliding window rate limiter for Restorm MonitoringService
 *
 * Rate limits are enforced server-side, keyed by the authenticated user identity
 * from the CAP request context (req.user.id). Client-provided usernames are never trusted.
 *
 * Production note: This in-memory limiter is suitable for single-process local
 * development. For multi-instance SAP BTP deployment, replace the backing store
 * with a shared CAP-compatible rate limiting mechanism (e.g., BTP destination-level
 * rate limiting or SAP Cloud Platform quota management) without adding Redis.
 */

class RateLimiter {
    /**
     * @param {number} windowMs - Window size in milliseconds
     * @param {number} maxRequests - Maximum requests allowed per window per user
     */
    constructor(windowMs, maxRequests) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        // key -> { resetAt, requests: [timestamp, ...] }
        this.windows = new Map();
    }

    /**
     * Check if a request from the given key is allowed.
     * Uses a sliding window log: timestamps outside the window are evicted on each check.
     *
     * @param {string} key - Rate limit key (authenticated user ID)
     * @param {number} [now] - Current timestamp (ms) for testing
     * @returns {object} { allowed, retryAfter, limit, remaining, resetAt }
     */
    check(key, now = Date.now()) {
        let window = this.windows.get(key);

        if (!window || now >= window.resetAt) {
            window = {
                resetAt: now + this.windowMs,
                requests: []
            };
            this.windows.set(key, window);
        }

        // Evict timestamps outside the sliding window. Performed in-place to avoid
        // array reallocation on every check. Because Node.js is single-threaded,
        // this synchronous read-modify-write is atomic per event-loop tick —
        // concurrent requests cannot bypass the limiter.
        const cutoff = now - this.windowMs;
        let validCount = 0;
        for (let i = 0; i < window.requests.length; i++) {
            if (window.requests[i] > cutoff) {
                window.requests[validCount] = window.requests[i];
                validCount++;
            }
        }
        window.requests.length = validCount;

        if (window.requests.length >= this.maxRequests) {
            const retryAfterSec = Math.ceil((window.resetAt - now) / 1000);
            return {
                allowed: false,
                retryAfter: Math.max(1, retryAfterSec),
                limit: this.maxRequests,
                remaining: 0,
                resetAt: window.resetAt
            };
        }

        window.requests.push(now);
        return {
            allowed: true,
            retryAfter: 0,
            limit: this.maxRequests,
            remaining: this.maxRequests - window.requests.length,
            resetAt: window.resetAt
        };
    }

    /**
     * Reset the rate limit window for a key (useful for tests).
     */
    reset(key) {
        this.windows.delete(key);
    }

    /**
     * Get current usage stats for a key without consuming a request.
     */
    peek(key, now = Date.now()) {
        const window = this.windows.get(key);
        if (!window || now >= window.resetAt) {
            return { remaining: this.maxRequests, resetAt: now + this.windowMs };
        }
        const cutoff = now - this.windowMs;
        const validCount = window.requests.filter(t => t > cutoff).length;
        return {
            remaining: Math.max(0, this.maxRequests - validCount),
            resetAt: window.resetAt
        };
    }
}

function createRateLimiter(windowMs, maxRequests) {
    return new RateLimiter(windowMs, maxRequests);
}

// Pre-configured limiters for Restorm actions.
// Limits are per authenticated user per window.
//
// Limits are set to accommodate legitimate operator workflows while
// still providing abuse protection against automated attacks.
//
// resetToCleanSeed  — Most destructive (deletes all alerts + snapshots): strictest
// configureThresholds — Admin config change: strict but workflow-friendly
// triggerSimulation  — State-changing simulation: moderate
// ingestTelemetry    — Telemetry ingestion: higher throughput but bounded
// explain            — Expensive LLM calls: moderate
// acknowledge        — State-changing alert lifecycle: moderate
// resolveAlert       — State-changing alert lifecycle: moderate
const LIMITERS = {
    resetToCleanSeed: createRateLimiter(10 * 60 * 1000, 20),
    configureThresholds: createRateLimiter(10 * 60 * 1000, 60),
    triggerSimulation: createRateLimiter(10 * 60 * 1000, 60),
    ingestTelemetry: createRateLimiter(1 * 60 * 1000, 120),
    explain: createRateLimiter(10 * 60 * 1000, 60),
    acknowledge: createRateLimiter(10 * 60 * 1000, 60),
    resolveAlert: createRateLimiter(10 * 60 * 1000, 60)
};

// Maximum request body size in bytes (protects against oversized payloads / DoS)
const MAX_BODY_SIZE = 100 * 1024; // 100 KB

/**
 * Enforce a rate limit for an action. Returns a rejection if the limit is exceeded,
 * or null if the request is allowed.
 *
 * @param {object} req - CDS request context (must have req.user.id)
 * @param {string} actionName - Human-readable action name for logging
 * @param {RateLimiter} limiter - Configured RateLimiter instance
 * @returns {object|null} Rejection result or null if allowed
 */
function enforceRateLimit(req, actionName, limiter) {
    const userId = req.user?.id || 'anonymous';
    const result = limiter.check(userId);

    if (!result.allowed) {
        // Log abuse event — no sensitive data (only user ID, action, count)
        console.warn(
            `[RateLimit] Abuse: user=${userId} action=${actionName} ` +
            `limit=${result.limit} remaining=0 retryAfter=${result.retryAfter}s`
        );

        // Set Retry-After header on the HTTP response if available
        if (req.res && typeof req.res.setHeader === 'function') {
            req.res.setHeader('Retry-After', String(result.retryAfter));
        }

        return req.reject(
            429,
            `Rate limit exceeded for '${actionName}'. ` +
            `Try again in ${result.retryAfter} seconds.`
        );
    }

    return null;
}

/**
 * Enforce a maximum request body size. Returns a rejection if the body is too large,
 * or null if the body is acceptable.
 *
 * @param {object} req - CDS request context
 * @returns {object|null} Rejection result or null if allowed
 */
function enforceBodySize(req) {
    const bodySize = Buffer.byteLength(JSON.stringify(req.data || {}), 'utf8');
    if (bodySize > MAX_BODY_SIZE) {
        const userId = req.user?.id || 'anonymous';
        console.warn(
            `[RateLimit] Oversized body: user=${userId} size=${bodySize} max=${MAX_BODY_SIZE}`
        );
        return req.reject(413, 'Request body too large');
    }
    return null;
}

module.exports = {
    RateLimiter,
    createRateLimiter,
    LIMITERS,
    MAX_BODY_SIZE,
    enforceRateLimit,
    enforceBodySize
};
