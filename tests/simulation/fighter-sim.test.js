import { describe, expect, it } from 'vitest';
import { MAX_HP, STAMINA_COSTS } from '../../src/config.js';
import { createFighterSim, FighterSim } from '../../src/simulation/FighterSim.js';
import {
  DOUBLE_JUMP_AIRBORNE_THRESHOLD,
  FP_SCALE,
  GROUND_Y_FP,
  JUMP_VY_FP,
  SPECIAL_COST_FP,
} from '../../src/systems/FixedPoint.js';

describe('FighterSim', () => {
  describe('constructor', () => {
    it('initializes at correct FP position', () => {
      const f = new FighterSim(100, 0);
      expect(f.simX).toBe(100 * FP_SCALE);
      expect(f.simY).toBe(GROUND_Y_FP);
      expect(f.hp).toBe(MAX_HP);
      expect(f.state).toBe('idle');
      expect(f.facingRight).toBe(true);
    });

    it('P2 faces left', () => {
      const f = new FighterSim(300, 1);
      expect(f.facingRight).toBe(false);
    });

    it('uses default stats and moves when no fighterData', () => {
      const f = new FighterSim(100, 0);
      expect(f.data.stats).toEqual({ speed: 3, power: 3, defense: 3 });
      expect(f.data.moves.lightPunch).toBeDefined();
      expect(f.data.moves.special).toBeDefined();
    });

    it('uses provided fighterData', () => {
      const data = { stats: { speed: 5, power: 2, defense: 4 }, moves: {} };
      const f = new FighterSim(100, 0, data);
      expect(f.data.stats.speed).toBe(5);
    });
  });

  describe('createFighterSim factory', () => {
    it('returns a FighterSim instance', () => {
      const f = createFighterSim(100, 0);
      expect(f).toBeInstanceOf(FighterSim);
    });
  });

  describe('update', () => {
    it('applies gravity when airborne', () => {
      const f = new FighterSim(100, 0);
      f.simY = GROUND_Y_FP - 50000; // airborne
      f.isOnGround = false;
      const prevVY = f.simVY;
      f.update();
      expect(f.simVY).toBeGreaterThan(prevVY);
    });

    it('decrements attack cooldown', () => {
      const f = new FighterSim(100, 0);
      f.state = 'attacking';
      f.attackCooldown = 5;
      f.attackFrameElapsed = 0;
      f.currentAttack = { type: 'lightPunch' };
      f.update();
      expect(f.attackCooldown).toBe(4);
      expect(f.attackFrameElapsed).toBe(1);
    });

    it('transitions to idle when attack cooldown reaches 0', () => {
      const f = new FighterSim(100, 0);
      f.state = 'attacking';
      f.attackCooldown = 1;
      f.currentAttack = { type: 'lightPunch' };
      f.update();
      expect(f.state).toBe('idle');
      expect(f.currentAttack).toBeNull();
    });

    it('recovers from hurt when hurtTimer expires', () => {
      const f = new FighterSim(100, 0);
      f.state = 'hurt';
      f.hurtTimer = 1;
      f.update();
      expect(f.state).toBe('idle');
    });

    it('regenerates stamina', () => {
      const f = new FighterSim(100, 0);
      f.stamina = 0;
      f.update();
      expect(f.stamina).toBeGreaterThan(0);
    });

    it('clamps to stage bounds', () => {
      const f = new FighterSim(100, 0);
      f.simX = -999999;
      f.update();
      expect(f.simX).toBeGreaterThanOrEqual(20 * FP_SCALE); // STAGE_LEFT
    });
  });

  describe('movement', () => {
    it('moveLeft sets negative velocity', () => {
      const f = new FighterSim(100, 0);
      f.moveLeft(100000);
      expect(f.simVX).toBe(-100000);
      expect(f.state).toBe('walking');
    });

    it('moveRight sets positive velocity', () => {
      const f = new FighterSim(100, 0);
      f.moveRight(100000);
      expect(f.simVX).toBe(100000);
    });

    it('stop zeroes velocity on ground', () => {
      const f = new FighterSim(100, 0);
      f.moveRight(100000);
      f.stop();
      expect(f.simVX).toBe(0);
      expect(f.state).toBe('idle');
    });

    it('ignores movement during attack', () => {
      const f = new FighterSim(100, 0);
      f.state = 'attacking';
      f.moveLeft(100000);
      expect(f.simVX).toBe(0);
    });

    it('ignores movement during hurt', () => {
      const f = new FighterSim(100, 0);
      f.state = 'hurt';
      f.moveRight(100000);
      expect(f.simVX).toBe(0);
    });
  });

  describe('jump', () => {
    it('sets upward velocity on ground', () => {
      const f = new FighterSim(100, 0);
      f.jump();
      expect(f.simVY).toBe(JUMP_VY_FP);
      expect(f.state).toBe('jumping');
      expect(f.isOnGround).toBe(false);
    });

    it('double jump after airborne threshold', () => {
      const f = new FighterSim(100, 0);
      f.isOnGround = false;
      f._airborneTime = DOUBLE_JUMP_AIRBORNE_THRESHOLD + 1;
      f.jump();
      expect(f.hasDoubleJumped).toBe(true);
    });

    it('cannot double jump twice', () => {
      const f = new FighterSim(100, 0);
      f.isOnGround = false;
      f.hasDoubleJumped = true;
      f._airborneTime = DOUBLE_JUMP_AIRBORNE_THRESHOLD + 1;
      const prevVY = f.simVY;
      f.jump();
      expect(f.simVY).toBe(prevVY); // unchanged
    });

    it('ignores jump during attack', () => {
      const f = new FighterSim(100, 0);
      f.state = 'attacking';
      f.jump();
      expect(f.isOnGround).toBe(true);
    });
  });

  describe('block', () => {
    it('sets blocking state and zeroes velocity', () => {
      const f = new FighterSim(100, 0);
      f.moveRight(100000);
      f.block();
      expect(f.state).toBe('blocking');
      expect(f.simVX).toBe(0);
      expect(f.blockTimer).toBe(3);
    });

    it('cannot block during attack', () => {
      const f = new FighterSim(100, 0);
      f.state = 'attacking';
      f.block();
      expect(f.state).toBe('attacking');
    });
  });

  describe('attack', () => {
    it('executes attack with cooldown', () => {
      const f = new FighterSim(100, 0);
      const result = f.attack('lightPunch');
      expect(result).toBe(true);
      expect(f.state).toBe('attacking');
      expect(f.attackCooldown).toBeGreaterThan(0);
      expect(f.currentAttack.type).toBe('lightPunch');
    });

    it('deducts stamina', () => {
      const f = new FighterSim(100, 0);
      const before = f.stamina;
      f.attack('lightPunch');
      expect(f.stamina).toBe(before - STAMINA_COSTS.lightPunch * FP_SCALE);
    });

    it('rejects attack when stamina too low', () => {
      const f = new FighterSim(100, 0);
      f.stamina = 0;
      expect(f.attack('lightPunch')).toBe(false);
      expect(f.state).toBe('idle');
    });

    it('rejects attack during cooldown', () => {
      const f = new FighterSim(100, 0);
      f.attack('lightPunch');
      expect(f.attack('heavyPunch')).toBe(false);
    });

    it('special requires meter', () => {
      const f = new FighterSim(100, 0);
      f.special = 0;
      expect(f.attack('special')).toBe(false);
    });

    it('special deducts meter and sets tint timer', () => {
      const f = new FighterSim(100, 0);
      f.special = SPECIAL_COST_FP;
      f.attack('special');
      expect(f.special).toBe(0);
      expect(f._specialTintTimer).toBeGreaterThan(0);
    });

    it('normal-to-special cancel on hit', () => {
      const f = new FighterSim(100, 0);
      f.special = SPECIAL_COST_FP * 2;
      f.attack('lightPunch');
      f.hitConnected = true;
      // Advance to active frame window
      f.attackFrameElapsed = f.currentAttack.startup;
      const result = f.attack('special');
      expect(result).toBe(true);
      expect(f.currentAttack.type).toBe('special');
    });
  });

  describe('hitbox/hurtbox', () => {
    it('getAttackHitbox returns null when not attacking', () => {
      const f = new FighterSim(100, 0);
      expect(f.getAttackHitbox()).toBeNull();
    });

    it('getAttackHitbox returns box during active frames', () => {
      const f = new FighterSim(100, 0);
      f.state = 'attacking';
      f.currentAttack = { type: 'lightPunch', startup: 3, active: 2, recovery: 5 };
      f.attackFrameElapsed = 3; // first active frame
      f.facingRight = true;
      const box = f.getAttackHitbox();
      expect(box).not.toBeNull();
      expect(box.w).toBeGreaterThan(0); // facing right
    });

    it('getAttackHitbox returns null during startup', () => {
      const f = new FighterSim(100, 0);
      f.state = 'attacking';
      f.currentAttack = { type: 'lightPunch', startup: 3, active: 2, recovery: 5 };
      f.attackFrameElapsed = 1; // still in startup
      expect(f.getAttackHitbox()).toBeNull();
    });

    it('getHurtbox varies by state', () => {
      const f = new FighterSim(100, 0);
      const standing = f.getHurtbox();

      f.state = 'blocking';
      const blocking = f.getHurtbox();
      expect(blocking.h).toBeLessThan(standing.h); // crouching is shorter
    });
  });

  describe('takeDamage', () => {
    it('reduces HP and applies knockback', () => {
      const f = new FighterSim(200, 1);
      const ko = f.takeDamage(10, 100 * FP_SCALE, 12);
      expect(f.hp).toBe(MAX_HP - 10);
      expect(f.simVX).not.toBe(0); // knockback
      expect(f.state).toBe('hurt');
      expect(ko).toBe(false);
    });

    it('returns true on KO', () => {
      const f = new FighterSim(200, 1);
      f.hp = 5;
      const ko = f.takeDamage(10, 100 * FP_SCALE, 12);
      expect(ko).toBe(true);
      expect(f.hp).toBe(0);
    });

    it('heavy damage causes knockdown', () => {
      const f = new FighterSim(200, 1);
      f.takeDamage(20, 100 * FP_SCALE, 30);
      expect(f.state).toBe('knockdown');
    });

    it('block reduces damage', () => {
      const f = new FighterSim(200, 1);
      f.state = 'blocking';
      f.takeDamage(10, 100 * FP_SCALE, 8);
      // Block damage = Math.trunc(10 / 5) = 2
      expect(f.hp).toBe(MAX_HP - 2);
    });

    it('gains special meter from damage', () => {
      const f = new FighterSim(200, 1);
      f.takeDamage(10, 100 * FP_SCALE, 12);
      expect(f.special).toBeGreaterThan(0);
    });
  });

  describe('resetForRound', () => {
    it('resets all state to initial values', () => {
      const f = new FighterSim(100, 0);
      f.hp = 50;
      f.special = 5000;
      f.state = 'attacking';
      f.simVX = 99999;
      f.attackCooldown = 10;

      f.resetForRound(200);
      expect(f.simX).toBe(200 * FP_SCALE);
      expect(f.hp).toBe(MAX_HP);
      expect(f.special).toBe(0);
      expect(f.state).toBe('idle');
      expect(f.simVX).toBe(0);
      expect(f.attackCooldown).toBe(0);
      expect(f.facingRight).toBe(true); // playerIndex 0
    });
  });

  describe('faceOpponent', () => {
    it('faces right when opponent is to the right', () => {
      const f1 = new FighterSim(100, 0);
      const f2 = new FighterSim(200, 1);
      f1.faceOpponent(f2);
      expect(f1.facingRight).toBe(true);
    });

    it('faces left when opponent is to the left', () => {
      const f1 = new FighterSim(200, 0);
      const f2 = new FighterSim(100, 1);
      f1.faceOpponent(f2);
      expect(f1.facingRight).toBe(false);
    });
  });

  describe('determinism', () => {
    it('same inputs produce identical state', () => {
      function runSequence() {
        const f = new FighterSim(144, 0);
        for (let i = 0; i < 60; i++) {
          if (i < 20) f.moveRight(120 * FP_SCALE);
          else if (i === 20) f.jump();
          else if (i === 30) f.attack('lightPunch');
          else f.stop();
          f.update();
        }
        return { simX: f.simX, simY: f.simY, hp: f.hp, state: f.state, stamina: f.stamina };
      }
      expect(runSequence()).toEqual(runSequence());
    });
  });
});
