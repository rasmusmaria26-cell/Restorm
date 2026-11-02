# Restorm — Landscape-Wide Cascade Simulation Fix Report

**Project:** Retry Storm Sentinel (Restorm)  
**Repository:** `C:\Users\lumaa\OneDrive\Desktop\projects\Restorm`  
**Branch:** `security/pre-push-remediation`  
**Date:** Mon Nov 02 2026  
**Status:** Fix implemented and verified  

---

## Root Cause

The "All Interfaces (Simulate Landscape-Wide Cascade)" option in the frontend simulation UI sent `interfaceId = 'ALL'` to the backend, but the `triggerSimulation` handler treated `'ALL'` as a specific interface UUID.

### Chain of failure:

1. **Frontend** (`app/index.html` line 95): `<option value="ALL">⚡ All Interfaces (Simulate Landscape-Wide Cascade)</option>`
2. **Frontend** (`app/app.js` line 739): `const targetInterfaceId = targetSelect ? targetSelect.value : 'ALL';` — sends `'ALL'` as `interfaceId`
3. **Backend** (`srv/monitoring-service.js` lines 287-292, original code): treated `'ALL'` as a specific interface UUID:
   ```javascript
   targetInterface = await SELECT.one.from(Interfaces).where({ ID: interfaceId });
   if (!targetInterface) return req.reject(404, `Interface ${interfaceId} not found`);
   ```
4. No interface with ID `'ALL'` exists → **HTTP 404** → Frontend maps to: "The requested interface or alert could not be found."

Specific-interface selection worked because it passed a real UUID (e.g., `11111111-1111-1111-1111-111111111111`) which matched a seed interface.

---

## Changes Made

### 1. `srv/monitoring-service.js` — `triggerSimulation` handler

Replaced the single-interface-only logic with landscape-wide cascade support:

| `interfaceId` value | Behavior |
|---------------------|----------|
| `'ALL'` | Simulates across **all active interfaces** (landscape-wide cascade) |
| `undefined` / `null` | Simulates across **all active interfaces** (landscape-wide cascade) |
| Specific UUID | Simulates that **one interface only** (existing behavior preserved) |
| Invalid format / unknown UUID | Returns 400 or 404 (validation preserved) |

**Implementation details:**
- When `interfaceId === 'ALL'` (or falsy), fetches all active interfaces via `SELECT.from(Interfaces).where({ active: true })`
- Iterates each interface: generates snapshot via `generateSnapshotData()` + runs detection pipeline via `processSnapshotAndEvaluate()`
- Per-interface try/catch: one interface failure does not abort the entire cascade; errors are captured per-result
- Returns aggregated result with `landscapeWide: true`, per-interface results, and summary counts
- Single-interface path returns the same message string as before (backward compatible)

### 2. `test/qa/backend-contract-integration.test.js` — 7 new tests

New `describe('Landscape-wide simulation (All Interfaces)')` block:

| Test | Purpose |
|------|---------|
| `interfaceId ALL runs cascade across all active interfaces` | Verifies landscape-wide mode returns aggregated results for all interfaces |
| `specific interfaceId still works (single interface preserved)` | Verifies backward compatibility — single UUID returns string message |
| `invalid interfaceId returns 404` | Verifies unknown UUID → 404 |
| `malformed interfaceId returns an error` | Verifies non-UUID format → error (400/404/ASSERT_DATA_TYPE) |
| `invalid scenario returns 400` | Verifies scenario allowlist still enforced |
| `landscape-wide generates incidents with valid interface IDs` | Verifies all persisted alerts reference valid interface IDs |
| `landscape-wide respects per-interface thresholds` | Verifies tightened thresholds trigger alerts on targeted interface only |

---

## Verification Results

### `npm test` — All 362 tests pass (0 fail)

| Category | Tests | Pass | Fail |
|----------|-------|------|------|
| All suites | 362 | 362 | 0 |

New tests: 7 added in `test/qa/backend-contract-integration.test.js`

### `npm run build` — Succeeded

`cds build --production` completed without errors.

### `node scripts/rag-eval.js` — 49/49 pass

RAG reliability evaluation fully passing.

### `node scripts/evaluate-ai.js` — 100% reliability

| Mode | Passed | Failed | Safety Violations |
|------|--------|--------|-------------------|
| Legacy | 42/42 | 0 | 0 |
| LangChain | 42/42 | 0 | 0 |

---

## Files Modified

| File | Change |
|------|--------|
| `srv/monitoring-service.js` | `triggerSimulation` handler: landscape-wide cascade support for `interfaceId === 'ALL'` |
| `test/qa/backend-contract-integration.test.js` | 7 new tests for all-interface simulation, validation, and error handling |

---

## Files Not Modified (by design)

- `app/index.html` — frontend UI unchanged (still sends `interfaceId = 'ALL'`)
- `app/app.js` — frontend handler unchanged
- `app/js/api-client.js` — API client unchanged
- `srv/core/simulator.js` — simulator engine unchanged
- `srv/core/ingestionPipeline.js` — detection pipeline unchanged
- `srv/monitoring-service.cds` — CDS model unchanged
- `xs-security.json` — XSUAA config unchanged
- `.env` — never touched

---

## Git Status

No files staged, committed, or pushed. All changes are in the working tree only.

---

## Behavior Summary

| Scenario | Before Fix | After Fix |
|----------|-----------|-----------|
| Specific interface + scenario | ✅ Works | ✅ Works (unchanged) |
| All Interfaces + scenario | ❌ 404 "Interface ALL not found" | ✅ Simulates all interfaces, returns aggregated results |
| Invalid UUID | ✅ 404 | ✅ 404 (unchanged) |
| Invalid scenario | ✅ 400 | ✅ 400 (unchanged) |
| Malformed interfaceId | ❌ 404 (misleading) | ✅ Error (400/404/ASSERT_DATA_TYPE) |
| Empty landscape (no active interfaces) | ❌ 400 "No active interface" | ✅ 400 "No active interfaces found for landscape-wide simulation" |
| Partial failure (one interface errors) | N/A | ✅ Continues cascade, error captured per-result |