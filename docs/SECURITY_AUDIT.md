# Security Audit Report — Retry Storm Sentinel (Restorm)

**Repository:** `C:\Users\lumaa\OneDrive\Desktop\projects\Restorm`  
**Branch:** `main` (tracks `origin/main`)  
**Audit date:** Fri Oct 30 2026  
**Mode:** Read-only (no files edited, nothing staged/committed/pushed)  
**Scanner availability:** No secret scanner (gitleaks/trufflehog) installed — dedicated secret scanning **NOT run**  
**Final verdict:** **NOT APPROVED**

---

## 1. Executive Summary

The repository is an SAP CAP (Node.js / OData V4) service with a LangChain-based AI incident explainer, deployed to SAP BTP via XSUAA. The codebase demonstrates strong security-conscious design: server-side role-based authorization via CDS `@requires`/`@restrict`, input validation with bounds/timestamp checks, a bounded read-only LangChain agent with Zod schema validation and output safety filtering, metadata-only LangSmith tracing with credential redaction, and a comprehensive test suite (331/331 passing, all local sqlite + mocked users).

**Top risks:**
1. **Real API keys exist on disk in `.env`** (OpenRouter, Gemini, LangSmith) — file is gitignored and **never committed**, so not exposed via Git, but present locally and at risk of accidental force-add.
2. **Unresolved dependency vulnerabilities** from `npm audit`: 2 Critical (handlebars, proxy-addr — dev/build-only transitive via `@sap/cds-dk`), 2 High (body-parser runtime-relevant via `@sap/cds`; zod direct, fix requires major version bump), 1 moderate (qs — dev-only).
3. **Gemini API key transmitted in URL query string** (`?key=...`) — exposed to server/proxy logs.
4. **No rate limiting** on state-changing/destructive actions (`resetToCleanSeed`, `ingestTelemetry`, `triggerSimulation`, `configureThresholds`).
5. **CSP includes `unsafe-inline` for styles; missing clickjacking / `X-Content-Type-Options` / referrer-policy headers.**
6. **Frontend role selection is client-side only** (a user can pick any role in the dropdown); enforcement relies on the CDS middleware, which is present but not re-checked in controller code.

**Verdict: NOT APPROVED** — unresolved Critical/High dependency vulnerabilities and a runtime-relevant High (body-parser, zod) remain. All have fixes available; remediation is straightforward (`npm install` to pull patches, with `zod` requiring a major-version review). No secrets are in the publication surface (`.env` is gitignored, never tracked, never in history).

---

## 2. Scope and Limitations

**Inspected:**
- Working tree, git status, staged/unstaged/untracked files, `.gitignore`, `git ls-files`, `git log --all` (full history across all branches)
- Manifests: `package.json`, `package-lock.json`, `mta.yaml`, `xs-security.json`
- Source: `srv/monitoring-service.js`, `srv/monitoring-service.cds`, `srv/core/*`, `srv/ai/*`, `app/app.js`, `app/js/api-client.js`, `app/index.html`, `playwright.config.js`
- Tests: `npm test` (331 tests, 62 suites), `npm audit --json`
- Local `.env` (read for secret categories only; values not printed)

**Not inspected / not run:**
- Dedicated secret scanner (gitleaks/trufflehog) — not installed on this Windows environment. Marked **not run**, not claimed clean.
- Live-cloud / penetration testing against SAP BTP or provider APIs (not authorized).
- `npm audit --production` (production-only subset) — full `npm audit` run instead.
- Remote repository contents beyond `origin/main` tracking branch.

**Limitation:** PowerShell lacks common Unix utilities; some history greps were done with `Select-String` / `git log --all --follow`. `.env` confirmed absent from all commits.

---

## 3. Git and Secrets Audit

