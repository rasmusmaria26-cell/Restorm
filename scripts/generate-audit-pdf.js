const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const outPath = path.join(__dirname, '..', 'Restorm-Security-Audit-Report.pdf');
const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });

const pipe = fs.createWriteStream(outPath);
doc.pipe(pipe);

// ---------- helpers ----------
function h1(text) {
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a3a5c').text(text, { align: 'left' });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor('#666').text('Retry Storm Sentinel (Restorm) — Security Audit', { align: 'right' });
  doc.moveDown(0.3);
  doc.strokeColor('#1a3a5c').lineWidth(1.2).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(0.8);
}

function h2(text) {
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a3a5c').text(text);
  doc.moveDown(0.2);
}

function p(text, opts = {}) {
  doc.font('Helvetica').fontSize(9.5).fillColor('#111').text(text, { ...opts, align: 'left' });
  doc.moveDown(0.35);
}

function bold(label, rest) {
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111').text(label, { continued: true });
  doc.font('Helvetica').fontSize(9.5).fillColor('#111').text(rest);
  doc.moveDown(0.35);
}

function bullet(text) {
  doc.font('Helvetica').fontSize(9.5).fillColor('#111').text('• ' + text, { indent: 20, align: 'left' });
  doc.moveDown(0.2);
}

function table(headers, rows, colWidths) {
  const pageWidth = doc.page.width - 100;
  const xStart = 50;
  const rowHeight = 16;
  const headerHeight = 18;

  // header
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
  let x = xStart;
  headers.forEach((h, i) => {
    doc.rect(x, doc.y, colWidths[i], headerHeight).fill('#1a3a5c');
    doc.text(h, x + 4, doc.y + 4, { width: colWidths[i] - 8, align: 'left' });
    x += colWidths[i];
  });
  doc.moveDown(headerHeight / 14);

  // rows
  let fill = false;
  rows.forEach(row => {
    if (doc.y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      // re-draw header on new page
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
      x = xStart;
      headers.forEach((h, i) => {
        doc.rect(x, doc.y, colWidths[i], headerHeight).fill('#1a3a5c');
        doc.text(h, x + 4, doc.y + 4, { width: colWidths[i] - 8, align: 'left' });
        x += colWidths[i];
      });
      doc.moveDown(headerHeight / 14);
    }
    doc.font('Helvetica').fontSize(8).fillColor('#111');
    x = xStart;
    row.forEach((cell, i) => {
      if (fill) doc.rect(x, doc.y, colWidths[i], rowHeight).fill('#f2f5f9');
      doc.text(String(cell), x + 4, doc.y + 3, { width: colWidths[i] - 8, align: 'left' });
      x += colWidths[i];
    });
    fill = !fill;
    doc.moveDown(rowHeight / 14);
  });
  doc.moveDown(0.5);
}

// ================= TITLE PAGE =================
doc.addPage();
doc.font('Helvetica-Bold').fontSize(24).fillColor('#1a3a5c').text('Security Audit Report', 50, 80);
doc.font('Helvetica-Bold').fontSize(18).fillColor('#111').text('Retry Storm Sentinel (Restorm)', 50, 120);
doc.moveDown(1);
doc.font('Helvetica').fontSize(11).fillColor('#444');
bold('Repository: ', 'C:\\Users\\lumaa\\OneDrive\\Desktop\\projects\\Restorm');
bold('Branch: ', 'main (tracks origin/main)');
bold('Audit date: ', 'Mon Nov 02 2026');
bold('Mode: ', 'Read-only — no files edited, nothing staged/committed/pushed');
bold('Project type: ', 'SAP CAP (Node.js / OData V4) with LangChain AI incident explainer');
bold('Deployment target: ', 'SAP BTP via XSUAA');
doc.moveDown(1);
doc.strokeColor('#1a3a5c').lineWidth(1.2).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a3a5c').text('Final Verdict: NOT APPROVED', { align: 'center' });
doc.font('Helvetica').fontSize(10).fillColor('#8b1a1a').text('Unresolved Critical and High dependency vulnerabilities remain.', { align: 'center' });
doc.moveDown(1);
doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666').text('This is a scoped read-only review, not a guarantee that no vulnerabilities exist.', { align: 'center' });

