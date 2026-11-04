# Restorm: Proactive Incident Intelligence — Engineering Report

## Executive Summary

Restorm has been transformed from a reactive, threshold-based SAP integration monitoring tool into a **repeatable, proactive incident intelligence platform**. The system can observe an emerging failure in real time, forecast an impending incident using deterministic mathematical regression, confirm the threshold breach through strict deterministic detection rules, and generate an audit-ready root cause explanation grounded in multi-page enterprise PDF runbooks.

The implementation strictly satisfies all architectural constraints:
- **Zero AI Hallucination in Math:** Predictive forecasting is computed entirely via pure Ordinary Least Squares (OLS) regression over timestamped telemetry.
- **Strict Decoupling:** The simulation engine generates telemetry; the predictive engine interprets it independently without cross-contamination.
- **Enterprise PDF RAG:** Multi-page operational runbooks are compiled into standard PDF format, extracted into structured chunks, and cited with exact page references (`PDF:Restorm_Operational_Runbooks.pdf#Page<N>`).
- **SAP Fiori Elements Coexistence:** Standard OData V4 UI annotations provide an enterprise SAP Fiori Elements List Report and Object Page without modifying or degrading the custom operational dashboard.
- **Test Integrity:** 100% test pass rate across 428 tests in 96 suites with 0 regressions.

---

## 1. Calibrated Gradual Failure Simulation (Phase 2)

### Mathematical Formulation
The gradual simulator (`srv/core/gradualSimulator.js`) models realistic multi-metric integration degradation using parameterized sigmoid curves:

$$S(\tau; \tau_0, k) = \frac{1}{1 + e^{-k(\tau - \tau_0)}}$$

Where:
- $\tau \in [0, 1]$ is normalized simulation progress over 20 discrete 1-second stages.
- $\tau_0$ is the midpoint of the transition curve.
- $k$ is the steepness coefficient.
- $\eta(\tau)$ is deterministic pseudo-random jitter derived from a linear congruential generator (LCG).

### Independent Metric Dynamics
Each metric operates on an independent progression to mirror real-world SAP Cloud Integration failure propagation:
1. **Processing Throughput ($\tau_0 = 0.70, k = 6.0$):** Degrades early as the downstream backend becomes unresponsive, dropping monotonically from 120 msg/s to 35 msg/s.
2. **Cumulative Retries ($\tau_0 = 0.73, k = 8.5$):** Surges sharply as client applications re-attempt failed transmissions. Crosses the configured threshold of 100 retries at stage 14 ($t \approx 13.0\text{–}13.5\text{s}$).
3. **Pending Queue Backlog ($\tau_0 = 0.81, k = 8.0$):** Accumulates after retries stall, climbing from baseline (8 msgs) to 482 msgs.
4. **Oldest Message Age ($\tau_0 = 0.88, k = 8.0$):** Rises as head-of-line blocking sets in, increasing from 12s to 1,070s.

### Calibration Verification
Across 20 snapshots:
- Pre-breach observations: **13 snapshots** ($t = 0\text{s}$ through $t = 12\text{s}$) strictly below the 100 retry limit.
- Breach snapshot: Stage 14 ($t = 13\text{s}$), retry count reaches 123 ($> 100$).
- Deterministic detection: Evaluates deterministically into `EXCESSIVE_RETRIES` (`Critical`).

---

## 2. Predictive Incident Analysis (Phase 3)

### Forecasting Engine Architecture
Implemented in `srv/core/predictiveEngine.js`, the predictive engine calculates growth rates, goodness of fit, and estimated time to arrival (ETA) before an incident triggers:

- **Growth Rate ($m$):**
  $$m = \frac{N \sum (t_i y_i) - \sum t_i \sum y_i}{N \sum (t_i^2) - (\sum t_i)^2}$$
- **Coefficient of Determination ($R^2$):**
  $$R^2 = 1 - \frac{\sum (y_i - \hat{y}_i)^2}{\sum (y_i - \bar{y})^2}$$
- **Estimated Time to Breach ($\text{ETA}$):**
  $$\text{ETA} = \frac{\text{Threshold} - y_{\text{latest}}}{m}$$

### Rolling Regression Window & Guardrails
A rolling window of the 8 most recent observations is used to capture active acceleration during the exponential climb phase, yielding $R^2 \ge 0.90$.

