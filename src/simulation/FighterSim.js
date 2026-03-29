/**
 * Pure fighter simulation — no Phaser dependency.
 * Canonical source for all fighter state and logic.
 * Fighter.js (Phaser wrapper) delegates to this.
 */
import { MAX_HP, STAMINA_COSTS } from '../config.js';
import { calculateBlockDamage } from '../entities/combat-block.js';
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

const DEFAULT_MOVES = {
  lightPunch: {
    type: 'lightPunch',
    damage: 8,
    startup: 3,
    active: 2,
    recovery: 5,
    hitstun: 12,
    blockstun: 8,
  },
  heavyPunch: {
    type: 'heavyPunch',
    damage: 14,
    startup: 5,
    active: 3,
    recovery: 8,
    hitstun: 20,
    blockstun: 14,
  },
  lightKick: {
    type: 'lightKick',
    damage: 8,
    startup: 3,
    active: 2,
    recovery: 5,
    hitstun: 14,
    blockstun: 9,
  },
  heavyKick: {
    type: 'heavyKick',
    damage: 14,
    startup: 5,
    active: 3,
    recovery: 8,
    hitstun: 22,
    blockstun: 15,
  },
  special: {
    type: 'special',
    damage: 25,
    startup: 8,
    active: 4,
    recovery: 10,
    hitstun: 30,
    blockstun: 20,
  },
};

const DEFAULT_STATS = { speed: 3, power: 3, defense: 3 };

export class FighterSim {
  /**
   * @param {number} xPx - Starting X position in pixels
   * @param {number} playerIndex - 0 for P1, 1 for P2
   * @param {object} [fighterData] - Fighter data (stats + moves). Falls back to defaults.
   */
  constructor(xPx, playerIndex, fighterData) {
    this.playerIndex = playerIndex;
    this.data = {
      stats: fighterData?.stats || DEFAULT_STATS,
      moves: fighterData?.moves || DEFAULT_MOVES,
    };

    // Fixed-point simulation state
    this.simX = Math.trunc(xPx * FP_SCALE);
    this.simY = GROUND_Y_FP;
    this.simVX = 0;
    this.simVY = 0;

    // Health / meters
    this.hp = MAX_HP;
    this.special = 0;
    this.stamina = MAX_STAMINA_FP;

    // State machine
    this.state = 'idle'; // idle | walking | jumping | attacking | hurt | knockdown | blocking
    this.facingRight = playerIndex === 0;

    // Attack state
    this.attackCooldown = 0;
    this.attackFrameElapsed = 0;
    this.currentAttack = null;
    this.hitConnected = false;
    this.comboCount = 0;
    this._specialTintTimer = 0;

    // Block
    this.blockTimer = 0;

    // Hurt
    this.hurtTimer = 0;

    // Airborne state
    this.isOnGround = true;
    this.hasDoubleJumped = false;
    this._airborneTime = 0;

    // Wall state
    this._isTouchingWall = false;
    this._wallDir = 0;
    this._hasWallJumped = false;

    // Animation tracking (used by presentation layer via syncSprite)
    this._prevAnimState = null;
  }

  update(events) {
    // Attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown--;
      this.attackFrameElapsed++;
    }

    // Attack completion
    if (this.attackCooldown <= 0 && this.state === 'attacking') {
      if (!this.hitConnected && events) {
        events.push({ type: 'whiff', playerIndex: this.playerIndex });
      }
      this.state = 'idle';
      this.currentAttack = null;
    }

    // Block commitment timer
    if (this.blockTimer > 0) this.blockTimer--;

    // Special tint timer
    if (this._specialTintTimer > 0) this._specialTintTimer--;

    // Hurt recovery
    if (this.hurtTimer > 0) {
      this.hurtTimer--;
      if (this.hurtTimer <= 0) this.state = 'idle';
    }

    // Stamina regen (FP integer)
    let regenRate = STAMINA_REGEN_IDLE_PER_FRAME_FP;
    if (this.state === 'attacking') regenRate = STAMINA_REGEN_ATTACKING_PER_FRAME_FP;
    else if (this.state === 'blocking') regenRate = STAMINA_REGEN_BLOCKING_PER_FRAME_FP;
    this.stamina = Math.min(MAX_STAMINA_FP, this.stamina + regenRate);

    // Gravity
    this.simVY += GRAVITY_PER_FRAME_FP;

    // Position integration (integer division)
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
    if (!this.isOnGround) this._airborneTime++;

