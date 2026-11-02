// Playwright configuration for Restorm Phase 5 E2E tests
// Tests run against the live dev server at http://localhost:4004/

module.exports = {
    testDir: './test-e2e',
    fullyParallel: false, // serialize to avoid port conflicts with the single dev server
    retries: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:4004',
        headless: true,
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
        actionTimeout: 10000,
        navigationTimeout: 15000,
        // Basic auth credentials for the CAP mocked auth (alice/bob/admin with empty password)
        httpCredentials: { username: 'bob', password: '' },
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
};