Seven strict guardrails ensure operational safety:
1. `INSUFFICIENT_DATA`: Requires $\ge 4$ distinct timestamped samples.
2. `STALE_TELEMETRY`: Rejects data where the latest sample is $> 300\text{s}$ old.
3. `THRESHOLD_BREACHED`: Suppressed if the threshold is already crossed.
4. `STABLE`: Growth rate $m \le 0.05$ units/sec.
5. `LOW_CONFIDENCE`: Suppresses forecasts where $R^2 < 0.60$.
6. `OUT_OF_HORIZON`: Rejects breaches projected beyond 120 seconds.
7. `PREDICTIVE_WARNING`: Activated when $m > 0.05$, $R^2 \ge 0.60$, and $0 < \text{ETA} \le 120\text{s}$.

### OData V4 Service Exposure
Exposed via CAP in `srv/monitoring-service.cds`:
- `function getPredictions(interfaceId: UUID) returns PredictionForecast;`
- `function getLandscapePredictions() returns array of PredictionForecast;`

The frontend dashboard displays an animated amber predictive banner and live countdown timer when an impending breach is forecasted.

---

## 3. PDF-Based Runbook RAG (Phase 4)

### Master Runbook Compilation
Generated via `scripts/generateRunbookPdf.js` using `pdfkit`, producing `srv/data/runbooks/Restorm_Operational_Runbooks.pdf` (5 pages, 15,481 bytes):
- **Page 1:** Operational Runbook Catalog & Architecture Guide.
- **Page 2:** Runbook A — Excessive Retries & Downstream Throttle Storm (`RB-PDF-001`).
- **Page 3:** Runbook B — Sudden Backlog & Consumer Stoppage (`RB-PDF-002`).
- **Page 4:** Runbook C — Aging Messages & Poison Pill Blockers (`RB-PDF-003`).
- **Page 5:** Runbook D — Stalled Recovery & Circuit Breaker Deadlock (`RB-PDF-004`).

### Structured Extraction & Citations
Implemented in `srv/core/pdfRunbookEngine.js`:
- Each chunk preserves exact source citations: `PDF:Restorm_Operational_Runbooks.pdf#Page<N>`.
- RAG retrieval scores entries using rule code matching, alias mapping, and keyword density.
- Safety filters reject hallucinated citations not present in the catalog and sanitize any destructive commands (e.g., `drop queue`, `rm -rf`).

---

## 4. SAP Fiori Elements Proof of Concept (Phase 5)

### OData V4 UI Annotations
Defined in `srv/annotations.cds` using official SAP UI vocabulary:
- `@UI.HeaderInfo`: Identifies entities as "Monitored Interface" / "Integration Incidents".
- `@UI.SelectionFields`: Search and filter by `interfaceKey`, `status`, `severity`, and `ruleCode`.
- `@UI.LineItem`: Column definitions with criticality highlights (1: Red/Critical, 2: Amber/High, 3: Green/Healthy).
- `@UI.Facets` & `@UI.FieldGroup`: Structured object page layouts.

### Coexistence Architecture
The Fiori Elements application is configured at `app/fiori/webapp/manifest.json` pointing directly to the CAP OData V4 service `/odata/v4/monitoring/`. A navigation pill in the custom dashboard links directly to the Fiori Elements application, ensuring zero degradation or disturbance to the existing frontend.

---

## 5. End-to-End Automated Demonstration

Verified in `test/e2eProactiveDemonstration.test.js` across 9 discrete lifecycle stages:
1. **Healthy Baseline:** Interface verified with 1 retry, 8 pending, 0 alerts.
2. **Simulation Initiation:** Configured 20-stage S-curve for Order Inbound (S/4HANA).
3. **Telemetry Ingestion (Stages 1–13):** Telemetry climbs to 91 retries (< 100 threshold), throughput degrades to 87 msg/s.
4. **Predictive Warning:** Engine forecasts impending breach in ~0.8s at +11.7 retries/s with 90% confidence ($R^2 = 0.90$).
5. **Deterministic Breach Crossing (Stage 14):** Ingestion crosses 100 retries, triggering `EXCESSIVE_RETRIES` (`Critical`).
6. **PDF Runbook Retrieval:** Successfully retrieves `RB-PDF-001` with citation `PDF:Restorm_Operational_Runbooks.pdf#Page2`.
7. **Grounded AI Explanation:** Generates structured explanation with cited runbook IDs and 3 verified non-destructive operational checks.
8. **Incident Report Export:** Exports audit-ready Markdown postmortem report (2,967 bytes).
9. **Fiori Elements Verification:** Validates CSN UI annotations and manifest configuration.

---

## 6. Complete Verification & Regression Suite

Full test suite execution results:
```text
> retry-storm-sentinel@1.0.0 test
> node --test --test-concurrency=1 test/**/*.test.js

ℹ tests 428
ℹ suites 96
ℹ pass 428
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 109357.6046
```

All 428 tests pass with zero failures and zero regressions.