    // Stage bounds
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
      if (this._isTouchingWall && this.simVY > WALL_SLIDE_SPEED_FP) {
        this.simVY = WALL_SLIDE_SPEED_FP;
      }
    }

    // Floor collision
    if (this.simY > GROUND_Y_FP) {
      this.simY = GROUND_Y_FP;
      this.simVY = 0;
    }
  }

  moveLeft(speed) {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking' && this.blockTimer > 0) return;
    this.simVX = -speed;
    this.state = 'walking';
  }

  moveRight(speed) {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking' && this.blockTimer > 0) return;
    this.simVX = speed;
    this.state = 'walking';
  }

  stop() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state === 'blocking' && this.blockTimer > 0) return;
    this.simVX = 0;
    if (this.isOnGround) this.state = 'idle';
  }

  jump(events) {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;

    let jumped = false;
    if (this.isOnGround) {
      this.simVY = JUMP_VY_FP;
      this.state = 'jumping';
      this.isOnGround = false;
      jumped = true;
    } else if (this._isTouchingWall && !this._hasWallJumped) {
      this._hasWallJumped = true;
      this.hasDoubleJumped = false;
      this.simVY = WALL_JUMP_Y_FP;
      this.simVX = -this._wallDir * WALL_JUMP_X_FP;
      this.state = 'jumping';
      jumped = true;
    } else if (!this.hasDoubleJumped && this._airborneTime > DOUBLE_JUMP_AIRBORNE_THRESHOLD) {
      this.hasDoubleJumped = true;
      this.simVY = DOUBLE_JUMP_VY_FP;
      jumped = true;
    }

    if (jumped && events) {
      events.push({ type: 'jump', playerIndex: this.playerIndex });
    }
  }

  block() {
    if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
    if (this.state !== 'blocking') this.blockTimer = 3;
    this.state = 'blocking';
    this.simVX = 0;
  }

  attack(type, events) {
    // Normal-to-special cancel: allow cancelling a normal into special on hit
    if (this.attackCooldown > 0 && this.state === 'attacking') {
      if (type === 'special' && this.hitConnected && this.currentAttack?.type !== 'special') {
        const move = this.currentAttack;
        const cancelEnd = move.startup + move.active + 4;
        if (this.attackFrameElapsed >= move.startup && this.attackFrameElapsed < cancelEnd) {
          this.attackCooldown = 0;
          this.attackFrameElapsed = 0;
          this.hitConnected = false;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

    if (this.attackCooldown > 0 || this.state === 'hurt' || this.state === 'knockdown') {
      return false;
    }
    if (type === 'special' && this.special < SPECIAL_COST_FP) return false;

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
    this.attackCooldown = moveData.startup + moveData.active + moveData.recovery;

    if (type === 'special') {
      this.special -= SPECIAL_COST_FP;
      this._specialTintTimer = Math.min(this.attackCooldown, SPECIAL_TINT_MAX_FRAMES);
      if (events) {
        events.push({ type: 'special_charge', playerIndex: this.playerIndex });
      }
    }

    return true;
  }

  faceOpponent(opponent) {
    this.facingRight = this.simX < opponent.simX;
  }

  getAttackHitbox() {
    if (this.state !== 'attacking' || !this.currentAttack) return null;

    const move = this.currentAttack;
    if (
      this.attackFrameElapsed < move.startup ||
      this.attackFrameElapsed >= move.startup + move.active
    ) {
      return null;
    }

    const defaultReach = move.type.includes('Kick') ? 55 : 45;
    const reach = (move.reach || defaultReach) * FP_SCALE;
    const h = (move.height || 40) * FP_SCALE;
    const dir = this.facingRight ? 1 : -1;

    return {
      x: this.simX + dir * 10 * FP_SCALE,
      y: this.simY - 50 * FP_SCALE,
      w: reach * dir,
      h,
    };
  }

  getHurtbox() {
    let w = 36,
      h = 60,
      offsetY = 60;
    if (this.state === 'blocking') {
      h = 40;
      offsetY = 40;
    } else if (!this.isOnGround) {
      w = 28;
      h = 50;
      offsetY = 50;
    } else if (this.state === 'attacking') {
      w = 40;
    }
    return {
      x: this.simX - Math.trunc(w / 2) * FP_SCALE,
      y: this.simY - offsetY * FP_SCALE,
      w: w * FP_SCALE,
      h: h * FP_SCALE,
    };
  }

  takeDamage(amount, attackerSimX, stunFrames) {
    if (this.state === 'blocking') amount = calculateBlockDamage(amount);

    this.hp = Math.max(0, this.hp - amount);
    this.special = Math.min(MAX_SPECIAL_FP, this.special + amount * 800);

    const knockDir = this.simX > attackerSimX ? 1 : -1;
    this.simVX = knockDir * KNOCKBACK_VX_FP;

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

  /** No-op — compatibility with SimulationStep.simulateFrame() which calls syncSprite(). */
  syncSprite() {}

  resetForRound(x) {
    this.simX = Math.trunc(x * FP_SCALE);
    this.simY = GROUND_Y_FP;
    this.simVX = 0;
    this.simVY = 0;
    this.hp = MAX_HP;
    this.special = 0;
    this.state = 'idle';
    this.attackCooldown = 0;
    this.attackFrameElapsed = 0;
    this.comboCount = 0;
    this.blockTimer = 0;
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
    this._prevAnimState = null;
    this.facingRight = this.playerIndex === 0;
  }

  get alive() {
    return this.hp > 0;
  }
}

/**
 * Create a FighterSim from pixel position and optional fighter data.
 * Convenience factory matching the old createSimFighter() API.
 */
export function createFighterSim(xPx, playerIndex, fighterData) {
  return new FighterSim(xPx, playerIndex, fighterData);
}
