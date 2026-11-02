# PHASE 5 BACKEND AUDIT — Restorm

**Agent:** AGENT 1 — BACKEND AND ODATA SPECIALIST  
**Stage:** B — Foundation  
**Repository:** C:\Users\lumaa\OneDrive\Desktop\projects\Restorm  
**Status:** Read-only inspection complete (backend source NOT modified)

---

## 1. Overview

The backend is a SAP Cloud Application Programming (CAP) model service exposing an OData V4 endpoint named `MonitoringService`. It models a retry-storm / integration monitoring landscape: interfaces, queue snapshots, alerts, runbook entries, systems, and connections, plus actions for alert lifecycle, simulation, telemetry ingestion, threshold configuration, report export, and a topology function.

- CDS service model: `srv/monitoring-service.cds`
- Service implementation: `srv/monitoring-service.js`
- Database model: `db/schema.cds` (namespace `sap.retrysentinel`)
- Auth: mocked users `alice`/`bob`/`admin` in `package.json` cds requires; production uses `xsuaa`
- Test suite: `test/**/*.test.js` — 85 tests across 11 suites
- Build script: `cds build --production` → `gen/`

No second backend data model was introduced and no deterministic detection rules (`srv/core/detectionEngine.js`) were changed.

---

## 2. CDS Entity Definitions (all 6 entities)

### 2.1 `sap.retrysentinel.Interfaces` (db/schema.cds:8)

```
entity Interfaces : cuid, managed {
    name                      : String(100);
    sourceSystem              : String(50);
    targetSystem              : String(50);
    active                    : Boolean default true;
    expectedSchedule          : String(100);
    description               : String(255);
    maxRetryThreshold         : Integer default 100;       // Rule A
    queueGrowthLimit          : Integer default 200;       // Rule B
    oldMessageAgeLimitSeconds : Integer default 600;       // Rule C
    recoveryStalledBacklog    : Integer default 100;       // Rule D
    snapshots                 : Composition of many QueueSnapshots on snapshots.interface = $self;
    alerts           : Association to many Alerts on alerts.interface = $self;
}
```

### 2.2 `sap.retrysentinel.QueueSnapshots` (db/schema.cds:27)

```
entity QueueSnapshots : cuid, managed {
    interface               : Association to Interfaces;
    capturedAt              : DateTime;
    pendingCount            : Integer;
    failedCount             : Integer;
    retryAttempts           : Integer;
    successCount            : Integer;
    oldestPendingAgeSeconds : Integer;
}
```

### 2.3 `sap.retrysentinel.Alerts` (db/schema.cds:40)

```
entity Alerts : cuid, managed {
    interface       : Association to Interfaces;
    ruleCode        : String(50);   // EXCESSIVE_RETRIES, QUEUE_GROWTH, OLD_MESSAGE_AGE, RECOVERY_STALLED
    severity        : String(20);   // Info, Warning, High, Critical
    status          : String(20) default 'Open'; // Open, Acknowledged, Resolved, Closed
    repeatCount     : Integer default 1;
    detectedAt      : DateTime;
    windowStart     : DateTime;
    windowEnd       : DateTime;
    observedMetrics : LargeString;  // JSON payload with snapshot metrics & thresholds
    summary         : String(255);
    acknowledgedAt  : DateTime;
    acknowledgedBy  : String(100);
    resolvedAt      : DateTime;
    resolvedBy      : String(100);
    aiExplanation   : LargeString;
}
```

### 2.4 `sap.retrysentinel.RunbookEntries` (db/schema.cds:61)

```
entity RunbookEntries : cuid, managed {
    ruleCode    : String(50);
    title       : String(150);
    symptoms    : LargeString;
    checks      : LargeString;
    limitations : LargeString;
    keywords    : String(255);
}
```

### 2.5 `sap.retrysentinel.Systems` (db/schema.cds:73)

```
entity Systems : cuid, managed {
    code        : String(50);  // E.g. WEBSHOP, S4HANA, PAYGATE, WMS, CPI
    name        : String(100);
    category    : String(50);  // Source, Target, Middleware, EventBroker
    environment : String(50) default 'Synthetic';
    tier        : String(20) default 'Core'; // Mission-Critical, Core, Supporting
}
```

