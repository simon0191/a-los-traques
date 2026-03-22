import { ROUND_TIME, ROUNDS_TO_WIN } from '../config.js';
import { calculateDamage, comboScaledDamage } from './combat-math.js';
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

export { calculateDamage } from './combat-math.js';

export class CombatSystem {
  constructor(scene) {
    this.scene = scene;
    this.roundNumber = 1;
    this.p1RoundsWon = 0;
    this.p2RoundsWon = 0;
    this.timer = ROUND_TIME;
    this.roundActive = false;
    this.matchOver = false;
    this.timerEvent = null;
    this._timerAccumulator = 0;
    this.suppressRoundEvents = false;
  }

  startRound() {
    this.timer = ROUND_TIME;
    this._timerAccumulator = 0;
    this.roundActive = true;

    if (this.scene.gameMode === 'online') return;

    const isSpectator = this.scene.gameMode === 'spectator';
    this.timerEvent = this.scene.time.addEvent({
      delay: 1000,
      callback: () => {
        if (!isSpectator) {
          this.timer--;
          if (this.timer <= 0) this.timeUp();
        }
      },
      loop: true,
    });
  }

  stopRound() {
    this.roundActive = false;
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
  }

  /**
   * Frame-counted timer tick for deterministic simulation.
   * Called once per simulation frame. Decrements timer every 60 frames.
   * Returns { timeup: true } when timer reaches 0, null otherwise.
   * In local mode (!suppressRoundEvents), also fires timeUp() directly.
   * @param {{ muteEffects?: boolean }} [options]
   * @returns {{ timeup: true } | null}
   */
  tickTimer({ muteEffects = false } = {}) {
    this._timerAccumulator++;
    if (this._timerAccumulator >= 60) {
      this._timerAccumulator = 0;
      this.timer--;
      if (this.timer <= 0) {
        if (!muteEffects && !this.suppressRoundEvents) this.timeUp();
        return { timeup: true };
      }
    }
    return null;
  }

  /**
   * Check if attacker's hitbox overlaps defender's hurtbox and apply damage.
   * Returns { hit: true, ko: boolean } on hit, false on miss.
   * @returns {{ hit: true, ko: boolean } | false}
   */
  checkHit(attacker, defender, { muteEffects = false } = {}) {
    if (!attacker.currentAttack || attacker.state !== 'attacking') return false;
    if (attacker.hitConnected) return false;

    const hitbox = attacker.getAttackHitbox();
    const hurtbox = defender.getHurtbox();
    if (!hitbox || !hurtbox) return false;

    // Normalize hitbox (w could be negative if facing left)
    const hx = hitbox.w < 0 ? hitbox.x + hitbox.w : hitbox.x;
    const hw = Math.abs(hitbox.w);

    if (fpRectsOverlap(hx, hitbox.y, hw, hitbox.h, hurtbox.x, hurtbox.y, hurtbox.w, hurtbox.h)) {
      const ko = this.applyDamage(attacker, defender, { muteEffects });
      attacker.hitConnected = true;
      return { hit: true, ko: !!ko };
    }
    return false;
  }

