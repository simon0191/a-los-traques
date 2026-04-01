import { defineConfig } from '@playwright/test';

/**
 * Playwright config for remote BrowserStack E2E tests.
 *
 * Key differences from local config:
 * - No webServer (uses deployed staging infrastructure)
 * - No retries (remote sessions are expensive)
 * - Longer timeout (speed=1 + real network latency)
 */
export default defineConfig({
	testDir: '.',
	testMatch: '**/*.spec.js',
	timeout: 300_000, // 5 minutes per test
	retries: 0, // remote sessions cost $, don't retry
	workers: 1,

	use: {
		headless: true,
		viewport: { width: 960, height: 540 },
	},

	// No webServer — remote tests hit deployed staging
});