### 2.6 `sap.retrysentinel.Connections` (db/schema.cds:84)

```
entity Connections : cuid, managed {
    interface       : Association to Interfaces;
    sourceSystem    : Association to Systems;
    targetSystem    : Association to Systems;
    component       : String(100); // E.g. "SAP Cloud Integration (CPI)", "Enterprise Event Mesh"
    protocol        : String(50);  // E.g. "HTTPS / OData V4", "REST / HTTPS", "AMQP"
    connectionType  : String(50);  // Asynchronous Queue, Asynchronous Batch, Event Stream
}
```

### 2.7 Service projection (srv/monitoring-service.cds)

`MonitoringService @(requires: 'authenticated-user')` projects all six entities as `@readonly`. The service layer adds actions and one function:

| Element | Kind | CDS signature | Bound to |
|---|---|---|---|
| acknowledge | action | `action acknowledge(acknowledgedBy: String) returns Alerts;` | Alerts |
| resolveAlert | action | `action resolveAlert(resolvedBy: String) returns Alerts;` | Alerts |
| explain | action | `action explain() returns LargeString;` | Alerts |
| exportIncidentReport | action | `action exportIncidentReport(format: String) returns LargeString;` | Alerts |
| getTopology | function | `function getTopology() returns LargeString;` | service (unbound) |
| ingestTelemetry | action | `action ingestTelemetry(interfaceId: UUID, capturedAt: Timestamp, pendingCount: Integer, failedCount: Integer, retryAttempts: Integer, successCount: Integer, oldestPendingAgeSeconds: Integer) returns String;` | service (unbound) |
| triggerSimulation | action | `action triggerSimulation(scenario: String, interfaceId: UUID) returns String;` | service (unbound) |
| configureThresholds | action | `action configureThresholds(interfaceId: UUID, maxRetryThreshold: Integer, queueGrowthLimit: Integer, oldMessageAgeLimitSeconds: Integer, recoveryStalledBacklog: Integer) returns Interfaces;` | service (unbound) |
| resetToCleanSeed | action | `action resetToCleanSeed() returns String;` | service (unbound) |

---

## 3. Endpoint Contracts

Base path (OData V4): `/odata/v4/MonitoringService/`

### 3.1 Read-only entity paths (GET only — all entities are `@readonly`)

| Path | Method | Request params | Response shape | Required role |
|---|---|---|---|---|
| `/Interfaces` | GET | OData query (`$filter`, `$select`, `$expand`, `$top`, `$skip`, `$orderby`) | Collection of `Interfaces` | any authenticated (SupportViewer+) |
| `/Interfaces({ID})` | GET | key `ID` (UUID) | Single `Interfaces` | any authenticated |
| `/QueueSnapshots` | GET | OData query | Collection of `QueueSnapshots` | any authenticated |
| `/QueueSnapshots({ID})` | GET | key `ID` | Single `QueueSnapshots` | any authenticated |
| `/Alerts` | GET | OData query | Collection of `Alerts` | any authenticated |
| `/Alerts({ID})` | GET | key `ID` | Single `Alerts` | any authenticated |
| `/RunbookEntries` | GET | OData query | Collection of `RunbookEntries` | any authenticated |
| `/RunbookEntries({ID})` | GET | key `ID` | Single `RunbookEntries` | any authenticated |
| `/Systems` | GET | OData query | Collection of `Systems` | any authenticated |
| `/Systems({ID})` | GET | key `ID` | Single `Systems` | any authenticated |
| `/Connections` | GET | OData query | Collection of `Connections` | any authenticated |
| `/Connections({ID})` | GET | key `ID` | Single `Connections` | any authenticated |

Notes: Entity sets are `@readonly` — POST/PUT/PATCH/DELETE are rejected at the CDS level (verified by test "Security Fix: Direct entity insertion on Alerts is rejected"). Writes occur only via the bound actions below.

### 3.2 Bound actions on `Alerts`

