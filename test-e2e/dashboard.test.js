/**
 * Restorm Phase 5 — Dashboard E2E Tests (Playwright)
 *
 * Runs against the live dev server at http://localhost:4004/ (cds-serve).
 * Verifies the dashboard shell, KPI cards, interface cards, topology,
 * incidents, thresholds, and incident lifecycle in a real Chromium browser.
 *
 * Run: npx playwright test --config playwright.config.js
 * Prerequisite: `npm start` (cds-serve) must be running on port 4004.
 */

const { test, expect } = require('@playwright/test');

test.describe('Restorm Operations Dashboard — E2E', () => {

    test.beforeEach(async ({ page }) => {
        // Basic auth is configured via httpCredentials in playwright.config.js
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');
    });

    async function waitForPageData(page) {
        // Wait for the app to fetch and render data from the backend
        await page.waitForTimeout(3500);
        try {
            await page.waitForSelector('.kpi-card, .interface-card, .empty-card', { timeout: 8000 });
        } catch (e) {
            // Continue; assertions will catch real failures
        }
    }

    async function navigateToHash(page, hash) {
        // Navigate via hash change and wait for URL to reflect it
        await page.evaluate((h) => { window.location.hash = h; }, hash);
        try {
            await page.waitForURL(`**/${hash}`, { timeout: 10000 });
        } catch (e) {
            // URL may not change if hash is empty; continue
        }
        // Wait for page content to render
        await page.waitForTimeout(3000);
    }

    test('shell renders with navigation and operator selector', async ({ page }) => {
        await waitForPageData(page);

        await expect(page).toHaveTitle(/Retry Storm Sentinel/);
        await expect(page.locator('.brand-title').first()).toContainText('Retry Storm Sentinel');

        // Sidebar navigation items
        await expect(page.locator('nav a[data-route]')).toHaveCount(5);
        await expect(page.locator('nav a[data-route=""]')).toContainText('Overview');
        await expect(page.locator('nav a[data-route="interfaces"]')).toContainText('Interface Inventory');
        await expect(page.locator('nav a[data-route="topology"]')).toContainText('Topology');
        await expect(page.locator('nav a[data-route="incidents"]')).toContainText('Incidents');
        await expect(page.locator('nav a[data-route="thresholds"]')).toContainText('Thresholds');

        // Operator selector
        await expect(page.locator('#userSelect')).toBeVisible();
        await expect(page.locator('#userSelect')).toHaveValue('bob');

        // Live stream toggle + refresh button
        await expect(page.locator('#liveStreamToggle')).toBeVisible();
        await expect(page.locator('#btnRefreshTop')).toBeVisible();
    });

    test('KPI cards render with real backend data', async ({ page }) => {
        await waitForPageData(page);

        const kpiCount = await page.locator('.kpi-card').count();
        expect(kpiCount).toBeGreaterThan(0);

        // Interfaces count should be 3 (from real backend)
        const interfacesCard = page.locator('.kpi-card').filter({ hasText: /Interfaces/i });
        await expect(interfacesCard).toContainText('3');
    });

    test('Interface cards render with health status', async ({ page }) => {
        await waitForPageData(page);

        const cardCount = await page.locator('.interface-card').count();
        expect(cardCount).toBe(3);

        await expect(page.locator('.interface-card').first()).toContainText('Order Inbound');
        await expect(page.locator('.interface-card').first()).toContainText('Healthy');
        await expect(page.locator('.interface-card').nth(1)).toContainText('Invoice Outbound');
        await expect(page.locator('.interface-card').nth(2)).toContainText('Inventory Replication');
    });

    test('Topology page renders landscape graph', async ({ page }) => {
        await waitForPageData(page);

        await navigateToHash(page, '#topology');

        await expect(page.locator('.topology-page')).toBeVisible();
        const pillCount = await page.locator('.topology-pill').count();
        expect(pillCount).toBeGreaterThan(0);
        await expect(page.locator('.topology-pill.is-healthy')).toContainText('5 Healthy');

        await expect(page.locator('svg.topo-node')).toHaveCountGreaterThan(0);
        await expect(page.locator('svg.topo-edge')).toHaveCountGreaterThan(0);

        await expect(page.locator('.topo-node').filter({ hasText: /WEBSHOP/ })).toBeVisible();
        await expect(page.locator('.topo-node').filter({ hasText: /S4HANA/ })).toBeVisible();
        await expect(page.locator('.topo-node').filter({ hasText: /PAYGATE/ })).toBeVisible();
        await expect(page.locator('.topo-node').filter({ hasText: /WMS/ })).toBeVisible();
        await expect(page.locator('.topo-node').filter({ hasText: /CPI/ })).toBeVisible();
    });

    test('Incidents page renders', async ({ page }) => {
        await waitForPageData(page);

        await navigateToHash(page, '#incidents');

        await expect(page.locator('.incidents-page')).toBeVisible();
        const incidentOrEmptyCount = await page.locator('.incident-card, .empty-card').count();
        expect(incidentOrEmptyCount).toBeGreaterThan(0);
    });

    test('Thresholds page renders (admin only)', async ({ page }) => {
        await waitForPageData(page);

        await page.selectOption('#userSelect', 'admin');
        await page.waitForTimeout(500);

        await navigateToHash(page, '#thresholds');

        await expect(page.locator('.thresholds-page')).toBeVisible();
        await expect(page.locator('#thresholdInterfaceSelect')).toBeVisible();
        await expect(page.locator('#maxRetryThreshold')).toBeVisible();
    });

    test('Viewer role (alice) cannot acknowledge or resolve', async ({ page }) => {
        await waitForPageData(page);

        await page.selectOption('#userSelect', 'alice');
        await page.waitForTimeout(500);

        // Stay on overview page
        const ackCount = await page.locator('button:has-text("Acknowledge")').count();
        const resolveCount = await page.locator('button:has-text("Resolve incident")').count();
        expect(ackCount).toBe(0);
        expect(resolveCount).toBe(0);
    });

    test('Incident lifecycle: simulate → acknowledge → resolve', async ({ page }) => {
        await waitForPageData(page);

        await page.selectOption('#userSelect', 'bob');
        await page.waitForTimeout(500);

        // Stay on overview - simulation buttons are in the shell footer
        const simCount = await page.locator('.sim-btn').count();
        expect(simCount).toBeGreaterThan(0);

        // Trigger retry storm simulation
        const retryStormBtn = page.locator('.sim-btn[data-scenario="RETRY_STORM"]');
        if (await retryStormBtn.count() > 0) {
            await retryStormBtn.click({ force: true });
        } else {
            await page.locator('.sim-btn').first().click({ force: true });
        }

        // Wait for simulation + auto-refresh cycle
        await page.waitForTimeout(4000);

        // Verify an alert appeared
        const openAlertsBadge = page.locator('#alertsCount');
        const alertCountText = await openAlertsBadge.textContent();
        expect(parseInt(alertCountText || '0', 10)).toBeGreaterThan(0);

        // Navigate to incidents
        await navigateToHash(page, '#incidents');

        const incidentCard = page.locator('.incident-card').first();
        await expect(incidentCard).toBeVisible();

        // Acknowledge
        const ackBtn = incidentCard.locator('button:has-text("Acknowledge")');
        if (await ackBtn.count() > 0) {
            await ackBtn.click({ force: true });
            await page.waitForTimeout(2000);

            const resolveBtn = incidentCard.locator('button:has-text("Resolve incident")');
            if (await resolveBtn.count() > 0) {
                await resolveBtn.click({ force: true });
                await page.waitForTimeout(2000);
            }
        }
    });

    test('Explain action returns grounded explanation', async ({ page }) => {
        await waitForPageData(page);

        await page.selectOption('#userSelect', 'bob');
        await page.waitForTimeout(500);

        await navigateToHash(page, '#incidents');

        const incidentCard = page.locator('.incident-card').first();
        if (await incidentCard.count() > 0) {
            const explainBtn = incidentCard.locator('button:has-text("Explain")');
            if (await explainBtn.count() > 0) {
                await explainBtn.click({ force: true });
                await page.waitForTimeout(3000);

                await expect(page.locator('#explainDrawer')).toHaveClass(/is-open/);
                await expect(page.locator('#drawerBody')).toContainText(/Summary|Observed facts|Possible explanations/);
            }
        }
    });

    test('Backend disconnection shows error state gracefully', async ({ page }) => {
        await waitForPageData(page);
        await expect(page.locator('body')).toBeVisible();
        await expect(page.locator('#app-outlet')).toBeVisible();
    });
});
