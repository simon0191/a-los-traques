import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_VERSION } from '../../src/simulation/SimulationEngine.js';
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
    updateAnimation: vi.fn(),
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
    transitionTimer: 0,
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
    p1.scene = scene;
    p2.scene = scene;
    combat = mockCombat();
    rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });
  });

  describe('basic advance', () => {
    it('increments currentFrame on each advance', () => {
      expect(rm.currentFrame).toBe(0);
      rm.advance(noInput, p1, p2, combat);
      expect(rm.currentFrame).toBe(1);
      rm.advance(noInput, p1, p2, combat);
      expect(rm.currentFrame).toBe(2);
    });

    it('sends local input to network with inputDelay offset', () => {
      rm.advance(noInput, p1, p2, combat);
      // 3rd arg is redundant history (empty on first frame)
      expect(nm.sendInput).toHaveBeenCalledWith(2, noInput, []);
    });

    it('stores local input at delayed frame', () => {
      rm.advance(noInput, p1, p2, combat);
      expect(rm.localInputHistory.has(2)).toBe(true);
    });

    it('calls updateAnimation on both fighters after advance', () => {
      rm.advance(noInput, p1, p2, combat);
      expect(p1.updateAnimation).toHaveBeenCalled();
      expect(p2.updateAnimation).toHaveBeenCalled();
    });
  });

  describe('input prediction', () => {
    it('predicts EMPTY_INPUT when no remote input received', () => {
      rm.advance(noInput, p1, p2, combat);
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

      rm.advance(noInput, p1, p2, combat);

      rm.advance(noInput, p1, p2, combat);

      const predicted = rm.predictedRemoteInputs.get(1);
      expect(predicted).toBeDefined();
      const decoded = decodeInput(predicted);
      expect(decoded.left).toBe(true);
      expect(decoded.lp).toBe(false);
    });
  });

  describe('misprediction detection', () => {
    it('detects misprediction when confirmed differs from predicted', () => {
      rm.advance(noInput, p1, p2, combat);
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

      rm.advance(noInput, p1, p2, combat);

      expect(rm.rollbackCount).toBe(1);
    });

    it('does not rollback when prediction matches confirmed', () => {
      rm.advance(noInput, p1, p2, combat);

      nm.drainConfirmedInputs.mockReturnValueOnce([[0, noInput]]);
      rm.advance(noInput, p1, p2, combat);

      expect(rm.rollbackCount).toBe(0);
    });
  });

  describe('rollback window', () => {
    it('does not rollback beyond maxRollbackFrames', () => {
      for (let i = 0; i < 10; i++) {
        rm.advance(noInput, p1, p2, combat);
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

      rm.advance(noInput, p1, p2, combat);
      expect(rm.rollbackCount).toBe(0);
    });
  });

  describe('pruning', () => {
    it('prunes old input/prediction data beyond rollback window', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      expect(rm.predictedRemoteInputs.has(0)).toBe(false);
    });

    it('keeps all snapshots (never pruned)', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      expect(rm.stateSnapshots.has(0)).toBe(true);
      expect(rm.stateSnapshots.has(19)).toBe(true);
    });
  });

  describe('muteEffects during rollback', () => {
    it('sets _muteEffects true during re-simulation', () => {
      let muteEffectsDuringResim = false;

      p1.update = vi.fn(() => {
        if (scene._muteEffects) muteEffectsDuringResim = true;
      });

      rm.advance(noInput, p1, p2, combat);

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
      rm.advance(noInput, p1, p2, combat);

      expect(muteEffectsDuringResim).toBe(true);
      expect(scene._muteEffects).toBe(false);
    });
  });

  describe('applyResync version validation', () => {
    it('rejects snapshot with wrong version', () => {
      rm.advance(noInput, p1, p2, combat);
      const frameBefore = rm.currentFrame;
      const snapshot = { version: 999, frame: 0, p1: {}, p2: {}, combat: {} };
      rm.applyResync(snapshot, p1, p2, combat);
      expect(rm.currentFrame).toBe(frameBefore);
    });

    it('accepts snapshot with matching version', () => {
      rm.advance(noInput, p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);
      const snapshot = rm.stateSnapshots.get(1);
      rm.applyResync(snapshot, p1, p2, combat);
      expect(rm.currentFrame).toBe(snapshot.frame);
    });

    it('accepts snapshot with no version (backward compat)', () => {
      rm.advance(noInput, p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);
      const snapshot = { ...rm.stateSnapshots.get(1) };
      delete snapshot.version;
      rm.applyResync(snapshot, p1, p2, combat);
      expect(rm.currentFrame).toBe(snapshot.frame);
    });

    it('accepts snapshot outside rollback window', () => {
      // Advance well past the rollback window
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, p1, p2, combat);
      }
      // Frame 0 snapshot is far outside maxRollbackFrames (7)
      const snapshot = rm.stateSnapshots.get(0);
      rm.applyResync(snapshot, p1, p2, combat);
      expect(rm.currentFrame).toBe(0);
    });

    it('snapshots include version field', () => {
      rm.advance(noInput, p1, p2, combat);
      const snapshot = rm.stateSnapshots.get(0);
      expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    });
  });

  describe('snapshot confirmation tags', () => {
    it('snapshots are predicted when no remote input confirmed', () => {
      rm.advance(noInput, p1, p2, combat);
      const snapshot = rm.stateSnapshots.get(0);
      expect(snapshot.confirmed).toBe(false);
    });

    it('snapshots tagged confirmed when both inputs present', () => {
      // Frame 0: provide confirmed remote input for frame 0+inputDelay=2
      nm.drainConfirmedInputs.mockReturnValueOnce([[0, noInput]]);
      rm.advance(noInput, p1, p2, combat);
      // localInputHistory has frame 2 (0 + inputDelay=2)
      // remoteInputHistory now has frame 0
      // Frame 0 snapshot: local has frame 2, remote has frame 0
      // The pre-tick snapshot at frame 0 checks _isFrameConfirmed(0):
      //   local has 0? No (local stored at frame 2). So still predicted.
      // But post-tick state at frame 1 checks _isFrameConfirmed(0):
      //   same result.
      // To get a confirmed snapshot, we need both local and remote for the SAME frame.
      // Local stores at currentFrame + inputDelay. With inputDelay=2:
      //   advance(frame=0) stores local at frame 2
      //   advance(frame=1) stores local at frame 3
      //   advance(frame=2) stores local at frame 4
      // So for frame 2 to be confirmed, we need remote input at frame 2.
      nm.drainConfirmedInputs.mockReturnValueOnce([[2, noInput]]);
      rm.advance(noInput, p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);

      // Frame 2's pre-tick snapshot should be confirmed (local has 2 from advance(0), remote has 2)
      const snapshot = rm.stateSnapshots.get(2);
      expect(snapshot).toBeDefined();
      expect(snapshot.confirmed).toBe(true);
    });

    it('_isFrameConfirmed returns true only when both inputs exist', () => {
      // No inputs at all
      expect(rm._isFrameConfirmed(0)).toBe(false);

      // Only local
      rm.localInputHistory.set(5, 0);
      expect(rm._isFrameConfirmed(5)).toBe(false);

      // Both local and remote
      rm.remoteInputHistory.set(5, 0);
      expect(rm._isFrameConfirmed(5)).toBe(true);
    });

    it('captureResyncSnapshot prefers confirmed over predicted', () => {
      // Advance several frames with no remote input (all predicted)
      for (let i = 0; i < 5; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      // Manually mark one earlier snapshot as confirmed
      const snap2 = rm.stateSnapshots.get(2);
      snap2.confirmed = true;

      const resyncSnap = rm.captureResyncSnapshot(p1, p2, combat);
      expect(resyncSnap.confirmed).toBe(true);
      expect(resyncSnap.frame).toBe(2);
    });

    it('captureResyncSnapshot falls back to latest when none confirmed', () => {
      for (let i = 0; i < 3; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      const resyncSnap = rm.captureResyncSnapshot(p1, p2, combat);
      expect(resyncSnap).toBeDefined();
      expect(resyncSnap.frame).toBe(rm.currentFrame - 1);
    });

    it('applyResync tags baseline snapshot as confirmed', () => {
      rm.advance(noInput, p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);
      const snapshot = rm.stateSnapshots.get(1);
      rm.applyResync(snapshot, p1, p2, combat);
      const baselineSnap = rm.stateSnapshots.get(rm.currentFrame);
      expect(baselineSnap.confirmed).toBe(true);
    });
  });

  describe('frame-0 sync', () => {
    it('getFrame0SyncHash returns a numeric hash', () => {
      const hash = rm.getFrame0SyncHash(p1, p2, combat);
      expect(typeof hash).toBe('number');
    });

    it('getFrame0SyncHash stores frame-0 snapshot with confirmed tag', () => {
      rm.getFrame0SyncHash(p1, p2, combat);
      const snap = rm.stateSnapshots.get(0);
      expect(snap).toBeDefined();
      expect(snap.confirmed).toBe(true);
      expect(snap.frame).toBe(0);
    });

    it('getFrame0SyncHash is deterministic', () => {
      const hash1 = rm.getFrame0SyncHash(p1, p2, combat);
      const hash2 = rm.getFrame0SyncHash(p1, p2, combat);
      expect(hash1).toBe(hash2);
    });

    it('getFrame0SyncHash resets currentFrame to 0', () => {
      rm.currentFrame = 10;
      rm.getFrame0SyncHash(p1, p2, combat);
      expect(rm.currentFrame).toBe(0);
    });

    it('validateFrame0Hash detects matching hashes', () => {
      const hash = rm.getFrame0SyncHash(p1, p2, combat);
      const result = rm.validateFrame0Hash(hash, p1, p2, combat);
      expect(result.match).toBe(true);
      expect(result.localHash).toBe(result.remoteHash);
    });

    it('validateFrame0Hash detects mismatched hashes', () => {
      const result = rm.validateFrame0Hash(999999, p1, p2, combat);
      expect(result.match).toBe(false);
      expect(result.remoteHash).toBe(999999);
    });
  });
});
