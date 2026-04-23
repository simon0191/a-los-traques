/**
 * Pure combat simulation — no Phaser dependency.
 * Canonical source for hit detection, damage, body collision, and timer logic.
 * CombatSystem.js (Phaser wrapper) delegates to this for simulation methods.
 */

import { calculateDamage, comboScaledDamage } from './combat-math.js';
import { ROUND_TIME } from './constants.js';
import {
  FIGHTER_BODY_WIDTH_FP,
  FP_SCALE,
  fpClamp,
  fpRectsOverlap,
  GROUND_Y_FP,
  MAX_SPECIAL_FP,
  STAGE_LEFT_FP,
  STAGE_RIGHT_FP,
} from './FixedPoint.js';

export class CombatSim {
  constructor() {
    this.roundNumber = 1;
    this.p1RoundsWon = 0;
    this.p2RoundsWon = 0;
    this.timer = ROUND_TIME;
    this.roundActive = false;
    this.matchOver = false;
    this._timerAccumulator = 0;
    this.transitionTimer = 0;
    this.suppressRoundEvents = false;
  }

  startRound() {
    this.timer = ROUND_TIME;
    this._timerAccumulator = 0;
    this.roundActive = true;
  }

  stopRound() {
    this.roundActive = false;
  }

  /**
   * Frame-counted timer tick. Decrements timer every 60 frames.
   * @returns {{ timeup: true } | null}
   */
  tickTimer() {
    this._timerAccumulator++;
    if (this._timerAccumulator >= 60) {
      this._timerAccumulator = 0;
      this.timer--;
      if (this.timer <= 0) return { timeup: true };
    }
    return null;
  }

  /**
   * Check if attacker's hitbox overlaps defender's hurtbox and apply damage.
   * Pure — no audio/camera side effects.
   * @param {import('./FighterSim.js').FighterSim} attacker
   * @param {import('./FighterSim.js').FighterSim} defender
   * @param {Array<object>} [events] - Optional events array to push sim events onto
   * @returns {{ hit: true, ko: boolean, damage: number, isBlocking: boolean, intensity: string } | false}
   */
  checkHit(attacker, defender, events) {
    if (!attacker.currentAttack || attacker.state !== 'attacking') return false;
    if (attacker.hitConnected) return false;

    const hitbox = attacker.getAttackHitbox();
    const hurtbox = defender.getHurtbox();
    if (!hitbox || !hurtbox) return false;

    const hx = hitbox.w < 0 ? hitbox.x + hitbox.w : hitbox.x;
    const hw = Math.abs(hitbox.w);

    if (fpRectsOverlap(hx, hitbox.y, hw, hitbox.h, hurtbox.x, hurtbox.y, hurtbox.w, hurtbox.h)) {
      const wasBlocking = defender.state === 'blocking';
      const { ko, damage, intensity } = this.applyDamage(attacker, defender);
      attacker.hitConnected = true;

      if (Array.isArray(events)) {
        const hitX = Math.trunc((attacker.simX + defender.simX) / 2);
        const hitY = hurtbox.y + Math.trunc(hurtbox.h / 2);
        events.push({
          type: wasBlocking ? 'hit_blocked' : 'hit',
          attackerIndex: attacker.playerIndex,
          defenderIndex: defender.playerIndex,
          intensity,
          damage,
          ko: !!ko,
          hitX,
          hitY,
        });
      }

      return { hit: true, ko: !!ko, damage, isBlocking: wasBlocking, intensity };
    }
    return false;
  }

  /**
   * Apply damage from attacker to defender. Pure calculation.
   * @returns {{ ko: boolean, damage: number, intensity: string }}
   */
  applyDamage(attacker, defender) {
    const move = attacker.currentAttack;
    let damage = calculateDamage(
      move.damage,
      attacker.data.stats.power,
      defender.data.stats.defense,
    );

    // Combo scaling
    const isComboHit = defender.state === 'hurt' || defender.state === 'knockdown';
    if (isComboHit) {
      attacker.comboCount++;
      damage = comboScaledDamage(damage, attacker.comboCount);
    } else {
      attacker.comboCount = 0;
    }

    // Attacker gains special meter
    attacker.special = Math.min(MAX_SPECIAL_FP, attacker.special + damage * 200);

    const isSpecial = move.type === 'special';
    const isHeavy = move.type && (move.type.startsWith('heavy') || damage >= 12);
    const intensity = isSpecial ? 'special' : isHeavy ? 'heavy' : 'light';

    // Determine stun frames from move data
    const stunFrames =
      defender.state === 'blocking' ? move.blockstun || undefined : move.hitstun || undefined;

    const ko = defender.takeDamage(damage, attacker.simX, stunFrames);

    return { ko, damage, intensity };
  }

  /**
   * Resolve body collision between two fighters.
   */
  resolveBodyCollision(f1, f2) {
    const airThreshold = GROUND_Y_FP - 20 * FP_SCALE;
    if (f1.simY < airThreshold || f2.simY < airThreshold) return;

    const halfW = FIGHTER_BODY_WIDTH_FP / 2;
    const f1x = f1.simX;
    const f2x = f2.simX;

    const overlap = halfW + halfW - Math.abs(f1x - f2x);
    if (overlap <= 0) return;

    const pushEach = Math.trunc(overlap / 2);
    const sign = f1x < f2x ? -1 : 1;

    let newF1x = f1x + sign * pushEach;
    let newF2x = f2x - sign * pushEach;

    newF1x = fpClamp(newF1x, STAGE_LEFT_FP, STAGE_RIGHT_FP);
    newF2x = fpClamp(newF2x, STAGE_LEFT_FP, STAGE_RIGHT_FP);

    const remainingOverlap = halfW + halfW - Math.abs(newF1x - newF2x);
    if (remainingOverlap > 0) {
      if (newF1x <= STAGE_LEFT_FP + 1 * FP_SCALE) {
        newF2x = newF1x + FIGHTER_BODY_WIDTH_FP;
      } else if (newF1x >= STAGE_RIGHT_FP - 1 * FP_SCALE) {
        newF2x = newF1x - FIGHTER_BODY_WIDTH_FP;
      } else if (newF2x <= STAGE_LEFT_FP + 1 * FP_SCALE) {
        newF1x = newF2x + FIGHTER_BODY_WIDTH_FP;
      } else if (newF2x >= STAGE_RIGHT_FP - 1 * FP_SCALE) {
        newF1x = newF2x - FIGHTER_BODY_WIDTH_FP;
      }
      newF1x = fpClamp(newF1x, STAGE_LEFT_FP, STAGE_RIGHT_FP);
      newF2x = fpClamp(newF2x, STAGE_LEFT_FP, STAGE_RIGHT_FP);
    }

    f1.simX = newF1x;
    f2.simX = newF2x;
  }

  reset() {
    this.roundNumber = 1;
    this.p1RoundsWon = 0;
    this.p2RoundsWon = 0;
    this.timer = ROUND_TIME;
    this.roundActive = false;
    this.matchOver = false;
    this._timerAccumulator = 0;
    this.transitionTimer = 0;
    this.suppressRoundEvents = false;
  }
}

/**
 * Create a CombatSim instance. Convenience factory matching old createSimCombat() API.
 */
export function createCombatSim({ suppressRoundEvents = true } = {}) {
  const sim = new CombatSim();
  sim.suppressRoundEvents = suppressRoundEvents;
  sim.roundActive = true;
  return sim;
}