// ================= 1. EXECUTIVE SUMMARY =================
h1('1. Executive Summary');
p('This is an SAP CAP (Node.js / OData V4) service with a LangChain-based grounded AI incident explainer, targeted at SAP BTP via XSUAA. The codebase shows strong security-conscious design: server-side role-based authorization via CDS @requires/@restrict, input validation with numeric bounds and timestamp skew windows, a bounded read-only LangChain agent with Zod schemas and output safety filtering, metadata-only LangSmith tracing with credential redaction, and a comprehensive local test suite (331 pass / 0 fail).');
p('However, the repository is NOT ready to push. Unresolved Critical and High dependency vulnerabilities exist (handlebars, proxy-addr, body-parser, zod), and real API keys are present on disk in the untracked (but gitignored) .env file. No secret scanner was run, so the tree cannot be claimed free of other secrets.');
h2('Top risks');
bullet('Unresolved Critical dependency vulnerabilities: handlebars (x3) and proxy-addr (transitive via @sap/cds-dk).');
bullet('Unresolved High dependency vulnerabilities: body-parser (runtime-relevant via @sap/cds) and zod (direct).');
bullet('Real API keys present on disk in local .env (OpenRouter, Gemini, LangSmith) — gitignored and never committed, but at risk of accidental force-add.');
bullet('Gemini API key transmitted in URL query string (?key=...) — exposed to server/proxy logs.');
bullet('No rate limiting on state-changing/destructive actions (resetToCleanSeed, ingestTelemetry, triggerSimulation, configureThresholds).');
bullet('CSP includes unsafe-inline for styles; missing clickjacking / X-Content-Type-Options / referrer-policy headers.');
bullet('Frontend role selection is client-side only; enforcement relies on CDS middleware (which is present and tested).');

// ================= 2. SCOPE AND LIMITATIONS =================
h1('2. Scope and Limitations');
h2('Inspected');
bullet('Working tree, git status, staged/unstaged/untracked files, .gitignore, git ls-files, full git log --all');
bullet('Manifests: package.json, package-lock.json, mta.yaml, xs-security.json');
bullet('Source: srv/monitoring-service.js, srv/monitoring-service.cds, srv/core/ingestionPipeline.js, srv/ai/explanationService.js, srv/ai/langchain/modelFactory.js, srv/ai/observability/langsmithTracing.js, srv/ai/observability/traceRedaction.js, app/app.js, app/index.html, app/js/api-client.js');
bullet('.env (read for secret categories only; values not printed)');
bullet('npm audit (network available) and npm test (331 pass / 0 fail)');
h2('Not inspected / not run');
bullet('Dedicated secret scanner (gitleaks/trufflehog) — not installed; marked not run, not claimed clean.');
bullet('Live-cloud / penetration testing against SAP BTP or provider APIs (not authorized).');
bullet('npm audit --production (full audit run instead).');
bullet('Remote repository contents beyond the local origin/main tracking ref.');
bullet('Contents of untracked .claude/ worktree directories and test-results/*/error-context.md artifacts (not opened for secrets; flagged for review before any git add).');

// ================= 3. GIT AND SECRETS AUDIT =================
h1('3. Git and Secrets Audit');
p('.env tracking status (verified):');
bullet('git ls-files .env → not tracked (empty)');
bullet('git check-ignore -v .env → ignored by .gitignore line 18 (.env)');
bullet('git log --all --oneline --follow -- .env → no commits (empty)');
bullet('git ls-tree HEAD -- .env → absent');
p('Conclusion: .env has never been committed to Git. Its real secrets are local-only and are not in the publication surface. They must not be force-added.');
p('Secrets found on disk (local .env, NOT in git). Masked identifiers only — values not reproduced:');
bullet('OPENROUTER_API_KEY = sk-or-v1-**** (present)');
bullet('GEMINI_API_KEY = AQ.Ab8RN**** (present)');
bullet('LANGSMITH_API_KEY = lsv2_pt_**** (present)');
bullet('LANGSMITH_TRACING=true, RESTORM_LANGSMITH_ENABLED=true, RESTORM_LANGSMITH_CAPTURE_CONTENT=false');
p('Git history for secrets: No .env in any commit. .env.example is tracked (template only, no real keys). No evidence of committed credentials in history. Secret scanning tool not run (none installed) — findings above are from manual review, not a scanner.');
h2('Untracked files requiring review before any git add');
bullet('.claude/ worktree directories');
bullet('test-results/*/error-context.md (may contain traces/transcripts)');
bullet('sentinel.db, sentinel.db-shm, sentinel.db-wal (local sqlite DB — gitignored, do not track)');
bullet('node_modules/, target/, gen/ (gitignored build output)');

