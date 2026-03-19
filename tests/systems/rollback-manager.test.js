import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FP_SCALE, GROUND_Y_FP, MAX_STAMINA_FP } from '../../src/systems/FixedPoint.js';
import { decodeInput, EMPTY_INPUT } from '../../src/systems/InputBuffer.js';
import { RollbackManager } from '../../src/systems/RollbackManager.js';

// Mock NetworkManager
function mockNM(slot = 0) {
  return {
    getPlayerSlot: () => slot,
    sendInput: vi.fn(),
    drainConfirmedInputs: vi.fn(() => []),
    sendSync: vi.fn(),
    rtt: 0,
  };
}

// Mock fighter with FP simulation fields
function mockFighter(xPx = 100, overrides = {}) {
  return {
    simX: xPx * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 0,
    simVY: 0,
    sprite: {
      x: xPx,
      y: GROUND_Y_FP / FP_SCALE,
      setFlipX: vi.fn(),
      setTint: vi.fn(),
      clearTint: vi.fn(),
      setOrigin: vi.fn(),
      play: vi.fn(),
    },
    hp: 100,
    special: 0,
    stamina: MAX_STAMINA_FP,
    state: 'idle',
    attackCooldown: 0,
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
    data: { stats: { speed: 3, power: 3, defense: 3 } },
    playerIndex: 0,
    hasAnims: false,
    fighterId: 'test',
    // Methods
    update: vi.fn(),
    moveLeft: vi.fn(),
    moveRight: vi.fn(),
    stop: vi.fn(),
    jump: vi.fn(),
    block: vi.fn(),
    attack: vi.fn(() => true),
    faceOpponent: vi.fn(),
    getAttackHitbox: vi.fn(() => null),
    getHurtbox: vi.fn(() => null),
    syncSprite: vi.fn(),
    ...overrides,
  };
}

// Mock scene
function mockScene() {
  return {
    _muteEffects: false,
    game: { audioManager: { play: vi.fn() } },
    cameras: { main: { shake: vi.fn() } },
    spawnHitSpark: vi.fn(),
    time: { delayedCall: vi.fn() },
    devConsole: null,
  };
}

// Mock CombatSystem
function mockCombat() {
  return {
    roundNumber: 1,
    p1RoundsWon: 0,
    p2RoundsWon: 0,
    timer: 60,
    roundActive: true,
    matchOver: false,
    _timerAccumulator: 0,
    resolveBodyCollision: vi.fn(),
    checkHit: vi.fn(),
    tickTimer: vi.fn(),
    scene: mockScene(),
  };
}

const noInput = {
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

describe('RollbackManager', () => {
  let nm, scene, p1, p2, combat, rm;

  beforeEach(() => {
    nm = mockNM(0);
    scene = mockScene();
    p1 = mockFighter(144);
    p2 = mockFighter(336);
    combat = mockCombat();
    rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });
  });

  describe('basic advance', () => {
    it('increments currentFrame on each advance', () => {
      expect(rm.currentFrame).toBe(0);
      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.currentFrame).toBe(1);
      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.currentFrame).toBe(2);
    });

    it('sends local input to network with inputDelay offset', () => {
      rm.advance(noInput, scene, p1, p2, combat);
      // 3rd arg is redundant history (empty on first frame)
      expect(nm.sendInput).toHaveBeenCalledWith(2, noInput, []);
    });

    it('stores local input at delayed frame', () => {
      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.localInputHistory.has(2)).toBe(true);
    });
  });

  describe('input prediction', () => {
    it('predicts EMPTY_INPUT when no remote input received', () => {
      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.predictedRemoteInputs.has(0)).toBe(true);
      expect(rm.predictedRemoteInputs.get(0)).toBe(EMPTY_INPUT);
    });

    it('predicts movement continuation, zero attacks', () => {
      const remoteInput = {
        left: true,
        right: false,
        up: false,
        down: false,
        lp: true,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };
      nm.drainConfirmedInputs.mockReturnValueOnce([[0, remoteInput]]);

      rm.advance(noInput, scene, p1, p2, combat);

      rm.advance(noInput, scene, p1, p2, combat);

      const predicted = rm.predictedRemoteInputs.get(1);
      expect(predicted).toBeDefined();
      const decoded = decodeInput(predicted);
      expect(decoded.left).toBe(true);
      expect(decoded.lp).toBe(false);
    });
  });

  describe('misprediction detection', () => {
    it('detects misprediction when confirmed differs from predicted', () => {
      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.predictedRemoteInputs.get(0)).toBe(EMPTY_INPUT);

      const confirmedInput = {
        left: true,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };
      nm.drainConfirmedInputs.mockReturnValueOnce([[0, confirmedInput]]);

      rm.advance(noInput, scene, p1, p2, combat);

      expect(rm.rollbackCount).toBe(1);
    });

    it('does not rollback when prediction matches confirmed', () => {
      rm.advance(noInput, scene, p1, p2, combat);

      nm.drainConfirmedInputs.mockReturnValueOnce([[0, noInput]]);
      rm.advance(noInput, scene, p1, p2, combat);

      expect(rm.rollbackCount).toBe(0);
    });
  });

  describe('rollback window', () => {
    it('does not rollback beyond maxRollbackFrames', () => {
      for (let i = 0; i < 10; i++) {
        rm.advance(noInput, scene, p1, p2, combat);
      }

      const confirmedInput = {
        left: true,
        right: false,
        up: false,
        down: false,
        lp: true,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };
      nm.drainConfirmedInputs.mockReturnValueOnce([[0, confirmedInput]]);

      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.rollbackCount).toBe(0);
    });
  });

  describe('pruning', () => {
    it('prunes old data beyond rollback window', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, scene, p1, p2, combat);
      }

      expect(rm.stateSnapshots.has(0)).toBe(false);
      expect(rm.predictedRemoteInputs.has(0)).toBe(false);
    });

    it('keeps recent data within rollback window', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, scene, p1, p2, combat);
      }

      expect(rm.stateSnapshots.has(19)).toBe(true);
    });
  });

  describe('muteEffects during rollback', () => {
    it('sets _muteEffects true during re-simulation', () => {
      let muteEffectsDuringResim = false;

      p1.update = vi.fn(() => {
        if (scene._muteEffects) muteEffectsDuringResim = true;
      });

      rm.advance(noInput, scene, p1, p2, combat);

      const confirmedInput = {
        left: true,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };
      nm.drainConfirmedInputs.mockReturnValueOnce([[0, confirmedInput]]);
      rm.advance(noInput, scene, p1, p2, combat);

      expect(muteEffectsDuringResim).toBe(true);
      expect(scene._muteEffects).toBe(false);
    });
  });
});
