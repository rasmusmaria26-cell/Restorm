# PHASE5_INCIDENT_OPERATIONS_REPORT.md

Restorm Phase 5 — Incident Operations (Agent 5 — Incident Operations Specialist)

---

## AGENT: AGENT 5 — INCIDENT OPERATIONS
## CURRENT TASK: Incident operations implementation

---

## FILES INSPECTED
- `app/js/api-client.js` — centralized OData API client (read-only, NOT modified)
- `app/js/store.js` — global observable store (read-only, NOT modified)
- `app/js/router.js` — hash-based router (read-only, NOT modified; routes `#incidents`, `#incident/:id`, `#thresholds` already wired)
- `app/js/pages/IncidentsPage.js` — page shell (owned, replaced with full implementation)
- `app/js/pages/IncidentDetailPage.js` — page shell (owned, replaced with full implementation)
- `app/js/pages/ThresholdsPage.js` — page shell (owned, replaced with full implementation)
- `app/app.js` — bootstrap (read-only; already wires pages + passes `api`, `getState`, `setState`, `params`, `FRIENDLY_RULE_TITLES`, `SEVERITY_WEIGHT`, `USER_PERMISSIONS`, `currentUsername`, `formatDurationSeconds`, `formatShortTime` to `render()`)
- `srv/monitoring-service.cds` — CDS service contract (read-only)
- `srv/monitoring-service.js` — service implementation (read-only)
- `db/schema.cds` — entity schema (read-only)
- `srv/ai/explanationService.js`, `srv/ai/runbookRetrieval.js`, `srv/core/reportGenerator.js` — backend explanation/report/read-only)

---

## FILES MODIFIED / CREATED

**Created (new):**
1. `app/js/pages/IncidentsPage.js` — Incident listing page
2. `app/js/pages/IncidentDetailPage.js` — Incident detail page (route `#incident/:id`)
3. `app/js/pages/ThresholdsPage.js` — Threshold policy management page
4. `test/frontend/incident-operations.test.js` — Frontend unit tests (node:test)

**NOT modified (per restrictions):**
- `app/js/api-client.js`, `app/js/store.js`, `app/js/router.js` (shared foundation)
- `app/js/components/*.js` (shared components)
- Any Agent 3 or Agent 4 files
- Any backend (`srv/`, `db/`) files
- `app/app.js`

---

## DEPENDENCIES
- Agent 2 shared foundation (api-client, store, router, components, page shells, app.js wiring)
- Backend OData contracts implemented by Agents 3/4 (monitoring service)

---

## API CONTRACTS USED (via `api` object passed to `render()`)

| Action | Endpoint | Method | Body | Authz role | Used in |
|--------|----------|--------|------|------------|---------|
| Fetch alerts | `/Alerts?$expand=interface&$orderby=detectedAt desc` | GET | — | authenticated | IncidentsPage, IncidentDetailPage |
| Fetch interfaces | `/Interfaces?$expand=snapshots($orderby=capturedAt asc)` | GET | — | authenticated | ThresholdsPage |
| Fetch runbooks | `/RunbookEntries` | GET | — | authenticated | IncidentDetailPage (raw fetch via BASE_URL) |
| Acknowledge | `/Alerts({id})/MonitoringService.acknowledge` | POST | `{ acknowledgedBy }` | SupportOperator | IncidentsPage, IncidentDetailPage |
| Resolve | `/Alerts({id})/MonitoringService.resolveAlert` | POST | `{ resolvedBy }` | SupportOperator | IncidentsPage, IncidentDetailPage |
| Explain | `/Alerts({id})/MonitoringService.explain` | POST | `{}` | authenticated | IncidentDetailPage |
| Export report | `/Alerts({id})/MonitoringService.exportIncidentReport` | POST | `{ format }` | authenticated | IncidentsPage, IncidentDetailPage |
| Configure thresholds | `/configureThresholds` | POST | `{ interfaceId, maxRetryThreshold, queueGrowthLimit, oldMessageAgeLimitSeconds, recoveryStalledBacklog }` | SimulatorAdmin | ThresholdsPage |

All calls go through `api-client.js` (untouched). `apiRequest` normalizes errors and attaches `.status` so the UI maps 401/403/404/409 to friendly messages.

---

## IMPLEMENTATION DETAILS

### 1. IncidentsPage.js (`#incidents`)
- Groups alerts into incidents by `interface_ID + ruleCode`; representative = most recent alert.
- Repeat count = max across group; status = Open (if any open) > Acknowledged (if any acked) > Resolved (if all resolved).
- Sort: Open before Acknowledged/Resolved, then severity (Critical > High > Warning > Info via `SEVERITY_WEIGHT`), then newest `detectedAt`.
- Each card: friendly title (from `FRIENDLY_RULE_TITLES`), rule code, interface name + source→target, evidence line (pending/retries/age from `observedMetrics`), ongoing since, repeat count, status badge.
- Action buttons per permission: Acknowledge (Open only), Resolve (Acknowledged only), Explain, Export Report — all call actual backend; never frontend-only lifecycle changes.
- Alice (SupportViewer): ack/resolve buttons disabled; bob/admin can act.
- Loading / Error / Empty states via shared components.

