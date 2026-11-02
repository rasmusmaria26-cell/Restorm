# LangChain.js & LangSmith Integration — Final Engineering Report

## A. Executive Summary

The integration of **LangChain.js** (AI Orchestration & Tool Calling) and **LangSmith** (LLM Observability & Evaluation) into Restorm has been completed and verified.

- **LangSmith Tracing:** Implemented with safe opt-in controls (`RESTORM_LANGSMITH_ENABLED=false` by default), metadata-only privacy filters, non-blocking failure isolation, and central secret redaction.
- **LangChain Incident Agent:** Implemented with 5 read-only Zod-validated investigation tools, strict cross-interface access scoping, execution boundaries (`MAX_TOOL_CALLS = 5`, `MAX_ITERATIONS = 4`), and seamless provider failover (Gemini -> OpenRouter -> Deterministic Fallback).
- **Feature Flag Rollout:** Controlled via `RESTORM_AI_ORCHESTRATION` (defaulting to `legacy`). The public explanation contract received by the frontend and OData endpoints remains 100% compatible.
- **Evaluation:** 42 synthetic incident fixtures tested across both modes with a 100% pass rate, zero safety violations, and zero hallucinated citations.

---

## B. Architecture

```
[Incoming Alert] 
       │
       ▼
[explanationService.js] ─────────────── Feature Flag: RESTORM_AI_ORCHESTRATION
       │                                        │
       ├────────────────────────────────────────┴───────────────────────┐
       ▼                                                                ▼
(Mode: 'legacy' - Default)                                    (Mode: 'langchain')
[Legacy Grounded Pipeline]                                    [LangChain Agent Loop]
  ├─ Direct Gemini API                                          ├─ Bounded ReAct Loop (max 4 iters)
  ├─ Direct OpenRouter API                                      ├─ 5 Read-Only Zod Tools
  └─ Deterministic Offline Fallback                             ├─ Candidate Provider Failover
                                                                └─ Schema & Safety Validator
       │                                                                │
       └────────────────────────────────┬───────────────────────────────┘
                                        │
                                        ▼
                   [LangSmith Observability Layer]
                     ├─ Metadata-Only Capture (Default)
                     ├─ Secret & Credential Redactor
                     ├─ Non-Blocking Failure Isolation
                     └─ 6 Standardized Trace Boundaries
```

---

## C. LangChain Implementation Details

1. **5 Read-Only Tools (`srv/ai/langchain/agentTools.js`):**
   - `get_interface_metrics`: Returns current pending, retry, failed counts, and health status for authorized interface.
   - `get_recent_snapshots`: Returns bounded (1-20) chronological historical telemetry observations.
   - `get_active_incidents`: Returns open alerts scoped to the interface.
   - `search_runbooks`: Queries approved enterprise runbook catalog; preserves exact `rb-xxx` IDs.
   - `get_threshold_policy`: Reads effective sensitivity thresholds; strictly read-only.
2. **Access Control:** `assertAuthorizedScope` blocks cross-tenant or unauthorized interface probing with an `[AccessDenied]` error.
3. **Execution Limits (`executionPolicy.js`):** `MAX_TOOL_CALLS = 5`, `MAX_ITERATIONS = 4`, `TOOL_TIMEOUT_MS = 5000`, `MODEL_TIMEOUT_MS = 15000`.
4. **Structured Output (`responseSchema.js`):** Enforces Zod schema matching Restorm's public contract (`summary`, `possibleHypotheses`, `recommendedChecks`, `citedRunbookIds`, `evidenceGaps`, `limitations`).

---

## D. LangSmith Implementation Details

1. **Opt-In Controls:** Tracing requires both `RESTORM_LANGSMITH_ENABLED=true` and a valid `LANGSMITH_API_KEY`. When disabled, zero network calls are made.
2. **Central Privacy Redaction (`traceRedaction.js`):**
   - Redacts Bearer/Basic headers, API keys (`AIzaSy*`, `sk-*`, `lsv2_pt_*`), passwords, connection strings, customer payloads, and internal stack traces.
   - Metadata allowlist restricts recorded properties to 19 approved telemetry attributes.
3. **Trace Boundaries:**
   - `restorm.incident_explanation`
   - `restorm.runbook_retrieval`
   - `restorm.model_generation`
   - `restorm.tool_execution`
   - `restorm.output_validation`
   - `restorm.deterministic_fallback`
4. **Failure Isolation:** Background promise handling ensures LangSmith timeouts or HTTP 403 errors never cause incident explanations to fail.

---

## E. Files Changed & Added