  applyDamage(attacker, defender, { muteEffects = false } = {}) {
    if (this.scene.devConsole?.godMode && defender.playerIndex === 0) {
      return;
    }

    const move = attacker.currentAttack;
    let damage = calculateDamage(
      move.damage,
      attacker.data.stats.power,
      defender.data.stats.defense,
    );

    // Combo scaling: if defender is already in hitstun/knockdown, apply scaling
    const isComboHit = defender.state === 'hurt' || defender.state === 'knockdown';
    if (isComboHit) {
      attacker.comboCount++;
      damage = comboScaledDamage(damage, attacker.comboCount);
    } else {
      attacker.comboCount = 0;
    }

    // Attacker gains special meter (0.2 * FP_SCALE = 200)
    attacker.special = Math.min(MAX_SPECIAL_FP, attacker.special + damage * 200);

    const isSpecial = move.type === 'special';
    const isHeavy = move.type && (move.type.startsWith('heavy') || damage >= 12);
    const intensity = isSpecial ? 'special' : isHeavy ? 'heavy' : 'light';

    if (!muteEffects) {
      const audio = this.scene.game.audioManager;
      if (defender.state === 'blocking') {
        audio.play('hit_block');
      } else if (isSpecial) {
        audio.play('hit_special');
      } else if (isHeavy) {
        audio.play('hit_heavy');
      } else {
        audio.play('hit_light');
      }
    }

    // Determine stun frames from move data
    const stunFrames =
      defender.state === 'blocking' ? move.blockstun || undefined : move.hitstun || undefined;

    // Defender takes damage (pass attacker's simX for knockback direction)
    const ko = defender.takeDamage(damage, attacker.simX, stunFrames);

    if (!muteEffects) {
      // Hit spark at pixel position (convert from FP for display)
      const hitX = (attacker.simX + defender.simX) / 2 / FP_SCALE;
      const hitY = defender.simY / FP_SCALE - 35;
      if (this.scene.spawnHitSpark) {
        this.scene.spawnHitSpark(hitX, hitY, intensity);
      }

      if (intensity === 'special') {
        this.scene.cameras.main.shake(200, 0.012);
      } else if (intensity === 'heavy') {
        this.scene.cameras.main.shake(100, 0.006);
      } else {
        this.scene.cameras.main.shake(50, 0.002);
      }

      if (attacker.sprite?.setTint) {
        attacker.sprite.setTint(0xffffff);
        this.scene.time.delayedCall(80, () => {
          if (attacker.sprite?.clearTint) attacker.sprite.clearTint();
        });
      }
      if (defender.sprite?.setTint) {
        defender.sprite.setTint(0xff4444);
        this.scene.time.delayedCall(150, () => {
          if (defender.sprite?.clearTint) defender.sprite.clearTint();
        });
      }
    }

    if (ko && !muteEffects && !this.suppressRoundEvents) {
      this.handleKO(attacker, defender);
    }

    return ko;
  }

  timeUp() {
    this.stopRound();
    this.scene.game.audioManager.play('announce_timeup');
    this._lastEndReason = 'timeup';
    const p1 = this.scene.p1Fighter;
    const p2 = this.scene.p2Fighter;
    if (p1.hp > p2.hp) {
      this.roundWin(0);
    } else if (p2.hp > p1.hp) {
      this.roundWin(1);
    } else {
      this.roundWin(0);
    }
  }

  handleKO(winner, _loser) {
    this.stopRound();
    this.scene.game.audioManager.play('ko');
    const winnerIndex = winner.playerIndex;
    this.scene.cameras.main.shake(300, 0.015);
    if (this.scene.flashScreen) {
      this.scene.flashScreen();
    }
    this.roundWin(winnerIndex);
  }

  /**
   * Handle a round-ending event from deferred round event detection.
   * Used by online mode where round events are captured from simulateFrame()
   * return values instead of firing directly inside the simulation.
   * @param {{ type: 'ko'|'timeup', winnerIndex: number }} roundEvent
   */
  handleRoundEnd(roundEvent) {
    this.stopRound();
    if (roundEvent.type === 'ko') {
      this.scene.game.audioManager.play('ko');
      this.scene.cameras.main.shake(300, 0.015);
      if (this.scene.flashScreen) {
        this.scene.flashScreen();
      }
    } else if (roundEvent.type === 'timeup') {
      this.scene.game.audioManager.play('announce_timeup');
      this._lastEndReason = 'timeup';
    }
    this.roundWin(roundEvent.winnerIndex);
  }

  roundWin(playerIndex) {
    if (playerIndex === 0) this.p1RoundsWon++;
    else this.p2RoundsWon++;

    if (this.p1RoundsWon >= ROUNDS_TO_WIN || this.p2RoundsWon >= ROUNDS_TO_WIN) {
      this.matchOver = true;
      this.scene.onMatchOver(playerIndex);
    } else {
      this.roundNumber++;
      this.scene.onRoundOver(playerIndex);
    }
  }

  /**
   * Resolve body collision between two fighters so they cannot overlap.
   * Uses FP simulation coordinates (simX/simY).
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
    this.suppressRoundEvents = false;
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
  }
}
