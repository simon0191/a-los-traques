import { FighterSim } from '../simulation/FighterSim.js';
import { FP_SCALE } from '../systems/FixedPoint.js';

export { calculateBlockDamage } from './combat-block.js';

/**
 * All FighterSim state fields proxied to Fighter via getters/setters.
 * Existing code reads/writes fighter.simX and it transparently goes to fighter.sim.simX.
 */
const SIM_FIELDS = [
  'simX',
  'simY',
  'simVX',
  'simVY',
  'hp',
  'special',
  'stamina',
  'state',
  'facingRight',
  'attackCooldown',
  'attackFrameElapsed',
  'currentAttack',
  'hitConnected',
  'comboCount',
  '_specialTintTimer',
  'blockTimer',
  'hurtTimer',
  'isOnGround',
  'hasDoubleJumped',
  '_airborneTime',
  '_isTouchingWall',
  '_wallDir',
  '_hasWallJumped',
  '_prevAnimState',
];

export class Fighter {
  constructor(scene, x, y, textureKey, fighterData, playerIndex) {
    this.scene = scene;
    this.playerIndex = playerIndex;
    this.data = fighterData;

    // Pure simulation state — canonical source of truth
    this.sim = new FighterSim(x, playerIndex, fighterData);

    // Proxy all simulation fields so existing code (GameState, SimulationStep, etc.) works
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

    // FighterSim starts at GROUND_Y, but Fighter gets an explicit y from the scene
    this.sim.simY = Math.trunc(y * FP_SCALE);

    // Phaser sprite
    this.sprite = scene.physics.add.sprite(x, y, textureKey);
    this.sprite.setOrigin(0.5, 1);
    this.sprite.body.moves = false;
    this.sprite.body.setAllowGravity(false);

    // Animation detection
    this.fighterId = fighterData.id;
    const idleTexKey = `fighter_${this.fighterId}_idle`;
    const idleTex = scene.textures.exists(idleTexKey) && scene.textures.get(idleTexKey);
    this.hasAnims = idleTex && idleTex.frameTotal > 2;
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }
  }

  // --- Simulation methods: delegate to FighterSim, then apply presentation side effects ---

  update(events) {
    this.sim.update(events);

    // Update animation
    if (this.hasAnims) {
      this._updateAnimation();
    }
  }

  moveLeft(speed) {
    this.sim.moveLeft(speed);
  }

  moveRight(speed) {
    this.sim.moveRight(speed);
  }

  stop() {
    this.sim.stop();
  }

  jump(events) {
    this.sim.jump(events);
  }

  block() {
    this.sim.block();
  }

  attack(type, events) {
    return this.sim.attack(type, events);
  }

  faceOpponent(opponent) {
    // Accept either a Fighter (with .sim) or a FighterSim (with .simX directly)
    const opponentSim = opponent.sim || opponent;
    this.sim.faceOpponent(opponentSim);
    this.sprite.setFlipX(!this.sim.facingRight);
  }

  getAttackHitbox() {
    return this.sim.getAttackHitbox();
  }

  getHurtbox() {
    return this.sim.getHurtbox();
  }

  takeDamage(amount, attackerSimX, stunFrames) {
    return this.sim.takeDamage(amount, attackerSimX, stunFrames);
  }

  // --- Presentation-only methods ---

  _updateAnimation() {
    let animState = this.sim.state;
    if (animState === 'attacking' && this.sim.currentAttack) {
      const attackMap = {
        lightPunch: 'light_punch',
        heavyPunch: 'heavy_punch',
        lightKick: 'light_kick',
        heavyKick: 'heavy_kick',
        special: 'special',
      };
      animState = attackMap[this.sim.currentAttack.type] || 'idle';
    } else if (animState === 'walking') {
      animState = 'walk';
    } else if (animState === 'jumping') {
      animState = 'jump';
    } else if (animState === 'blocking') {
      animState = 'block';
    }

    if (animState !== this.sim._prevAnimState) {
      const key = `${this.fighterId}_${animState}`;
      if (this.scene.anims.exists(key)) {
        if (
          this.sim.state === 'attacking' &&
          this.sim.currentAttack &&
          this.sim.attackCooldown > 0
        ) {
          const anim = this.scene.anims.get(key);
          const fps = (anim.frames.length / this.sim.attackCooldown) * 60;
          this.sprite.play({ key, frameRate: fps });
        } else {
          this.sprite.play(key);
        }
        this.sim._prevAnimState = animState;
      }
    }
  }

  updateAnimation() {
    if (this.hasAnims) this._updateAnimation();
  }

  syncSprite() {
    this.sprite.x = this.sim.simX / FP_SCALE;
    this.sprite.y = this.sim.simY / FP_SCALE;
    this.sprite.setFlipX(!this.sim.facingRight);

    // State-driven tints
    if (this.sim.state === 'blocking') {
      this.sprite.setTint(0x6688ff);
    } else if (this.sim._specialTintTimer > 0) {
      this.sprite.setTint(0xffcc00);
    } else {
      this.sprite.clearTint();
    }

    // Keep the cosmetic overlay in lockstep with the fighter sprite (RFC 0018).
    if (this._overlaySprite) {
      this._overlaySprite.x = this.sprite.x;
      this._overlaySprite.y = this.sprite.y;
      this._overlaySprite.setFlipX(this.sprite.flipX);
      this._overlaySprite.setDepth(this.sprite.depth + 1);
      this._syncOverlayAnimation();
    }
  }

  /**
   * Attach a cosmetic overlay sprite (hat, accessory, etc.) to this fighter.
   * Looks up the per-animation baked overlay strips produced by the RFC 0018
   * editor via the `overlayManifest` registry entry written by BootScene.
   *
   * Silently no-ops if no manifest is loaded or no overlay is calibrated for
   * this fighter × accessory combination. Passing `null` removes any attached
   * overlay.
   */
  setOverlay(accessoryId) {
    if (this._overlaySprite) {
      this._overlaySprite.destroy();
      this._overlaySprite = null;
    }
    this._overlayAccessoryId = accessoryId ?? null;
    if (!accessoryId) return;

    const manifest = this.scene.game.registry.get('overlayManifest');
    const byAnim = manifest?.calibrations?.[this.fighterId]?.[accessoryId];
    if (!byAnim) return; // no calibration yet, skip silently
    const animations = Object.keys(byAnim);
    if (animations.length === 0) return;

    // Use the idle animation (or the first available) as the initial texture.
    const initialAnim = animations.includes('idle') ? 'idle' : animations[0];
    const key = `overlay_${this.fighterId}_${accessoryId}_${initialAnim}`;
    if (!this.scene.textures.exists(key)) return;

    this._overlaySprite = this.scene.add.sprite(this.sprite.x, this.sprite.y, key);
    this._overlaySprite.setOrigin(0.5, 1);
    if (this.scene.anims.exists(key)) this._overlaySprite.play(key);
    this._syncOverlayAnimation();
  }

  _syncOverlayAnimation() {
    if (!this._overlaySprite || !this._overlayAccessoryId) return;
    const current = this.sprite.anims?.currentAnim?.key;
    if (!current) return;
    const suffix = current.replace(`${this.fighterId}_`, '');
    const key = `overlay_${this.fighterId}_${this._overlayAccessoryId}_${suffix}`;
    if (this._overlaySprite.anims?.currentAnim?.key === key) return;
    if (this.scene.anims.exists(key)) {
      this._overlaySprite.play(key);
    } else if (this.scene.textures.exists(key)) {
      this._overlaySprite.setTexture(key);
    }
  }

  reset(x) {
    this.sim.resetForRound(x);
    this.syncSprite();
    this.sprite.clearTint();
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }
  }

  resetForRound(x) {
    this.sim.resetForRound(x);
  }

  get alive() {
    return this.sim.hp > 0;
  }
}
