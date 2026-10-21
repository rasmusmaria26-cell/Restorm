# 🛡️ Retry Storm Sentinel

> **Enterprise Integration Monitoring & Retry Storm Mitigation Platform for SAP CAP**  
> Proactively detects cascading retry storms, queue backpressure, and stalled message recovery across enterprise integration landscapes with deterministic SLA rule engines, interactive visual topology maps, and audit-ready postmortem incident reports.

[![CAP](https://img.shields.io/badge/SAP%20CAP-Node.js%2024%20%2F%20CDS-0a84ff.svg)](https://cap.cloud.sap/)
[![OData](https://img.shields.io/badge/OData-V4-2e8b6a.svg)](https://www.odata.org/)
[![Tests](https://img.shields.io/badge/Tests-59%20Passing-brightgreen.svg)](test/)
[![Security](https://img.shields.io/badge/Security-Audit--Guarded-blue.svg)](.agents/rules/retry-storm-security-guardian.md)

---

## 🏛️ System Architecture

```
                       [ External Systems / SAP CPI / Event Mesh ]
                                           │
                                           ▼ (POST ingestTelemetry)
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                              MonitoringService (OData V4)                              │
 │                                                                                        │
 │  ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────────────────────┐  │
 │  │  Ingestion Pipeline  │  │ Threshold Governance │  │  Topology Landscape Engine  │  │
 │  │ (Clock-skew, bounds, │  │ (Per-interface SLAs, │  │   (Dynamic health status,   │  │
 │  │  deduplication)      │  │  admin authorization)│  │    graph nodes & channels)  │  │
 │  └──────────┬───────────┘  └──────────┬───────────┘  └──────────────┬──────────────┘  │
 │             │                         │                             │                 │
 │             ▼                         ▼                             ▼                 │
 │  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
 │  │                     Deterministic Detection Rule Engine                          │  │
 │  │  • Rule A: Excessive Retries (Storm)     • Rule C: Stale Message SLA Exceeded    │  │
 │  │  • Rule B: Rapid Queue Backlog Growth    • Rule D: Stalled Recovery Backpressure │  │
 │  └────────────────────────┬─────────────────────────────────────────────────────────┘  │
 │                           │                                                            │
 │             ┌─────────────┴─────────────┐                                              │
 │             ▼                           ▼                                              │
 │  ┌─────────────────────┐  ┌───────────────────────────┐                                │
 │  │  Incident Exporter  │  │  AI Advisory Intelligence │                                │
 │  │ (Markdown & JSON    │  │  (Grounded Runbook SOPs,  │                                │
 │  │  Postmortem Audit)  │  │   Safe Fallback Offline)  │                                │
 │  └─────────────────────┘  └───────────────────────────┘                                │
 └─────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                     Persistence Layer (SQLite Local / SAP HANA Cloud)                  │
 │   • Interfaces    • QueueSnapshots    • Alerts    • Systems    • Connections    • Runbooks │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Capabilities (Delivered Phases 1–4)

### 📡 1. External Telemetry Ingestion (Phase 1)
- Validated REST/OData ingestion endpoint (`/odata/v4/monitoring/ingestTelemetry`) accepting real metrics from integration runtimes.
- Bounds validation: $[0, 1{,}000{,}000]$ integer ranges, age up to 30 days, clock-skew protection within $[-7\text{d}, +5\text{m}]$.
- Incident deduplication increments `repeatCount` rather than spamming duplicate open alerts.

### ⚙️ 2. Per-Interface Threshold Policies (Phase 2)
- Interface-specific SLA thresholds for high-volume vs critical channels (`maxRetryThreshold`, `queueGrowthLimit`, `oldMessageAgeLimitSeconds`, `recoveryStalledBacklog`).
- Governed via `configureThresholds` restricted strictly to `SimulatorAdmin`.
- Dynamic SVG queue sparklines with threshold limit guide markers.

### 📋 3. Incident Postmortem & Audit Reports (Phase 3)
- Export audit-ready incident reports (`exportIncidentReport`) in standardized Markdown or machine-readable JSON.
- Derives MTTR duration, peak metrics vs SLA variance, operator audit history (`acknowledgedBy`, `resolvedBy`), and grounded runbook citations.
- 1-click browser download directly from alert cards or the explanation drawer.

### 🗺️ 4. Integration Landscape Topology (Phase 4)
- Landscape modeling: `Systems` (Source, Target, Middleware, EventBroker) and `Connections` (CPI, Event Mesh).
- Dynamic graph endpoint (`getTopology`) synthesizing real-time health across systems and channels.
- Interactive SVG topology map with live backpressure indicators, animated critical storm paths, and 1-click incident filtering.

---

## 👥 Role-Based Security Matrix

| Role | User | Capabilities | Ingestion | Thresholds | Baseline Reset |
|---|---|---|:---:|:---:|:---:|
| **SupportViewer** | `alice` | View interfaces, alerts, topology, export reports | ❌ 403 | ❌ 403 | ❌ 403 |
| **SupportOperator** | `bob` | Acknowledge & resolve alerts, ingest telemetry, run simulations | ✅ 200 | ❌ 403 | ❌ 403 |
| **SimulatorAdmin** | `admin` | Full control, SLA policy configuration, database factory reset | ✅ 200 | ✅ 200 | ✅ 200 |

*Unauthenticated requests are strictly rejected with HTTP 401.*

---

## 🛠️ API Reference & cURL Examples

All requests use HTTP Basic Authentication (e.g. `bob:bob`, `admin:admin`, `alice:alice`).

### 1. Ingest Telemetry Metric Snapshot
```bash
curl -X POST http://localhost:4004/odata/v4/monitoring/ingestTelemetry \
  -u bob:bob \
  -H "Content-Type: application/json" \
  -d '{
    "interfaceId": "11111111-1111-1111-1111-111111111111",
    "capturedAt": "2026-10-21T13:30:00.000Z",
    "pendingCount": 350,
    "failedCount": 12,
    "retryAttempts": 185,
    "successCount": 420,
    "oldestPendingAgeSeconds": 750
  }'
```

### 2. Configure Interface SLA Thresholds (Admin only)
```bash
curl -X POST http://localhost:4004/odata/v4/monitoring/configureThresholds \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{
    "interfaceId": "11111111-1111-1111-1111-111111111111",
    "maxRetryThreshold": 80,
    "queueGrowthLimit": 150,
    "oldMessageAgeLimitSeconds": 300,
    "recoveryStalledBacklog": 80
  }'
```

### 3. Export Incident Postmortem Report (.md or JSON)
```bash
curl -X POST "http://localhost:4004/odata/v4/monitoring/Alerts(YOUR_ALERT_ID)/MonitoringService.exportIncidentReport" \
  -u alice:alice \
  -H "Content-Type: application/json" \
  -d '{"format": "markdown"}'
```

### 4. Fetch System Landscape Topology Graph
```bash
curl -X GET http://localhost:4004/odata/v4/monitoring/getTopology() \
  -u alice:alice
```

---

## 🧪 Testing & Verification

Run the comprehensive 59-test suite:
```bash
npm test
```

### Test Suites:
1. `test/detectionEngine.test.js` — Pure deterministic rule evaluation & edge cases
2. `test/explanationService.test.js` — AI runbook grounding, fallback robustness & sanitization
3. `test/ingestion.test.js` — External telemetry validation, clock-skew & deduplication
4. `test/monitoring-service.test.js` — OData authorization, incident lifecycle & audit trail
5. `test/reportExport.test.js` — Postmortem export formatting (Markdown & JSON)
6. `test/simulator.test.js` — Prototype safety, scenario generation & immutability
7. `test/thresholds.test.js` — Admin policy governance & dynamic sensitivity
8. `test/topology.test.js` — Landscape systems, connections & reactive health propagation

---

## 💻 Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Deploy database schema and seed data
npx cds deploy --to sqlite:sentinel.db

# 3. Start development server
npm start
```

Visit the calm control-room monitoring console at **[http://localhost:4004/](http://localhost:4004/)**.
