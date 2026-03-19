/**
 * Fixed-point arithmetic module for deterministic physics simulation.
 * All positions/velocities use integers scaled by FP_SCALE (1000x).
 * Zero Phaser dependencies.
 */

// Scale factor
export const FP_SCALE = 1000;

// Position constants (pixels * FP_SCALE)
export const GROUND_Y_FP = 220 * FP_SCALE;
export const STAGE_LEFT_FP = 20 * FP_SCALE;
export const STAGE_RIGHT_FP = 460 * FP_SCALE;

// Physics constants
export const GRAVITY_PER_FRAME_FP = Math.trunc((800 * FP_SCALE) / 60); // 13_333
export const JUMP_VY_FP = -350 * FP_SCALE;
export const DOUBLE_JUMP_VY_FP = -380 * FP_SCALE;
export const WALL_JUMP_X_FP = 180 * FP_SCALE;
export const WALL_JUMP_Y_FP = -320 * FP_SCALE;
export const WALL_SLIDE_SPEED_FP = 60 * FP_SCALE;
export const KNOCKBACK_VX_FP = 150 * FP_SCALE;
export const KNOCKBACK_VY_FP = -200 * FP_SCALE;

// Body collision
export const FIGHTER_BODY_WIDTH_FP = 36 * FP_SCALE;

// Stamina (stored as value * FP_SCALE for fractional regen)
export const MAX_STAMINA_FP = 100 * FP_SCALE;
export const STAMINA_REGEN_IDLE_PER_FRAME_FP = Math.trunc((22 * FP_SCALE) / 60); // 366
export const STAMINA_REGEN_ATTACKING_PER_FRAME_FP = Math.trunc((6 * FP_SCALE) / 60); // 100
export const STAMINA_REGEN_BLOCKING_PER_FRAME_FP = Math.trunc((12 * FP_SCALE) / 60); // 200

// Special meter (stored as value * FP_SCALE)
export const MAX_SPECIAL_FP = 100 * FP_SCALE;
export const SPECIAL_COST_FP = 50 * FP_SCALE;

// Timing thresholds (in frames)
export const DOUBLE_JUMP_AIRBORNE_THRESHOLD = 6; // ~100ms at 60fps
export const HURT_TIMER_KNOCKDOWN = 48; // ~800ms at 60fps
export const HURT_TIMER_LIGHT = 18; // ~300ms at 60fps
export const SPECIAL_TINT_MAX_FRAMES = 24; // ~400ms at 60fps

// Wall detection threshold
export const WALL_DETECT_THRESHOLD_FP = 2 * FP_SCALE;

// Online input delay (frames) — shared constant for NetworkManager + RollbackManager
export const ONLINE_INPUT_DELAY = 3;

/** Convert fixed-point value to pixel value. */
export function fpToPixels(fp) {
  return fp / FP_SCALE;
}

/** Convert pixel value to fixed-point (truncates toward zero). */
export function pixelsToFP(px) {
  return Math.trunc(px * FP_SCALE);
}

/** Integer clamp — replaces Phaser.Math.Clamp for simulation code. */
export function fpClamp(val, min, max) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

/**
 * Integer AABB overlap test — replaces Phaser.Geom.Rectangle.Overlaps.
 * All parameters are fixed-point integers.
 */
export function fpRectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Convert milliseconds to frame count (rounded). */
export function msToFrames(ms) {
  return Math.round((ms * 60) / 1000);
}