### Publication surface (next commit)
| Category | Finding |
|----------|---------|
| Tracked modified (unstaged) | `.env.example`, `app/app.js`, `app/index.html`, `docs/README.md`, `package-lock.json`, `package.json`, `srv/ai/explanationService.js`, `srv/core/ingestionPipeline.js`, `srv/monitoring-service.js`, `test/ingestion.test.js` |
| Deleted | `Retry_Storm_Sentinel_Master_Project_Document.md` |
| Renamed | `BROWSER_TEST_REPORT.md` → `docs/reports/BROWSER_TEST_REPORT.md` |
| Untracked (new) | `.claude/`, `app/css/`, `app/js/`, `docs/design/`, `docs/langchain/`, `docs/phase5/`, `docs/reports/*`, `playwright.config.js`, `scripts/*`, `sentinel.db-shm`, `sentinel.db-wal`, `srv/ai/{evaluation,langchain,observability}`, `srv/ai/telemetryAdapter.js`, `test-e2e/`, `test-results/`, `test/{ai,frontend,qa}`, `test/telemetryAdapter.test.js` |
| Ignored but present | `node_modules/`, `target/`, `gen/`, `*.db` (`sentinel.db`), `.env`, `.vscode/settings.json` |

### `.env` tracking status (verified multiple ways)
- `git ls-files .env` → **not tracked** (empty)
- `git check-ignore -v .env` → ignored by `.gitignore:18:.env`
- `git log --all --follow -- .env` → **no commits** (empty)
- `git ls-tree HEAD -- .env` → absent
- Search of all commit name-lists for `.env` → only `.env.example` appears

**Conclusion: `.env` has never been committed to Git.** The real secrets it holds are local-only and are **not in the publication surface**. They must not be force-added.

### Secrets found on disk (local `.env`, NOT in git)
Masked identifiers only — values not reproduced:
- `OPENROUTER_API_KEY` = `sk-or-v1-****` (present)
- `GEMINI_API_KEY` = `AQ.Ab8RN****` (present)
- `LANGSMITH_API_KEY` = `lsv2_pt_****` (present)
- `LANGSMITH_TRACING=true`, `RESTORM_LANGSMITH_ENABLED=true`, `RESTORM_LANGSMITH_CAPTURE_CONTENT=false`

These are legitimate local development credentials but create an accidental-publication risk if `.env` is ever `git add -f`ed or `git add -A`ed without care. `.gitignore` protects normal `git add .` but not force-add.

### Git history for secrets
No `.env` in any commit. `.env.example` is tracked (template only, no real keys). No evidence of committed credentials in history. **Secret scanning tool not run** (none installed) — findings above are from manual review, not a scanner.

---

## 4. Application Security

### Authentication & session management
- **CDS auth:** `srv/monitoring-service.cds` declares `service MonitoringService @(requires: 'authenticated-user')`. Dev: `package.json` `cds.requires.auth.kind = "mocked"` with users alice (SupportViewer), bob (SupportOperator + SupportViewer), admin (SimulatorAdmin + others). Production: `kind = "xsuaa"` via XSUAA.
- **Frontend auth:** `app/js/api-client.js` `getAuthHeader()` builds `Basic ` + `btoa(username + ':')` where `username` comes from the client-side `<select id="userSelect">` DOM element — **any visitor can select any role (alice/bob/admin) client-side**; the empty password is sent. There is no server-side verification that the frontend-chosen identity matches an authenticated session. Enforcement is delegated entirely to CDS role restrictions.
- **Transport:** `connect-src 'self'` CSP limits exfil, but nothing enforces HTTPS; Basic auth over HTTP would send credentials in cleartext.

**Assessment:** CDS role enforcement exists and is exercised by tests (401 anonymous, 403 viewer). However, client-side role selection means the UI cannot be trusted as an authorization boundary; rely on CDS middleware. The `acknowledge`/`resolveAlert` actions extract `acknowledgedBy`/`resolvedBy` from `req.data ?? req.user?.id ?? 'Operator'` — spoofable via `req.data`, though CDS `@restrict` to `SupportOperator` gates the action itself.

