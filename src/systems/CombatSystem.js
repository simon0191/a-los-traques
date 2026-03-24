import { ROUNDS_TO_WIN } from '../config.js';
import { CombatSim } from '../simulation/CombatSim.js';
import { FP_SCALE } from './FixedPoint.js';

export { calculateDamage } from './combat-math.js';

/**
 * CombatSim state fields proxied to CombatSystem.
 */
const SIM_FIELDS = [
  'roundNumber',
  'p1RoundsWon',
  'p2RoundsWon',
  'timer',
  'roundActive',
  'matchOver',
  '_timerAccumulator',
  'transitionTimer',
  'suppressRoundEvents',
];

export class CombatSystem {
  constructor(scene) {
    this.scene = scene;

    // Pure simulation state — canonical source of truth
    this.sim = new CombatSim();

    // Proxy all simulation fields
    for (const field of SIM_FIELDS) {
      Object.defineProperty(this, field, {
        get() {
          return this.sim[field];
        },
        set(v) {
          this.sim[field] = v;
        },
        enumerable: true,
        configurable: true,
      });
    }

    // Phaser timer event (local mode only)
    this.timerEvent = null;
  }

  startRound() {
    this.sim.startRound();

    if (this.scene.gameMode === 'online') return;

    const isSpectator = this.scene.gameMode === 'spectator';
    this.timerEvent = this.scene.time.addEvent({
      delay: 1000,
      callback: () => {
        if (!isSpectator) {
          this.sim.timer--;
          if (this.sim.timer <= 0) this.timeUp();
        }
      },
      loop: true,
    });
  }

  stopRound() {
    this.sim.stopRound();
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
  }

  /**
   * Frame-counted timer tick for deterministic simulation.
   * @param {{ muteEffects?: boolean }} [options]
   * @returns {{ timeup: true } | null}
   */
  tickTimer({ muteEffects = false } = {}) {
    const result = this.sim.tickTimer();
    if (result?.timeup && !muteEffects && !this.sim.suppressRoundEvents) {
      this.timeUp();
    }
    return result;
  }

  /**
   * Check hit and apply damage with side effects.
   * @returns {{ hit: true, ko: boolean } | false}
   */
  checkHit(attacker, defender, { muteEffects = false } = {}) {
    // Use the attacker/defender's sim if available, otherwise use directly
    const atkSim = attacker.sim || attacker;
    const defSim = defender.sim || defender;

    const result = this.sim.checkHit(atkSim, defSim);
    if (!result) return false;

    if (!muteEffects) {
      this._playHitEffects(attacker, defender, result);
    }

    if (result.ko && !muteEffects && !this.sim.suppressRoundEvents) {
      this.handleKO(attacker, defender);
    }

    return { hit: true, ko: result.ko };
  }

  _playHitEffects(attacker, defender, hitResult) {
    const audio = this.scene.game.audioManager;
    const defSim = defender.sim || defender;

    if (defSim.state === 'blocking') {
      audio.play('hit_block');
    } else if (hitResult.intensity === 'special') {
      audio.play('hit_special');
    } else if (hitResult.intensity === 'heavy') {
      audio.play('hit_heavy');
    } else {
      audio.play('hit_light');
    }

    // Hit spark
    const atkSim = attacker.sim || attacker;
    const hitX = (atkSim.simX + defSim.simX) / 2 / FP_SCALE;
    const hitY = defSim.simY / FP_SCALE - 35;
    if (this.scene.spawnHitSpark) {
      this.scene.spawnHitSpark(hitX, hitY, hitResult.intensity);
    }

    // Camera shake
    if (hitResult.intensity === 'special') {
      this.scene.cameras.main.shake(200, 0.012);
    } else if (hitResult.intensity === 'heavy') {
      this.scene.cameras.main.shake(100, 0.006);
    } else {
      this.scene.cameras.main.shake(50, 0.002);
    }

    // Flash tints
    const atkSprite = attacker.sprite;
    const defSprite = defender.sprite;
    if (atkSprite?.setTint) {
      atkSprite.setTint(0xffffff);
      this.scene.time.delayedCall(80, () => {
        if (atkSprite?.clearTint) atkSprite.clearTint();
      });
    }
    if (defSprite?.setTint) {
      defSprite.setTint(0xff4444);
      this.scene.time.delayedCall(150, () => {
        if (defSprite?.clearTint) defSprite.clearTint();
      });
    }
  }

  /**
   * Resolve body collision. Delegates to CombatSim.
   */
  resolveBodyCollision(f1, f2) {
    const s1 = f1.sim || f1;
    const s2 = f2.sim || f2;
    this.sim.resolveBodyCollision(s1, s2);
  }

  // --- Side-effect methods (audio, camera, scene callbacks) ---

  timeUp() {
    this.stopRound();
    this.scene.game.audioManager.play('announce_timeup');
    this._lastEndReason = 'timeup';
    const p1 = this.scene.p1Fighter;
    const p2 = this.scene.p2Fighter;
    const p1Hp = p1.sim ? p1.sim.hp : p1.hp;
    const p2Hp = p2.sim ? p2.sim.hp : p2.hp;
    if (p1Hp > p2Hp) {
      this.roundWin(0);
    } else if (p2Hp > p1Hp) {
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
    if (this.sim.matchOver) {
      this.scene.onMatchOver(roundEvent.winnerIndex);
    } else {
      this.scene.onRoundOver(roundEvent.winnerIndex);
    }
  }

  roundWin(playerIndex) {
    if (playerIndex === 0) this.sim.p1RoundsWon++;
    else this.sim.p2RoundsWon++;

    if (this.sim.p1RoundsWon >= ROUNDS_TO_WIN || this.sim.p2RoundsWon >= ROUNDS_TO_WIN) {
      this.sim.matchOver = true;
      this.scene.onMatchOver(playerIndex);
    } else {
      this.sim.roundNumber++;
      this.scene.onRoundOver(playerIndex);
    }
  }

  reset() {
    this.sim.reset();
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
  }
}
