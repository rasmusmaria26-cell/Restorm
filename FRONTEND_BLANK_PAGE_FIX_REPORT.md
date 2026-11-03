# Restorm — Frontend Blank Page and Literal `\n` Fix Report

**Project:** Retry Storm Sentinel (Restorm)  
**Repository:** `c:\Users\lumaa\OneDrive\Desktop\projects\Restorm`  
**Branch:** `security/pre-push-remediation`  
**Date:** Tue Nov 03 2026  
**Status:** Resolved, thoroughly verified with automated browser testing & regressions passing  

---

## 1. Executive Summary

When visiting `http://localhost:4004/`, users observed:
1. A blank light-grey application page.
2. The literal characters `\n` displayed at the top-left of the viewport.
3. Neither the login screen nor the operational dashboard was visible.

A multi-factor root cause analysis determined that this behavior was caused by the combination of an unintended literal text sequence outside HTML tags, a CSS class conflict (`.hidden { display: none !important; }`) that prevented JavaScript inline styles from displaying `#main-app`, an undeclared identifier (`roleBadge`) causing a `ReferenceError` during post-login UI updates, and malformed HTML/SVG syntax in `app/index.html`.

All issues have been resolved, and end-to-end browser flows (unauthenticated landing, admin login/dashboard, Bob login/dashboard, Alice login/dashboard, and mobile viewport responsive layout) have been validated with zero console errors and zero CSP violations.

---

## 2. Root Cause Analysis

### Finding 1: Exact Source of Literal `\n` Characters
- **File:** `app/index.html`, line 308
- **Root Cause:** A previous automated code modification inserted a literal escaped string `\n` instead of an actual newline character between `</div> <!-- /#main-app -->` and `<!-- Application Script (ES module) -->`:
  ```html
  </div> <!-- /#main-app -->\n    <!-- Application Script (ES module) -->
  ```
- **Rendering Impact:** Because this text node was outside any JavaScript string literal, CSS block, or HTML comment, the browser rendered the literal string `\n` in the body flow. Whenever both the login panel and main app shells were hidden, this `\n` appeared at the top-left of the viewport against the light-grey `body` background (`#f1f5f9`).

### Finding 2: CSS `.hidden` with `!important` Blocking `#main-app` Display
- **Files:** `app/css/components.css` line 1620, `app/index.html` line 139, `app/app.js` lines 922, 971
- **Root Cause:** In `index.html`, `#main-app` was scaffolded with `class="main-app hidden"`. In `components.css`, `.hidden` is declared as:
  ```css
  .hidden {
      display: none !important;
  }
  ```
  In `app/app.js`, `handleLogin` and `bootstrap` attempted to reveal the main shell by assigning:
  ```javascript
  mainApp.style.display = 'block';
  ```
  Because `.hidden` uses `!important`, setting inline `display: block` had zero effect. `#main-app` remained `display: none !important`. Meanwhile, `loginScreen.style.display = 'none'` hid the login screen. Both containers became invisible, leaving only the empty light-grey page canvas.
- **Fix:** Updated `app/app.js` to manage visibility via class manipulation (`mainApp.classList.remove('hidden')`, `loginScreen.classList.add('hidden')`, and vice versa on logout).

### Finding 3: JavaScript Runtime Error: `ReferenceError: roleBadge is not defined`
- **File:** `app/app.js`, line 253
- **Root Cause:** When migrating from the prototype role-selection dropdown to the dedicated login screen, the HTML element `id="roleCapsBadge"` was replaced by `id="userAuthInfo"` and `id="userAuthName"`. However, in `app/app.js`, `updateRoleUI()` retained:
  ```javascript
  if (roleBadge) roleBadge.textContent = ...;
  ```
  In strict ES module execution, referencing undeclared `roleBadge` threw `ReferenceError: roleBadge is not defined`. During `handleLogin()`, this exception aborted execution immediately after `loginScreen.style.display = 'none'`, landing in the `catch` block without rendering `#main-app` or restoring `#login-screen`.
- **Fix:** Replaced the legacy reference with proper lookups for `userAuthInfo` and `userAuthName`, updating role labels safely.

