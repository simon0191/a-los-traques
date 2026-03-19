import { describe, expect, it } from 'vitest';
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

/**
 * Create a pure simulation fighter (no Phaser dependency).
 * Replicates all Fighter.js logic using FP integer math.
 */
function createSimFighter(xPx, playerIndex, stats = { speed: 3, power: 3, defense: 3 }) {
  const moves = {
    lightPunch: { type: 'lightPunch', damage: 8, startup: 3, active: 2, recovery: 5, hitstun: 12, blockstun: 8 },
    heavyPunch: { type: 'heavyPunch', damage: 14, startup: 5, active: 3, recovery: 8, hitstun: 20, blockstun: 14 },
    lightKick: { type: 'lightKick', damage: 8, startup: 3, active: 2, recovery: 5, hitstun: 14, blockstun: 9 },
    heavyKick: { type: 'heavyKick', damage: 14, startup: 5, active: 3, recovery: 8, hitstun: 22, blockstun: 15 },
    special: { type: 'special', damage: 25, startup: 8, active: 4, recovery: 10, hitstun: 30, blockstun: 20 },
  };

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
      this.simVX = -speed;
      this.state = 'walking';
    },
    moveRight(speed) {
      if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
      this.simVX = speed;
      this.state = 'walking';
    },
    stop() {
      if (this.state === 'attacking' || this.state === 'hurt' || this.state === 'knockdown') return;
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
      this.state = 'blocking';
      this.simVX = 0;
    },
    attack(type) {
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
      if (this.attackFrameElapsed < move.startup ||
          this.attackFrameElapsed >= move.startup + move.active) {
        return null;
      }
      const reach = (this.currentAttack.type.includes('Kick') ? 55 : 45) * FP_SCALE;
      const dir = this.facingRight ? 1 : -1;
      return {
        x: this.simX + dir * 10 * FP_SCALE,
        y: this.simY - 50 * FP_SCALE,
        w: reach * dir,
        h: 40 * FP_SCALE,
      };
    },
    getHurtbox() {
      return {
        x: this.simX - 18 * FP_SCALE,
        y: this.simY - 60 * FP_SCALE,
        w: 36 * FP_SCALE,
        h: 60 * FP_SCALE,
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
  };
}

/** Extract deterministic state (ignoring non-deterministic fields like sprite). */
function extractState(fighter) {
  return {
    simX: fighter.simX,
    simY: fighter.simY,
    simVX: fighter.simVX,
    simVY: fighter.simVY,
    hp: fighter.hp,
    special: fighter.special,
    stamina: fighter.stamina,
    state: fighter.state,
    attackCooldown: fighter.attackCooldown,
    attackFrameElapsed: fighter.attackFrameElapsed,
    comboCount: fighter.comboCount,
    hurtTimer: fighter.hurtTimer,
    hitConnected: fighter.hitConnected,
    currentAttack: fighter.currentAttack,
    isOnGround: fighter.isOnGround,
    _airborneTime: fighter._airborneTime,
    hasDoubleJumped: fighter.hasDoubleJumped,
    facingRight: fighter.facingRight,
    _isTouchingWall: fighter._isTouchingWall,
    _wallDir: fighter._wallDir,
    _hasWallJumped: fighter._hasWallJumped,
    _specialTintTimer: fighter._specialTintTimer,
  };
}

/** Simple combat system for testing (pure logic, no Phaser). */
function createSimCombat() {
  return {
    roundActive: true,
    suppressRoundEvents: true,
    timer: 60,
    _timerAccumulator: 0,
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
        const stunFrames = defender.state === 'blocking'
          ? (move.blockstun || undefined)
          : (move.hitstun || undefined);
        defender.takeDamage(damage, attacker.simX, stunFrames);
        attacker.hitConnected = true;
        return true;
      }
      return false;
    },
    tickTimer() {
      this._timerAccumulator++;
      if (this._timerAccumulator >= 60) {
        this._timerAccumulator = 0;
        this.timer--;
      }
    },
  };
}