// ================= 4. APPLICATION SECURITY =================
h1('4. Application Security');
h2('Authentication & session management');
bullet('CDS auth: service MonitoringService @(requires: authenticated-user). Dev: cds.requires.auth.kind = mocked with users alice (SupportViewer), bob (SupportOperator + SupportViewer), admin (SimulatorAdmin + others). Production: kind = xsuaa via XSUAA.');
bullet(`Frontend auth: getAuthHeader() (api-client.js:28-32) builds Basic ' + btoa(username + ':') where username comes from client-side <select id=userSelect> — any visitor can select any role (alice/bob/admin) client-side; empty password sent. No server-side verification that frontend-chosen identity matches an authenticated session.`);
bullet('Transport: connect-src self CSP limits exfil, but nothing enforces HTTPS; Basic auth over HTTP would send credentials in cleartext.');
p('Assessment: CDS role enforcement exists and is exercised by tests (401 anonymous, 403 viewer). However, client-side role selection means the UI cannot be trusted as an authorization boundary; rely on CDS middleware. acknowledge/resolveAlert extract acknowledgedBy/resolvedBy from req.data ?? req.user.id ?? Operator — spoofable via req.data, though CDS @restrict to SupportOperator gates the action itself.');
h2('Authorization (server-side) — verified via CDS + tests');
const authzHeaders = ['Action', 'CDS restriction', 'Controller re-checks req.user?', 'Test result'];
const authzRows = [
  ['acknowledge', 'SupportOperator', 'No', 'bob 200, alice 403'],
  ['resolveAlert', 'SupportOperator', 'No', 'bob 200, alice 403'],
  ['ingestTelemetry', 'SimulatorAdmin, SupportOperator', 'No', 'bob 403 (viewer), operator OK'],
  ['triggerSimulation', 'SimulatorAdmin, SupportOperator', 'No', 'bob 403 (viewer)'],
  ['configureThresholds', 'SimulatorAdmin', 'No', 'admin 200, bob/alice 403'],
  ['resetToCleanSeed', 'SimulatorAdmin', 'No', 'admin 200, bob/alice 403'],
  ['explain', 'authenticated-user only (no @restrict)', 'No', 'bob 200, alice 200'],
  ['exportIncidentReport', 'authenticated-user only (no @restrict)', 'No', 'bob 200, alice 200'],
  ['getTopology', 'authenticated-user', 'No', 'anonymous 401'],
];
table(authzHeaders, authzRows, [110, 150, 110, 120]);
p('CDS @requires/@restrict provides server-side enforcement at the OData protocol layer. Controllers do not perform independent req.user role assertions — defense-in-depth is weak. Tests confirm the CDS layer works. Material authorization defect: none, but add controller-level role assertions for defense-in-depth, especially on destructive resetToCleanSeed (wipes all alerts + snapshots).');
h2('IDOR / BOLA');
bullet('ingestTelemetry validates interfaceId exists and is active; rejects non-existent/inactive interfaces.');
bullet('LangChain agent tools enforce assertAuthorizedScope(interfaceId, authorizedInterfaceId) — cross-interface access blocked within a single investigation.');
bullet('No cross-tenant concept (dedicated tenant mode in xs-security.json).');
h2('Input validation & injection');
bullet('ingestionPipeline.js: validateIntegerBound (type + min/max), validateTimestamp (ISO-8601, rejects >5 min future and >7 days past — clock-skew defense).');
bullet('simulator.js: ALLOWED_SCENARIOS allowlist; defensive copies; Object.freeze templates.');
bullet('LangChain tools: Zod schemas on all 5 tools, string length caps, MAX_TOOL_CALLS=5, MAX_ITERATIONS=4, timeouts.');
bullet('OData via CDS (parameterized by framework); no raw string-concatenated SQL observed. fetch() to Gemini/OpenRouter uses JSON.stringify bodies — no shell injection.');
h2('API & service security');
bullet('No rate limiting on any action — resetToCleanSeed, ingestTelemetry, triggerSimulation, configureThresholds can be hammered.');
bullet('Error handling: apiRequest surfaces res.text() as the error message; CDS error bodies could leak internal paths/stack traces to the client.');
bullet('No CORS configuration visible in CDS service (CAP default is restrictive). connect-src self in CSP.');
bullet('No webhooks present. Single OData V4 path /odata/v4/monitoring.');
h2('Frontend & browser security (verified in index.html)');
p("CSP: default-src 'self'; script-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self';");
bullet("style-src 'unsafe-inline' — permits inline style-based XSS.");
bullet('Missing frame-ancestors / X-Frame-Options — clickjacking protection absent.');
bullet('Missing X-Content-Type-Options: nosniff.');
bullet('Missing Referrer-Policy.');
bullet("script-src 'self' is good (no inline scripts, no unsafe-eval).");
bullet('No credentials in localStorage/sessionStorage; username held in JS variable only. No source maps. No open redirects.');
bullet("playwright.config.js hardcodes test credentials { username: 'bob', password: '' } — not a production secret, but test creds in config.");
h2('Data & database security');
bullet('Local sentinel.db (sqlite) — gitignored (*.db), not committed. Plaintext file, no encryption-at-rest config. Acceptable for local dev; production on BTP would use managed DB.');
bullet('Test fixtures/seed data are synthetic (simulator templates), not production copies.');
h2('Infrastructure & CI/CD');
bullet('mta.yaml: Node.js module on nodejs_buildpack, XSUAA application plan, dedicated tenant. xs-security.json defines 3 scopes / 3 role templates / 3 role collections. Well-formed and consistent.');
bullet('No CI workflow files (.github/) observed — no CI/CD pipeline to audit for secret leakage in logs.');
bullet('No Dockerfile/K8s/Terraform observed. Build: npm ci + cds build --production.');