| File Path | Action | Description |
| :--- | :--- | :--- |
| `package.json` | Modified | Added `langsmith`, `@langchain/core`, `langchain`, `zod` dependencies |
| `.env.example` | Modified | Added placeholders for `RESTORM_AI_ORCHESTRATION` and LangSmith variables |
| `srv/ai/explanationService.js` | Modified | Added feature flag routing and LangSmith trace spans |
| `srv/ai/observability/traceRedaction.js` | Created | Central trace sanitizer and metadata allowlist engine |
| `srv/ai/observability/traceMetadata.js` | Created | Standardized metadata builders for trace spans |
| `srv/ai/observability/langsmithTracing.js` | Created | Safe LangSmith wrapper with failure isolation |
| `srv/ai/langchain/executionPolicy.js` | Created | Operational bounds, timeouts, and recursion limits |
| `srv/ai/langchain/responseSchema.js` | Created | Zod schema validating public explanation contract |
| `srv/ai/langchain/agentTools.js` | Created | 5 read-only tools with Zod validation and scope checks |
| `srv/ai/langchain/agentPrompts.js` | Created | System prompts with prompt-injection defense |
| `srv/ai/langchain/modelFactory.js` | Created | Model provider factory wrapping Gemini & OpenRouter |
| `srv/ai/langchain/incidentAgent.js` | Created | Controlled incident investigation agent loop |
| `srv/ai/evaluation/incidentDataset.js` | Created | 42 deterministic synthetic incident test fixtures |
| `srv/ai/evaluation/evaluationMetrics.js` | Created | Grounding, citation, and safety evaluation metrics |
| `scripts/evaluate-ai.js` | Created | CLI comparative evaluation runner |
| `test/ai/langsmith-tracing.test.js` | Created | Unit tests for tracing config and failure isolation |
| `test/ai/trace-redaction.test.js` | Created | Unit tests for PII and credential redaction |
| `test/ai/agent-tools.test.js` | Created | Unit tests for the 5 read-only tools and scoping |
| `test/ai/langchain-agent.test.js` | Created | Unit tests for agent loop, bounds, and fallback |
| `test/ai/prompt-injection.test.js` | Created | Unit tests for prompt injection and command safety |
| `test/ai/orchestration-compatibility.test.js` | Created | Unit tests for contract compatibility and feature flags |
| `LANGCHAIN_LANGSMITH_INTEGRATION.md` | Created | Architecture and operational guide |
| `LANGCHAIN_LANGSMITH_FINAL_REPORT.md` | Created | Final engineering report and evaluation matrix |

---

## F. Dependencies

```json
{
  "@langchain/core": "^1.3.2",
  "langchain": "^1.6.0",
  "langsmith": "^0.11.5",
  "zod": "^3.25.76"
}
```

---

## G. Configuration

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

## H. Test & Build Results

| Test Category | Command | Suites | Tests | Passed | Failed | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **All Automated Tests** | `npm test` | 61 | 323 | **323** | **0** | **100% PASS** |
| **AI Unit & Security Tests** | `node --test test/ai/*.test.js` | 6 | 32 | **32** | **0** | **100% PASS** |
| **RAG Reliability Evaluation** | `node scripts/rag-eval.js` | 1 | 49 | **49** | **0** | **100% PASS** |
| **Synthetic Comparative Evaluation** | `node scripts/evaluate-ai.js` | 2 | 84 | **84** | **0** | **100% PASS** |
| **CAP Production Build** | `npm run build` | — | — | — | — | **100% PASS** (5.6s) |

---

## I. Comparison: Legacy vs. LangChain Orchestration

| Dimension | Legacy Pipeline | LangChain Orchestrated Pipeline |
| :--- | :--- | :--- |
| **Context Assembly** | Static context injected into single prompt | Dynamic multi-turn investigation via 5 read-only tools |
| **Tool Calling** | None (single-shot prompt) | Bounded tool calling with Zod argument validation |
| **Scope Enforcement** | None | Cross-interface isolation enforced (`assertAuthorizedScope`) |
| **Trace Observability** | Traces root call and model generation | Traces root, retrieval, model, tools, and validation spans |
| **Public Contract** | Standard Restorm Explanation JSON | Identical Restorm Explanation JSON |
| **Offline Reliability** | 100% deterministic fallback | 100% deterministic fallback |
| **Average Latency (Offline)** | < 1ms | 4ms (includes tool initialization & loop bounds) |

---

## J. Known Limitations & Production Considerations

1. **Default Mode:** `RESTORM_AI_ORCHESTRATION` remains `legacy` by default. Transitioning to `langchain` in production requires an explicit environment configuration update (`RESTORM_AI_ORCHESTRATION=langchain`).
2. **External SAP Connections:** The platform operates strictly with synthetic local SQLite data. Connecting to live SAP Cloud Integration tenants requires configuring SAP BTP Destination Service and XSUAA credentials.
3. **No Automatic Remediation:** In adherence to enterprise safety rules, no agent tool has permission to restart CPI flows, drop queues, or resolve incidents automatically.

---

## K. Final Verdict

**COMPLETE** — Both LangChain.js orchestration and LangSmith observability are fully implemented, rigorously tested (323 unit tests + 49 RAG tests + 84 evaluation checks passing), and verified with zero regressions.
