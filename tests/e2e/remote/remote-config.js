/**
 * Browser capability presets and defaults for remote E2E testing via BrowserStack.
 *
 * Each preset defines P1 and P2 browser capabilities. The two sessions run on
 * separate BrowserStack machines so they communicate over real network infrastructure.
 *
 * Uses Playwright CDP connection (not browserstack-node-sdk) so each browser
 * is an independent session — enabling cross-browser, cross-OS testing.
 */

const buildName =
  process.env.BROWSERSTACK_BUILD_NAME ||
  `remote-e2e-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}`;

export const PRESETS = {
  // Default: Chrome on Windows (P1) + Safari on macOS (P2)
  default: {
    p1: {
      browser: 'chrome',
      browser_version: 'latest',
      os: 'Windows',
      os_version: '11',
      name: 'E2E-P1-Chrome-Win',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
    p2: {
      browser: 'playwright-webkit',
      browser_version: 'latest',
      os: 'OS X',
      os_version: 'Sonoma',
      name: 'E2E-P2-WebKit-Mac',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
  },

  // Same browser: isolate network effects from browser differences
  'chrome-chrome': {
    p1: {
      browser: 'chrome',
      browser_version: 'latest',
      os: 'Windows',
      os_version: '11',
      name: 'E2E-P1-Chrome-Win',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
    p2: {
      browser: 'chrome',
      browser_version: 'latest',
      os: 'OS X',
      os_version: 'Sonoma',
      name: 'E2E-P2-Chrome-Mac',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
  },

  // WebKit on both: test Safari-like behavior on both sides
  'webkit-webkit': {
    p1: {
      browser: 'playwright-webkit',
      browser_version: 'latest',
      os: 'OS X',
      os_version: 'Sonoma',
      name: 'E2E-P1-WebKit-Mac',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
    p2: {
      browser: 'playwright-webkit',
      browser_version: 'latest',
      os: 'OS X',
      os_version: 'Ventura',
      name: 'E2E-P2-WebKit-Mac',
      build: buildName,
      'browserstack.username': process.env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    },
  },
};

// Server URLs
export const STAGING_BASE_URL = process.env.REMOTE_E2E_BASE_URL || 'https://alostraques.com';
export const STAGING_PARTY_HOST =
  process.env.REMOTE_E2E_PARTY_HOST || 'a-los-traques.simon0191.partykit.dev';

// Timeouts — remote browsers are slower than local
export const REMOTE_ROOM_TIMEOUT = 60_000; // 60s (vs 30s local)
export const REMOTE_MATCH_TIMEOUT = 180_000; // 3min (speed=1, real latency)
export const REMOTE_PAGE_LOAD_TIMEOUT = 30_000; // 30s initial page load
