import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  testIgnore: '**/remote/**', // remote tests have their own config
  timeout: 300_000,
  retries: 1, // retry once — latent desync bug causes occasional flaky failures
  workers: 1, // tests share servers, run sequentially

  use: {
    headless: true,
    viewport: { width: 960, height: 540 },
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  // Phase 3: the game now ships from Next.js at /play. The helpers in
  // browser-helpers.js append /play automatically, so tests keep
  // constructing BASE_URL = http://localhost:3000.
  webServer: [
    {
      command: 'bun run dev',
      port: 3000,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'bun run party:dev',
      port: 1999,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
