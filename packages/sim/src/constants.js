// Pure constants shared across the simulation.
// Kept separate from game-side config (which also carries Vite/network-specific values).

// Internal resolution
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

// Fighter constants
export const FIGHTER_WIDTH = 128;
export const FIGHTER_HEIGHT = 128;
export const GROUND_Y = 220;
export const GRAVITY = 800;

// Combat
export const ROUND_TIME = 60;
export const ROUNDS_TO_WIN = 2;
export const ROUND_TRANSITION_FRAMES = 300;
export const MAX_HP = 100;
export const MAX_SPECIAL = 100;
export const SPECIAL_COST = 50;

// Stage bounds
export const STAGE_LEFT = 20;
export const STAGE_RIGHT = 460;

// Fighter body collision width
export const FIGHTER_BODY_WIDTH = 36;

// Stamina system
export const MAX_STAMINA = 100;
export const STAMINA_COSTS = {
  lightPunch: 15,
  heavyPunch: 28,
  lightKick: 15,
  heavyKick: 28,
  special: 35,
};
export const STAMINA_REGEN = {
  idle: 22,
  attacking: 6,
  blocking: 12,
};

// Wall jump
export const WALL_SLIDE_SPEED = 60;
export const WALL_JUMP_X = 180;
export const WALL_JUMP_Y = -320;
