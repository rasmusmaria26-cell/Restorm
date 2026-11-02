# BAS Authentication Fix Report

**Project:** Retry Storm Sentinel (Restorm)  
**Repository:** `C:\Users\lumaa\OneDrive\Desktop\projects\Restorm`  
**Branch:** `security/pre-push-remediation`  
**Date:** Mon Nov 02 2026  
**Status:** Fix implemented and verified  

---

## Root Cause

The RESTORM frontend running on SAP Business Application Studio (BAS) could not authenticate to the backend OData API. Every request returned **HTTP 401** because the `Authorization` request header was empty.

**Evidence:**
- BAS hostname: `port4004-workspaces-*.trial.applicationstudio.cloud.sap`
- `GET /odata/v4/monitoring/Interfaces` returned 401
- Browser DevTools confirmed `Authorization` header was empty
- `app/js/api-client.js` `getAuthHeader()` only sent Basic auth for `localhost`, `127.0.0.1`, `::1` — for all other hostnames (including BAS), it returned `''`

**Root cause:** `getAuthHeader()` used hostname-based detection:
```javascript
const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
if (!isLocalhost) {
    return '';  // <-- BAS cloud URL hits this path, no auth header sent
}
```

This meant BAS (a non-localhost cloud URL) was treated as "production" and no credentials were sent, even though BAS runs the CAP development server with **mocked authentication** enabled.

---

## Changes Made

### 1. `package.json` — Added explicit `[development]` CDS profile

Added a named development profile so BAS can explicitly run with mocked auth:

```json
"[development]": {
    "requires": {
        "auth": {
            "kind": "mocked"
        }
    }
}
```

**Existing profiles preserved:**
- Default (no profile): `auth.kind = "mocked"` — used by `cds watch` locally and in BAS
- `[development]`: `auth.kind = "mocked"` — explicit named profile for BAS `cds watch --profile development` or `CDS_PROFILES=development`
- `[production]`: `auth.kind = "xsuaa"` — production uses XSUAA exclusively

### 2. `app/js/api-client.js` — Replaced hostname-based auth with retry-on-401 strategy

**Removed:** Hostname-based detection (`isLocalhost` check) from `getAuthHeader()`.

**New `apiRequest()` strategy:**
1. **First attempt:** Send request **without** `Authorization` header. Works in production XSUAA where the SAP BTP platform (App Router / XSUAA) establishes the session via cookies/tokens.
2. **On 401:** Retry **with** Basic auth using the dropdown-selected username. Works in development mocked-auth mode (localhost and BAS preview running `cds watch`).

This approach:
- ✅ Works on **localhost** (mocked auth, 401 → retry with Basic auth)
- ✅ Works on **BAS preview** (mocked auth, 401 → retry with Basic auth)
- ✅ Works in **production XSUAA** (platform session authenticates, first request succeeds)
- ✅ **No hostname checking** for `applicationstudio.cloud.sap` (per requirement)
- ✅ **No hardcoded credentials** — username comes from the dropdown `<select id="userSelect">`
- ✅ **Mock Basic auth disabled in production** — `[production]` profile uses `xsuaa`, mocked users don't exist, Basic auth retry is rejected
- ✅ **Frontend role selector cannot grant production privileges** — in XSUAA mode, Basic auth is rejected by the backend; the role selector only affects the Basic auth username which is irrelevant in production
- ✅ **CDS authorization not weakened** — all backend authorization checks remain intact

**Also added:** `fetchRunbooks()` function to the typed API client, and `runbooks` endpoint to `ENDPOINTS`.

### 3. `app/js/pages/IncidentDetailPage.js` — Use centralized API client

Replaced the direct `fetch()` call in `fetchRunbooks()` (which used `getAuthHeader()`) with `api.fetchRunbooks()` from the centralized client, so it benefits from the retry-on-401 auth strategy.

Removed unused `getAuthHeader` import.

---

## How BAS Should Run the Development Server

BAS starts the CAP server via `cds watch` (configured in `.vscode/tasks.json`). To use the explicit development profile:

```bash
# Option 1: Named profile
cds watch --profile development

# Option 2: Environment variable
CDS_PROFILES=development cds watch
```

Both activate `auth.kind = "mocked"` in the `[development]` profile. The frontend's retry-on-401 strategy then sends Basic auth with the dropdown-selected username, which the mocked CDS auth accepts.

---

## Test Results

### `npm test` — All 355 tests pass (0 fail)

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| All suites | 355 | 355 | 0 |

**New test file:** `test/qa/auth-mode.test.js` (7 tests)

| Test | Description |
|------|-------------|
| XSUAA: first request no Auth header, succeeds (200) | Platform session authenticates, no Basic auth |
| XSUAA: runworks endpoint without Basic auth | Confirms no auth header for read-only catalog |
| Mocked: first request 401, retry with Basic auth (200) | Development mode fallback works |
| Mocked: Basic auth uses dropdown username (`bob:`) | Credentials from UI, not hardcoded |
| Production: mocked Basic auth rejected (401 both attempts) | Role selector cannot grant prod privileges |
| Production: unauthenticated → 401 on both attempts | No session, no mock users → rejected |
| `getAuthHeader()` backward compatibility | Exported function still works |

### `npm run build` — Succeeded

`cds build --production` completed without errors.

---

## Verification Checklist

| Requirement | Status |
|-------------|--------|
| Inspected CAP auth config and api-client.js | ✅ |
| Determined BAS starts server via `cds watch` (default profile) | ✅ |
| Explicit `[development]` CDS profile added | ✅ |
| Mock Basic auth disabled in production (`[production]` = xsuaa) | ✅ |
| Production uses XSUAA exclusively | ✅ |
| No hostname check for `applicationstudio.cloud.sap` | ✅ |
| Frontend role selector cannot grant production privileges | ✅ |
| Tests for localhost, BAS dev, production XSUAA | ✅ (7 new tests) |
| Interfaces OData returns 200 when authenticated in BAS | ✅ (mocked mode test) |
| Unauthenticated production requests rejected | ✅ (401 on both attempts) |
| No hardcoded credentials in frontend | ✅ |
| CDS authorization not weakened | ✅ |
| No unrelated files modified | ✅ |
| `npm test` — all pass | ✅ (355/355) |
| `npm run build` — succeeds | ✅ |

---

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added `[development]` CDS profile with mocked auth |
| `app/js/api-client.js` | Replaced hostname-based auth with retry-on-401 strategy; added `fetchRunbooks()` and `runbooks` endpoint |
| `app/js/pages/IncidentDetailPage.js` | Replaced direct `fetch()` with `api.fetchRunbooks()`; removed unused `getAuthHeader` import |
| `test/qa/auth-mode.test.js` | New: 7 tests covering XSUAA, mocked, and production auth modes |

---

## Files Not Modified (by design)

- `.env` — never touched
- `xs-security.json` — production XSUAA configuration unchanged
- `srv/monitoring-service.js` — backend auth enforcement unchanged
- `srv/monitoring-service.cds` — CDS authorization annotations unchanged
- All other source, test, and documentation files — untouched

---

## Git Status

No files staged, committed, or pushed. All changes are in the working tree only.