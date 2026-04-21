import { FIGHTER_HEIGHT, FIGHTER_WIDTH } from '../config.js';
import accessoryCatalog from '../data/accessories.json';
import { FighterSim } from '../simulation/FighterSim.js';
import { FP_SCALE } from '../systems/FixedPoint.js';
import { resolveOverlayTransform } from './overlay-transform.js';

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
   * a `{ category: accessoryId | null }` map — one overlay sprite is created
   * per non-null entry. Calibration is shared across accessories of the same
   * category, so two different sombreros land in the same place.
   *
   * The overlay sprite is textured with the accessory's source PNG
   * (`accessory_{id}`, loaded by BootScene). Each render tick, the calibration
   * entry for the current animation frame is looked up and applied as a
   * transform — there is no pre-baked per-fighter spritesheet.
   *
   * Passing `null` (or no value) for a category removes that overlay.
   * Passing `null` as the whole argument clears everything.
   */
  setAccessories(accessoriesByCategory) {
    for (const sprite of this._overlaySprites.values()) sprite.destroy();
    this._overlaySprites.clear();
    if (!accessoriesByCategory) return;

    const manifest = this.scene.game.registry.get('overlayManifest');
    for (const [category, accessoryId] of Object.entries(accessoriesByCategory)) {
      if (!accessoryId) continue;
      if (!manifest?.calibrations?.[this.fighterId]?.[category]) continue;

      const textureKey = `accessory_${accessoryId}`;
      if (!this.scene.textures.exists(textureKey)) continue;

      const sprite = this.scene.add.sprite(this.sprite.x, this.sprite.y, textureKey);
      sprite.setOrigin(0.5, 0.5);
      sprite._accessoryId = accessoryId;
      sprite._category = category;
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

  /**
   * Per-tick sync: read the calibration entry for the fighter's current
   * animation frame and apply it to each overlay sprite as a transform
   * (position, rotation, scale, flipX). The calibration lives in
   * `overlayManifest` (Phaser registry); the pure math lives in
   * `resolveOverlayTransform` (unit-tested, no Phaser).
   *
   * If the current anim isn't calibrated, fall back to `idle` so the overlay
   * keeps rendering near the head rather than flickering off. Frames beyond
   * the calibration's length clamp to the last entry.
   */
  _syncOverlays() {
    if (this._overlaySprites.size === 0) return;

    const manifest = this.scene.game.registry.get('overlayManifest');
    const byCategory = manifest?.calibrations?.[this.fighterId];
    if (!byCategory) {
      for (const sprite of this._overlaySprites.values()) sprite.setVisible(false);
      return;
    }

    const animName = this._currentAnimName();
    const frameIndex = this._currentFrameIndex();
    const depth = this.sprite.depth + 1;

    for (const [category, sprite] of this._overlaySprites.entries()) {
      const byAnim = byCategory[category];
      const entry = byAnim?.[animName] ?? byAnim?.idle;
      const frames = entry?.frames;
      if (!frames || frames.length === 0) {
        sprite.setVisible(false);
        continue;
      }
      const cal = frames[Math.min(frameIndex, frames.length - 1)] ?? frames[0];
      const source = this.scene.textures.get(sprite.texture.key).getSourceImage();
      const accessoryWidth = source?.width ?? 0;

      const transform = resolveOverlayTransform({
        cal,
        fighterX: this.sprite.x,
        fighterY: this.sprite.y,
        fighterWidth: FIGHTER_WIDTH,
        fighterHeight: FIGHTER_HEIGHT,
        facingRight: this.sim.facingRight,
        accessoryWidth,
      });
      if (!transform) {
        sprite.setVisible(false);
        continue;
      }

      sprite.setVisible(true);
      sprite.setPosition(transform.x, transform.y);
      sprite.setRotation(transform.rotation);
      sprite.setScale(transform.scale);
      sprite.setFlipX(!this.sim.facingRight);
      sprite.setDepth(depth);
    }
  }

  _currentAnimName() {
    const animKey = this.sprite.anims?.currentAnim?.key;
    if (!animKey) return 'idle';
    const prefix = `${this.fighterId}_`;
    return animKey.startsWith(prefix) ? animKey.slice(prefix.length) : animKey;
  }

  _currentFrameIndex() {
    const raw = this.sprite.frame?.name;
    if (raw === undefined || raw === null) return 0;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
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
