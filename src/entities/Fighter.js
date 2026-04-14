import accessoryCatalog from '../data/accessories.json';
import { FighterSim } from '../simulation/FighterSim.js';
import { FP_SCALE } from '../systems/FixedPoint.js';

const ACCESSORY_CATEGORY_BY_ID = Object.fromEntries(
  accessoryCatalog.map((a) => [a.id, a.category]),
);

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

    // Multi-overlay state: one sprite per active category.
    this._overlaySprites = new Map();
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

    // Keep every cosmetic overlay in lockstep with the fighter sprite.
    if (this._overlaySprites.size > 0) this._syncOverlays();
  }

  /**
   * Attach a set of accessories to this fighter. `accessoriesByCategory` is
   * a `{ category: accessoryId | null }` map — one calibrated overlay sprite
   * is created per non-null entry. Calibration is shared across accessories
   * of the same category, so two different sombreros land in the same place.
   *
   * Passing `null` (or no value) for a category removes that overlay.
   * Passing `null` as the whole argument clears everything.
   */
  setAccessories(accessoriesByCategory) {
    // Destroy previous overlays.
    for (const sprite of this._overlaySprites.values()) sprite.destroy();
    this._overlaySprites.clear();
    if (!accessoriesByCategory) return;

    const manifest = this.scene.game.registry.get('overlayManifest');
    for (const [category, accessoryId] of Object.entries(accessoriesByCategory)) {
      if (!accessoryId) continue;
      const byAnim = manifest?.calibrations?.[this.fighterId]?.[category];
      if (!byAnim) continue;
      const animations = Object.keys(byAnim);
      if (animations.length === 0) continue;

      const initialAnim = animations.includes('idle') ? 'idle' : animations[0];
      const key = `overlay_${this.fighterId}_${accessoryId}_${initialAnim}`;
      if (!this.scene.textures.exists(key)) continue;

      const sprite = this.scene.add.sprite(this.sprite.x, this.sprite.y, key);
      sprite.setOrigin(0.5, 1);
      sprite._accessoryId = accessoryId;
      this._overlaySprites.set(category, sprite);
    }
    this._syncOverlays();
  }

  /**
   * Backward-compat shim: single accessory by id. Resolves the category
   * from the catalog and delegates to setAccessories.
   */
  setOverlay(accessoryId) {
    if (!accessoryId) {
      this.setAccessories(null);
      return;
    }
    const category = ACCESSORY_CATEGORY_BY_ID[accessoryId];
    if (!category) return;
    this.setAccessories({ [category]: accessoryId });
  }

  _syncOverlays() {
    for (const sprite of this._overlaySprites.values()) {
      sprite.x = this.sprite.x;
      sprite.y = this.sprite.y;
      sprite.setFlipX(this.sprite.flipX);
      sprite.setDepth(this.sprite.depth + 1);
    }
    this._syncOverlayAnimation();
  }

  /**
   * Force each overlay sprite's texture + frame to exactly match the fighter
   * sprite. No independent animation plays on the overlays — they render the
   * same frame index as the fighter, so per-frame calibration stays aligned
   * even if the fighter anim's framerate changes.
   */
  _syncOverlayAnimation() {
    if (this._overlaySprites.size === 0) return;
    const current = this.sprite.anims?.currentAnim?.key;
    if (!current) return;
    const suffix = current.replace(`${this.fighterId}_`, '');
    const frameName = this.sprite.frame?.name ?? 0;
    for (const sprite of this._overlaySprites.values()) {
      const overlayKey = `overlay_${this.fighterId}_${sprite._accessoryId}_${suffix}`;
      if (!this.scene.textures.exists(overlayKey)) {
        sprite.setVisible(false);
        continue;
      }
      sprite.setVisible(true);
      sprite.setTexture(overlayKey, frameName);
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