| Path | Method | Body params | Response | Required role | Handler line |
|---|---|---|---|---|---|
| `/Alerts({ID})/acknowledge` | POST | `{ acknowledgedBy: String }` | Updated `Alerts` entity | `SupportOperator` (via `@(restrict)` grant) | srv/monitoring-service.js:21 |
| `/Alerts({ID})/resolveAlert` | POST | `{ resolvedBy: String }` | Updated `Alerts` entity | `SupportOperator` (via `@(restrict)` grant) | srv/monitoring-service.js:48 |
| `/Alerts({ID})/explain` | POST | (none) | `LargeString` (JSON explanation) | authenticated-user (no explicit restrict) | srv/monitoring-service.js:75 |
| `/Alerts({ID})/exportIncidentReport` | POST | `{ format: String }` ("markdown\|json") | `LargeString` (report) | authenticated-user (no explicit restrict) | srv/monitoring-service.js:93 |

### 3.3 Unbound service actions

| Path | Method | Body params | Response | Required role | Handler line |
|---|---|---|---|---|---|
| `/ingestTelemetry` | POST | `{ interfaceId: UUID, capturedAt: Timestamp, pendingCount, failedCount, retryAttempts, successCount, oldestPendingAgeSeconds: Integer }` | `String` (JSON result) | `SimulatorAdmin` OR `SupportOperator` | srv/monitoring-service.js:163 |
| `/triggerSimulation` | POST | `{ scenario: String, interfaceId: UUID }` | `String` (result message) | `SimulatorAdmin` OR `SupportOperator` | srv/monitoring-service.js:235 |
| `/configureThresholds` | POST | `{ interfaceId: UUID, maxRetryThreshold, queueGrowthLimit, oldMessageAgeLimitSeconds, recoveryStalledBacklog: Integer }` | `Interfaces` entity | `SimulatorAdmin` | srv/monitoring-service.js:273 |
| `/resetToCleanSeed` | POST | (none) | `String` (confirmation) | `SimulatorAdmin` | srv/monitoring-service.js:309 |

### 3.4 Unbound service function

| Path | Method | Request params | Response | Required role | Handler line |
|---|---|---|---|---|---|
| `/getTopology` | GET | (none) | `LargeString` (JSON topology graph) | authenticated-user | srv/monitoring-service.js:136 |

### 3.5 Handler implementation summary (srv/monitoring-service.js)

| Line range | Operation | Key behaviors |
|---|---|---|
| 21–45 | `acknowledge` | Rejects 400 invalid ID; 404 not found; 409 if not `Open`; sets status `Acknowledged`, `acknowledgedAt`, `acknowledgedBy`; returns updated alert |
| 48–72 | `resolveAlert` | Rejects 400/404; 409 if already `Resolved`/`Closed`; sets status `Resolved`, `resolvedAt`, `resolvedBy` |
| 75–90 | `explain` | Loads alert + runbook match by `ruleCode`; calls `generateGroundedExplanation`; persists `aiExplanation`; returns JSON string |
| 93–133 | `exportIncidentReport` | Loads alert + interface + runbook; format `json` returns structured JSON payload; default Markdown via `generateMarkdownReport` |
| 136–160 | `getTopology` | Selects Systems/Connections/Interfaces; latest snapshot per interface; active alerts (not Resolved/Closed); builds graph via `buildTopologyGraph`; returns JSON string |
| 163–232 | `ingestTelemetry` | Validates UUID interfaceId + active interface; bounds-checks 6 integer fields; validates ISO-8601 timestamp (±5 min future, ≤7 days past); persists snapshot; runs `processSnapshotAndEvaluate`; returns JSON result |
| 235–270 | `triggerSimulation` | Allowlist-scenario validation; resolves interface (default active); generates snapshot via simulator; runs evaluation pipeline; returns `result.message` |
| 273–306 | `configureThresholds` | Validates UUID + 5 threshold fields with bounds; UPDATEs interface; returns updated interface |
| 309–339 | `resetToCleanSeed` | Deletes all Alerts + QueueSnapshots; resets interface thresholds to defaults; re-seeds baseline snapshots (pending 8, failed 0, retry 1, success 140, age 15); returns confirmation string |

---

## 4. Authorization Model

### 4.1 Roles

| Role | Intended capabilities |
|---|---|
| `SupportViewer` | Read-only access to all entities; can export incident reports |
| `SupportOperator` | All viewer rights + acknowledge/resolve alerts, trigger simulations, ingest telemetry |
| `SimulatorAdmin` | All operator rights + configure thresholds, reset database to clean seed |

