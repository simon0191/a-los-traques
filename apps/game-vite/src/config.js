// Game-side config. Re-exports pure constants from @alostraques/sim so the sim
// package stays the source of truth, then layers Vite-specific values on top.
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

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ||
  (import.meta.env.DEV ? 'localhost:1999' : 'a-los-traques.simon0191.partykit.dev');

// Placeholder colors for fighters (before real sprites exist)
export const FIGHTER_COLORS = {
  p1: 0x3366ff,
  p2: 0xff3333,
};
