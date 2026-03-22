/**
 * Wait for the game to expose __AUTOPLAY_ROOM_ID (set by LobbyScene when P1 creates a room).
 */
export async function waitForRoomId(page, timeout = 30_000) {
  await page.waitForFunction(() => window.__AUTOPLAY_ROOM_ID, { timeout });
  return page.evaluate(() => window.__AUTOPLAY_ROOM_ID);
}

/**
 * Wait for the fight to complete (matchComplete flag set by VictoryScene).
 */
export async function waitForMatchComplete(page, timeout = 90_000) {
  await page.waitForFunction(() => window.__FIGHT_LOG?.matchComplete === true, { timeout });
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
export function p1Url(baseUrl, { fighter, seed, aiDifficulty } = {}) {
  const params = new URLSearchParams({ autoplay: '1', createRoom: '1' });
  if (fighter) params.set('fighter', fighter);
  if (seed != null) params.set('seed', String(seed));
  if (aiDifficulty) params.set('aiDifficulty', aiDifficulty);
  return `${baseUrl}?${params}`;
}

/**
 * Build the autoplay URL for P2 (room joiner).
 */
export function p2Url(baseUrl, roomId, { fighter, seed, aiDifficulty } = {}) {
  const params = new URLSearchParams({ autoplay: '1', room: roomId });
  if (fighter) params.set('fighter', fighter);
  if (seed != null) params.set('seed', String(seed));
  if (aiDifficulty) params.set('aiDifficulty', aiDifficulty);
  return `${baseUrl}?${params}`;
}