### 4.2 Mocked users (package.json:19–41)

| User | Roles |
|---|---|
| `alice` | `SupportViewer` |
| `bob` | `SupportOperator`, `SupportViewer` |
| `admin` | `SimulatorAdmin`, `SupportOperator`, `SupportViewer` |

### 4.3 Auth configuration

- **Development / test:** `requires.auth.kind = "mocked"` (package.json:21). Users and roles are statically defined. `cds.User({id, roles})` is constructed directly in tests.
- **Production (`[production]`):** `requires.auth.kind = "xsuaa"` (package.json:44). Real SAP Identity Authentication / XSUAA integration; mocked users do not apply.

### 4.4 Service-level and element-level restrictions

- Service: `@(requires: 'authenticated-user')` (monitoring-service.cds:3) — every endpoint requires an authenticated user; anonymous requests return 401 (verified by tests T7 across multiple suites).
- Function `getTopology`: `@(requires: 'authenticated-user')` (line 33).
- Action `ingestTelemetry`: `@(requires: ['SimulatorAdmin', 'SupportOperator'])` (line 37).
- Action `triggerSimulation`: `@(requires: ['SimulatorAdmin', 'SupportOperator'])` (line 49).
- Action `configureThresholds`: `@(requires: 'SimulatorAdmin')` (line 53).
- Action `resetToCleanSeed`: `@(requires: 'SimulatorAdmin')` (line 63).
- Action `acknowledge`: `@(restrict: [{ grant: 'acknowledge', to: 'SupportOperator' }])` (line 12).
- Action `resolveAlert`: `@(restrict: [{ grant: 'resolveAlert', to: 'SupportOperator' }])` (line 15).
- Actions `explain` and `exportIncidentReport`: no explicit `@(restrict)` — rely on service-level `authenticated-user` only (any authenticated role, including `SupportViewer`, can invoke).
- All entities projected `@readonly` — direct INSERT/UPDATE/DELETE on entities is rejected (403/405); writes only via actions.

### 4.5 Authorization enforcement verified by tests

- Anonymous access → 401 Unauthorized (multiple suites).
- `alice` (SupportViewer) cannot `triggerSimulation` → 403.
- `alice` cannot `resolveAlert` → 403.
- `alice` cannot `configureThresholds` → 403.
- `bob` (SupportOperator) cannot `resetToCleanSeed` → 403.
- `admin` (SimulatorAdmin) can `resetToCleanSeed`, `configureThresholds`.
- Direct entity insertion on `Alerts` rejected (@readonly).

### 4.6 Mocked vs production gap

Mocked auth is file-based and static; production xsuaa requires real identity provider configuration (`xs-security.json` exists at repo root but is not wired into `package.json` production requires beyond kind switch). Role grants in CDS (`@(restrict)`) are enforced by CAP's authorization middleware in both modes, but production user-to-role mapping depends on xsuaa role collections not present in this repo.

---

## 5. Missing Backend Functionality — Gap Analysis

The following capabilities were identified in discovery as absent from the current backend:

| # | Missing capability | Impact | Notes |
|---|---|---|---|
| 1 | Real-time streaming / push (SSE, WebSocket, OData change feed) | Clients must poll for new alerts/snapshots | No eventing or outbound push channel in service |
| 2 | KPI aggregation endpoint | No aggregated metrics (MTTR, alert volume by rule/severity, queue health trends) | Only raw entity reads + per-snapshot ingestion |
| 3 | Alert assignment / ownership | No assignee field on Alerts; no assignment action | Alerts track acknowledgedBy/resolvedBy but no assignable owner |
| 4 | Audit log / change history | No immutable record of who changed what and when | Status transitions update timestamps but no separate audit table |
| 5 | Health endpoint (`/health`) | No liveness/readiness probe for orchestration | `getTopology` doubles as health-ish but is not a health endpoint |
| 6 | Scheduled/automated ingestion | Telemetry must be pushed externally; no internal poller | `ingestTelemetry` is on-demand only |
| 7 | Alert escalation / notification | No email, webhook, or incident-ticket integration | No outbound notification adapter |
| 8 | Soft delete / archive for resolved alerts | Resolved/Closed alerts remain in same table | No archive partition or retention policy |
| 9 | OData batch / change tracking | No `$batch` support or delta tokens | Standard CRUD+actions only |

