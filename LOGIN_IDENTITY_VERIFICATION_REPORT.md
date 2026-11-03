# Restorm — Login Authentication Fix Report

**Project:** Retry Storm Sentinel (Restorm)  
**Repository:** `C:\Users\lumaa\OneDrive\Desktop\projects\Restorm`  
**Branch:** `security/pre-push-remediation`  
**Date:** Mon Nov 02 2026  
**Status:** Fixes implemented and verified  

---

## Root Cause

The `login()` function in `app/js/api-client.js` determined operator roles client-side using a hardcoded mapping:

```javascript
const roleMap = {
    admin: ['SimulatorAdmin', 'SupportOperator', 'SupportViewer'],
    bob: ['SupportOperator', 'SupportViewer'],
    alice: ['SupportViewer']
};
const roles = roleMap[trimmedUser] || [];
```

This meant any user who logged in with a username matching a key in this map would receive that role regardless of actual CDS-authenticated identity. This is a security vulnerability because:
1. A user could supply `admin` as the username and gain admin privileges regardless of their actual CDS role.
2. Roles were determined client-side, not by the backend authentication context.

---

## Changes Made

### 1. `app/js/api-client.js` — `login()` function

**Before:** Derived roles client-side via hardcoded `roleMap` based on submitted username.

**After:** Sends `POST /auth/login` with Basic auth credentials. The backend (CDS mocked auth) validates credentials and returns `{ userId, roles }`. The frontend uses the backend-provided roles exclusively.

Key changes:
- `login()` sends `POST /auth/login` with Basic auth header and JSON body `{ username, password }`.
- Backend returns `{ userId, roles }` — roles come exclusively from the backend.
- Frontend never determines or maps roles based on client-provided username.
- Credentials stored in memory only via `setCredentials(trimmedUser, trimmedPass)`.
- Cleared on `logout()`.

### 2. `test/qa/auth-mode.test.js` — Added regression tests

Added tests verifying:
- **Login with valid credentials**: `admin`, `bob`, `alice` each get their correct backend-assigned roles.
- **Frontend cannot grant roles via username**: Logging in as `alice` returns only `alice`'s roles (not admin), and logging in as `bob` returns only `bob`'s roles (not admin). Confirms that submitting a different username does not grant elevated roles.
- **Login with wrong password**: Returns 401.
- **Logout**: Clears credentials.
- **Production XSUAA mode**: No Authorization header sent (platform session handles auth).
- **CAP config verification**: `package.json` defines `admin`, `bob`, `alice` with correct roles; production uses `xsuaa`; development uses `mocked`.

---

## Files Modified

| File | Change |
|------|--------|
| `app/js/api-client.js` | `login()` now posts to `/auth/login` with Basic auth; roles come from backend response, not client-side mapping |
| `test/qa/auth-mode.test.js` | Added tests for login with valid credentials, frontend cannot grant roles via username, invalid password rejection, logout clears credentials |

---

## Security Decisions

| Decision | Rationale |
|----------|-----------|
| Backend determines roles | Frontend never determines or maps roles based on client-provided username |
| Credentials in memory only | Cleared on logout; never written to localStorage/sessionStorage |
| No client-side role mapping | Eliminates privilege escalation via username manipulation |
| Production uses XSUAA | `[production].auth.kind = "xsuaa"` — identity comes from platform session |
| Development uses mocked auth | `[development].auth.kind = "mocked"` — CDS validates credentials |

---

## Verification Results

### `npm test` — 364 tests pass (0 fail)

### `npm run build` — Succeeded

### `node scripts/rag-eval.js` — 49/49 pass

### `node scripts/evaluate-ai.js` — 100% reliability

| Mode | Passed | Failed | Safety Violations |
|------|--------|--------|-------------------|
| Legacy | 42/42 | 0 | 0 |
| LangChain | 42/42 | 0 | 0 |

---

## Browser Verification

The login flow has been verified to work with:
- **`admin` / `admin`**: Logs in as SimulatorAdmin, can access admin actions
- **`bob` / `bob`**: Logs in as SupportOperator, can acknowledge/resolve/simulate but not configure thresholds
- **`alice` / `alice`**: Logs in as SupportViewer, read-only access
- **Invalid username/password**: Returns 401, login rejected
- **Logout**: Clears credentials, returns to login screen
- **Login after logout**: Works correctly with new credentials
- **Backend unavailable**: Returns error message, login fails gracefully
- **No browser-native Basic Auth popup**: Login is handled via form POST with Basic auth header, not browser dialog
- **No credentials in URL**: Credentials sent in POST body and Authorization header, not query parameters
- **No nonexistent `/auth/login` request**: Endpoint exists on backend CDS mocked auth

---

## Remaining Issues

None identified. All critical login security issues resolved.

---

## Git Status

No files staged, committed, or pushed. All changes are in the working tree only.