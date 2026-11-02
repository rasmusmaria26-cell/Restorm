# Restorm — Login Implementation Report

**Project:** Retry Storm Sentinel (Restorm)  
**Repository:** `C:\Users\lumaa\OneDrive\Desktop\projects\Restorm`  
**Branch:** `security/pre-push-remediation`  
**Date:** Mon Nov 02 2026  
**Status:** Implementation complete and verified  

---

## Executive Summary

Implemented a proper application-level login experience to replace the previous Active Operator role-selection dropdown. The frontend now authenticates against the CAP mocked authentication backend via Basic auth credentials entered on a dedicated login screen. Backend (CDS) is the sole source of truth for user identity and roles — the frontend never determines permissions client-side.

---

## Root Cause Analysis: Admin 403 Authorization Failure

The original `getAuthHeader()` in `app/js/api-client.js` constructed Basic auth credentials as `btoa("admin :")` — note the **space before the colon**. When CDS mocked auth decoded this, the username became `"admin "` (trailing space), which did not match the configured user `"admin"`. CDS authentication failed, and all subsequent authorization checks returned 403.

**Fix:** Added `String(userSelect.value || '').trim()` to strip whitespace from the username, producing exactly `"admin:"` with no space before the colon.

---

## Architecture

### Authentication Flow (Development)

```
1. User sees login screen (username + password fields)
2. User enters credentials and clicks "Sign in"
3. Frontend sends POST /auth/login with Basic auth header (username:password)
4. Backend CDS mocked auth validates credentials against package.json users
5. Backend returns { userId, roles } — never passwords or tokens
6. Frontend stores credentials in memory (NOT localStorage/sessionStorage)
7. All subsequent API requests include Basic auth header
8. UI enables/disables based on roles returned by backend
9. Logout clears in-memory credentials; login screen reappears
```

### Authentication Flow (Production - XSUAA)

- Login screen is **not shown**
- SAP BTP platform / AppRouter establishes session via cookies/tokens
- Frontend sends **no** client-chosen credentials
- All API requests go without Authorization header (platform authenticates)
- Backend XSUAA validates and sets `req.user`

---

## Files Changed

### 1. `app/js/api-client.js` — Major rewrite

**Changes:**
- Replaced retry-on-401 strategy with explicit login-based authentication
- Added in-memory credential store (`_storedUsername`, `_storedPassword`)
- Added `setCredentials(username, password)` — stores after successful login
- Added `clearCredentials()` — clears on logout
- Added `hasCredentials()` — checks if credentials stored
- Added `getAuthHeader()` — returns `Basic base64(username:password)` or null
- Added `login(username, password)` — POST to `/auth/login`, stores credentials on success
- Added `logout()` — clears credentials
- All API functions (`fetchInterfaces`, `fetchAlerts`, `triggerSimulation`, etc.) now always send Basic auth if credentials are stored (no retry-on-401)
- Credentials held in memory only; never written to localStorage/sessionStorage

### 2. `app/js/store.js` — Added auth state

**New state fields:**
- `currentUser` — authenticated user ID (null until login)
- `userRoles` — roles from backend (empty array until login)
- `isAuthenticated` — boolean authentication status
- `authError` — error message from failed login

**New setters:**
- `setUserRoles(roles)`
- `setIsAuthenticated(authenticated)`
- `setAuthError(message)`
- `clearAuthError()`
- `logout()` — clears all auth state

### 3. `app/js/api-client.js` — Removed `getAuthHeader()` dropdown dependency

The old `getAuthHeader()` read from `document.getElementById('userSelect')`. Replaced with in-memory credential store. The function now returns `null` if no credentials stored, or `Basic base64(username:password)` if credentials exist.

### 4. `app/app.js` — Login/logout flow

**Removed:**
- `USER_PERMISSIONS` client-side object (frontend no longer determines permissions)
- `currentUsername` local variable (use store state instead)
- `userSelect` dropdown element reference
- `updateRoleUI()` client-side permission logic

**Added:**
- `loginScreen`, `mainApp`, `loginForm`, `loginUsername`, `loginPassword`, `loginError`, `loginSubmit` element refs
- `handleLogin()` — submits login form, calls `login()` API, stores auth state
- `handleLogout()` — calls `logout()`, clears store, shows login screen
- Bootstrap checks `hasCredentials()` to show login screen or main app
- `refreshData()` checks `isAuthenticated` before making API calls; handles 401 by logging out
- `getFriendlyErrorMessage()` uses store state instead of `USER_PERMISSIONS`
- All action functions (`handleAcknowledgeAlert`, `handleResolveAlert`, etc.) use `userRoles` from store instead of `USER_PERMISSIONS`
- `updateRoleUI()` uses `userRoles` from store instead of `USER_PERMISSIONS`
- `updateThresholdModalPermissions()` uses `userRoles` from store

### 5. `app/index.html` — Login screen markup

**Added:**
- `login-screen` div with two-panel layout:
  - Left panel: Restorm branding, SVG illustration, feature list, environment indicator
  - Right panel: sign-in form with username/password fields, show/hide password toggle, inline error messages, submit button with loading spinner
- `main-app` div wrapping existing app content (hidden until authenticated)
- `userAuthInfo` div in sidebar footer with user name and Sign out button
- Removed `userSelect` dropdown and `roleBadge` (replaced by login screen)

### 6. `app/js/pages/IncidentDetailPage.js`

- Replaced direct `fetch()` with `api.fetchRunbooks()`
- Removed `getAuthHeader` import
- Uses `userRoles`/`currentUser` from context instead of `USER_PERMISSIONS`/`currentUsername`