### Finding 4: Malformed HTML Comment Block
- **File:** `app/index.html`, lines 136–138
- **Root Cause:** The separator above `#main-app` mixed CSS comment syntax with HTML comment delimiters:
  ```html
  <!-- ============================================================ */
  /* MAIN APP — hidden until authenticated                          */
  <!-- ============================================================ -->
  ```
  Line 136 opened with `<!--` but ended with `*/`, which is not a valid HTML comment closing sequence. The browser parser treated everything up to line 138's `-->` as an unclosed comment containing an inner `<!--`.
- **Fix:** Standardized to clean HTML comments (`<!-- ... -->`).

### Finding 5: SVG Path Syntax Error in Password Toggle Button
- **File:** `app/index.html`, line 109
- **Root Cause:** The SVG path for the password visibility toggle icon contained an invalid coordinate grouping:
  ```html
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/>
  ```
  Browser SVG parsers reported: `Error: <path> attribute d: Expected number, "… 8-4 8-11-8-11-8z"`.
- **Fix:** Corrected the path coordinate pairs to valid SVG syntax: `d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"`.

### Finding 6: Empty Pink Alert Box Displayed on Login Screen
- **File:** `app/css/components.css`, line 1914
- **Root Cause:** `.login-error[role="alert"] { display: block; }` caused the error box to be visible immediately on load because `<div id="login-error" role="alert">` in `index.html` has the `role="alert"` attribute even when empty.
- **Fix:** Changed CSS selector to `.login-error:not(:empty) { display: block; }` so the error alert only appears when an actual error message exists.

### Finding 7: Unauthenticated Route Rendering (401 Console Errors)
- **File:** `app/app.js`, lines 760–764
- **Root Cause:** `router.onRouteChange` was invoked immediately during bootstrap before authentication. This triggered `renderRoute('overview')`, causing `OverviewPage` to execute `fetchInterfaces()` and `fetchAlerts()`, which produced 401 Unauthorized errors in the console.
- **Fix:** Added authentication guard in `onRouteChange`: `if (!getState().isAuthenticated) return;`.

### Finding 8: `ReferenceError: perms is not defined` on Incidents Page
- **Files:** `app/js/pages/IncidentsPage.js` line 182, `app/js/pages/IncidentDetailPage.js` line 332
- **Root Cause:** In both incident views, button permission logic evaluated `perms.canAcknowledge` and `perms.canResolve`. While `canAcknowledge` and `canResolve` variables were declared, the object `perms` was omitted. Navigating to `#incidents` threw `ReferenceError: perms is not defined`, triggering the inline `ErrorState` ("perms is not defined" with Retry button).
- **Fix:** Defined `const perms = { canAcknowledge, canResolve, isAdmin, isOperator };` in both page modules.

### Finding 9: Unstyled "Sign out" Button in Sidebar Footer
- **Files:** `app/index.html` line 160, `app/css/components.css` line 1613
- **Root Cause:** `#btnLogout` was missing the base `.btn` class (`class="btn-quiet btn-logout"`), and `.btn-logout` had no custom border, padding, or hover styling defined. The browser rendered a raw grey user-agent bevel button.
- **Fix:** Added base `btn` class in markup and implemented modern full-width button styling with subtle borders, border-radius, and hover states matching the design system.

---

## 3. Files Modified

