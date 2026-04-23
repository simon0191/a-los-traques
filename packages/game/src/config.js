// Game-side config. Re-exports pure constants from @alostraques/sim so the sim
// package stays the source of truth, then layers host-app-supplied values on top.
export {
  FIGHTER_BODY_WIDTH,
  FIGHTER_HEIGHT,
  FIGHTER_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  GRAVITY,
  GROUND_Y,
  MAX_HP,
  MAX_SPECIAL,
  MAX_STAMINA,
  ROUND_TIME,
  ROUND_TRANSITION_FRAMES,
  ROUNDS_TO_WIN,
  SPECIAL_COST,
  STAGE_LEFT,
  STAGE_RIGHT,
  STAMINA_COSTS,
  STAMINA_REGEN,
  WALL_JUMP_X,
  WALL_JUMP_Y,
  WALL_SLIDE_SPEED,
} from '@alostraques/sim';

// Placeholder colors for fighters (before real sprites exist)
export const FIGHTER_COLORS = {
  p1: 0x3366ff,
  p2: 0xff3333,
};

// Env-derived values. Set via configureEnv() from the host app's createGame()
// factory; defaults keep the package importable in headless tests.
let _partyKitHost = 'a-los-traques.simon0191.partykit.dev';
let _isDev = false;

export function configureEnv({ partyKitHost, isDev } = {}) {
  if (partyKitHost) _partyKitHost = partyKitHost;
  if (typeof isDev === 'boolean') _isDev = isDev;
}

export function getPartyKitHost() {
  return _partyKitHost;
}

export function isDevMode() {
  return _isDev;
}