### Authorization (server-side)
| Action | CDS restriction | Controller re-checks `req.user.roles`? |
|--------|----------------|----------------------------------------|
| `acknowledge` | `SupportOperator` | No (relies on CDS) |
| `resolveAlert` | `SupportOperator` | No (relies on CDS) |
| `ingestTelemetry` | `SimulatorAdmin`, `SupportOperator` | No |
| `triggerSimulation` | `SimulatorAdmin`, `SupportOperator` | No |
| `configureThresholds` | `SimulatorAdmin` | No |
| `resetToCleanSeed` | `SimulatorAdmin` | No |
| `explain`, `exportIncidentReport`, `getTopology` | `authenticated-user` only | No |

CDS `@requires`/`@restrict` provides server-side enforcement at the OData protocol layer. Controller implementations do not perform independent role checks — defense-in-depth is weak here. Tests confirm 403 for alice/bob on `configureThresholds` and 401 anonymous, so the CDS layer works. **Material authorization defect: none**, but add controller-level `req.user` role assertions for defense-in-depth, especially on `resetToCleanSeed` (destructive, wipes all alerts + snapshots).

**IDOR/BOLA:** `ingestTelemetry` validates `interfaceId` exists and is `active`. The LangChain agent tools enforce `assertAuthorizedScope(interfaceId, authorizedInterfaceId)` — cross-interface access blocked within a single investigation. No cross-tenant concept (dedicated tenant).

### Input validation & injection
Strong:
- `ingestionPipeline.js`: `validateIntegerBound` (type + min/max), `validateTimestamp` (ISO-8601, rejects >5 min future and >7 days past — clock skew defense).
- `simulator.js`: `ALLOWED_SCENARIOS` allowlist; defensive copies; `Object.freeze` templates.
- `detectionEngine.js`: thresholds resolved safely with fallback to `Object.freeze` defaults.
- LangChain tools: Zod schemas on all 5 tools, string length caps, `MAX_TOOL_CALLS=5`, `MAX_ITERATIONS=4`, `TOTAL_INVESTIGATION_TIMEOUT_MS=15000`, `MAX_SNAPSHOTS_LIMIT=20`, `MAX_RUNBOOK_RESULTS=3`.
- `runbookRetrieval.js`: treats telemetry/runbook text as untrusted strings; no dynamic SQL/CDS injection.

**Injection surface:** OData via CDS (parameterized by framework); no raw string-concatenated SQL observed. `fetch()` calls to Gemini/OpenRouter use `JSON.stringify` bodies — no shell injection.

### API & service security
- **No rate limiting** on any action — `resetToCleanSeed`, `ingestTelemetry`, `triggerSimulation`, `configureThresholds` can be hammered. Medium risk.
- **Error handling:** `apiRequest` surfaces `res.text()` as the error message; CDS error bodies could leak internal paths/stack traces to the client. `getFriendlyErrorMessage` maps status codes but raw body may still reach console. Low-medium.
- **No CORS configuration visible** in CDS service (CAP handles CORS; default is restrictive). `connect-src 'self'` in CSP.
- **Webhooks:** none present.
- **API versioning:** single OData V4 path `/odata/v4/monitoring`; no explicit versioning strategy documented.

### Frontend & browser security
**index.html CSP:**
```
default-src 'self';
script-src 'self';
font-src 'self' https://fonts.gstatic.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data:;
connect-src 'self';
```
Issues:
- `style-src 'unsafe-inline'` — permits inline style-based XSS (limited impact, but weakens CSP).
- Missing `frame-ancestors` / `X-Frame-Options` — **clickjacking protection absent**.
- Missing `X-Content-Type-Options: nosniff`.
- Missing `Referrer-Policy`.
- `script-src 'self'` is good (no inline scripts, no `unsafe-eval`).

**Local storage:** no credentials stored in `localStorage`/`sessionStorage` observed; username held in JS variable only. **Source maps:** none referenced. **Open redirects:** none (no external URL redirects). **`httpCredentials` in `playwright.config.js`:** hardcodes `{ username: 'bob', password: '' }` test credentials — not a production secret, but test creds in config.