// ================= 5. AI / LLM SECURITY =================
h1('5. AI / LLM / Agent Security');
h2('Prompt injection & trust boundaries');
bullet('agentPrompts.js SYSTEM_PROMPT explicitly treats telemetry and runbook contents as UNTRUSTED; forbids following embedded instructions; forbids overriding deterministic detection; forbids recommending destructive actions (delete/drop/purge/restart); requires citing only catalog runbook IDs; requires hypotheses labeled as unproven.');
bullet('validateModelOutput (explanationService.js:49): filters citedRunbookIds to only retrieved IDs; rejects checks matching unsafe patterns (drop queue|delete message|purge queue|truncate|rm -rf|force delete).');
bullet('Prompt wording supplemented by code enforcement.');
h2('Agent & tool security');
bullet('5 read-only LangChain tools, all Zod-validated. No tools to modify thresholds, alter queues, or resolve incidents.');
bullet('Tools enforce assertAuthorizedScope(interfaceId, authorizedInterfaceId).');
bullet('executionPolicy.js: MAX_TOOL_CALLS=5, MAX_ITERATIONS=4, TOTAL_INVESTIGATION_TIMEOUT_MS=15000, MODEL_TIMEOUT_MS=15000, TOOL_TIMEOUT_MS=5000, MAX_SNAPSHOTS_LIMIT=20, MAX_RUNBOOK_RESULTS=3, MAX_STRING_LENGTH=2000.');
bullet('Model cannot expand its own permissions or invoke arbitrary tools/URLs — tool map fixed at construction.');
h2('Tracing & observability privacy');
bullet('isTracingEnabled() requires BOTH an enabled flag AND a non-empty LANGSMITH_API_KEY; returns false (zero network calls) if either missing.');
bullet('isContentCaptureEnabled() defaults to false — metadata-only by default. .env has capture=false.');
bullet('withTrace(): never blocks business logic on tracing failure; catches postRun/patchRun errors; rethrows business errors.');
bullet('traceRedaction.js: SECRET_VALUE_PATTERNS catches Bearer , Basic , Google AIzaSy, sk-, lsv2_pt_, and DB connection URIs. ALLOWED_METADATA_KEYS is a strict allowlist. getTracingDiagnostics() returns no key values.');
h2('Retrieval & model output');
bullet('runbookRetrieval.js: keyword scoring over internal runbook catalog; no embedding/vector store; no external RAG source that could override system instructions.');
bullet('validateModelOutput: citation validation against retrieved runbook IDs; unsafe-pattern rejection. Output cannot alter authorization/roles/lifecycle state — explanation is advisory only, written to aiExplanation field on Alert.');
h2('Fallback behavior');
bullet('If providers fail or keys missing → deterministicFallback (offline, zero credentials). Tracing errors never fail business logic. Model timeouts via AbortSignal.timeout. Cooldown cache for 429/401/403.');

