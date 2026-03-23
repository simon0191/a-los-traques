/**
 * Deterministic frame advance for rollback netcode.
 * Extracts a pure simulation step from FightScene.
 * Frame-based — no delta time needed.
 */

import { GAME_WIDTH, ROUND_TIME, ROUND_TRANSITION_FRAMES, ROUNDS_TO_WIN } from '../config.js';
import { FP_SCALE } from './FixedPoint.js';
import { decodeInput } from './InputBuffer.js';

const P1_START_X = GAME_WIDTH * 0.3;
const P2_START_X = GAME_WIDTH * 0.7;

/**
 * Apply decoded input to a fighter.
 * @param {import('../entities/Fighter.js').Fighter} fighter
 * @param {object} inputState - { left, right, up, down, lp, hp, lk, hk, sp }
 */
export function applyInputToFighter(fighter, inputState) {
  const speed = (80 + fighter.data.stats.speed * 20) * FP_SCALE;

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
 * No delta parameter — all physics is frame-based integer math.
 * Returns an optional round event descriptor when KO or timeup is detected.
 * @param {import('../entities/Fighter.js').Fighter} p1Fighter
 * @param {import('../entities/Fighter.js').Fighter} p2Fighter
 * @param {import('./CombatSystem.js').CombatSystem} combat
 * @param {number} p1Input - Encoded input for P1
 * @param {number} p2Input - Encoded input for P2
 * @param {{ muteEffects?: boolean }} [options]
 * @returns {{ type: 'ko'|'timeup', winnerIndex: number } | null}
 */
export function simulateFrame(
  p1Fighter,
  p2Fighter,
  combat,
  p1Input,
  p2Input,
  { muteEffects = false } = {},
) {
  // 1. Update fighters (gravity, cooldowns, timers, ground check)
  p1Fighter.update();
  p2Fighter.update();

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

  // 5. Hit detection + timer tick → capture round events (only when round is active)
  let roundEvent = null;
  if (combat.roundActive) {
    const p1Hit = combat.checkHit(p1Fighter, p2Fighter, { muteEffects });
    const p2Hit = combat.checkHit(p2Fighter, p1Fighter, { muteEffects });

    if (p1Hit?.ko) roundEvent = { type: 'ko', winnerIndex: 0 };
    else if (p2Hit?.ko) roundEvent = { type: 'ko', winnerIndex: 1 };

    // 6. Tick timer
    const timerResult = combat.tickTimer({ muteEffects });
    if (!roundEvent && timerResult?.timeup) {
      roundEvent = {
        type: 'timeup',
        winnerIndex: p1Fighter.hp >= p2Fighter.hp ? 0 : 1,
      };
    }

    // Update all round state on the frame that detects a round event.
    // Both peers must reach identical state at the same simulation frame,
    // regardless of when the network round-event message arrives at P2.
    // handleRoundEnd() still fires for audio/visual effects, but all
    // simulation state (roundActive, roundsWon, roundNumber, velocities)
    // is set here so both peers agree.
    if (roundEvent) {
      combat.roundActive = false;
      p1Fighter.simVX = 0;
      p2Fighter.simVX = 0;
      if (roundEvent.winnerIndex === 0) combat.p1RoundsWon++;
      else combat.p2RoundsWon++;
      combat.roundNumber++;
      if (combat.p1RoundsWon >= ROUNDS_TO_WIN || combat.p2RoundsWon >= ROUNDS_TO_WIN) {
        combat.matchOver = true;
      }
      // Start frame-based transition countdown (deterministic, both peers agree)
      if (!combat.matchOver) {
        combat.transitionTimer = ROUND_TRANSITION_FRAMES;
      }
    }
  }

  // 6b. Tick transition timer — deterministic round reset for online mode
  if (!combat.roundActive && combat.transitionTimer > 0) {
    combat.transitionTimer--;
    if (combat.transitionTimer <= 0 && !combat.matchOver) {
      // Reset fighters for next round (simulation-safe, no sprite/audio calls)
      p1Fighter.resetForRound(P1_START_X);
      p2Fighter.resetForRound(P2_START_X);
      combat.timer = ROUND_TIME;
      combat._timerAccumulator = 0;
      combat.roundActive = true;
    }
  }

  // 7. Sync sprites (rendering only)
  p1Fighter.syncSprite();
  p2Fighter.syncSprite();

  return roundEvent;
}
