# PHASE 5 — AGENT OWNERSHIP & FILE BOUNDARIES

**Restorm — Retry Storm Sentinel — Phase 5: Real-Time SAP Integration Operations Dashboard**

This document establishes file ownership and conflict-prevention rules for the six specialist subagents. No agent may modify files outside its allowed scope. Shared files have a single designated owner (the Orchestrator or Agent 2 for frontend shared files). Feature agents consume shared contracts; they do not independently edit them.

---

## ORCHESTRATOR (Main Technical Lead)

**Role:** Coordinates all agents, approves shared contracts, owns shared infrastructure, performs final integration and release.

**Allowed files (single owner):**
- `package.json` (dependency manifest — only the Orchestrator may approve changes)
- Root configuration files (`.env.example`, `mta.yaml`, `xs-security.json`, `.gitignore`, `cds` config in `package.json`)
- `PHASE5_AGENT_OWNERSHIP.md`
- `PHASE5_BACKEND_AUDIT.md` (consolidation only — authored by Agent 1)
- `PHASE5_FRONTEND_FOUNDATION.md` (consolidation only — authored by Agent 2)
- `PHASE5_DASHBOARD_REPORT.md` (consolidation only — authored by Agent 3)
- `PHASE5_TOPOLOGY_REPORT.md` (consolidation only — authored by Agent 4)
- `PHASE5_INCIDENT_OPERATIONS_REPORT.md` (consolidation only — authored by Agent 5)
- `PHASE5_QA_REPORT.md` (consolidation only — authored by Agent 6)

**Forbidden:** None (but defers to agent file ownership for implementation)

---

## AGENT 1 — BACKEND AND ODATA SPECIALIST

**Responsibilities:** CDS schemas, CAP services, OData entity/operation mapping, API contract audit, backend extensions, backend integration tests.

**Allowed files/directories:**
- `srv/monitoring-service.cds`
- `srv/monitoring-service.js`
- `srv/core/*.js` (read-only inspection; modifications only if a confirmed defect requires it and approved by Orchestrator)
- `srv/ai/*.js` (read-only inspection)
- `db/schema.cds` (read-only — do not introduce a second data model)
- `db/data/*.csv` (read-only seed data)
- `test/monitoringService.test.js`, `test/topology.test.js`, `test/thresholds.test.js`, `test/ingestion.test.js`, `test/explanationService.test.js`, `test/runbookRetrieval.test.js`, `test/detectionEngine.test.js`, `test/reportExport.test.js`, `test/simulator.test.js`, `test/cpiConnectorMock.test.js`, `test/telemetryAdapter.test.js`
- `PHASE5_BACKEND_AUDIT.md` (author)

**Forbidden files:**
- `app/*` (frontend — owned by Agent 2)
- Do not modify deterministic detection rules (`srv/core/detectionEngine.js`) unless a confirmed defect is reported and approved.
- Do not introduce a second backend data model.
- Do not invent OData endpoints not present in `srv/monitoring-service.cds`.

**Deliverable:** `PHASE5_BACKEND_AUDIT.md`

---

## AGENT 2 — FRONTEND FOUNDATION SPECIALIST

**Responsibilities:** Application shell, routing, design system, shared layout, centralized OData API client, reusable loading/error/empty states, responsive sidebar/header, shared utilities.

**Allowed files/directories (single owner of shared frontend infrastructure):**
- `app/index.html` (application shell)
- `app/app.js` (bootstrap, routing, global state)
- `app/css/*` (design tokens, layout, components)
- `app/js/*` (API client, router, state, shared components, utilities)
- `package.json` — frontend-only dev dependencies (requires Orchestrator approval to modify)

**Forbidden files:**
- `srv/*`, `db/*` (backend — owned by Agent 1)
- Do not modify backend contracts independently.
- Do not implement dashboard business pages (owned by Agents 3, 4, 5).
- Do not implement incident lifecycle logic (owned by Agent 5).
- Do not modify shared backend services.

**Deliverable:** `PHASE5_FRONTEND_FOUNDATION.md`

**Shared dependencies (consumed by Agents 3, 4, 5):**
- Centralized OData API client (`app/js/api-client.js`)
- Router (`app/js/router.js`)
- Global state (`app/js/state.js`)
- Design tokens (`app/css/design-tokens.css`)
- Reusable UI components (`app/js/components/*`)

---

## AGENT 3 — DASHBOARD AND ANALYTICS SPECIALIST

**Responsibilities:** Operational overview, KPI cards, interface health distribution, active incident summary, queue health table, retry metrics, historical queue charts, interface inventory, interface details, dashboard tests.

