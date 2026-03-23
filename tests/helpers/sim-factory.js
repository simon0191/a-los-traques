/**
 * Pure simulation fighters and combat system — no Phaser dependency.
 * Extracted from rollback-round-events.test.js for reuse in replay engine and other tests.
 */
import { MAX_HP, STAMINA_COSTS } from '../../src/config.js';
import { calculateBlockDamage } from '../../src/entities/combat-block.js';
import { calculateDamage } from '../../src/systems/combat-math.js';
import {
  DOUBLE_JUMP_AIRBORNE_THRESHOLD,
  FP_SCALE,
  fpClamp,
  fpRectsOverlap,
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
} from '../../src/systems/FixedPoint.js';

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

/**
 * Create a pure simulation fighter (no Phaser dependency).
 * @param {number} xPx - Starting X position in pixels
 * @param {number} playerIndex - 0 for P1, 1 for P2
 * @param {object} [fighterData] - Fighter data from fighters.json (stats + moves). Falls back to defaults.
 */
export function createSimFighter(xPx, playerIndex, fighterData) {
  const stats = fighterData?.stats || DEFAULT_STATS;
  const moves = fighterData?.moves || DEFAULT_MOVES;

  return {
    simX: xPx * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 0,
    simVY: 0,
    hp: MAX_HP,
    special: 0,
    stamina: MAX_STAMINA_FP,
    state: 'idle',
    attackCooldown: 0,
    hurtTimer: 0,
    hitConnected: false,
    attackFrameElapsed: 0,
    comboCount: 0,
    blockTimer: 0,
    currentAttack: null,
    isOnGround: true,
    _airborneTime: 0,
    hasDoubleJumped: false,
    facingRight: playerIndex === 0,
    _isTouchingWall: false,
    _wallDir: 0,
    _hasWallJumped: false,
    _prevAnimState: null,
    _specialTintTimer: 0,
    playerIndex,
    data: { stats, moves },
    sprite: { x: xPx, y: 220, setFlipX() {}, clearTint() {}, setTint() {} },
    scene: { _muteEffects: true, game: { audioManager: { play() {} } } },
    hasAnims: false,

    update() {
      if (this.attackCooldown > 0) {
        this.attackCooldown--;
        this.attackFrameElapsed++;
      }
      if (this.attackCooldown <= 0 && this.state === 'attacking') {
        this.state = 'idle';
        this.currentAttack = null;
      }
      if (this._specialTintTimer > 0) this._specialTintTimer--;
      if (this.blockTimer > 0) this.blockTimer--;
      if (this.hurtTimer > 0) {
        this.hurtTimer--;
        if (this.hurtTimer <= 0) this.state = 'idle';
      }
      let regenRate = STAMINA_REGEN_IDLE_PER_FRAME_FP;
      if (this.state === 'attacking') regenRate = STAMINA_REGEN_ATTACKING_PER_FRAME_FP;
      else if (this.state === 'blocking') regenRate = STAMINA_REGEN_BLOCKING_PER_FRAME_FP;
      this.stamina = Math.min(MAX_STAMINA_FP, this.stamina + regenRate);

      this.simVY += GRAVITY_PER_FRAME_FP;
      this.simY += Math.trunc(this.simVY / 60);
      this.simX += Math.trunc(this.simVX / 60);

      const wasAirborne = !this.isOnGround;
      this.isOnGround = this.simY >= GROUND_Y_FP;
      if (this.isOnGround && wasAirborne) {
        this.hasDoubleJumped = false;
        this._hasWallJumped = false;
        this._airborneTime = 0;
      }
      if (!this.isOnGround) this._airborneTime++;

      this.simX = fpClamp(this.simX, STAGE_LEFT_FP, STAGE_RIGHT_FP);

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
      if (this.simY > GROUND_Y_FP) {
        this.simY = GROUND_Y_FP;
        this.simVY = 0;
      }
    },

    moveLeft(speed) {
      if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
      if (this.state === 'blocking' && this.blockTimer > 0) return;
      this.simVX = -speed;
      this.state = 'walking';
    },
    moveRight(speed) {
      if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
      if (this.state === 'blocking' && this.blockTimer > 0) return;
      this.simVX = speed;
      this.state = 'walking';
    },
    stop() {
      if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
      if (this.state === 'blocking' && this.blockTimer > 0) return;
      this.simVX = 0;
      if (this.isOnGround) this.state = 'idle';
    },
    jump() {
      if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
      if (this.isOnGround) {
        this.simVY = JUMP_VY_FP;
        this.state = 'jumping';
        this.isOnGround = false;
      } else if (this._isTouchingWall && !this._hasWallJumped) {
        this._hasWallJumped = true;
        this.hasDoubleJumped = false;
        this.simVY = WALL_JUMP_Y_FP;
        this.simVX = -this._wallDir * WALL_JUMP_X_FP;
        this.state = 'jumping';
      } else if (!this.hasDoubleJumped && this._airborneTime > DOUBLE_JUMP_AIRBORNE_THRESHOLD) {
        this.hasDoubleJumped = true;
        this.simVY = -380 * FP_SCALE;
      }
    },
    block() {
      if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
      if (this.state !== 'blocking') this.blockTimer = 3;
      this.state = 'blocking';
      this.simVX = 0;
    },
    attack(type) {
      if (this.attackCooldown > 0 || this.state === 'hurt' || this.state === 'knockdown')
        return false;
      if (type === 'special' && this.special < SPECIAL_COST_FP) return false;
      const staCost = (STAMINA_COSTS[type] || 15) * FP_SCALE;
      if (this.stamina < staCost) return false;
      this.stamina -= staCost;
      const moveData = this.data.moves[type];
      if (!moveData) return false;
      this.state = 'attacking';
      this.hitConnected = false;
      this.attackFrameElapsed = 0;
      this.currentAttack = { type, ...moveData };
      this.attackCooldown = moveData.startup + moveData.active + moveData.recovery;
      if (type === 'special') {
        this.special -= SPECIAL_COST_FP;
        this._specialTintTimer = Math.min(this.attackCooldown, SPECIAL_TINT_MAX_FRAMES);
      }
      return true;
    },
    faceOpponent(opponent) {
      this.facingRight = this.simX < opponent.simX;
    },
    getAttackHitbox() {
      if (this.state !== 'attacking' || !this.currentAttack) return null;
      const move = this.currentAttack;
      if (
        this.attackFrameElapsed < move.startup ||
        this.attackFrameElapsed >= move.startup + move.active
      )
        return null;
      const defaultReach = this.currentAttack.type.includes('Kick') ? 55 : 45;
      const reach = (this.currentAttack.reach || defaultReach) * FP_SCALE;
      const h = (this.currentAttack.height || 40) * FP_SCALE;
      const dir = this.facingRight ? 1 : -1;
      return {
        x: this.simX + dir * 10 * FP_SCALE,
        y: this.simY - 50 * FP_SCALE,
        w: reach * dir,
        h,
      };
    },
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
    },
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
    },
    syncSprite() {
      this.sprite.x = this.simX / FP_SCALE;
      this.sprite.y = this.simY / FP_SCALE;
    },
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
    },
  };
}

