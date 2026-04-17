// Internal resolution - scaled up via Phaser.Scale.FIT
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

export const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST ||
  (import.meta.env.DEV ? 'localhost:1999' : 'a-los-traques.simon0191.partykit.dev');

// Fighter constants
export const FIGHTER_WIDTH = 128;
export const FIGHTER_HEIGHT = 128;
export const GROUND_Y = 220; // Y position of the floor
export const GRAVITY = 800;

// Combat
export const ROUND_TIME = 60; // seconds
export const ROUNDS_TO_WIN = 2;
export const ROUND_TRANSITION_FRAMES = 300; // ~5s at 60fps — pause between rounds in online mode
export const MAX_HP = 100;
export const MAX_SPECIAL = 100;
export const SPECIAL_COST = 50;

// Placeholder colors for fighters (before real sprites exist)
export const FIGHTER_COLORS = {
  p1: 0x3366ff,
  p2: 0xff3333,
};

// Stage bounds
export const STAGE_LEFT = 20;
export const STAGE_RIGHT = 460;

// Fighter body collision width (used for push-back between fighters)
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
  idle: 22, // per second
  attacking: 6, // per second
  blocking: 12, // per second
};

// Wall jump
export const WALL_SLIDE_SPEED = 60; // max fall speed when touching wall
export const WALL_JUMP_X = 180; // horizontal push-away velocity
export const WALL_JUMP_Y = -320; // vertical velocity