**Allowed files/directories:**
- `app/js/pages/overview.js` and related overview components
- `app/js/pages/interface-inventory.js` and components
- `app/js/pages/interface-detail.js` and components
- `app/js/components/charts/*` (dashboard-specific chart components)
- Frontend tests for dashboard pages (`test/frontend/dashboard*.test.js` or similar)

**Forbidden files:**
- `srv/*`, `db/*` (backend)
- Do not modify the shared API client (owned by Agent 2).
- Do not modify application routing directly (owned by Agent 2).
- Do not modify backend services.
- Do not hardcode operational metrics (must use actual backend contracts).

**Deliverable:** `PHASE5_DASHBOARD_REPORT.md`

---

## AGENT 4 — TOPOLOGY SPECIALIST

**Responsibilities:** Integration topology page, topology visualization components, topology data transformations, topology tests.

**Allowed files/directories:**
- `app/js/pages/topology.js` and topology-specific components
- `app/js/components/topology/*` (topology visualization)
- Topology data transformation utilities
- Frontend tests for topology page

**Forbidden files:**
- `srv/*`, `db/*` (backend)
- Do not invent node relationships (use actual topology from `getTopology()`).
- Do not modify shared routing or API clients.
- Do not change backend topology semantics.

**Deliverable:** `PHASE5_TOPOLOGY_REPORT.md`

---

## AGENT 5 — INCIDENT OPERATIONS SPECIALIST

**Responsibilities:** Incident listing, incident detail, incident timeline, acknowledge/resolve workflows, threshold policy management, AI-grounded explanations, runbook references, operator action confirmations, permission-aware UI.

**Allowed files/directories:**
- `app/js/pages/incidents.js` and incident components
- `app/js/pages/incident-detail.js` and components
- `app/js/pages/thresholds.js` and threshold components
- `app/js/components/incident/*` (timeline, runbook, explanation UI)
- Frontend tests for incident pages

**Forbidden files:**
- `srv/*`, `db/*` (backend)
- Never fake incident updates (all state changes call actual backend operations).
- Never allow frontend-only lifecycle changes.
- Never bypass backend authorization.
- Never present AI hypotheses as confirmed root causes.
- Do not implement automatic remediation in this phase.
- Do not modify shared API client or routing.

**Deliverable:** `PHASE5_INCIDENT_OPERATIONS_REPORT.md`

---

## AGENT 6 — QA, SECURITY AND E2E SPECIALIST

**Responsibilities:** Full inspection, test plan, backend contract integration tests, dashboard metric accuracy tests, interface filtering/pagination, historical chart correctness, topology relationships, incident ack/resolve, threshold policy persistence, authorization, AI fallback, data refresh, backend disconnection, empty/malformed responses, responsive behavior, XSS, sensitive data exposure, performance with synthetic datasets.

**Allowed files/directories:**
- `test/frontend/*` (frontend unit/component tests)
- `test/e2e/*` (browser E2E tests)
- `test/security/*` (security tests)
- `test/performance/*` (performance tests)
- `PHASE5_QA_REPORT.md` (author)
- Test configuration files (frontend test runner setup)

**Forbidden files:**
- Do not change production application logic without reporting a confirmed defect.
- Do not modify files owned by other agents without coordination through the Orchestrator.
- Do not report passing tests without executing them.
- Never alter the user's normal development database (`sentinel.db`) — use dedicated synthetic test datasets.

**Deliverable:** `PHASE5_QA_REPORT.md`

---

## SHARED FILES — SINGLE OWNER POLICY

| File | Owner | Notes |
|------|-------|-------|
| `package.json` | Orchestrator | Only Orchestrator may approve dependency changes |
| `app/index.html` | Agent 2 | Application shell |
| `app/app.js` | Agent 2 | Bootstrap, routing, global state |
| `app/js/api-client.js` | Agent 2 | Centralized OData API client |
| `app/js/router.js` | Agent 2 | Application routing |
| `app/js/state.js` | Agent 2 | Global state management |
| `app/css/design-tokens.css` | Agent 2 | Design tokens |
| `srv/monitoring-service.cds` | Agent 1 | CDS service contract |
| `srv/monitoring-service.js` | Agent 1 | Backend service implementation |
| `db/schema.cds` | Agent 1 | Data model (read-only for Phase 5) |

## CONFLICT RESOLUTION PROTOCOL

If two agents need to modify the same file:
1. Stop both edits immediately.
2. Report the conflict to the Orchestrator.
3. The designated single owner implements the change.
4. The Orchestrator informs dependent agents of the approved change.

No agent may claim another agent's work is complete without verifying the actual files and test results.
