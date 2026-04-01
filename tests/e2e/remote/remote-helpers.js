/**
 * Helpers for connecting to BrowserStack remote browsers via Playwright CDP
 * and extracting debug data from remote game instances.
 */
import { chromium } from '@playwright/test';

/**
 * Connect to a BrowserStack browser via Playwright CDP WebSocket.
 * Returns a Playwright Browser object with full page.evaluate() support.
 *
 * @param {object} capabilities - BrowserStack capabilities (browser, os, etc.)
 * @returns {Promise<import('@playwright/test').Browser>}
 */
export async function connectRemoteBrowser(capabilities) {
  const capsJson = JSON.stringify(capabilities);
  const wsUrl = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(capsJson)}`;
  const browser = await chromium.connect(wsUrl);
  return browser;
}

/**
 * Build autoplay URL for P1 (room creator) on remote infrastructure.
 * Always uses speed=1 and debug=1 for realistic network testing.
 */
export function remoteP1Url(baseUrl, partyHost, opts = {}) {
  const params = new URLSearchParams({
    autoplay: '1',
    createRoom: '1',
    speed: String(opts.speed ?? 1),
    debug: '1',
  });
  if (partyHost) params.set('partyHost', partyHost);
  if (opts.fighter) params.set('fighter', opts.fighter);
  if (opts.seed != null) params.set('seed', String(opts.seed));
  if (opts.aiDifficulty) params.set('aiDifficulty', opts.aiDifficulty);
  return `${baseUrl}?${params}`;
}

/**
 * Build autoplay URL for P2 (room joiner) on remote infrastructure.
 */
export function remoteP2Url(baseUrl, roomId, partyHost, opts = {}) {
  const params = new URLSearchParams({
    autoplay: '1',
    room: roomId,
    speed: String(opts.speed ?? 1),
    debug: '1',
  });
  if (partyHost) params.set('partyHost', partyHost);
  if (opts.fighter) params.set('fighter', opts.fighter);
  if (opts.seed != null) params.set('seed', String(opts.seed));
  if (opts.aiDifficulty) params.set('aiDifficulty', opts.aiDifficulty);
  return `${baseUrl}?${params}`;
}

/**
 * Extract v2 debug bundle from a remote browser page.
 * Tries window.__DEBUG_BUNDLE first (richer v2 data), falls back to __FIGHT_LOG.
 */
export async function extractDebugBundle(page) {
  return page.evaluate(() => {
    if (window.__DEBUG_BUNDLE) return { version: 2, data: window.__DEBUG_BUNDLE };
    if (window.__FIGHT_LOG) return { version: 1, data: window.__FIGHT_LOG };
    return null;
  });
}

/**
 * Mark a BrowserStack session as passed or failed via executor API.
 */
export async function markSessionStatus(page, passed, reason) {
  try {
    const cmd = JSON.stringify({
      action: 'setSessionStatus',
      arguments: { status: passed ? 'passed' : 'failed', reason: reason || '' },
    });
    await page.evaluate((c) => `browserstack_executor: ${c}`, cmd);
  } catch {
    // Non-fatal — BrowserStack status is best-effort
  }
}

/**
 * Fetch server diagnostics from the PartyKit cloud server.
 * Returns null if unavailable (missing token, server unreachable, etc.)
 */
export async function fetchServerDiagnostics(partyHost, roomId) {
  const token = process.env.DIAG_TOKEN;
  if (!token) return null;

  try {
    const resp = await fetch(`https://${partyHost}/parties/main/${roomId}/diagnostics`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) return resp.json();
    return null;
  } catch {
    return null;
  }
}
