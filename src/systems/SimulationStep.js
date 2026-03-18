/**
 * Deterministic frame advance for rollback netcode.
 * Extracts a pure simulation step from FightScene.
 */

import { decodeInput } from './InputBuffer.js';

/** Fixed delta for online simulation (60fps) */
export const FIXED_DELTA = 1000 / 60;

/**
 * Apply decoded input to a fighter.
 * @param {import('../entities/Fighter.js').Fighter} fighter
 * @param {object} inputState - { left, right, up, down, lp, hp, lk, hk, sp }
 */
export function applyInputToFighter(fighter, inputState) {
  const speed = 80 + (fighter.data.stats.speed * 20);

  if (inputState.left) {
    fighter.moveLeft(speed);
  } else if (inputState.right) {
    fighter.moveRight(speed);
  } else {
    fighter.stop();
  }

  if (inputState.up) {
    fighter.jump();
  }

  if (inputState.down && fighter.isOnGround) fighter.block();

  if (inputState.lp) fighter.attack('lightPunch');
  else if (inputState.hp) fighter.attack('heavyPunch');
  else if (inputState.lk) fighter.attack('lightKick');
  else if (inputState.hk) fighter.attack('heavyKick');
  else if (inputState.sp) fighter.attack('special');
}

/**
 * Run one deterministic simulation frame.
 * @param {import('../entities/Fighter.js').Fighter} p1Fighter
 * @param {import('../entities/Fighter.js').Fighter} p2Fighter
 * @param {import('./CombatSystem.js').CombatSystem} combat
 * @param {number} p1Input - Encoded input for P1
 * @param {number} p2Input - Encoded input for P2
 * @param {number} delta - Frame delta in ms (should be FIXED_DELTA for online)
 * @param {{ muteEffects?: boolean }} [options]
 */
export function simulateFrame(p1Fighter, p2Fighter, combat, p1Input, p2Input, delta, { muteEffects = false } = {}) {
  // 1. Update fighters (gravity, cooldowns, timers, ground check)
  p1Fighter.update(null, delta);
  p2Fighter.update(null, delta);

  // 2. Apply inputs
  const p1State = decodeInput(p1Input);
  const p2State = decodeInput(p2Input);
  applyInputToFighter(p1Fighter, p1State);
  applyInputToFighter(p2Fighter, p2State);

  // 3. Resolve body collision
  combat.resolveBodyCollision(p1Fighter, p2Fighter);

  // 4. Face opponent
  p1Fighter.faceOpponent(p2Fighter);
  p2Fighter.faceOpponent(p1Fighter);

  // 5. Hit detection (both directions)
  if (combat.roundActive) {
    combat.checkHit(p1Fighter, p2Fighter, { muteEffects });
    combat.checkHit(p2Fighter, p1Fighter, { muteEffects });

    // 6. Tick timer
    combat.tickTimer();
  }
}