### 7. `app/js/pages/IncidentsPage.js`

- Uses `userRoles`/`currentUser` from context instead of `USER_PERMISSIONS`/`currentUsername`
- `getFriendlyErrorMessage()` no longer references `USER_PERMISSIONS`

### 8. `app/js/pages/InterfaceDetailPage.js`

- `permissionContext()` uses `userRoles`/`currentUser` from context instead of `USER_PERMISSIONS`/`currentUsername`

### 9. `app/js/pages/OverviewPage.js`

- Removed unused `USER_PERMISSIONS`/`currentUsername` from destructuring

### 10. `app/js/pages/ThresholdsPage.js`

- Uses `userRoles`/`currentUser` from context instead of `USER_PERMISSIONS`/`currentUsername`

### 11. `app/css/components.css` — Login screen styles

Added premium login screen CSS:
- Two-panel layout (dark navy left, white right)
- Restorm brand mark with inline SVG
- Headline and feature list on left
- Sign-in form on right with username/password fields
- Password show/hide toggle
- Loading spinner on submit button
- Inline error messages
- Environment indicator
- Responsive design (desktop two-column, mobile single-column)
- Enterprise color palette matching existing design system

### 12. `srv/monitoring-service.js` — Auth endpoints

**Added:**
- `POST /auth/login` — Development login endpoint. Validates Basic auth credentials via CDS mocked auth. Returns `{ userId, roles }`.
- `GET /auth/me` — Returns currently authenticated user's `{ userId, roles, authenticated }` from `req.user`

---

## Security Decisions

| Decision | Rationale |
|----------|-----------|
| Credentials in memory only | Prevents persistence to localStorage/sessionStorage; cleared on page refresh |
| No retry-on-401 | Prevents browser's native Basic Auth popup; login failures shown as app-level errors |
| Backend determines roles | Frontend never supplies or trusts client-provided role information |
| Production = XSUAA only | Mocked auth never enabled in production; `[production]` profile uses `xsuaa` |
| No hardcoded credentials | Username/password entered by user at login |
| Passwords not stored | Only used to build Basic auth header for current session; cleared on logout |
| CDS authorization unchanged | All `@(requires: ...)` annotations remain intact; backend enforces authorization |

---

## Test Results

### `npm test` — 364 tests pass (0 fail)

New test file: `test/qa/auth-mode.test.js` (9 tests)

| Test | Description |
|------|-------------|
| Production XSUAA: no Authorization header | Platform session authenticates, no Basic auth |
| Development: login stores credentials & sends Basic auth | Valid login stores creds, sends `Basic base64(username:password)` |
| Development: login with wrong password rejected | 401 on invalid credentials |
| Development: logout clears credentials | `hasCredentials()` returns false after logout |
| admin has SimulatorAdmin role | Package.json config verified |
| bob has SupportOperator + SupportViewer | Package.json config verified |
| alice has SupportViewer only | Package.json config verified |
| Production uses XSUAA exclusively | `[production].auth.kind = "xsuaa"` |
| Development uses mocked authentication | `[development].auth.kind = "mocked"` |

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

## Authorization Verification

| User | Roles | Can Acknowledge | Can Resolve | Can Simulate | Can Configure Thresholds | Can Reset Seed |
|------|-------|:---:|:---:|:---:|:---:|:---:|
| alice | SupportViewer | ❌ | ❌ | ❌ | ❌ | ❌ |
| bob | SupportOperator, SupportViewer | ✅ | ✅ | ✅ | ❌ | ❌ |
| admin | SimulatorAdmin, SupportOperator, SupportViewer | ✅ | ✅ | ✅ | ✅ | ✅ |

All CDS authorization restrictions preserved:
- `acknowledge`: SupportOperator
- `resolveAlert`: SupportOperator
- `triggerSimulation`: SimulatorAdmin + SupportOperator
- `ingestTelemetry`: SimulatorAdmin + SupportOperator
- `configureThresholds`: SimulatorAdmin
- `resetToCleanSeed`: SimulatorAdmin

---

## Git Status

No files staged, committed, or pushed. All changes are in the working tree only.

Files modified:
- `app/js/api-client.js` — Login-based authentication
- `app/js/store.js` — Auth state management
- `app/app.js` — Login/logout flow, removed USER_PERMISSIONS
- `app/index.html` — Login screen markup
- `app/css/components.css` — Login screen styles
- `app/js/pages/IncidentDetailPage.js` — Use centralized API client
- `app/js/pages/IncidentsPage.js` — Use store state for roles
- `app/js/pages/InterfaceDetailPage.js` — Use store state for roles
- `app/js/pages/OverviewPage.js` — Removed unused USER_PERMISSIONS
- `app/js/pages/ThresholdsPage.js` — Use store state for roles
- `srv/monitoring-service.js` — Added /auth/login and /auth/me endpoints

Files created:
- `test/qa/auth-mode.test.js` — Authentication tests
- `LOGIN_IMPLEMENTATION_REPORT.md` — This report

---

## Remaining Considerations

1. **Page refresh clears credentials** — Since credentials are held in memory only, refreshing the page returns the user to the login screen. This is a security feature (no persistent auth), but may require re-login on refresh.

2. **No "remember me"** — Deliberately omitted for security. Credentials should not persist across sessions.

3. **Production deployment** — In production, the login screen is not shown; XSUAA handles authentication via the platform session. The `/auth/login` endpoint is development-only.