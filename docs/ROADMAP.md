# 🗺️ Retry Storm Sentinel — Project Roadmap & Delivery Plan

> **Tracking against:** [Retry_Storm_Sentinel_Master_Project_Document.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/Retry_Storm_Sentinel_Master_Project_Document.md)  
> **Target Timeline:** 4–6 Weeks (Beginner-friendly MVP & Iterative Refinement)  
> **Status:** **M0–M5 Complete** | **M4/M6 Hardening in Progress** | **M7 Scheduled**

---

## 1. Executive Roadmap Summary

| Milestone | Focus Area | Status | Target Completion | Current Artifacts |
|---|---|:---:|:---:|---|
| **M0** | Environment, Tooling & CAP Setup | ✅ Done | Week 1 | `package.json`, `@sap/cds`, `@cap-js/sqlite` |
| **M1** | Domain Data Model & Seed Data | ✅ Done | Week 1 | [db/schema.cds](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/db/schema.cds), [db/data/](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/db/data/) |
| **M2** | OData V4 Service & Business Actions | ✅ Done | Week 2 | [srv/monitoring-service.cds](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/monitoring-service.cds), [srv/monitoring-service.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/monitoring-service.js) |
| **M3** | Synthetic Scenario Simulator | ✅ Done | Week 2 | [srv/core/simulator.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/core/simulator.js) |
| **M4** | Deterministic Detection Rules | 🔄 Refinement | Week 3 | [srv/core/detectionEngine.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/core/detectionEngine.js) *(Add Rule D & Cooldown)* |
| **M5** | Operational Dashboard UI | ✅ Done | Week 3 | [app/index.html](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/index.html) |
| **M6** | Advisory AI & Runbook Citations | 🔄 Refinement | Week 4 | [srv/ai/explanationService.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/ai/explanationService.js) *(Add LLM connector)* |
| **M7** | Automated Testing, Verification & Polish | ⏳ Next | Week 5 | `test/` suite, docs hub, demo recording |

---

## 2. Milestone Deep-Dive

### Milestone 0: Environment, Tooling & CAP Initialization
- **Objective**: Establish reliable CAP runtime, dependencies, and configuration.
- **Tasks Completed**:
  - [x] Node.js runtime and `@sap/cds` v9 verified.
  - [x] Local SQLite database adapter `@cap-js/sqlite` configured.
  - [x] `package.json` created with clean dev scripts (`cds-serve`, `cds watch`).
  - [x] Local `.gitignore` configured to keep SQLite files and credentials untracked.
- **Acceptance Criteria**:
  - `cds watch` starts without dependency resolution errors.

---

### Milestone 1: Domain Data Model & Seed Catalog
- **Objective**: Define core CDS entities for interfaces, snapshots, alerts, and runbooks.
- **Tasks Completed**:
  - [x] Created [db/schema.cds](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/db/schema.cds) with `Interfaces`, `QueueSnapshots`, `Alerts`, and `RunbookEntries`.
  - [x] Adopted SAP standard aspect `cuid` (UUID primary keys) and `managed` (audit timestamps).
  - [x] Seeded standard integration interfaces in [db/data/sap.retrysentinel-Interfaces.csv](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/db/data/sap.retrysentinel-Interfaces.csv).
  - [x] Seeded curated runbook catalog entries in [db/data/sap.retrysentinel-RunbookEntries.csv](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/db/data/sap.retrysentinel-RunbookEntries.csv).
- **Acceptance Criteria**:
  - `npx cds deploy --to sqlite:sentinel.db` runs cleanly and loads initial CSV data without primary key collisions.

---

### Milestone 2: OData V4 Service Layer & Actions
- **Objective**: Expose data model via RESTful OData V4 endpoints and implement business logic handlers.
- **Tasks Completed**:
  - [x] Defined [srv/monitoring-service.cds](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/monitoring-service.cds) with entity projections.
  - [x] Added custom action `acknowledge` to entity `Alerts` with audit logging.
  - [x] Added custom action `explain` to generate incident recommendations.
  - [x] Added unbound action `triggerSimulation` for controlled end-to-end testing.
- **Acceptance Criteria**:
  - `GET /odata/v4/monitoring/Interfaces` and `GET /odata/v4/monitoring/Alerts` return valid OData JSON payloads.

---

### Milestone 3: Synthetic Scenario Simulator
- **Objective**: Provide repeatable, deterministic test data representing distinct operational states without requiring live SAP backend connectivity.
- **Tasks Completed**:
  - [x] Implemented [srv/core/simulator.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/core/simulator.js).
  - [x] Defined 5 canonical operational scenario profiles:
    - `NORMAL`: Healthy throughput, low retries (1), minimal queue (8).
    - `RETRY_STORM`: High failure count (190), severe retry spikes (320), high pending count (450).
    - `QUEUE_GROWTH`: Elevated queue accumulation (260), moderate retries (35).
    - `PERSISTENT_BACKLOG`: Low throughput, long-stalled message age (1500s).
    - `RECOVERY`: Downstream restoration, high processing rate (280), rapid queue drainage (18).
