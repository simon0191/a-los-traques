/**
 * Wait for the game to expose __AUTOPLAY_ROOM_ID (set by LobbyScene when P1 creates a room).
 */
export async function waitForRoomId(page, timeout = 30_000) {
  await page.waitForFunction(() => window.__AUTOPLAY_ROOM_ID, { timeout });
  return page.evaluate(() => window.__AUTOPLAY_ROOM_ID);
}

/**
 * Wait for the fight to complete (matchComplete flag set by VictoryScene).
 *
 * When `pollInterval` is set, uses a polling loop with periodic page.evaluate()
 * calls instead of a single waitForFunction. This keeps the CDP WebSocket active,
 * preventing BrowserStack from killing the session due to idle timeout (default 90s).
 */
export async function waitForMatchComplete(page, timeout = 110_000, { pollInterval } = {}) {
  if (!pollInterval) {
    await page.waitForFunction(() => window.__FIGHT_LOG?.matchComplete === true, { timeout });
    return;
  }

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => window.__FIGHT_LOG?.matchComplete === true);
    if (done) return;
    await new Promise((r) => setTimeout(r, Math.min(pollInterval, deadline - Date.now())));
  }
  throw new Error(`waitForMatchComplete: timed out after ${timeout}ms`);
}

/**
 * Wait until the fight is in progress (enough frames simulated).
 * Used to ensure the fight is running before injecting network disruptions.
 */
export async function waitForFightInProgress(page, minFrames = 120, timeout = 60_000) {
  await page.waitForFunction((min) => (window.__FIGHT_LOG?.totalFrames ?? 0) > min, minFrames, {
    timeout,
  });
}

/**
 * Extract the full fight log from a page.
 */
export async function extractFightLog(page) {
  return page.evaluate(() => window.__FIGHT_LOG);
}

/**
 * Build the autoplay URL for P1 (room creator).
 */
/** Default speed multiplier for E2E tests (2x overclock) */
export const DEFAULT_SPEED = 2;

export function p1Url(baseUrl, { fighter, seed, aiDifficulty, speed = DEFAULT_SPEED } = {}) {
  const params = new URLSearchParams({ autoplay: '1', createRoom: '1' });
  if (fighter) params.set('fighter', fighter);
  if (seed != null) params.set('seed', String(seed));
  if (aiDifficulty) params.set('aiDifficulty', aiDifficulty);
  if (speed > 1) params.set('speed', String(speed));
  return `${baseUrl}/play?${params}`;
}

/**
 * Build the autoplay URL for P2 (room joiner).
 */
export function p2Url(
  baseUrl,
  roomId,
  { fighter, seed, aiDifficulty, speed = DEFAULT_SPEED } = {},
) {
  const params = new URLSearchParams({ autoplay: '1', room: roomId });
  if (fighter) params.set('fighter', fighter);
  if (seed != null) params.set('seed', String(seed));
  if (aiDifficulty) params.set('aiDifficulty', aiDifficulty);
  if (speed > 1) params.set('speed', String(speed));
  return `${baseUrl}/play?${params}`;
}