/** Input sequence for a realistic fight scenario. */
function getInputSequence() {
  const inputs = [];
  for (let f = 0; f < 300; f++) {
    const p1 = {
      left: false,
      right: false,
      up: false,
      down: false,
      lp: false,
      hp: false,
      lk: false,
      hk: false,
      sp: false,
    };
    const p2 = { ...p1 };

    // P1: walk right toward P2
    if (f < 40) p1.right = true;
    // P1: jump at frame 40
    if (f === 40) p1.up = true;
    // P1: light punch at frame 50
    if (f === 50) p1.lp = true;
    // P1: heavy kick at frame 80
    if (f === 80) p1.hk = true;
    // P1: walk left at frames 100-120
    if (f >= 100 && f < 120) p1.left = true;

    // P2: walk left toward P1
    if (f < 30) p2.left = true;
    // P2: block at frame 48-55
    if (f >= 48 && f <= 55) p2.down = true;
    // P2: light kick at frame 70
    if (f === 70) p2.lk = true;
    // P2: jump at frame 90
    if (f === 90) p2.up = true;
    // P2: heavy punch at frame 110
    if (f === 110) p2.hp = true;

    inputs.push({ p1, p2 });
  }
  return inputs;
}

/** Run a full simulation and return final state. */
function runSimulation(inputSequence) {
  const p1 = createSimFighter(144, 0);
  const p2 = createSimFighter(336, 1);
  const combat = createSimCombat();
  const speed1 = (80 + p1.data.stats.speed * 20) * FP_SCALE;
  const speed2 = (80 + p2.data.stats.speed * 20) * FP_SCALE;

  for (const { p1: p1In, p2: p2In } of inputSequence) {
    // 1. Update fighters
    p1.update();
    p2.update();

    // 2. Apply P1 input
    if (p1In.left) p1.moveLeft(speed1);
    else if (p1In.right) p1.moveRight(speed1);
    else p1.stop();
    if (p1In.up) p1.jump();
    if (p1In.down && p1.isOnGround) p1.block();
    if (p1In.lp) p1.attack('lightPunch');
    else if (p1In.hp) p1.attack('heavyPunch');
    else if (p1In.lk) p1.attack('lightKick');
    else if (p1In.hk) p1.attack('heavyKick');
    else if (p1In.sp) p1.attack('special');

    // 3. Apply P2 input
    if (p2In.left) p2.moveLeft(speed2);
    else if (p2In.right) p2.moveRight(speed2);
    else p2.stop();
    if (p2In.up) p2.jump();
    if (p2In.down && p2.isOnGround) p2.block();
    if (p2In.lp) p2.attack('lightPunch');
    else if (p2In.hp) p2.attack('heavyPunch');
    else if (p2In.lk) p2.attack('lightKick');
    else if (p2In.hk) p2.attack('heavyKick');
    else if (p2In.sp) p2.attack('special');

    // 4. Collision
    combat.resolveBodyCollision(p1, p2);

    // 5. Facing
    p1.faceOpponent(p2);
    p2.faceOpponent(p1);

    // 6. Hit detection
    if (combat.roundActive) {
      combat.checkHit(p1, p2);
      combat.checkHit(p2, p1);
      combat.tickTimer();
    }

    // 7. Sync sprites
    p1.syncSprite();
    p2.syncSprite();
  }

  return {
    p1: extractState(p1),
    p2: extractState(p2),
    timer: combat.timer,
    timerAcc: combat._timerAccumulator,
  };
}

describe('determinism', () => {
  it('two independent simulations with identical inputs produce bit-for-bit identical state', () => {
    const inputs = getInputSequence();

    const result1 = runSimulation(inputs);
    const result2 = runSimulation(inputs);

    expect(result1).toEqual(result2);
  });

  it('deterministic across 100 runs', () => {
    const inputs = getInputSequence();
    const reference = runSimulation(inputs);

    for (let i = 0; i < 100; i++) {
      const result = runSimulation(inputs);
      expect(result).toEqual(reference);
    }
  });

  it('different inputs produce different state', () => {
    const inputs1 = getInputSequence();
    const inputs2 = getInputSequence();
    // Modify a late input so stamina difference persists to final state
    inputs2[290].p1.lp = true;

    const result1 = runSimulation(inputs1);
    const result2 = runSimulation(inputs2);

    // At least one field should differ
    const p1Same =
      result1.p1.simX === result2.p1.simX &&
      result1.p1.hp === result2.p1.hp &&
      result1.p1.stamina === result2.p1.stamina;
    const p2Same =
      result1.p2.simX === result2.p2.simX &&
      result1.p2.hp === result2.p2.hp &&
      result1.p2.stamina === result2.p2.stamina;

    expect(p1Same && p2Same).toBe(false);
  });
});