- **Acceptance Criteria**:
  - Triggering any scenario yields identical, repeatable metric snapshots for reliable testing.

---

### Milestone 4: Deterministic Detection Rules (In Progress / Refinement)
- **Objective**: Evaluate metric snapshots against explicit threshold rules and persist alerts.
- **Tasks Completed**:
  - [x] Implemented [srv/core/detectionEngine.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/core/detectionEngine.js).
  - [x] Rule A (`EXCESSIVE_RETRIES`): Triggers when `retryAttempts >= 100` (Critical).
  - [x] Rule B (`QUEUE_GROWTH`): Triggers when `pendingCount >= 200` (High).
  - [x] Rule C (`OLD_MESSAGE_AGE`): Triggers when `oldestPendingAgeSeconds >= 600` (High).
- **Planned Enhancements**:
  - [ ] **Rule D (`RECOVERY_STALLED`)**: Detect when a system enters recovery but queue fails to drain within expected rate.
  - [ ] **Alert Deduplication & Cooldown**: Prevent duplicate open alerts for the same interface and rule when poller executes repeatedly.
  - [ ] **Composite Multi-Condition Severity**: Upgrade severity to `Critical` when both high retries and queue growth occur simultaneously.

---

### Milestone 5: Operational Dashboard UI
- **Objective**: Deliver a clean, usable operator dashboard to monitor alerts and drive simulation scenarios.
- **Tasks Completed**:
  - [x] Built responsive, dark-mode dashboard in [app/index.html](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/index.html).
  - [x] Scenario trigger action bar (`Normal`, `Storm`, `Queue Growth`, `Recovery`).
  - [x] Monitored integration cards showing real-time interface health.
  - [x] Real-time alerts table with severity badges and timestamp formatting.
  - [x] Operator acknowledgement button with live state update.
  - [x] AI Explanation interactive modal.
- **Acceptance Criteria**:
  - An operator can run a complete 10-minute demo directly from the browser without database manipulation.

---

### Milestone 6: Grounded AI Advisory Layer (In Progress / Refinement)
- **Objective**: Provide explainable advisory guidance based strictly on verified metrics and curated runbooks.
- **Tasks Completed**:
  - [x] Implemented grounded rule-to-runbook matcher in [srv/ai/explanationService.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/ai/explanationService.js).
  - [x] Structured output into: `summary`, `observedFacts`, `possibleHypotheses`, `recommendedChecks`, `citedRunbookIds`, and `limitations`.
- **Planned Enhancements**:
  - [ ] Optional LLM Provider client (Google Gemini API / SAP GenAI Hub / Local Ollama) using the prompt template defined in Section 14 of the master document.
  - [ ] Robust fallback mode: If API keys are missing or provider times out, seamlessly return the deterministic grounded explanation.

---

### Milestone 7: Automated Testing, Documentation & Demo Polish (Upcoming)
- **Objective**: Package the application with automated regression tests, architectural artifacts, and reproducible demo scripts.
- **Planned Deliverables**:
  - [ ] Unit & integration tests in `test/` using `@sap/cds/test` and Jest/Mocha.
  - [ ] Automated verification of scenarios T1 through T8.
  - [ ] Step-by-step 10-minute script guide for technical presentations.
  - [ ] Demo video recording or animated walkthrough.

---

## 3. Post-MVP & Future Enhancements (Phase 2 Backlog)

| Feature | Description | Priority | Complexity |
|---|---|:---:|:---:|
| **Rule D & Cooldown** | Implement recovery stall detection and time-window deduplication | P1 | Low |
| **Automated Test Suite** | Full CAP test suite for all simulator and detection scenarios | P1 | Medium |
| **Live LLM Integration** | Optional provider connection with fallback to grounded template | P1 | Medium |
| **CSV Metric Ingestion** | Upload anonymized queue snapshots from external enterprise monitoring | P2 | Medium |
| **Trend Visualizations** | Chart.js / SAP UI5 charts showing queue trends over time | P2 | Medium |
| **Multi-Interface Correlation** | Detect cascading retry storms propagating across dependent interfaces | P2 | High |
| **SAP HANA Cloud Migration** | Switch from local SQLite to SAP HANA Cloud for deployment on SAP BTP | P2 | Medium |
| **SAP Integration Suite Connector**| Real-time adapter to pull message metrics from SAP Cloud Integration OData APIs | P3 | High |