// ================= 6. DEPENDENCY AUDIT =================
h1('6. Dependency Audit');
p('Command: npm audit (network available, full audit — not production-only)');
p('Result: 5 vulnerabilities — 2 critical, 2 high, 1 moderate. All have fixes available.');
const depHeaders = ['Package', 'Severity', 'Advisory / CVSS', 'Range', 'Fix Available', 'Location'];
const depRows = [
  ['handlebars', 'Critical', 'GHSA-8r5x-fm3f-whwj (JS injection AST type confusion), CVSS 9.8', '>=3.0.0 <=4.7.9', 'Yes (npm audit fix)', '@sap/cds-dk transitive'],
  ['handlebars', 'Critical', 'GHSA-xw65-4hp5-5hc7 (unsafe inline embedding), CVSS 4.7', '>=3.0.0 <=4.7.9', 'Yes (npm audit fix)', '@sap/cds-dk transitive'],
  ['handlebars', 'Critical', 'GHSA-p8wg-vrv2-v86f (own property bypass), CVSS 0.0', '>=3.0.0 <=4.7.9', 'Yes (npm audit fix)', '@sap/cds-dk transitive'],
  ['proxy-addr', 'Critical', 'GHSA-jqcg-44mw-7w3h (IP spoofing via IPv4-mapped IPv6), CVSS 9.1', '1.1.0–2.0.7', 'Yes (npm audit fix)', '@sap/cds-dk transitive'],
  ['body-parser', 'High', 'GHSA-27r3-jxmh-p828 (DoS trailing bytes after compressed body), CVSS 7.5', '>=2.0.0 <2.4.0', 'Yes (npm audit fix)', 'direct via @sap/cds + cds-dk copy'],
  ['zod', 'High', 'GHSA-mrhx-c7xc-m3w5 (memory exhaustion oversized collections), CVSS 7.5', '<4.6.6', 'Yes via --force (4.6.7, breaking major)', 'direct'],
  ['qs', 'Moderate', 'GHSA-6pq8-jhm2-2vcw (DoS stringify arrayFormat comma), CVSS 5.3', '>=6.7.0 <=6.16.0', 'Yes (npm audit fix)', '@sap/cds-dk transitive'],
];
table(depHeaders, depRows, [70, 60, 130, 80, 70, 90]);
p('No force upgrades recommended. zod fix requires a major-version review (4.6.7) and testing for breaking changes. All other fixes available via npm audit fix.');

// ================= 7. TEST RESULTS =================
h1('7. Test Results');
p('Command: npm test → node --test --test-concurrency=1 test/**/*.test.js');
p('Result: tests 331, suites 62, pass 331, fail 0, cancelled 0, skipped 0, todo 0, duration ~72s.');
p('Environment: Local sqlite (sentinel.db), mocked CDS users (alice/bob/admin), no live cloud, no provider API calls (AI tests use fallback or mock; one test exercised a live OpenRouter key and passed but that is not reproducible evidence of live behavior). A mocked test is not evidence of live provider behavior.');
p('Coverage: ingestion authz (401/403), validation bounds/timestamps, deterministic ordering, threshold policies, topology auth (anonymous 401), runbook retrieval, simulator validation, telemetry adapter strict validation, incident export (alice/viewer can export), trace redaction, prompt-injection safety, XSS/sensitive-data exposure, provider failover, fallback behavior.');