| File | Changes Made |
|------|--------------|
| [app/index.html](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/index.html) | Removed literal `\n` outside markup on line 308; corrected malformed HTML comment block on lines 136–138; fixed SVG eye path on line 109; added `btn` class and `type="button"` to `#btnLogout`. |
| [app/app.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/app.js) | Updated `handleLogin`, `handleLogout`, and `bootstrap` to toggle `.hidden` class alongside `style.display`; resolved `roleBadge` ReferenceError in `updateRoleUI()`; guarded router against unauthenticated API calls; wired up password visibility toggle; set `userAuthInfo.style.display = 'flex'`. |
| [app/css/components.css](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/css/components.css) | Replaced `.login-error[role="alert"]` with `.login-error:not(:empty)`; styled `#userAuthInfo`, `.user-role-badge`, and `.btn-logout` for consistent sidebar presentation. |
| [app/js/pages/IncidentsPage.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/js/pages/IncidentsPage.js) | Defined `const perms = { canAcknowledge, canResolve, isAdmin, isOperator }` to fix `ReferenceError: perms is not defined`. |
| [app/js/pages/IncidentDetailPage.js](file:///c:/Users/lumaa/OneDrive/Desktop/projects/Restorm/app/js/pages/IncidentDetailPage.js) | Defined `const perms = { canAcknowledge, canResolve, isAdmin, isOperator }` to fix `ReferenceError: perms is not defined`. |

---

## 4. Browser Verification Results

Automated browser verification using Playwright testing against the active live instance on `http://localhost:4004/`:

| Step / Check | Verification Detail | Result |
|--------------|---------------------|--------|
| **1. Unauthenticated Initial Load** | Opened `http://localhost:4004/` with clean session. Verified `#login-screen` is visible (`display: flex`) and `#main-app` is hidden (`display: none`). Verified zero literal `\n` text on canvas. | **PASS** |
| **2. Clean Login UI** | Checked that empty `#login-error` alert is not displayed; password toggle button toggles input type between `password` and `text`. | **PASS** |
| **3. Admin Authentication** | Submitted `admin`/`admin`. `#login-screen` transitioned to hidden; `#main-app` revealed; KPI cards and interface grid rendered. Sidebar badge confirmed: `admin (Simulator admin)`. Admin simulation and reset buttons enabled. | **PASS** |
| **4. Logout to Login** | Clicked `Sign out`. Session credentials cleared; `#main-app` hidden; `#login-screen` reappeared cleanly. | **PASS** |
| **5. Bob Authentication** | Submitted `bob`/`bob`. Dashboard rendered; sidebar badge confirmed: `bob (Support operator)`. Simulation buttons enabled; reset button disabled. | **PASS** |
| **6. Alice Authentication** | Submitted `alice`/`alice`. Dashboard rendered; sidebar badge confirmed: `alice (Support viewer)`. Simulation and reset buttons disabled (read-only view). | **PASS** |
| **7. Mobile Viewport (375x667)** | Tested on iPhone SE viewport dimensions. Brand card and login card stacked responsively. Hamburger menu opened mobile sidebar overlay; `Sign out` operated seamlessly. | **PASS** |
| **8. Console Errors & CSP** | Verified `0` console errors, `0` uncaught exceptions, and `0` CSP violations throughout entire workflow. | **PASS** |

---

## 5. Regression Test Results

### 1. `npm test`
- **Result:** **365 passed**, 0 failed, 70 suites, duration: 77.9s
- All authentication mode, authorization matrix, backend contract, simulator, and ingestion test suites passed.

### 2. `npm run build`
- **Result:** Completed successfully in 2.7s (`cds build --production`).

### 3. `node scripts/rag-eval.js`
- **Result:** **49 / 49 passed** (100% pass rate).
- Validated runbook retrieval, fact preservation, uncertainty disclosure, safe checks retention, and deterministic fallback.

### 4. `node scripts/evaluate-ai.js`
- **Result:** **42 / 42 passed (Legacy)**, **42 / 42 passed (LangChain)**.
- 100% reliability, zero safety violations, zero hallucinated citations.

---

## 6. Security Reviewer Assessment

In accordance with the Security Guardian guidelines:

### What Was Checked
- Server-side and client-side authentication flow between frontend API client and CAP CDS mocked authentication.
- Strict Content Security Policy (`default-src 'self'; script-src 'self'; style-src 'self' ...; img-src 'self' data:; connect-src 'self'`).
- Preserved authorization matrix enforcing role permissions strictly from the backend (`req.user.is(...)`).
- Absence of client-side credentials in localStorage, sessionStorage, or URL query strings.
- Production XSUAA configuration remains untouched and ready for SAP BTP AppRouter integration.

### What Was Not Checked
- Physical deployment to a live SAP BTP Cloud Foundry space (requires enterprise BTP credentials).
- Live XSUAA tenant binding tokens on a real SAP BTP Cloud Foundry space (local synthetic mock environment used).

### Which Findings Require Action
- None for this issue. All frontend rendering blockers and syntax errors are completely resolved.

### Five Highest-Priority Next Steps
1. Keep the active `cds-serve` service running for ongoing local browser verification and QA workflows.
2. Maintain strict separation of credentials in in-memory state only (no persistence to browser storage).
3. Ensure future UI components use class-based visibility toggles (`.hidden`) rather than conflicting inline styles.
4. Verify SAP BTP destination and AppRouter configuration when preparing the production cloud deployment bundle.
5. Continue running the automated Playwright test suite as part of pre-push CI/CD validation.

---

## 7. Git Working Tree State
No files have been staged, committed, or pushed. All changes remain in the local working copy.
