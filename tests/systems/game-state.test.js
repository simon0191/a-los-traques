import { FP_SCALE, GROUND_Y_FP } from '@alostraques/sim';
import { describe, expect, it, vi } from 'vitest';
import {
  captureCombatState,
  captureFighterState,
  captureGameState,
  restoreCombatState,
  restoreFighterState,
  restoreGameState,
  SNAPSHOT_VERSION,
} from '../../apps/game-vite/src/systems/GameState.js';

function makeFighter(overrides = {}) {
  return {
    simX: 100 * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 50 * FP_SCALE,
    simVY: -100 * FP_SCALE,
    hp: 80,
    special: 30 * FP_SCALE,
    stamina: 70 * FP_SCALE,
    state: 'idle',
    attackCooldown: 0,
    attackFrameElapsed: 0,
    comboCount: 0,
    blockTimer: 0,
    hurtTimer: 0,
    hitConnected: false,
    currentAttack: null,
    isOnGround: true,
    _airborneTime: 0,
    hasDoubleJumped: false,
    facingRight: true,
    _isTouchingWall: false,
    _wallDir: 0,
    _hasWallJumped: false,
    _prevAnimState: null,
    _specialTintTimer: 0,
    syncSprite: vi.fn(),
    ...overrides,
  };
}

function makeCombat(overrides = {}) {
  return {
    roundNumber: 1,
    p1RoundsWon: 0,
    p2RoundsWon: 0,
    timer: 60,
    roundActive: true,
    matchOver: false,
    _timerAccumulator: 0,
    transitionTimer: 0,
    ...overrides,
  };
}

describe('captureFighterState / restoreFighterState', () => {
  it('roundtrips all fields correctly', () => {
    const fighter = makeFighter({
      hp: 42,
      special: 75 * FP_SCALE,
      stamina: 55 * FP_SCALE,
      state: 'attacking',
      attackCooldown: 10,
      hurtTimer: 0,
      hitConnected: true,
      currentAttack: { type: 'lightPunch', damage: 8, startup: 3, active: 2, recovery: 5 },
      isOnGround: false,
      _airborneTime: 12,
      hasDoubleJumped: true,
      facingRight: false,
      _isTouchingWall: true,
      _wallDir: -1,
      _hasWallJumped: true,
      _prevAnimState: 'light_punch',
      _specialTintTimer: 6,
    });
    fighter.simX = 250 * FP_SCALE;
    fighter.simY = 180 * FP_SCALE;
    fighter.simVX = -80 * FP_SCALE;
    fighter.simVY = 200 * FP_SCALE;

    const snapshot = captureFighterState(fighter);

    const target = makeFighter();
    restoreFighterState(target, snapshot);

    expect(target.simX).toBe(250 * FP_SCALE);
    expect(target.simY).toBe(180 * FP_SCALE);
    expect(target.simVX).toBe(-80 * FP_SCALE);
    expect(target.simVY).toBe(200 * FP_SCALE);
    expect(target.hp).toBe(42);
    expect(target.special).toBe(75 * FP_SCALE);
    expect(target.stamina).toBe(55 * FP_SCALE);
    expect(target.state).toBe('attacking');
    expect(target.attackCooldown).toBe(10);
    expect(target.hitConnected).toBe(true);
    expect(target.currentAttack).toEqual({
      type: 'lightPunch',
      damage: 8,
      startup: 3,
      active: 2,
      recovery: 5,
    });
    expect(target.isOnGround).toBe(false);
    expect(target._airborneTime).toBe(12);
    expect(target.hasDoubleJumped).toBe(true);
    expect(target.facingRight).toBe(false);
    expect(target._isTouchingWall).toBe(true);
    expect(target._wallDir).toBe(-1);
    expect(target._hasWallJumped).toBe(true);
    expect(target._prevAnimState).toBe('light_punch');
    expect(target._specialTintTimer).toBe(6);
  });

  it('deep copies currentAttack (no shared references)', () => {
    const fighter = makeFighter({
      currentAttack: { type: 'special', damage: 20 },
    });

    const snapshot = captureFighterState(fighter);
    snapshot.currentAttack.damage = 999;

    expect(fighter.currentAttack.damage).toBe(20);
  });

  it('handles null currentAttack', () => {
    const fighter = makeFighter({ currentAttack: null });
    const snapshot = captureFighterState(fighter);
    const target = makeFighter({ currentAttack: { type: 'lightPunch', damage: 5 } });
    restoreFighterState(target, snapshot);
    expect(target.currentAttack).toBeNull();
  });
});

describe('captureCombatState / restoreCombatState', () => {
  it('roundtrips all fields', () => {
    const combat = makeCombat({
      roundNumber: 3,
      p1RoundsWon: 1,
      p2RoundsWon: 2,
      timer: 25,
      roundActive: false,
      matchOver: true,
      _timerAccumulator: 42,
    });

    const snapshot = captureCombatState(combat);
    const target = makeCombat();
    restoreCombatState(target, snapshot);

    expect(target.roundNumber).toBe(3);
    expect(target.p1RoundsWon).toBe(1);
    expect(target.p2RoundsWon).toBe(2);
    expect(target.timer).toBe(25);
    expect(target.roundActive).toBe(false);
    expect(target.matchOver).toBe(true);
    expect(target._timerAccumulator).toBe(42);
  });
});

describe('captureGameState / restoreGameState', () => {
  it('captures and restores full game state', () => {
    const p1 = makeFighter({ hp: 90 });
    const p2 = makeFighter({ hp: 60, facingRight: false });
    const combat = makeCombat({ timer: 45 });

    const snapshot = captureGameState(10, p1, p2, combat);
    expect(snapshot.frame).toBe(10);

    p1.hp = 0;
    p2.hp = 0;
    combat.timer = 0;

    restoreGameState(snapshot, p1, p2, combat);

    expect(p1.hp).toBe(90);
    expect(p2.hp).toBe(60);
    expect(combat.timer).toBe(45);
  });

  it('includes version field in snapshot', () => {
    const p1 = makeFighter();
    const p2 = makeFighter();
    const combat = makeCombat();

    const snapshot = captureGameState(0, p1, p2, combat);
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
  });
});
