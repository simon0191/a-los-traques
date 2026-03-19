import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GROUND_Y } from '../../src/config.js';
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

// Mock fighter with all state fields needed
function mockFighter(x = 100, overrides = {}) {
  return {
    sprite: {
      x,
      y: GROUND_Y,
      body: {
        velocity: { x: 0, y: 0 },
        blocked: { down: true },
        setVelocityX: vi.fn(function (v) {
          this.velocity.x = v;
        }),
        setVelocityY: vi.fn(function (v) {
          this.velocity.y = v;
        }),
        setGravityY: vi.fn(),
      },
      setFlipX: vi.fn(),
      setTint: vi.fn(),
      clearTint: vi.fn(),
      setOrigin: vi.fn(),
      play: vi.fn(),
    },
    hp: 100,
    special: 0,
    stamina: 100,
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
      expect(nm.sendInput).toHaveBeenCalledWith(2, noInput); // frame 0 + inputDelay 2
    });

    it('stores local input at delayed frame', () => {
      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.localInputHistory.has(2)).toBe(true);
    });
  });

  describe('input prediction', () => {
    it('predicts EMPTY_INPUT when no remote input received', () => {
      rm.advance(noInput, scene, p1, p2, combat);
      // Should have predicted for frame 0
      expect(rm.predictedRemoteInputs.has(0)).toBe(true);
      expect(rm.predictedRemoteInputs.get(0)).toBe(EMPTY_INPUT);
    });

    it('predicts movement continuation, zero attacks', () => {
      // Simulate receiving a remote input with left+lp
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

      // Now frame 1: prediction should have left but no lp
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
      // Frame 0: predict empty
      rm.advance(noInput, scene, p1, p2, combat);
      expect(rm.predictedRemoteInputs.get(0)).toBe(EMPTY_INPUT);

      // Frame 1: confirmed input for frame 0 arrives with left pressed
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

      // Rollback should have been triggered
      expect(rm.rollbackCount).toBe(1);
    });

    it('does not rollback when prediction matches confirmed', () => {
      // Frame 0: predict empty
      rm.advance(noInput, scene, p1, p2, combat);

      // Confirm empty input for frame 0
      nm.drainConfirmedInputs.mockReturnValueOnce([[0, noInput]]);
      rm.advance(noInput, scene, p1, p2, combat);

      expect(rm.rollbackCount).toBe(0);
    });
  });

  describe('rollback window', () => {
    it('does not rollback beyond maxRollbackFrames', () => {
      // Advance 10 frames
      for (let i = 0; i < 10; i++) {
        rm.advance(noInput, scene, p1, p2, combat);
      }

      // Confirmed input arrives for frame 0 (10 frames ago, > maxRollbackFrames=7)
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
      // Should not have rolled back (too far in the past)
      expect(rm.rollbackCount).toBe(0);
    });
  });

  describe('pruning', () => {
    it('prunes old data beyond rollback window', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, scene, p1, p2, combat);
      }

      // Old frames should be pruned
      expect(rm.stateSnapshots.has(0)).toBe(false);
      expect(rm.predictedRemoteInputs.has(0)).toBe(false);
    });

    it('keeps recent data within rollback window', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, scene, p1, p2, combat);
      }

      // Recent frames should still be there
      expect(rm.stateSnapshots.has(19)).toBe(true);
    });
  });

  describe('muteEffects during rollback', () => {
    it('sets _muteEffects true during re-simulation', () => {
      let muteEffectsDuringResim = false;

      // Make p1.update check muteEffects
      p1.update = vi.fn(() => {
        if (scene._muteEffects) muteEffectsDuringResim = true;
      });

      // Frame 0: predict empty
      rm.advance(noInput, scene, p1, p2, combat);

      // Frame 1: confirmed input for frame 0 arrives (different from prediction)
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
      // After rollback, _muteEffects should be false again
      expect(scene._muteEffects).toBe(false);
    });
  });
});
