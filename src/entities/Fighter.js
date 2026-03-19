import { MAX_HP, STAMINA_COSTS } from '../config.js';
import {
  DOUBLE_JUMP_AIRBORNE_THRESHOLD,
  DOUBLE_JUMP_VY_FP,
  FP_SCALE,
  fpClamp,
  GRAVITY_PER_FRAME_FP,
  GROUND_Y_FP,
  HURT_TIMER_KNOCKDOWN,
  HURT_TIMER_LIGHT,
  JUMP_VY_FP,
  KNOCKBACK_VX_FP,
  KNOCKBACK_VY_FP,
  MAX_SPECIAL_FP,
  MAX_STAMINA_FP,
  SPECIAL_COST_FP,
  SPECIAL_TINT_MAX_FRAMES,
  STAGE_LEFT_FP,
  STAGE_RIGHT_FP,
  STAMINA_REGEN_ATTACKING_PER_FRAME_FP,
  STAMINA_REGEN_BLOCKING_PER_FRAME_FP,
  STAMINA_REGEN_IDLE_PER_FRAME_FP,
  WALL_DETECT_THRESHOLD_FP,
  WALL_JUMP_X_FP,
  WALL_JUMP_Y_FP,
  WALL_SLIDE_SPEED_FP,
} from '../systems/FixedPoint.js';

export { calculateBlockDamage } from './combat-block.js';

import { calculateBlockDamage } from './combat-block.js';

export class Fighter {
  constructor(scene, x, y, textureKey, fighterData, playerIndex) {
    this.scene = scene;
    this.data = fighterData;
    this.playerIndex = playerIndex; // 0 or 1

    // Create sprite — physics body kept for compatibility but disabled
    this.sprite = scene.physics.add.sprite(x, y, textureKey);
    this.sprite.setOrigin(0.5, 1);
    this.sprite.body.moves = false;
    this.sprite.body.setAllowGravity(false);

    // Check if this fighter has real sprite animations
    this.fighterId = fighterData.id;
    const idleTexKey = `fighter_${this.fighterId}_idle`;
    const idleTex = scene.textures.exists(idleTexKey) && scene.textures.get(idleTexKey);
    this.hasAnims = idleTex && idleTex.frameTotal > 2;
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }

    // Fixed-point simulation state
    this.simX = Math.trunc(x * FP_SCALE);
    this.simY = Math.trunc(y * FP_SCALE);
    this.simVX = 0;
    this.simVY = 0;

    // State
    this.hp = MAX_HP;
    this.special = 0; // FP (0 is same scaled or not)
    this.state = 'idle';
    this._prevAnimState = null;
    this.facingRight = playerIndex === 0;
    this.attackCooldown = 0; // frames
    this.hurtTimer = 0; // frames
    this.isOnGround = true;
    this.hitConnected = false;

    // Double jump tracking
    this.hasDoubleJumped = false;
    this._airborneTime = 0; // frames

    // Stamina (FP for fractional regen)
    this.stamina = MAX_STAMINA_FP;

    // Wall jump tracking
    this._isTouchingWall = false;
    this._wallDir = 0;
    this._hasWallJumped = false;

    // Timer for special attack tint (frames)
    this._specialTintTimer = 0;