### Data & database security
- Local `sentinel.db` (sqlite) — gitignored (`*.db`), not committed. Contains operational telemetry + alert state. `@cap-js/sqlite` devDependency.
- No encryption-at-rest configuration observed (sqlite file plaintext). Acceptable for local dev; production on BTP would use managed DB.
- No backup/restore, no least-privilege DB credential config observed (dev uses file-based sqlite).
- Test fixtures/seed data are synthetic (simulator templates), not production copies. Good.

### Infrastructure & CI/CD
- `mta.yaml`: Node.js module on `nodejs_buildpack`, XSUAA `application` plan, dedicated tenant. `xs-security.json` defines 3 scopes / 3 role templates / 3 role collections. Well-formed.
- No CI workflow files (`.github/`) observed in the tree — no CI/CD pipeline to audit for secret leakage in logs.
- No Dockerfile/K8s/Terraform observed.
- Build: `npm ci` + `cds build --production`. `@sap/cds-dk` is a dev/build dependency carrying the vulnerable transitive packages.

---

## 5. AI / LLM / Agent / Observability Security

### Prompt injection & trust boundaries
- `agentPrompts.js` `SYSTEM_PROMPT`: explicitly treats telemetry and runbook contents as UNTRUSTED; forbids following embedded instructions; forbids overriding deterministic detection; forbids recommending destructive actions (delete/drop/purge/restart); requires citing only catalog runbook IDs; requires hypotheses labeled as unproven.
- `validateModelOutput` (`explanationService.js`): filters `citedRunbookIds` to only retrieved IDs; rejects checks matching `/drop\s+queue|delete\s+message|purge\s+queue|truncate|rm\s+-rf/i`.
- **Good defense-in-depth; prompt wording is supplemented by code enforcement.**

### Agent & tool security
- 5 read-only LangChain tools (`agentTools.js`), all Zod-validated.
- Tools enforce `assertAuthorizedScope(interfaceId, authorizedInterfaceId)` — cross-interface access blocked.
- No tools exist to modify thresholds, alter queues, or resolve incidents.
- `executionPolicy.js`: `MAX_TOOL_CALLS=5`, `MAX_ITERATIONS=4`, `TOTAL_INVESTIGATION_TIMEOUT_MS=15000`, `MODEL_TIMEOUT_MS=15000`, `TOOL_TIMEOUT_MS=5000`, `MAX_SNAPSHOTS_LIMIT=20`, `MAX_RUNBOOK_RESULTS=3`, `MAX_STRING_LENGTH=2000`.
- Human approval not required for tools (all read-only) — acceptable for current design.
- Model cannot expand its own permissions or invoke arbitrary tools/URLs — tool map is fixed at construction.

### Tracing and observability privacy
- `langsmithTracing.js`: `isTracingEnabled()` requires both `RESTORM_LANGSMITH_ENABLED`/`LANGSMITH_TRACING === "true"` AND a non-empty `LANGSMITH_API_KEY`. Returns false (no network calls) if either missing. `.env` has tracing enabled with a real key, so tracing is active locally.
- `isContentCaptureEnabled()` defaults to `false` — metadata-only by default. `.env` has `RESTORM_LANGSMITH_CAPTURE_CONTENT=false`. Good.
- `withTrace()`: never blocks business logic on tracing failure; catches `postRun`/`patchRun` errors. `runTree.end()` outputs are passed through `sanitizeRunContent`.
- `traceRedaction.js`: `SECRET_KEY_PATTERNS` catches api_key/auth/bearer/token/password/secret/credential/private_key/conn/payload/message/body/envelope keys. `SECRET_VALUE_PATTERNS` catches `Bearer `, `Basic `, Google `AIzaSy`, `sk-`, `lsv2_pt_`, and DB connection URIs. `ALLOWED_METADATA_KEYS` is a strict allowlist.
- **Finding:** `SECRET_VALUE_PATTERNS` includes `/body/i` and `/message[_-]?body/i` as key patterns (not value patterns), but the actual alert telemetry values (pendingCount, retryAttempts, etc.) are not secret patterns — fine. However, `alert.observedMetrics` content is passed into trace metadata via `buildExplanationMetadata` only as raw values (inputTokens/outputTokens), not the full metrics object. Good.
- **Gap:** `getTracingDiagnostics()` returns `endpoint`, `projectName`, `hasApiKey` (boolean), `captureContent` — no key values leaked. Good.