These gaps are documented as known limitations; none were implemented in this stage (read-only inspection mandate).

---

## 6. Existing Implementation Risks

| Risk | Location | Severity | Description |
|---|---|---|---|
| R1 | `srv/monitoring-service.js:31` | Medium | `acknowledge`/`resolveAlert` use `req.params[0]?.ID \|\| req.params[0]` — key extraction tolerant of malformed param shapes; relies on caller passing `ID` |
| R2 | `srv/monitoring-service.js:106` | Low | `exportIncidentReport` JSON mode parses `observedMetrics`/`aiExplanation` with try/catch fallback to raw; malformed JSON silently degrades rather than errors |
| R3 | `srv/monitoring-service.js:252–253` | Low | `triggerSimulation` fallback `SELECT.one.where({active:true}) \|\| SELECT.one.from(Interfaces)` — second SELECT returns undefined if empty; `||` chain may yield `undefined`, then `targetInterface.ID` throws (guarded by null check at 256) |
| R4 | `srv/monitoring-service.js:311–312` | Medium | `resetToCleanSeed` issues unfiltered `DELETE.from(Alerts)` and `DELETE.from(QueueSnapshots)` — irreversible bulk delete, admin-only but no soft-delete or confirmation |
| R5 | `srv/monitoring-service.js:136–160` | Low | `getTopology` loads all snapshots then dedups in JS (`seenIface` set) rather than SQL `GROUP BY`/window; O(n) memory on snapshot table growth |
| R6 | `package.json:43–47` | Medium | Production auth is xsuaa but no role-collection / xsuaa config mapped to CDS roles; production deployment requires xsuaa binding not present in repo |
| R7 | `srv/monitoring-service.cds:18,34,37–64` | Low | `explain` and `exportIncidentReport` lack `@(restrict)` — any authenticated user (incl. SupportViewer) can invoke, broader than operator-only intent for some actions |
| R8 | `srv/core/ingestionPipeline.js:87–91` | Low | Predecessor snapshot query relies on `snapshotData.ID` being present for self-exclusion; newly built snapshot objects lack `ID` until persisted, so `ID: { '!=': undefined }` may not exclude correctly in all CDS dialects |

---

## 7. Proposed File Ownership Table

| File / directory | Owner (agent) | Responsibility |
|---|---|---|
| `srv/monitoring-service.cds` | AGENT 1 — Backend & OData | CDS service model, action/function signatures, authorization annotations |
| `srv/monitoring-service.js` | AGENT 1 — Backend & OData | Action handlers, request validation, response shaping |
| `db/schema.cds` | AGENT 1 — Backend & OData | Database entity definitions, associations, compositions |
| `srv/core/detectionEngine.js` | AGENT 2 — Detection Engine (DO NOT MODIFY per Stage B restrictions) | Deterministic detection rules (Rules A–D) |
| `srv/core/ingestionPipeline.js` | AGENT 1 — Backend & OData | Telemetry ingestion validation + evaluation pipeline orchestration |
| `srv/core/simulator.js` | AGENT 1 — Backend & OData | Scenario snapshot generator + allowed scenarios allowlist |
| `srv/core/topologyService.js` | AGENT 1 — Backend & OData | Topology graph builder used by `getTopology` |
| `srv/core/reportGenerator.js` | AGENT 1 — Backend & OData | Markdown incident report generation |
| `srv/ai/explanationService.js` | AGENT 1 — Backend & OData | Grounded AI explanation generation (deterministic + live) |
| `test/*.test.js` | AGENT 1 — Backend & OData | Backend test suites (85 tests, 11 suites) |
| `app/*` | Frontend agents (DO NOT MODIFY per Stage B restrictions) | UI components — out of scope for this agent |
| `PHASE5_BACKEND_AUDIT.md` | AGENT 1 — Backend & OData | This audit document |
| `xs-security.json` | AGENT 1 — Backend & OData | XSUAA security configuration (production auth) |



