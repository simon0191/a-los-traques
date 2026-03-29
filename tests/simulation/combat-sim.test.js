import { describe, expect, it } from 'vitest';
import { ROUND_TIME } from '../../src/config.js';
import { CombatSim, createCombatSim } from '../../src/simulation/CombatSim.js';
import { FighterSim } from '../../src/simulation/FighterSim.js';

describe('CombatSim', () => {
  describe('constructor', () => {
    it('initializes with default values', () => {
      const c = new CombatSim();
      expect(c.roundNumber).toBe(1);
      expect(c.timer).toBe(ROUND_TIME);
      expect(c.roundActive).toBe(false);
      expect(c.matchOver).toBe(false);
      expect(c.transitionTimer).toBe(0);
    });
  });

  describe('createCombatSim factory', () => {
    it('creates with roundActive true and suppressRoundEvents', () => {
      const c = createCombatSim();
      expect(c).toBeInstanceOf(CombatSim);
      expect(c.roundActive).toBe(true);
      expect(c.suppressRoundEvents).toBe(true);
    });
  });

  describe('startRound / stopRound', () => {
    it('startRound sets roundActive and resets timer', () => {
      const c = new CombatSim();
      c.timer = 30;
      c.startRound();
      expect(c.roundActive).toBe(true);
      expect(c.timer).toBe(ROUND_TIME);
      expect(c._timerAccumulator).toBe(0);
    });

    it('stopRound clears roundActive', () => {
      const c = new CombatSim();
      c.roundActive = true;
      c.stopRound();
      expect(c.roundActive).toBe(false);
    });
  });

  describe('tickTimer', () => {
    it('decrements timer every 60 frames', () => {
      const c = createCombatSim();
      for (let i = 0; i < 59; i++) {
        expect(c.tickTimer()).toBeNull();
      }
      expect(c.timer).toBe(ROUND_TIME); // not yet decremented
      c.tickTimer(); // 60th tick
      expect(c.timer).toBe(ROUND_TIME - 1);
    });

    it('returns timeup when timer reaches 0', () => {
      const c = createCombatSim();
      c.timer = 1;
      c._timerAccumulator = 59;
      const result = c.tickTimer();
      expect(result).toEqual({ timeup: true });
    });
  });

  describe('checkHit', () => {
    function setupHitScenario() {
      const p1 = new FighterSim(100, 0);
      const p2 = new FighterSim(130, 1);
      const combat = createCombatSim();

      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'lightPunch',
        damage: 8,
        startup: 3,
        active: 2,
        recovery: 5,
        hitstun: 12,
        blockstun: 8,
      };
      p1.attackFrameElapsed = 3;
      p1.attackCooldown = 7;
      p1.hitConnected = false;
      p1.facingRight = true;

      return { p1, p2, combat };
    }

    it('returns hit result on overlap', () => {
      const { p1, p2, combat } = setupHitScenario();
      const result = combat.checkHit(p1, p2);
      expect(result).toMatchObject({ hit: true, ko: false });
      expect(result.damage).toBeGreaterThan(0);
      expect(result.intensity).toBe('light');
      expect(p1.hitConnected).toBe(true);
    });

    it('returns false when not attacking', () => {
      const { p1, p2, combat } = setupHitScenario();
      p1.state = 'idle';
      expect(combat.checkHit(p1, p2)).toBe(false);
    });

    it('returns false when already connected', () => {
      const { p1, p2, combat } = setupHitScenario();
      p1.hitConnected = true;
      expect(combat.checkHit(p1, p2)).toBe(false);
    });

    it('returns false when out of range', () => {
      const p1 = new FighterSim(100, 0);
      const p2 = new FighterSim(400, 1); // far away
      const combat = createCombatSim();
      p1.state = 'attacking';
      p1.currentAttack = { type: 'lightPunch', damage: 8, startup: 3, active: 2, recovery: 5 };
      p1.attackFrameElapsed = 3;
      p1.attackCooldown = 7;
      p1.hitConnected = false;
      p1.facingRight = true;
      expect(combat.checkHit(p1, p2)).toBe(false);
    });

    it('detects KO when defender HP is low', () => {
      const { p1, p2, combat } = setupHitScenario();
      p2.hp = 1;
      const result = combat.checkHit(p1, p2);
      expect(result).toMatchObject({ hit: true, ko: true });
    });

    it('reports blocking state', () => {
      const { p1, p2, combat } = setupHitScenario();
      p2.state = 'blocking';
      const result = combat.checkHit(p1, p2);
      expect(result.isBlocking).toBe(true);
    });

    it('applies combo scaling on consecutive hits', () => {
      const { p1, p2, combat } = setupHitScenario();
      p2.state = 'hurt'; // already in hitstun
      p1.comboCount = 0;
      combat.checkHit(p1, p2);
      expect(p1.comboCount).toBe(1);
    });
  });

  describe('resolveBodyCollision', () => {
    it('pushes overlapping fighters apart', () => {
      const p1 = new FighterSim(100, 0);
      const p2 = new FighterSim(105, 1); // very close
      const combat = new CombatSim();

      const p1Before = p1.simX;
      const p2Before = p2.simX;
      combat.resolveBodyCollision(p1, p2);

      // Should be pushed apart
      expect(p1.simX).toBeLessThanOrEqual(p1Before);
      expect(p2.simX).toBeGreaterThanOrEqual(p2Before);
    });

    it('does not push when far apart', () => {
      const p1 = new FighterSim(100, 0);
      const p2 = new FighterSim(300, 1);
      const combat = new CombatSim();

      const p1Before = p1.simX;
      combat.resolveBodyCollision(p1, p2);
      expect(p1.simX).toBe(p1Before);
    });

    it('skips collision when one fighter is airborne', () => {
      const p1 = new FighterSim(100, 0);
      const p2 = new FighterSim(105, 1);
      const combat = new CombatSim();
      p1.simY = 0; // high in air

      const p2Before = p2.simX;
      combat.resolveBodyCollision(p1, p2);
      expect(p2.simX).toBe(p2Before);
    });
  });

  describe('reset', () => {
    it('resets all state', () => {
      const c = new CombatSim();
      c.roundNumber = 3;
      c.p1RoundsWon = 2;
      c.matchOver = true;
      c.transitionTimer = 100;

      c.reset();
      expect(c.roundNumber).toBe(1);
      expect(c.p1RoundsWon).toBe(0);
      expect(c.p2RoundsWon).toBe(0);
      expect(c.matchOver).toBe(false);
      expect(c.transitionTimer).toBe(0);
    });
  });
});