### Retrieval and model output
- `runbookRetrieval.js`: keyword scoring over runbook catalog; returns original IDs; no embedding/vector store; no external RAG source that could override system instructions. Indirect prompt injection surface limited to runbook catalog entries (internal, approved).
- `validateModelOutput`: citation validation against retrieved runbook IDs; unsafe pattern rejection. Output cannot alter authorization/roles/lifecycle state — explanation is advisory only, written to `aiExplanation` field on Alert. No state-changing side effects from model output.

### Fallback behavior
- If providers fail or keys missing → `deterministicFallback` (offline, zero credentials). Tracing errors never fail business logic (`withTrace` swallows trace errors but rethrows business errors). Model timeouts handled via `AbortSignal.timeout`. Cooldown cache for 429/401/403. Good.

---

## 6. SAP / CAP / OData-Specific Checks

### CDS authorization
- `srv/monitoring-service.cds` line 3: `service MonitoringService @(requires: 'authenticated-user')` — all actions require authentication.
- Entity-level: `Interfaces`, `QueueSnapshots`, `RunbookEntries`, `Systems`, `Connections` are `@readonly` projections (no write via OData).
- `Alerts` actions `acknowledge`/`resolveAlert` restricted to `SupportOperator` via `@(restrict: [...])`.
- `ingestTelemetry`/`triggerSimulation` require `['SimulatorAdmin', 'SupportOperator']`.
- `configureThresholds`/`resetToCleanSeed` require `'SimulatorAdmin'`.
- `getTopology` requires `authenticated-user`.
- `explain()` and `exportIncidentReport()` have **no explicit `@(requires)` or `@(restrict)`** on the action declarations — they inherit the service-level `authenticated-user` only. Any authenticated user (including SupportViewer/alice) can call `explain` and `exportIncidentReport`. Tests confirm alice can export (T3) — by design, but note `explain` triggers an LLM call which may consume quota/cost.

### CDS handlers
- `resetToCleanSeed` performs `DELETE.from(Alerts)` + `DELETE.from(QueueSnapshots)` + bulk `UPDATE`/`INSERT` — destructive, admin-gated by CDS. No controller-level re-check.
- OData filter/sort/paging handled by CDS framework; `ingestionPipeline.js` uses `SELECT` with parameterized `.where()` — no dynamic CQL string construction.
- `xs-security.json`: 3 scopes, 3 role templates, 3 role collections; dedicated tenant mode. `mta.yaml` wires XSUAA `application` plan. Consistent.

### Simulator/admin endpoints
- `resetToCleanSeed` and `configureThresholds` are admin-only via CDS. No separate simulator admin endpoint beyond these. No evidence of unintended production exposure (dev only, mocked auth).

---

## 7. Security Testing and Evidence

### Test run (exact command and result)
- **Command:** `npm test` → `node --test --test-concurrency=1 test/**/*.test.js`
- **Result:** tests 331, suites 62, pass 331, fail 0, cancelled 0, skipped 0, todo 0, duration 71545ms
- **Test environment:** Local sqlite (`sentinel.db`), mocked CDS users (alice/bob/admin via `cds.User`), no live cloud, no provider API calls (AI tests mock or fallback), no penetration testing.
- **Coverage areas:** ingestion authz (T1/T2), validation (T7/T8), deterministic ordering (T9-T12), threshold policies (T2/T3 authorization), topology auth (T6 anonymous 401), runbook retrieval, simulator validation, telemetry adapter, incident export (T3 alice can export), telemetry adapter strict validation.
- **Mock vs live:** All tests use mocked users and local sqlite; AI provider calls are not exercised in tests (guarded by key presence). A mocked test is not evidence of live provider behavior.

