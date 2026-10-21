# 🛡️ Retry Storm Sentinel

> **A real-time integration monitoring prototype for SAP Cloud Application Programming Model (CAP)**  
> Detects repeated integration failures, retry storms, and queue growth backlogs with deterministic rules and grounded AI explanations.

---

## 🏗️ Architecture & Directory Layout

```
Restorm/
├── app/                          # Frontend Presentation Layer
│   └── index.html                # Operational monitoring dashboard & simulator UI
├── db/                           # Persistence & Domain Model
│   ├── schema.cds                # CDS Entity Definitions (Interfaces, Snapshots, Alerts, Runbooks)
│   └── data/                     # Seed CSV Files (Loaded automatically on deploy)
├── srv/                          # Application Services & Business Logic
│   ├── monitoring-service.cds    # OData V4 Service definition
│   ├── monitoring-service.js     # Thin API controller
│   ├── core/                     # Pure Business Domain Logic
│   │   ├── detectionEngine.js    # Deterministic rule evaluator & thresholds
│   │   └── simulator.js          # Synthetic scenario generator (Normal, Storm, Backlog, Recovery)
│   └── ai/                       # Advisory Intelligence Layer
│       └── explanationService.js # Grounded runbook explanation generator
├── docs/                         # Project Documentation Suite
│   ├── README.md                 # Documentation Index & Hub
│   ├── ARCHITECTURE.md           # System Architecture & Diagrams (C4/Mermaid/ERD)
│   ├── ROADMAP.md                # Milestone Plan & Delivery Status (M0-M7)
│   ├── CURRENT_STATUS_ANALYSIS.md# In-depth Gap Analysis & Implementation Audit
│   ├── DETECTION_RULES_AND_RUNBOOK.md # Thresholds, Rules & Curated Runbook SOPs
│   └── Retry_Storm_Sentinel_Master_Project_Document.md # Master project blueprint
├── sentinel.db                   # Local SQLite Database (gitignored)
├── package.json                  # Dependencies & scripts
└── .gitignore                    # Secrets, node_modules, and DB exclusions
```

---

## 📚 Detailed Documentation
Comprehensive specifications and project analyses are available in the [`docs/`](docs/README.md) directory:
- 🏛️ **[System Architecture](docs/ARCHITECTURE.md)**: Deep dive into the CAP service, C4/Mermaid diagrams, and ERD.
- 🗺️ **[Development Roadmap](docs/ROADMAP.md)**: Milestone tracking (M0–M7) and Phase 2 backlog.
- 📊 **[Current Status & Gap Analysis](docs/CURRENT_STATUS_ANALYSIS.md)**: Detailed audit of what is implemented vs pending.
- 📏 **[Detection Rules & Runbooks](docs/DETECTION_RULES_AND_RUNBOOK.md)**: Deterministic thresholds, SOPs, and AI guardrails.

---

## 🚀 Quickstart Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Deploy Local Database
```bash
npx cds deploy --to sqlite:sentinel.db
```

### 3. Start Development Server
```bash
npx cds watch
```

- **Dashboard UI**: [http://localhost:4004/](http://localhost:4004/)
- **OData Service Root**: [http://localhost:4004/odata/v4/monitoring](http://localhost:4004/odata/v4/monitoring)

---

## ⚡ Testing Scenarios via UI
1. Open the dashboard at `http://localhost:4004/`.
2. Click **🚨 Trigger Retry Storm** to simulate downstream endpoint outage with growing retry backlog.
3. Observe the **Critical Alert** appearing under Real-time Alerts.
4. Click **Acknowledge** to verify operator audit lifecycle.
5. Click **🔄 Simulate Recovery** to test traffic drain and baseline return.
