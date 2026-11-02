# 📚 Retry Storm Sentinel — Documentation Hub

Welcome to the documentation suite for **Retry Storm Sentinel**, an integration retry monitoring and resilience advisory platform built with SAP Cloud Application Programming Model (CAP), OData V4, LangChain.js, and LangSmith.

---

## 📑 Documentation Index

### 🏛️ Core Architecture & Roadmap
| Document | Purpose | Key Contents |
|---|---|---|
| **[ARCHITECTURE.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/ARCHITECTURE.md)** | System Design & Topology | High-level architecture, C4 diagrams, ERD, sequence flows, tech stack, and ADRs. |
| **[ROADMAP.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/ROADMAP.md)** | Delivery Milestones & Progress | Phase-by-phase implementation plan (M0–M7), milestones, and post-MVP features. |
| **[CURRENT_STATUS_ANALYSIS.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/CURRENT_STATUS_ANALYSIS.md)** | Codebase Audit & Gap Analysis | Detailed audit of baseline capabilities, verification, and technical health. |
| **[DETECTION_RULES_AND_RUNBOOK.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/DETECTION_RULES_AND_RUNBOOK.md)** | Rules & Runbook Specifications | SLA rule engine math (A, B, C, D), curated runbook catalog, and guardrails. |
| **[SECURITY_GUARDIAN_AUDIT_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/SECURITY_GUARDIAN_AUDIT_REPORT.md)** | Security Guardian Audit | STRIDE threat modeling, authorization audit, injection defense, and OWASP review. |
| **[Master Project Document](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/Retry_Storm_Sentinel_Master_Project_Document.md)** | Specification & Requirements | Master specification covering background, problem statement, risk mitigations, and user personas. |

### 🤖 AI, LangChain & LangSmith Observability (`docs/langchain/`)
| Document | Purpose | Key Contents |
|---|---|---|
| **[LANGCHAIN_LANGSMITH_INTEGRATION.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/langchain/LANGCHAIN_LANGSMITH_INTEGRATION.md)** | Integration Architecture Spec | Stage 0 architecture, 5 read-only investigation tools, multi-turn agent, and security boundaries. |
| **[LANGCHAIN_LANGSMITH_FINAL_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/langchain/LANGCHAIN_LANGSMITH_FINAL_REPORT.md)** | Delivery & Test Verification Report | Test matrix, failure isolation results, schema validation, and benchmark metrics. |
| **[PHASE_B1_LIVE_VERIFICATION_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/langchain/PHASE_B1_LIVE_VERIFICATION_REPORT.md)** | Phase B.1 Staging Verification | Staging validation of LangSmith connectivity, Gemini, and OpenRouter failover. |
| **[PHASE_B2_VERIFICATION_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/langchain/PHASE_B2_VERIFICATION_REPORT.md)** | Phase B.2 Live Verification Fixes | Resolution of 429 quota handling, schema alignment, investigation deadlines, and live tool invocation. |

### 🎨 Phase 5: UI, Topology & Incident Operations (`docs/phase5/`)
| Document | Purpose | Key Contents |
|---|---|---|
| **[PHASE5_FINAL_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/phase5/PHASE5_FINAL_REPORT.md)** | Phase 5 Orchestrator Report | Summary of responsive UI, visual topology graph, incident operations, and test matrix. |
| **[PHASE5_AGENT_OWNERSHIP.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/phase5/PHASE5_AGENT_OWNERSHIP.md)** | Workstream Division | Ownership mapping across backend, UI foundation, KPIs, topology, operations, and QA. |
| **[PHASE5_BACKEND_AUDIT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/phase5/PHASE5_BACKEND_AUDIT.md)** | OData V4 Surface Audit | Authorization matrix, entity schemas, state machines, and API contracts. |
| **[PHASE5_DASHBOARD_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/phase5/PHASE5_DASHBOARD_REPORT.md)** | Dashboard KPIs & Inventory | KPI card engine, responsive grid, sortable/filterable interface tables. |
| **[PHASE5_TOPOLOGY_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/phase5/PHASE5_TOPOLOGY_REPORT.md)** | Interactive Landscape Graph | Dynamic health propagation (Critical/Warning/Healthy), node filtering, and SVG visualization. |
| **[PHASE5_INCIDENT_OPERATIONS_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/phase5/PHASE5_INCIDENT_OPERATIONS_REPORT.md)** | Incident Operations & SOPs | Alert lifecycle (Open → Acknowledged → Resolved), timeline, and report export. |
| **[PHASE5_QA_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/phase5/PHASE5_QA_REPORT.md)** | Comprehensive QA Test Suite | 59 test cases covering edge cases, responsive layout, permissions, and synthetic scale. |

### 🔍 Quality, Evaluation & Test Reports (`docs/reports/`)
| Document | Purpose | Key Contents |
|---|---|---|
| **[DETECTION_QUALITY_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/reports/DETECTION_QUALITY_REPORT.md)** | Rule Precision & Recall | Evaluation of Rules A, B, C, D across clean baseline, edge cases, and synthetic datasets. |
| **[RAG_EVALUATION_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/reports/RAG_EVALUATION_REPORT.md)** | RAG Retrieval & Grounding Eval | 49 assertions testing keyword retrieval, citation preservation, and prompt injection defense. |
| **[BROWSER_TEST_REPORT.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/reports/BROWSER_TEST_REPORT.md)** | Playwright E2E UI Test Report | Cross-browser verification, responsive viewport checks, and DOM interaction testing. |

### 🛠️ Integration & Operations Guides
| Document | Purpose | Key Contents |
|---|---|---|
| **[SAP_CPI_INTEGRATION_GUIDE.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/SAP_CPI_INTEGRATION_GUIDE.md)** | SAP CPI Setup Guide | Groovy scripts, exception subprocesses, and CPI telemetry push configurations. |
| **[SAP_BAS_SETUP.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/SAP_BAS_SETUP.md)** | SAP Business Application Studio | Dev environment setup, CDS CLI configuration, and local launch procedures. |
| **[TELEMETRY_ADAPTER_DESIGN.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/docs/design/TELEMETRY_ADAPTER_DESIGN.md)** | Telemetry Adapter Design | Schema specification, transformation rules, and clock-skew bounds for external payloads. |

---

## ⚡ Quick References

- **Project Root README:** [README.md](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/README.md)
- **Data Model:** [db/schema.cds](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/db/schema.cds)
- **OData Service:** [srv/monitoring-service.cds](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/monitoring-service.cds)
- **Detection Rules:** [srv/core/detectionEngine.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/core/detectionEngine.js)
- **AI Agent:** [srv/ai/langchain/incidentAgent.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/ai/langchain/incidentAgent.js)
- **LangSmith Tracing:** [srv/ai/observability/langsmithTracing.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/ai/observability/langsmithTracing.js)
- **Web Dashboard:** [app/index.html](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/index.html)