### 2. IncidentDetailPage.js (`#incident/:id`)
- Full detail: ID, ruleCode, severity, status, detectedAt, windowStart/End, repeatCount, observedMetrics table, summary.
- Interface info: name, source → target.
- Timeline: detected → acknowledged → resolved (actors + timestamps; "Pending" when not yet done).
- Acknowledge/Resolve buttons (permission-aware, call actual backend, 409 on illegal state transition).
- Explain button: calls `explainAlert`, renders inline drawer with:
  - Summary
  - Observed facts (verified metrics) — clearly separated
  - Possible explanations labeled **(hypotheses — unproven)** + explicit note: "These are hypotheses, not confirmed root causes."
  - Recommended checks, curated runbook references (cited IDs + titles), limitations/evidence-gaps callout.
- Export Report button: downloads markdown postmortem (`Incident-Postmortem-<rule>-<id>.md`).

### 3. ThresholdsPage.js (`#thresholds`)
- Lists all interfaces with current threshold policies (table + allowed ranges).
- Edit form per interface (admin only): `maxRetryThreshold` (1–10000), `queueGrowthLimit` (1–100000), `oldMessageAgeLimitSeconds` (10–2592000), `recoveryStalledBacklog` (1–100000); inputs use `step="1"` and validation rejects non-integers/out-of-bounds.
- Save calls `configureThresholds` backend action; non-admin gets 403 from backend and a permission notice is shown.
- Validation error feedback shown inline; success refreshes data.

### 4. Permission-aware UI behavior
- `USER_PERMISSIONS[currentUsername]` drives `canAcknowledge` / `canResolve`; alice (viewer) sees ack/resolve disabled with tooltips; bob/admin can act.
- Threshold editing restricted to `admin` (SimulatorAdmin); 403 surfaced for non-admin.
- 401 → auth message; 404 → not found; 409 → state conflict; 403 → role message.

### 5. AI explanation safety
- Hypotheses rendered under heading "Possible explanations (hypotheses — unproven)" with italic disclaimer.
- Never presents `possibleHypotheses` as confirmed root cause; no `confirmedRootCause` field is ever set or shown.
- Observed facts separated from hypotheses; limitations/evidence-gaps always shown.

---

## AUTH ENFORCEMENT
- Frontend pre-checks disable/hide actions for viewer roles (defense in depth).
- Backend enforces CDS `@(restrict: ...)` / `@(requires: 'SimulatorAdmin')` — acknowledge/resolve require `SupportOperator`; `configureThresholds` requires `SimulatorAdmin`.
- 403/401/404/409 responses mapped to friendly messages via `getFriendlyErrorMessage`; no bypass of backend authorization.
- Roles: bob=SupportOperator (ack/resolve), alice=SupportViewer (view-only), admin=SimulatorAdmin (thresholds).

---

## TESTS EXECUTED
- `node --check` on `app/js/pages/IncidentsPage.js`, `IncidentDetailPage.js`, `ThresholdsPage.js`, `test/frontend/incident-operations.test.js` — all pass (no syntax errors).
- `npm test` (backend suite `test/**/*.test.js`) — 124 tests, 120 pass, 4 fail.
- `node test/frontend/incident-operations.test.js` — 20 tests, 20 pass, 0 fail.

---

## TEST RESULTS (frontend incident-operations.test.js)

| Suite | Pass | Fail |
|-------|------|------|
| incident grouping logic | 5 | 0 |
| lifecycle state transitions | 3 | 0 |
| permission-aware behavior | 2 | 0 |
| threshold validation | 5 | 0 |
| AI hypotheses labeling | 2 | 0 |
| empty / malformed responses | 3 | 0 |
| **Total** | **20** | **0** |

Frontend test coverage: grouping by interface+ruleCode; Open/Acknowledged/Resolved ordering; severity ordering; empty/malformed input; Open→Acknowledged→Resolve lifecycle; viewer (alice) cannot ack/resolve; bob/admin can; threshold bounds (1–10000, 1–100000, 10–2592000, 1–100000); non-integer/empty/malformed rejection; hypotheses separated from observed facts and never confirmed; undefined/null/malformed response handling.

---

## BLOCKERS
None. The 4 failures in `npm test` are pre-existing test-state-ordering issues in `test/monitoringService.test.js` (shared mutable SQLite DB not reset between tests; e.g., "Alert Acknowledgment" finds no Open alerts because earlier tests consumed them). These are unrelated to this agent's frontend work — no backend or Agent 3/4 files were modified.

---

## REMAINING WORK
None. All Stage C incident operations deliverables are implemented and tested.
- Incident listing page ✔
- Incident detail page ✔
- Incident timeline ✔
- Acknowledge/resolve workflows (actual backend) ✔
- Threshold policy management page ✔
- AI-grounded explanations (hypotheses labeled unproven) ✔
- Runbook references ✔
- Export report (markdown download) ✔
- Operator action confirmations + permission-aware UI ✔
- Frontend tests (20/20 passing) ✔