### Dependency audit (exact)
- **Command:** `npm audit --json` (full, not production-only)
- **Result:** 5 vulnerabilities — 2 critical, 2 high, 1 moderate. All transitive via `@sap/cds-dk` except `zod` (direct). All have `fixAvailable: true`.

| Package | Severity | Advisory | CVSS | Range | Fix Available | Location |
|---------|----------|----------|------|-------|---------------|----------|
| handlebars | Critical | GHSA-8r5x-fm3f-whwj (AST type confusion JS injection) | 9.8 | >=4.0.0 <=4.7.9 | Yes | `@sap/cds-dk` transitive |
| handlebars | Critical | GHSA-xw65-4hp5-5hc7 (unsafe inline embedding) | 4.7 | >=4.0.0 <=4.7.9 | Yes | `@sap/cds-dk` transitive |
| handlebars | Critical | GHSA-p8wg-vrv2-v86f (own property check bypass) | 0.0 | >=3.0.0 <=4.7.9 | Yes | `@sap/cds-dk` transitive |
| proxy-addr | Critical | GHSA-jqcg-44mw-7w3h (IP spoofing via IPv4-mapped IPv6) | 9.1 | >=1.1.0 <2.0.8 | Yes | `@sap/cds-dk` transitive |
| body-parser | High | GHSA-27r3-jxmh-p828 (DoS via trailing bytes after compressed body) | 7.5 | >=2.0.0 <2.4.0 | Yes | direct + `@sap/cds-dk` |
| zod | High | GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized collections) | 7.5 | <4.6.6 | Yes (4.6.7, major) | direct |
| qs | Moderate | GHSA-6pq8-jhm2-2vcw (DoS via stringify arrayFormat comma) | 5.3 | >=6.7.0 <=6.16.0 | Yes | `@sap/cds-dk` transitive |

---

## 8. Findings Table