// ================= 8. FINDINGS TABLE =================
h1('8. Findings Table');
const fHeaders = ['ID', 'Severity', 'Category', 'Location', 'Recommended Fix', 'Status'];
const fRows = [
  ['F1', 'Critical', 'Dependency vulnerability', 'node_modules/@sap/cds-dk/.../handlebars (transitive)', 'npm install / npm audit fix (fixAvailable)', 'Open'],
  ['F2', 'Critical', 'Dependency vulnerability', 'node_modules/@sap/cds-dk/.../proxy-addr (transitive)', 'npm install (fixAvailable)', 'Open'],
  ['F3', 'High', 'Dependency vulnerability (runtime)', 'node_modules/body-parser (direct via @sap/cds)', 'npm audit fix (fixAvailable)', 'Open'],
  ['F4', 'High', 'Dependency vulnerability (direct)', 'node_modules/zod', 'Review major-version bump to zod 4.6.7; test breaking changes', 'Open'],
  ['F5', 'Moderate', 'Dependency vulnerability (dev-only)', 'node_modules/@sap/cds-dk/.../qs', 'npm install (fixAvailable)', 'Open'],
  ['F6', 'Medium', 'Secrets on disk', 'Local .env (untracked, gitignored, never committed)', 'Never force-add .env; rotate keys; consider pre-commit hook', 'Open'],
  ['F7', 'Medium', 'API key in URL query string', 'srv/ai/explanationService.js:214; modelFactory.js:111', 'Move Gemini key to Authorization: Bearer header', 'Open'],
  ['F8', 'Medium', 'Missing rate limiting', 'srv/monitoring-service.js actions: resetToCleanSeed, ingestTelemetry, triggerSimulation, configureThresholds', 'Add rate limiting (per-IP or per-user) on mutating actions', 'Open'],
  ['F9', 'Low', 'CSP weakness', 'app/index.html:7-8', 'Add frame-ancestors self, X-Content-Type-Options nosniff, Referrer-Policy; remove unsafe-inline', 'Open'],
  ['F10', 'Low', 'Client-side role selection', 'app/js/api-client.js:28-32; app/index.html:43-47', 'Document CDS as enforcement boundary; consider re-validating req.user in controller', 'Open'],
  ['F11', 'Low', 'Error information disclosure', 'app/js/api-client.js:57-65', 'Sanitize error messages before returning to client', 'Open'],
  ['F12', 'Informational', 'Unrestricted explain action', 'srv/monitoring-service.cds:18-20', 'Add @(restrict) to explain if LLM cost is a concern', 'Open'],
];
table(fHeaders, fRows, [35, 60, 105, 145, 135, 40]);

// ================= 9. GIT PUSH READINESS =================
h1('9. Git Push Readiness');
p('Nothing was staged, committed, or pushed. This was a read-only audit.');
h2('Files safe to publish');
p('All tracked modified files except any containing secrets — none found in the tracked set. .env.example is a template (safe). package-lock.json/package.json changes are dependency edits (safe after reviewing F1–F5).');
h2('Files requiring exclusion/review before push');
bullet('.env — contains real API keys; MUST remain untracked/ignored. Do NOT git add -f .env.');
bullet('sentinel.db, sentinel.db-shm, sentinel.db-wal — local sqlite DB; gitignored; do not track.');
bullet('node_modules/, target/, gen/ — gitignored build output.');
bullet('.claude/ and test-results/*/error-context.md — untracked artifacts; review before any git add.');
h2('Git history');
p('.env never committed (verified empty via git log --all --follow -- .env). No secrets in history. Safe to push from a history standpoint, provided F1–F5 are resolved and .env stays out.');
h2('Pre-push checklist');
bullet('Resolve F1–F5 (npm install / npm audit fix; zod major-version review for F4).');
bullet('Confirm .env is not staged (git status should show it ignored/untracked only).');
bullet('Do NOT force-add .env. Rotate any key that may have touched a non-ignored location before push.');

// ================= 10. FINAL VERDICT =================
h1('10. Final Verdict');
doc.font('Helvetica-Bold').fontSize(13).fillColor('#8b1a1a').text('NOT APPROVED', { align: 'center' });
doc.moveDown(0.3);
doc.font('Helvetica').fontSize(10).fillColor('#111').text('Unresolved Critical (handlebars x3, proxy-addr) and High (body-parser runtime-relevant, zod direct) dependency vulnerabilities remain. All have fixes available via npm install / npm audit fix; zod requires a major-version review (4.6.7, breaking change). Additionally F6 (secrets on disk in untracked .env) requires key-not-committed discipline; F7/F8/F9 are medium hardening items.', { align: 'left' });
doc.moveDown(0.5);
doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666').text('This is a scoped read-only review, not a guarantee that no vulnerabilities exist. No files were staged, committed, or pushed.', { align: 'left' });

doc.end();
pipe.on('finish', () => {
  console.log('PDF written to:', outPath);
  console.log('Size (bytes):', fs.statSync(outPath).size);
});