/**
 * Create a sim combat system that mirrors CombatSystem behavior.
 * @param {{ suppressRoundEvents?: boolean }} [options]
 */
export function createSimCombat({ suppressRoundEvents = true } = {}) {
  return {
    roundActive: true,
    suppressRoundEvents,
    timer: 60,
    _timerAccumulator: 0,
    matchOver: false,
    roundNumber: 1,
    p1RoundsWon: 0,
    p2RoundsWon: 0,
    transitionTimer: 0,
    _lastEndReason: null,
    resolveBodyCollision(f1, f2) {
      const halfW = 18 * FP_SCALE;
      const airThreshold = GROUND_Y_FP - 20 * FP_SCALE;
      if (f1.simY < airThreshold || f2.simY < airThreshold) return;
      const overlap = halfW + halfW - Math.abs(f1.simX - f2.simX);
      if (overlap <= 0) return;
      const pushEach = Math.trunc(overlap / 2);
      const sign = f1.simX < f2.simX ? -1 : 1;
      f1.simX += sign * pushEach;
      f2.simX -= sign * pushEach;
      f1.simX = fpClamp(f1.simX, STAGE_LEFT_FP, STAGE_RIGHT_FP);
      f2.simX = fpClamp(f2.simX, STAGE_LEFT_FP, STAGE_RIGHT_FP);
    },
    checkHit(attacker, defender) {
      if (!attacker.currentAttack || attacker.state !== 'attacking') return false;
      if (attacker.hitConnected) return false;
      const hitbox = attacker.getAttackHitbox();
      const hurtbox = defender.getHurtbox();
      if (!hitbox || !hurtbox) return false;
      const hx = hitbox.w < 0 ? hitbox.x + hitbox.w : hitbox.x;
      const hw = Math.abs(hitbox.w);
      if (fpRectsOverlap(hx, hitbox.y, hw, hitbox.h, hurtbox.x, hurtbox.y, hurtbox.w, hurtbox.h)) {
        const move = attacker.currentAttack;
        const damage = calculateDamage(
          move.damage,
          attacker.data.stats.power,
          defender.data.stats.defense,
        );
        attacker.special = Math.min(MAX_SPECIAL_FP, attacker.special + damage * 200);
        const stunFrames =
          defender.state === 'blocking' ? move.blockstun || undefined : move.hitstun || undefined;
        const ko = defender.takeDamage(damage, attacker.simX, stunFrames);
        attacker.hitConnected = true;
        return { hit: true, ko };
      }
      return false;
    },
    tickTimer() {
      this._timerAccumulator++;
      if (this._timerAccumulator >= 60) {
        this._timerAccumulator = 0;
        this.timer--;
        if (this.timer <= 0) return { timeup: true };
      }
      return null;
    },
    stopRound() {
      this.roundActive = false;
    },
    startRound() {
      this.roundActive = true;
      this.timer = 60;
      this._timerAccumulator = 0;
    },
  };
}

/**
 * Reset a sim fighter to initial state for a new round (preserves round wins).
 */
export function resetSimFighter(fighter, xPx) {
  fighter.simX = xPx * FP_SCALE;
  fighter.simY = GROUND_Y_FP;
  fighter.simVX = 0;
  fighter.simVY = 0;
  fighter.hp = MAX_HP;
  fighter.special = 0;
  fighter.stamina = MAX_STAMINA_FP;
  fighter.state = 'idle';
  fighter.attackCooldown = 0;
  fighter.hurtTimer = 0;
  fighter.hitConnected = false;
  fighter.attackFrameElapsed = 0;
  fighter.comboCount = 0;
  fighter.blockTimer = 0;
  fighter.currentAttack = null;
  fighter.isOnGround = true;
  fighter._airborneTime = 0;
  fighter.hasDoubleJumped = false;
  fighter._isTouchingWall = false;
  fighter._wallDir = 0;
  fighter._hasWallJumped = false;
  fighter._prevAnimState = null;
  fighter._specialTintTimer = 0;
}
