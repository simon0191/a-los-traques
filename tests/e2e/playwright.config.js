import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
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

  webServer: [
    {
      command: 'bun run dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: 'bun run party:dev',
      port: 1999,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
