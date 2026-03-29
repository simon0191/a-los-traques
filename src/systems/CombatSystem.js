import { CombatSim } from '../simulation/CombatSim.js';

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

    // Phaser timer event (spectator mode only — local/online use tick())
    this.timerEvent = null;
  }

  startRound() {
    this.sim.startRound();

    // Only spectator mode needs a Phaser timer — local and online use
    // frame-based tickTimer() inside tick() for deterministic simulation.
    if (this.scene.gameMode !== 'spectator') return;

    this.timerEvent = this.scene.time.addEvent({
      delay: 1000,
      callback: () => {
        this.sim.timer--;
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
   * @returns {{ timeup: true } | null}
   */
  tickTimer() {
    return this.sim.tickTimer();
  }

  /**
   * Check hit and apply damage. Audio/VFX handled by bridges via sim events.
   * @param {*} attacker
   * @param {*} defender
   * @param {Array<object>} [events] - Optional events array for bridge consumption
   * @returns {{ hit: true, ko: boolean } | false}
   */
  checkHit(attacker, defender, events) {
    const atkSim = attacker.sim || attacker;
    const defSim = defender.sim || defender;

    const result = this.sim.checkHit(atkSim, defSim, events);
    if (!result) return false;

    return { hit: true, ko: result.ko };
  }

  /**
   * Resolve body collision. Delegates to CombatSim.
   */
  resolveBodyCollision(f1, f2) {
    const s1 = f1.sim || f1;
    const s2 = f2.sim || f2;
    this.sim.resolveBodyCollision(s1, s2);
  }

  reset() {
    this.sim.reset();
    if (this.timerEvent) {
      this.timerEvent.remove();
      this.timerEvent = null;
    }
  }
}
