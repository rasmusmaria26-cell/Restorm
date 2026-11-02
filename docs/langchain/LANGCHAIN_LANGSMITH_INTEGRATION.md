# Restorm — LangChain.js & LangSmith Integration Guide

## 1. Executive Overview

This document details the architecture and operational usage of the **LangChain.js Orchestration Layer** and **LangSmith Observability Layer** integrated into **Restorm (Retry Storm Sentinel)**.

The integration was designed around enterprise safety, strict read-only access, non-blocking failure isolation, and zero disruption to the deterministic incident detection engine.

---

## 2. Architecture Comparison

### Before (Legacy Pipeline)
```
SAP Telemetry Ingestion -> Deterministic Detection Engine -> Alerts Entity
                                                                  |
                                                           [explainAlert Action]
                                                                  |
                                                                  v
                                                     explanationService.js
                                                     (Direct Gemini / OpenRouter / Fallback)
```

### After (Dual-Engine Architecture with LangSmith Observability)
```
SAP Telemetry Ingestion -> Deterministic Detection Engine -> Alerts Entity
                                                                  |
                                                           [explainAlert Action]
                                                                  |
                                                                  v
                                              +--------------------------------------+
                                              |       explanationService.js          |
                                              |  (Feature-Flag Orchestration Router) |
                                              +-------------------+------------------+
                                                                  |
                                     RESTORM_AI_ORCHESTRATION     |
                                              +-------------------+------------------+
                                              |                                      |
                                      ('legacy', Default)                     ('langchain')
                                              v                                      v
                                    +--------------------+                 +--------------------+
                                    | Legacy Pipeline    |                 | LangChain Agent    |
                                    | - Direct Gemini    |                 | - Bounded Loop     |
                                    | - Direct OpenRouter|                 | - 5 Read-Only Tools|
                                    | - Deterministic    |                 | - Schema Validator |
                                    +---------+----------+                 +---------+----------+
                                              |                                      |
                                              +-------------------+------------------+
                                                                  |
                                                                  v
                                              +--------------------------------------+
                                              |     LangSmith Observability Layer    |
                                              | - Opt-In Tracing (Disabled Default)  |
                                              | - Central Redaction (No PII / Keys)  |
                                              | - Non-Blocking Failure Isolation     |
                                              +--------------------------------------+
```

---

## 3. The 5 Read-Only Investigation Tools

All agent tools are defined in `srv/ai/langchain/agentTools.js` using `@langchain/core/tools` and strict `zod` schemas:

| Tool Name | Parameters | Purpose | Scope & Security |
| :--- | :--- | :--- | :--- |
| `get_interface_metrics` | `interfaceId` (string) | Fetches current pending, retry, failed, success counts, and age | Strictly scoped to authorized interface; never returns message bodies |
| `get_recent_snapshots` | `interfaceId` (string), `limit` (int, 1-20) | Retrieves bounded historical telemetry observations | Chronologically sorted; max 20 snapshots; zero interpolation |
| `get_active_incidents` | `interfaceId` (string) | Retrieves active open alerts for the interface | Max 10 incidents; read-only; scoped to authorized interface |
| `search_runbooks` | `query` (string), `ruleCode` (optional string) | Searches approved enterprise runbook catalog | Preserves exact `rb-xxx` IDs; treats runbooks as untrusted data |
| `get_threshold_policy` | `interfaceId` (string) | Retrieves effective sensitivity thresholds | Strictly read-only; no write or mutation capabilities |

*Security Guarantee:* No tools exist to acknowledge, resolve, change thresholds, reset the simulator, execute shell commands, or issue arbitrary SQL.

---

## 4. Agent Execution Bounds & Safety

Configured in `srv/ai/langchain/executionPolicy.js`:
- `MAX_TOOL_CALLS = 5`: Hard ceiling on tool invocations per investigation.
- `MAX_ITERATIONS = 4`: Prevents infinite agent reasoning loops.
- `TOOL_TIMEOUT_MS = 5000`: 5-second timeout on tool executions.
- `MODEL_TIMEOUT_MS = 15000`: 15-second timeout on model generation.
- `MAX_SNAPSHOTS_LIMIT = 20`: Bounded historical context.

### Prompt-Injection Defense
1. System prompt strictly directs the agent to treat telemetry and runbook text as **untrusted data**.
2. [validateModelOutput()](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/srv/ai/explanationService.js#L40) strips operational commands matching `/(drop queue|delete message|purge queue|truncate|rm -rf|force delete)/i`.
3. Unverified causes are labeled as hypotheses; the deterministic detection engine remains the sole authority for alert severity.

---

## 5. LangSmith Observability & Redaction

Configured in `srv/ai/observability/`:
- **Default Status:** Tracing is **disabled by default** (`RESTORM_LANGSMITH_ENABLED=false`).
- **Privacy Engine (`traceRedaction.js`):** Redacts API keys (`AIzaSy*`, `sk-*`, `lsv2_pt_*`), Bearer tokens, database connection URIs, customer payloads, and internal stack traces. Default trace mode is **metadata-only**.
- **Trace Boundaries:**
  1. `restorm.incident_explanation` (root chain)
  2. `restorm.runbook_retrieval` (retriever span)
  3. `restorm.model_generation` (LLM span)
  4. `restorm.tool_execution` (tool spans)
  5. `restorm.output_validation` (safety validator span)
  6. `restorm.deterministic_fallback` (offline fallback span)
- **Failure Isolation:** Any LangSmith network error or 401/403 response is captured silently in background handlers. LangSmith outages **never** break incident explanations.

---

## 6. Environment Configuration

Template entries added to `.env.example`:
```env
# AI orchestration mode: 'legacy' (default) or 'langchain'
RESTORM_AI_ORCHESTRATION=legacy

# LangSmith observability controls (disabled by default)
RESTORM_LANGSMITH_ENABLED=false
RESTORM_LANGSMITH_CAPTURE_CONTENT=false
RESTORM_LANGSMITH_EVAL_UPLOAD=false

# LangSmith official SDK environment variables
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=restorm-ai-development
LANGSMITH_ENDPOINT=
LANGSMITH_WORKSPACE_ID=
```

---

## 7. Verification & Evaluation Commands

```bash
# Run all unit tests (including 32 AI-specific tests)
npm test

# Run RAG reliability evaluations (49 checks)
node scripts/rag-eval.js

# Run 42-fixture comparative AI evaluation (legacy vs langchain)
node scripts/evaluate-ai.js

# Run CAP production build
npm run build
```