| ID | Severity | Confidence | Category | File / Location | Evidence | Scenario / Impact | Fix | Status |
|----|----------|------------|----------|-----------------|----------|-------------------|-----|--------|
| F1 | Critical | HIGH | Dependency vulnerability | `node_modules/@sap/cds-dk/node_modules/handlebars` (transitive) | `npm audit`: GHSA-8r5x-fm3f-whwj JS injection via AST type confusion, CVSS 9.8; range >=4.0.0 <=4.7.9 | Build-tool compromise / template injection if handlebars reached via cds-dk tooling | `npm install` pulls patched transitive dep (fixAvailable) | Open |
| F2 | Critical | HIGH | Dependency vulnerability | `node_modules/@sap/cds-dk/node_modules/proxy-addr` (transitive) | `npm audit`: GHSA-jqcg-44mw-7w3h IP spoofing via IPv4-mapped IPv6 trust subnet, CVSS 9.1 | IP-based access bypass if proxy-addr reached | `npm install` (fixAvailable) | Open |
| F3 | High | HIGH | Dependency vulnerability (runtime) | `node_modules/body-parser` (direct via @sap/cds) + cds-dk copy | `npm audit`: GHSA-27r3-jxmh-p828 DoS via trailing bytes after compressed body, CVSS 7.5, range >=2.0.0 <2.4.0 | HTTP DoS on request body parsing | `npm install` (fixAvailable) | Open |
| F4 | High | HIGH | Dependency vulnerability (direct) | `node_modules/zod` | `npm audit`: GHSA-mrhx-c7xc-m3w5 memory exhaustion on oversized constrained collections, CVSS 7.5, range <4.6.6; fixAvailable zod 4.6.7 (major) | DoS via malicious input to Zod-validated fields | Review major-version bump to zod 4.6.7; test breaking changes | Open |
| F5 | Moderate | HIGH | Dependency vulnerability (dev-only) | `node_modules/@sap/cds-dk/node_modules/qs` | `npm audit`: GHSA-6pq8-jhm2-2vcw DoS via qs.stringify arrayFormat comma, CVSS 5.3 | Dev-tool DoS; low production impact | `npm install` (fixAvailable) | Open |
| F6 | Medium | HIGH | Secrets on disk | Local `.env` (untracked, gitignored) | `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `LANGSMITH_API_KEY` present on disk | Accidental `git add -f .env` publishes keys; key rotation required if ever committed | Never force-add `.env`; rotate keys before any push; consider pre-commit hook | Open |
| F7 | Medium | MEDIUM | API key in URL | `srv/ai/explanationService.js` line 214; `srv/ai/langchain/modelFactory.js` line 111 | Gemini API key embedded in `https://generativelanguage.googleapis.com/...?key=<key>` query string | Key logged by proxies, load balancers, browser dev tools, server access logs | Move key to `Authorization: Bearer` header or `x-goog-api-key` header if supported; avoid query string | Open |
| F8 | Medium | MEDIUM | Missing rate limiting | `srv/monitoring-service.js` actions: `resetToCleanSeed`, `ingestTelemetry`, `triggerSimulation`, `configureThresholds` | No rate-limit middleware on state-changing/destructive endpoints | Brute-force / abuse of destructive reset and telemetry ingestion | Add rate limiting (per-IP or per-user) on mutating actions | Open |
| F9 | Low | MEDIUM | CSP weakness | `app/index.html` line 7-8 | `style-src 'unsafe-inline'`; missing `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` | Clickjacking, MIME sniffing, limited inline-style XSS | Add `frame-ancestors 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; remove `unsafe-inline` | Open |
| F10 | Low | MEDIUM | Client-side role selection | `app/js/api-client.js` line 28-32; `app/index.html` line 43-47 | Username sourced from `<select id="userSelect">` DOM; any visitor can pick admin role | UI cannot enforce auth; relies solely on CDS middleware (which works) | Document that CDS is the enforcement boundary; consider re-validating `req.user` in controller | Open |
| F11 | Low | MEDIUM | Error information disclosure | `app/js/api-client.js` line 57-65 | `res.text()` returned as error message to frontend | Raw CDS error bodies may leak internal paths/stack details | Sanitize error messages before returning to client | Open |
| F12 | Informational | MEDIUM | Unrestricted explain action | `srv/monitoring-service.cds` lines 18-20 | `explain()` and `exportIncidentReport()` lack `@(restrict)`; inherit `authenticated-user` only | SupportViewer can trigger LLM explain (quota/cost) | Add `@(restrict)` to `explain` if LLM cost is a concern | Open |

---

## 9. Git Push Readiness

**Nothing was staged, committed, or pushed.** Read-only audit.

**Files safe to publish:** All tracked modified files except any that might contain secrets — none found in tracked set. `.env.example` is a template (safe). `package-lock.json`/`package.json` changes are dependency edits (safe after reviewing F1-F5).

**Files requiring exclusion/review before push:**
- `.env` — contains real API keys; MUST remain untracked/ignored. Do NOT `git add -f .env`.
- `sentinel.db`, `sentinel.db-shm`, `sentinel.db-wal` — local sqlite DB; gitignored; do not track.
- `node_modules/`, `target/`, `gen/` — gitignored build output.

**Git history:** `.env` never committed (verified via `git log --all --follow -- .env` = empty). No secrets in history. Safe to push from a history standpoint.

**Pre-push checklist:**
1. Resolve F1-F5 (`npm install` + zod major-version review).
2. Confirm `.env` is not staged (`git status` should show it ignored/untracked only).
3. Rotate any key that may have touched disk in a non-ignored location before push.
4. Do not force-add `.env`.

---

## 10. Final Verdict

**NOT APPROVED** — unresolved Critical (handlebars, proxy-addr) and High (body-parser runtime, zod direct) dependency vulnerabilities remain. All have fixes available via `npm install`; zod requires a major-version review (4.6.7). Additionally F6 (secrets on disk) requires the key-not-committed discipline, and F7/F8/F9 are medium hardening items.

This is a scoped read-only review, not a guarantee that no vulnerabilities exist. No files were staged, committed, or pushed.
