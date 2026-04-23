import {
  CombatSim,
  captureGameState,
  encodeInput,
  FighterSim,
  hashGameState,
  restoreCombatState,
  restoreFighterState,
  restoreGameState,
  tick,
} from '@alostraques/sim';
import { describe, expect, it } from 'vitest';
import { ROUND_TIME, ROUNDS_TO_WIN } from '../../packages/game/src/config.js';

const EMPTY = encodeInput({});
const RIGHT = encodeInput({ right: true });
const PUNCH = encodeInput({ lp: true });
const RIGHT_PUNCH = encodeInput({ right: true, lp: true });
const LEFT_KICK = encodeInput({ left: true, hk: true });

function makeGame() {
  const p1 = new FighterSim(144, 0);
  const p2 = new FighterSim(336, 1);
  const combat = new CombatSim();
  combat.roundActive = true;
  return { p1, p2, combat };
}

describe('SimulationEngine', () => {
  describe('tick', () => {
    it('returns new state object each call', () => {
      const { p1, p2, combat } = makeGame();
      const r1 = tick(p1, p2, combat, EMPTY, EMPTY, 0);
      const r2 = tick(p1, p2, combat, EMPTY, EMPTY, 1);
      expect(r1.state).not.toBe(r2.state); // different objects
    });

    it('state contains p1, p2, combat, and frame', () => {
      const { p1, p2, combat } = makeGame();
      const { state } = tick(p1, p2, combat, EMPTY, EMPTY, 42);
      expect(state.frame).toBe(42);
      expect(state.p1).toBeDefined();
      expect(state.p2).toBeDefined();
      expect(state.combat).toBeDefined();
      expect(state.p1.simX).toBe(p1.simX);
    });

    it('applies input to fighters', () => {
      const { p1, p2, combat } = makeGame();
      const _before = p1.simX;
      tick(p1, p2, combat, RIGHT, EMPTY, 0);
      // After one frame with right input, fighter should have moved
      expect(p1.simVX).toBeGreaterThan(0);
    });

    it('returns null roundEvent during normal play', () => {
      const { p1, p2, combat } = makeGame();
      const { roundEvent } = tick(p1, p2, combat, EMPTY, EMPTY, 0);
      expect(roundEvent).toBeNull();
    });

    it('returns timeup roundEvent when timer expires', () => {
      const { p1, p2, combat } = makeGame();
      combat.timer = 1;
      combat._timerAccumulator = 59;
      const { roundEvent } = tick(p1, p2, combat, EMPTY, EMPTY, 0);
      expect(roundEvent).toEqual({ type: 'timeup', winnerIndex: expect.any(Number) });
    });

    it('returns ko roundEvent when fighter KO', () => {
      const { p1, p2, combat } = makeGame();
      // Setup p1 attack in active frame, p2 at 1 HP nearby
      p1.simX = 130 * 1000;
      p2.simX = 160 * 1000;
      p2.hp = 1;
      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'heavyPunch',
        damage: 14,
        startup: 3,
        active: 3,
        recovery: 5,
        hitstun: 20,
        blockstun: 14,
      };
      p1.attackFrameElapsed = 3;
      p1.attackCooldown = 8;
      p1.facingRight = true;
      p1.hitConnected = false;

      const { roundEvent } = tick(p1, p2, combat, EMPTY, EMPTY, 0);
      expect(roundEvent).toEqual({ type: 'ko', winnerIndex: 0 });
    });

    it('updates round state on KO (roundsWon, roundActive)', () => {
      const { p1, p2, combat } = makeGame();
      p1.simX = 130 * 1000;
      p2.simX = 160 * 1000;
      p2.hp = 1;
      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'heavyPunch',
        damage: 14,
        startup: 3,
        active: 3,
        recovery: 5,
        hitstun: 20,
      };
      p1.attackFrameElapsed = 3;
      p1.attackCooldown = 8;
      p1.facingRight = true;
      p1.hitConnected = false;

      tick(p1, p2, combat, EMPTY, EMPTY, 0);
      expect(combat.roundActive).toBe(false);
      expect(combat.p1RoundsWon).toBe(1);
      expect(combat.roundNumber).toBe(2);
    });

    it('sets matchOver when enough rounds won', () => {
      const { p1, p2, combat } = makeGame();
      combat.p1RoundsWon = ROUNDS_TO_WIN - 1;
      p1.simX = 130 * 1000;
      p2.simX = 160 * 1000;
      p2.hp = 1;
      p1.state = 'attacking';
      p1.currentAttack = {
        type: 'heavyPunch',
        damage: 14,
        startup: 3,
        active: 3,
        recovery: 5,
        hitstun: 20,
      };
      p1.attackFrameElapsed = 3;
      p1.attackCooldown = 8;
      p1.facingRight = true;
      p1.hitConnected = false;

      tick(p1, p2, combat, EMPTY, EMPTY, 0);
      expect(combat.matchOver).toBe(true);
    });
  });

  describe('determinism', () => {
    it('same inputs produce identical hashes', () => {
      function run() {
        const { p1, p2, combat } = makeGame();
        let state;
        for (let f = 0; f < 120; f++) {
          const i1 = f % 30 < 15 ? RIGHT_PUNCH : EMPTY;
          const i2 = f % 30 < 15 ? LEFT_KICK : EMPTY;
          const result = tick(p1, p2, combat, i1, i2, f);
          state = result.state;
        }
        return hashGameState(state);
      }
      expect(run()).toBe(run());
    });

    it('different inputs produce different hashes', () => {
      function run(input) {
        const { p1, p2, combat } = makeGame();
        let state;
        for (let f = 0; f < 60; f++) {
          const result = tick(p1, p2, combat, input, EMPTY, f);
          state = result.state;
        }
        return hashGameState(state);
      }
      expect(run(RIGHT)).not.toBe(run(PUNCH));
    });
  });

  describe('captureGameState / restoreGameState', () => {
    it('captures all fighter and combat state', () => {
      const { p1, p2, combat } = makeGame();
      p1.hp = 75;
      p2.simX = 200000;
      combat.timer = 42;

      const snap = captureGameState(10, p1, p2, combat);
      expect(snap.frame).toBe(10);
      expect(snap.p1.hp).toBe(75);
      expect(snap.p2.simX).toBe(200000);
      expect(snap.combat.timer).toBe(42);
    });

    it('restoreGameState overwrites live state', () => {
      const { p1, p2, combat } = makeGame();
      const snap = captureGameState(0, p1, p2, combat);

      // Modify state
      p1.hp = 1;
      p2.simX = 999999;
      combat.timer = 5;

      restoreGameState(snap, p1, p2, combat);
      expect(p1.hp).toBe(100);
      expect(p2.simX).toBe(snap.p2.simX);
      expect(combat.timer).toBe(ROUND_TIME);
    });

    it('snapshot is a deep copy (modifying snap does not affect original)', () => {
      const { p1, p2, combat } = makeGame();
      const snap = captureGameState(0, p1, p2, combat);
      snap.p1.hp = 0;
      expect(p1.hp).toBe(100); // unchanged
    });
  });

  describe('hashGameState', () => {
    it('same state produces same hash', () => {
      const { p1, p2, combat } = makeGame();
      const s1 = captureGameState(0, p1, p2, combat);
      const s2 = captureGameState(0, p1, p2, combat);
      expect(hashGameState(s1)).toBe(hashGameState(s2));
    });

    it('different state produces different hash', () => {
      const { p1, p2, combat } = makeGame();
      const s1 = captureGameState(0, p1, p2, combat);
      p1.hp = 50;
      const s2 = captureGameState(0, p1, p2, combat);
      expect(hashGameState(s1)).not.toBe(hashGameState(s2));
    });
  });

  describe('restoreFighterState / restoreCombatState', () => {
    it('restores individual fighter state', () => {
      const f = new FighterSim(100, 0);
      const snap = {
        simX: 999,
        simY: 888,
        simVX: 0,
        simVY: 0,
        hp: 50,
        special: 100,
        stamina: 50000,
        state: 'hurt',
        attackCooldown: 0,
        attackFrameElapsed: 0,
        comboCount: 2,
        blockTimer: 0,
        hurtTimer: 10,
        hitConnected: false,
        currentAttack: null,
        isOnGround: true,
        _airborneTime: 0,
        hasDoubleJumped: false,
        facingRight: false,
        _isTouchingWall: false,
        _wallDir: 0,
        _hasWallJumped: false,
        _prevAnimState: null,
        _specialTintTimer: 0,
      };

      restoreFighterState(f, snap);
      expect(f.simX).toBe(999);
      expect(f.hp).toBe(50);
      expect(f.state).toBe('hurt');
      expect(f.comboCount).toBe(2);
    });

    it('restores combat state', () => {
      const c = new CombatSim();
      const snap = {
        roundNumber: 3,
        p1RoundsWon: 1,
        p2RoundsWon: 2,
        timer: 30,
        roundActive: false,
        matchOver: true,
        _timerAccumulator: 10,
        transitionTimer: 50,
      };

      restoreCombatState(c, snap);
      expect(c.roundNumber).toBe(3);
      expect(c.matchOver).toBe(true);
      expect(c.transitionTimer).toBe(50);
    });
  });
});
