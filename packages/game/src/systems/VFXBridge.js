/**
 * Maps simulation events to visual effects (camera shake, sparks, tint flashes).
 * Pure consumer — no simulation state mutation.
 */
import { FP_SCALE } from '@alostraques/sim';

export class VFXBridge {
  /**
   * @param {Phaser.Scene} scene - The FightScene instance
   * @param {() => import('../entities/Fighter.js').Fighter} getP1 - Getter for P1 fighter
   * @param {() => import('../entities/Fighter.js').Fighter} getP2 - Getter for P2 fighter
   */
  constructor(scene, getP1, getP2) {
    this.scene = scene;
    this._getP1 = getP1;
    this._getP2 = getP2;
  }

  /**
   * Process a batch of simulation events from one tick.
   * @param {Array<object>} events
   */
  processEvents(events) {
    for (const evt of events) {
      switch (evt.type) {
        case 'hit':
          this._handleHit(evt);
          break;
        case 'hit_blocked':
          this._handleHitBlocked(evt);
          break;
        case 'round_ko':
          this.scene.cameras.main.shake(300, 0.015);
          if (this.scene.flashScreen) this.scene.flashScreen();
          break;
      }
    }
  }

  _handleHit(evt) {
    // Hit spark
    const hitX = evt.hitX / FP_SCALE;
    const hitY = evt.hitY / FP_SCALE;
    if (this.scene.spawnHitSpark) {
      this.scene.spawnHitSpark(hitX, hitY, evt.intensity);
    }

    // Camera shake
    if (evt.intensity === 'special') {
      this.scene.cameras.main.shake(200, 0.012);
    } else if (evt.intensity === 'heavy') {
      this.scene.cameras.main.shake(100, 0.006);
    } else {
      this.scene.cameras.main.shake(50, 0.002);
    }

    // One-shot tint flashes
    const atkFighter = evt.attackerIndex === 0 ? this._getP1() : this._getP2();
    const defFighter = evt.defenderIndex === 0 ? this._getP1() : this._getP2();

    if (atkFighter?.sprite?.setTint) {
      atkFighter.sprite.setTint(0xffffff);
      this.scene.time.delayedCall(80, () => {
        if (atkFighter?.sprite?.clearTint) atkFighter.sprite.clearTint();
      });
    }
    if (defFighter?.sprite?.setTint) {
      defFighter.sprite.setTint(0xff4444);
      this.scene.time.delayedCall(150, () => {
        if (defFighter?.sprite?.clearTint) defFighter.sprite.clearTint();
      });
    }
  }

  _handleHitBlocked(evt) {
    // Hit spark (smaller for blocked hits)
    const hitX = evt.hitX / FP_SCALE;
    const hitY = evt.hitY / FP_SCALE;
    if (this.scene.spawnHitSpark) {
      this.scene.spawnHitSpark(hitX, hitY, evt.intensity);
    }
  }
}