    // Attack phase tracking (frames elapsed since attack started)
    this.attackFrameElapsed = 0;
  }

  update() {
    // Update cooldowns (frame-based — decrement by 1)
    if (this.attackCooldown > 0) {
      this.attackCooldown--;
      this.attackFrameElapsed++;
    }

    // Attack completion (deterministic)
    if (this.attackCooldown <= 0 && this.state === 'attacking') {
      if (!this.hitConnected && !this.scene._muteEffects) {
        this.scene.game.audioManager.play('whiff');
      }
      this.state = 'idle';
      this.currentAttack = null;
    }

    // Special tint timer (frame-based)
    if (this._specialTintTimer > 0) {
      this._specialTintTimer--;
      if (this._specialTintTimer <= 0) {
        this._specialTintTimer = 0;
        if (this.sprite?.clearTint) this.sprite.clearTint();
      }
    }

    if (this.hurtTimer > 0) {
      this.hurtTimer--;
      if (this.hurtTimer <= 0) this.state = 'idle';
    }

    // Stamina regen (FP integer add)
    let regenRate = STAMINA_REGEN_IDLE_PER_FRAME_FP;
    if (this.state === 'attacking') regenRate = STAMINA_REGEN_ATTACKING_PER_FRAME_FP;
    else if (this.state === 'blocking') regenRate = STAMINA_REGEN_BLOCKING_PER_FRAME_FP;
    this.stamina = Math.min(MAX_STAMINA_FP, this.stamina + regenRate);

    // Gravity
    this.simVY += GRAVITY_PER_FRAME_FP;

    // Position integration (integer division, truncate toward zero)
    this.simY += Math.trunc(this.simVY / 60);
    this.simX += Math.trunc(this.simVX / 60);

    // Ground check
    const wasAirborne = !this.isOnGround;
    this.isOnGround = this.simY >= GROUND_Y_FP;
    if (this.isOnGround && wasAirborne) {
      this.hasDoubleJumped = false;
      this._hasWallJumped = false;
      this._airborneTime = 0;
    }
    if (!this.isOnGround) {
      this._airborneTime++;
    }

    // Clamp to stage bounds
    this.simX = fpClamp(this.simX, STAGE_LEFT_FP, STAGE_RIGHT_FP);

    // Wall detection + wall slide
    this._isTouchingWall = false;
    this._wallDir = 0;
    if (!this.isOnGround) {
      if (this.simX <= STAGE_LEFT_FP + WALL_DETECT_THRESHOLD_FP) {
        this._isTouchingWall = true;
        this._wallDir = -1;
      } else if (this.simX >= STAGE_RIGHT_FP - WALL_DETECT_THRESHOLD_FP) {
        this._isTouchingWall = true;
        this._wallDir = 1;
      }
      // Wall slide: cap downward velocity
      if (this._isTouchingWall && this.simVY > WALL_SLIDE_SPEED_FP) {
        this.simVY = WALL_SLIDE_SPEED_FP;
      }
    }

    // Floor collision
    if (this.simY > GROUND_Y_FP) {
      this.simY = GROUND_Y_FP;
      this.simVY = 0;
    }

    // Update animation based on state
    if (this.hasAnims) {
      this._updateAnimation();
    }
  }

  _updateAnimation() {
    let animState = this.state;
    if (animState === 'attacking' && this.currentAttack) {
      const attackMap = {
        lightPunch: 'light_punch',
        heavyPunch: 'heavy_punch',
        lightKick: 'light_kick',
        heavyKick: 'heavy_kick',
        special: 'special',
      };
      animState = attackMap[this.currentAttack.type] || 'idle';
    } else if (animState === 'walking') {
      animState = 'walk';
    } else if (animState === 'jumping') {
      animState = 'jump';
    } else if (animState === 'blocking') {
      animState = 'block';
    }

    if (animState !== this._prevAnimState) {
      const key = `${this.fighterId}_${animState}`;
      if (this.scene.anims.exists(key)) {
        // For attack animations, match framerate to attack duration (in frames → fps)
        if (this.state === 'attacking' && this.currentAttack && this.attackCooldown > 0) {
          const anim = this.scene.anims.get(key);
          const fps = (anim.frames.length / this.attackCooldown) * 60;
          this.sprite.play({ key, frameRate: fps });
        } else {
          this.sprite.play(key);
        }
        this._prevAnimState = animState;
      }
    }
  }

  faceOpponent(opponent) {
    this.facingRight = this.simX < opponent.simX;
    this.sprite.setFlipX(!this.facingRight);
  }

  moveLeft(speed) {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking') this.sprite.clearTint();
    this.simVX = -speed;
    this.state = 'walking';
  }

  moveRight(speed) {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking') this.sprite.clearTint();
    this.simVX = speed;
    this.state = 'walking';
  }

  stop() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking') this.sprite.clearTint();
    this.simVX = 0;
    if (this.isOnGround) this.state = 'idle';
  }

  jump() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;

    if (this.isOnGround) {
      this.simVY = JUMP_VY_FP;
      this.state = 'jumping';
      this.isOnGround = false;
      if (!this.scene._muteEffects) this.scene.game.audioManager.play('jump');
    } else if (this._isTouchingWall && !this._hasWallJumped) {
      this._hasWallJumped = true;
      this.hasDoubleJumped = false;
      this.simVY = WALL_JUMP_Y_FP;
      this.simVX = -this._wallDir * WALL_JUMP_X_FP;
      this.state = 'jumping';
      if (!this.scene._muteEffects) this.scene.game.audioManager.play('jump');
    } else if (!this.hasDoubleJumped && this._airborneTime > DOUBLE_JUMP_AIRBORNE_THRESHOLD) {
      this.hasDoubleJumped = true;
      this.simVY = DOUBLE_JUMP_VY_FP;
      if (!this.scene._muteEffects) this.scene.game.audioManager.play('jump');
    }
  }

  attack(type) {
    if (this.attackCooldown > 0 || this.state === 'hurt' || this.state === 'knockdown') {
      return false;
    }
    if (type === 'special' && this.special < SPECIAL_COST_FP) return false;

    // Stamina gate (FP)
    const staCost = (STAMINA_COSTS[type] || 15) * FP_SCALE;
    if (this.stamina < staCost) return false;
    this.stamina -= staCost;

    const moveData = this.data.moves[type];
    if (!moveData) return false;

    this.state = 'attacking';
    this._prevAnimState = null;
    this.hitConnected = false;
    this.attackFrameElapsed = 0;
    this.currentAttack = { type, ...moveData };

    // Total attack duration in frames
    const totalFrames = moveData.startup + moveData.active + moveData.recovery;
    this.attackCooldown = totalFrames;

    if (type === 'special') {
      this.special -= SPECIAL_COST_FP;
      if (!this.scene._muteEffects) {
        this.scene.game.audioManager.play('special_charge');
      }
      if (!this.scene._muteEffects) {
        this.sprite.setTint(0xffcc00);
      }
      this._specialTintTimer = Math.min(this.attackCooldown, SPECIAL_TINT_MAX_FRAMES);
    }

    return true;
  }

  // Returns hitbox as plain FP object {x, y, w, h}
  // Only active during the 'active' phase (after startup, before recovery)
  getAttackHitbox() {
    if (this.state !== 'attacking' || !this.currentAttack) return null;

    const move = this.currentAttack;
    if (this.attackFrameElapsed < move.startup ||
        this.attackFrameElapsed >= move.startup + move.active) {
      return null; // No hitbox during startup or recovery
    }

    const reach = (this.currentAttack.type.includes('Kick') ? 55 : 45) * FP_SCALE;
    const dir = this.facingRight ? 1 : -1;

    return {
      x: this.simX + dir * 10 * FP_SCALE,
      y: this.simY - 50 * FP_SCALE,
      w: reach * dir,
      h: 40 * FP_SCALE,
    };
  }

  // Returns hurtbox as plain FP object {x, y, w, h}
  getHurtbox() {
    return {
      x: this.simX - 18 * FP_SCALE,
      y: this.simY - 60 * FP_SCALE,
      w: 36 * FP_SCALE,
      h: 60 * FP_SCALE,
    };
  }

  takeDamage(amount, attackerSimX, stunFrames) {
    if (this.state === 'blocking') {
      amount = calculateBlockDamage(amount);
      this.sprite.clearTint();
    }

    this.hp = Math.max(0, this.hp - amount);
    // Gain special from damage: 0.8 * FP_SCALE = 800
    this.special = Math.min(MAX_SPECIAL_FP, this.special + amount * 800);

    // Knockback direction based on FP positions
    const knockDir = this.simX > attackerSimX ? 1 : -1;
    this.simVX = knockDir * KNOCKBACK_VX_FP;

    // Use per-move stun if provided, else fall back to legacy constants
    if (stunFrames != null) {
      if (amount >= 15) {
        this.state = 'knockdown';
        this.hurtTimer = stunFrames;
        this.simVY = KNOCKBACK_VY_FP;
      } else {
        this.state = 'hurt';
        this.hurtTimer = stunFrames;
      }
    } else if (amount >= 15) {
      this.state = 'knockdown';
      this.hurtTimer = HURT_TIMER_KNOCKDOWN;
      this.simVY = KNOCKBACK_VY_FP;
    } else {
      this.state = 'hurt';
      this.hurtTimer = HURT_TIMER_LIGHT;
    }

    return this.hp <= 0;
  }

  block() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    this.state = 'blocking';
    this.simVX = 0;
    this.sprite.setTint(0x6688ff);
  }

  /** Sync sprite position from simulation state. Call after simulation frame. */
  syncSprite() {
    this.sprite.x = this.simX / FP_SCALE;
    this.sprite.y = this.simY / FP_SCALE;
  }

  reset(x) {
    this.simX = Math.trunc(x * FP_SCALE);
    this.simY = GROUND_Y_FP;
    this.simVX = 0;
    this.simVY = 0;
    this.syncSprite();
    this.sprite.clearTint();
    this.hp = MAX_HP;
    this.special = 0;
    this.state = 'idle';
    this._prevAnimState = null;
    this.attackCooldown = 0;
    this.attackFrameElapsed = 0;
    this.hurtTimer = 0;
    this.currentAttack = null;
    this.hitConnected = false;
    this.hasDoubleJumped = false;
    this._airborneTime = 0;
    this.stamina = MAX_STAMINA_FP;
    this._isTouchingWall = false;
    this._wallDir = 0;
    this._hasWallJumped = false;
    this._specialTintTimer = 0;
    if (this.hasAnims) {
      this.sprite.play(`${this.fighterId}_idle`);
    }
  }

  get alive() {
    return this.hp > 0;
  }
}
