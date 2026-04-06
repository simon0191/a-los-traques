/**
 * Browser capability presets for hybrid E2E testing: local Chromium (P1) + BrowserStack (P2).
 *
 * P1 is always the local Chromium launched by Playwright on the developer's machine.
 * Only P2 needs BrowserStack capabilities — this halves BrowserStack session cost
 * compared to the fully-remote test.
 *
 * Controlled via HYBRID_E2E_PRESET env var (default: 'default').
 */

const buildName =
  process.env.BROWSERSTACK_BUILD_NAME ||
  `hybrid-e2e-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}`;

export const HYBRID_PRESETS = {
  // Default: local Chromium (P1) vs Chrome on Windows (P2)
  default: {
    p2: {
      browser: 'chrome',
      browser_version: 'latest',
      os: 'Windows',
      os_version: '11',
      name: 'Hybrid-P2-Chrome-Win',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
  },

  // Local Chromium (P1) vs Safari/WebKit on macOS (P2)
  'local-webkit': {
    p2: {
      browser: 'playwright-webkit',
      browser_version: 'latest',
      os: 'OS X',
      os_version: 'Sonoma',
      name: 'Hybrid-P2-WebKit-Mac',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
  },
};
