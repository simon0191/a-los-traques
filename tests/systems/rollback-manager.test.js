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
    sendChecksum: vi.fn(),
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

    it('snapshot stores remoteInput (predicted value)', () => {
      rm.advance(noInput, p1, p2, combat);

      const snap = rm.stateSnapshots.get(0);
      expect(snap.remoteInput).toBe(EMPTY_INPUT);
    });

    it('snapshot stores remoteInput (confirmed value)', () => {
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

      const snap = rm.stateSnapshots.get(0);
      // encodeInput({ left: true }) = 1
      expect(snap.remoteInput).toBe(1);
    });

    it('detects misprediction via snapshot.remoteInput even after predictedRemoteInputs cleared', () => {
      rm.advance(noInput, p1, p2, combat);

      // Simulate pruning by clearing the predictions map
      rm.predictedRemoteInputs.clear();

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

      // Misprediction detected via snapshot.remoteInput, not predictedRemoteInputs
      expect(rm.rollbackCount).toBe(1);
    });

    it('resim updates snapshot.remoteInput with corrected input', () => {
      rm.advance(noInput, p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);

      // snapshot at frame 0 should have predicted remoteInput (EMPTY_INPUT)
      expect(rm.stateSnapshots.get(0).remoteInput).toBe(EMPTY_INPUT);

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

      // After rollback + resim, snapshot at frame 0 should have corrected remoteInput
      expect(rm.stateSnapshots.get(0).remoteInput).toBe(1);
    });
  });

  describe('rollback window', () => {
    it('deep rollback works when prediction still in retention window', () => {
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
      // With 120-frame retention, frame 0 prediction survives 10 frames
      // and the misprediction triggers a deep rollback
      expect(rm.rollbackCount).toBe(1);
    });
  });

  describe('pruning', () => {
    it('prunes old data beyond 120-frame retention window', () => {
      for (let i = 0; i < 125; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      expect(rm.predictedRemoteInputs.has(0)).toBe(false);
    });

    it('retains data within 120-frame retention window', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      expect(rm.predictedRemoteInputs.has(0)).toBe(true);
      expect(rm.stateSnapshots.has(0)).toBe(true);
      expect(rm.stateSnapshots.has(19)).toBe(true);
    });

    it('prunes snapshots beyond 120-frame retention window', () => {
      for (let i = 0; i < 125; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      expect(rm.stateSnapshots.has(0)).toBe(false);
      expect(rm.stateSnapshots.has(124)).toBe(true);
    });
  });

  describe('events during rollback', () => {
    it('only returns events from the current frame, not resim frames', () => {
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
      const { events } = rm.advance(noInput, p1, p2, combat);

      // Events should be an array (from the current frame tick only)
      expect(Array.isArray(events)).toBe(true);
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
      // RFC 0010: currentFrame stays at oldFrame, not snapshot.frame
      expect(rm.currentFrame).toBe(2);
    });

    it('accepts snapshot with no version (backward compat)', () => {
      rm.advance(noInput, p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);
      const snapshot = { ...rm.stateSnapshots.get(1) };
      delete snapshot.version;
      rm.applyResync(snapshot, p1, p2, combat);
      // RFC 0010: currentFrame stays at oldFrame
      expect(rm.currentFrame).toBe(2);
    });

    it('accepts snapshot outside rollback window without rewinding frame', () => {
      // Advance well past the rollback window
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, p1, p2, combat);
      }
      // Frame 0 snapshot is far outside maxRollbackFrames (7) but within retention
      const snapshot = rm.stateSnapshots.get(0);
      rm.applyResync(snapshot, p1, p2, combat);
      // RFC 0010: currentFrame stays at 20, not 0
      expect(rm.currentFrame).toBe(20);
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

    it('captureResyncSnapshot returns current frame state', () => {
      // RFC 0010: always captures current frame, not an older confirmed one
      for (let i = 0; i < 5; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      const resyncSnap = rm.captureResyncSnapshot(p1, p2, combat);
      expect(resyncSnap).toBeDefined();
      expect(resyncSnap.frame).toBe(rm.currentFrame);
    });

    it('applyResync tags resync-frame snapshot as confirmed', () => {
      rm.advance(noInput, p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);
      const snapshot = rm.stateSnapshots.get(1);
      rm.applyResync(snapshot, p1, p2, combat);
      // The snapshot at the resync frame should be marked confirmed
      const resyncSnap = rm.stateSnapshots.get(snapshot.frame);
      expect(resyncSnap.confirmed).toBe(true);
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

  describe('resync as deep rollback (RFC 0010)', () => {
    it('does not rewind currentFrame after resync', () => {
      for (let i = 0; i < 10; i++) {
        rm.advance(noInput, p1, p2, combat);
      }
      const snapshot = rm.stateSnapshots.get(3);
      rm.applyResync(snapshot, p1, p2, combat);
      expect(rm.currentFrame).toBe(10);
    });

    it('resimulates forward from snapshot frame to currentFrame', () => {
      for (let i = 0; i < 10; i++) {
        rm.advance(noInput, p1, p2, combat);
      }
      const snapshot = rm.stateSnapshots.get(3);
      rm.applyResync(snapshot, p1, p2, combat);

      // Snapshots should exist for frames 3 through 10 (resync frame through currentFrame)
      for (let f = 3; f <= 10; f++) {
        expect(rm.stateSnapshots.has(f)).toBe(true);
      }
    });

    it('preserves input histories after resync', () => {
      for (let i = 0; i < 5; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      // localInputHistory should have entries at frames 2,3,4,5,6 (inputDelay=2)
      const localSizeBefore = rm.localInputHistory.size;
      expect(localSizeBefore).toBeGreaterThan(0);

      const snapshot = rm.stateSnapshots.get(1);
      rm.applyResync(snapshot, p1, p2, combat);

      // Input histories should be preserved, not cleared
      expect(rm.localInputHistory.size).toBe(localSizeBefore);
    });

    it('uses confirmed remote inputs during resimulation', () => {
      // Advance 5 frames
      for (let i = 0; i < 5; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      // Manually add confirmed remote inputs for frames 1-3
      rm.remoteInputHistory.set(1, 2); // encoded "right"
      rm.remoteInputHistory.set(2, 2);
      rm.remoteInputHistory.set(3, 2);

      // Resync from frame 1 — resim will tick frames 1,2,3,4
      // Post-tick snapshot at f+1 stores remoteInput used for frame f
      const snapshot = rm.stateSnapshots.get(1);
      rm.applyResync(snapshot, p1, p2, combat);

      // snapshot[f+1].remoteInput = input used for frame f
      // So snapshot[2] has input for frame 1, snapshot[3] for frame 2, etc.
      for (let f = 2; f <= 4; f++) {
        const snap = rm.stateSnapshots.get(f);
        expect(snap).toBeDefined();
        expect(snap.remoteInput).toBe(2);
      }
    });

    it('no frame gap after multiple consecutive resyncs', () => {
      for (let i = 0; i < 20; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      // Apply 5 consecutive resyncs at different frames
      for (let r = 0; r < 5; r++) {
        const snapFrame = 10 + r;
        const snapshot = rm.stateSnapshots.get(snapFrame);
        rm.applyResync(snapshot, p1, p2, combat);
      }

      // currentFrame should still be 20 — no drift
      expect(rm.currentFrame).toBe(20);
    });

    it('falls back to rewind for extreme gap beyond retention window', () => {
      // Advance beyond HISTORY_RETENTION_FRAMES (120)
      for (let i = 0; i < 130; i++) {
        rm.advance(noInput, p1, p2, combat);
      }

      // Create a snapshot at frame 0 (manually, since it was pruned)
      const earlySnapshot = {
        version: SNAPSHOT_VERSION,
        frame: 0,
        p1: rm.stateSnapshots.values().next().value.p1,
        p2: rm.stateSnapshots.values().next().value.p2,
        combat: rm.stateSnapshots.values().next().value.combat,
      };

      rm.applyResync(earlySnapshot, p1, p2, combat);

      // Gap > 120 frames — should fall back to rewind
      expect(rm.currentFrame).toBe(0);
      // Input histories should be cleared in fallback mode
      expect(rm.localInputHistory.size).toBe(0);
    });

    it('resync at currentFrame is a no-op for frame counter', () => {
      for (let i = 0; i < 5; i++) {
        rm.advance(noInput, p1, p2, combat);
      }
      // Resync at the current position — snapshot.frame === currentFrame
      const snapshot = rm.stateSnapshots.get(5);
      rm.applyResync(snapshot, p1, p2, combat);
      expect(rm.currentFrame).toBe(5);
    });
  });

  describe('adaptive input delay', () => {
    it('does not change inputDelay when RTT is 0', () => {
      nm.rtt = 0;
      rm.inputDelay = 3;
      rm._recalculateInputDelay();
      expect(rm.inputDelay).toBe(3);
    });

    it('does not change inputDelay when RTT is undefined', () => {
      nm.rtt = undefined;
      rm.inputDelay = 3;
      rm._recalculateInputDelay();
      expect(rm.inputDelay).toBe(3);
    });

    it('never reduces inputDelay below ONLINE_INPUT_DELAY_FRAMES (3)', () => {
      nm.rtt = 10; // Very low RTT: 10ms → oneWay = ceil(10/16.667) = 1 → optimal = 3 (floored)
      rm.inputDelay = 3;
      rm._recalculateInputDelay();
      expect(rm.inputDelay).toBe(3);
    });

    it('increases inputDelay for high RTT', () => {
      // 80ms RTT → oneWay = ceil(80/16.667) = 5 → optimal = max(3, min(5, 6)) = 5
      nm.rtt = 80;
      rm.inputDelay = 3;
      rm._recalculateInputDelay();
      // Ramps up by 1 per recalculation: 3 → 4
      expect(rm.inputDelay).toBe(4);
    });

    it('ramps up gradually to optimal over multiple recalculations', () => {
      nm.rtt = 80; // optimal = 5
      rm.inputDelay = 3;
      rm._recalculateInputDelay(); // 3 → 4
      rm._recalculateInputDelay(); // 4 → 5
      rm._recalculateInputDelay(); // stays at 5 (optimal)
      expect(rm.inputDelay).toBe(5);
    });

    it('updates maxRollbackFrames along with inputDelay', () => {
      nm.rtt = 80; // optimal = 5
      rm.inputDelay = 3;
      rm._recalculateInputDelay(); // inputDelay → 4
      // maxRollbackFrames = max(7, 4*2+1) = 9
      expect(rm.maxRollbackFrames).toBe(9);
    });
  });

  describe('reverse resync (P1 self-correction)', () => {
    it('increments consecutiveDesyncCount on each desync', () => {
      rm.getFrame0SyncHash(p1, p2, combat);
      // Advance past checksum offset so local checksums exist
      for (let i = 0; i < 30; i++) rm.advance(noInput, p1, p2, combat);

      rm.handleRemoteChecksum(17, 999);
      expect(rm._consecutiveDesyncCount).toBe(1);

      rm.handleRemoteChecksum(17, 888);
      expect(rm._consecutiveDesyncCount).toBe(2);
    });

    it('resets consecutiveDesyncCount on matching checksum', () => {
      rm.getFrame0SyncHash(p1, p2, combat);
      for (let i = 0; i < 30; i++) rm.advance(noInput, p1, p2, combat);

      rm.handleRemoteChecksum(17, 999);
      expect(rm._consecutiveDesyncCount).toBe(1);

      // Get the actual local hash so it matches
      const localHash = rm._localChecksums.get(17);
      rm.handleRemoteChecksum(17, localHash);
      expect(rm._consecutiveDesyncCount).toBe(0);
    });

    it('resets consecutiveDesyncCount on applyResync', () => {
      rm.getFrame0SyncHash(p1, p2, combat);
      rm.advance(noInput, p1, p2, combat);
      rm._consecutiveDesyncCount = 3;
      const snapshot = rm.stateSnapshots.get(0);
      rm.applyResync(snapshot, p1, p2, combat);
      expect(rm._consecutiveDesyncCount).toBe(0);
    });

    it('shouldReverseResync returns false below threshold', () => {
      rm._consecutiveDesyncCount = 1;
      expect(rm.shouldReverseResync()).toBe(false);
    });

    it('shouldReverseResync returns true at threshold', () => {
      rm._consecutiveDesyncCount = 2;
      expect(rm.shouldReverseResync()).toBe(true);
    });

    it('shouldReverseResync returns true above threshold', () => {
      rm._consecutiveDesyncCount = 5;
      expect(rm.shouldReverseResync()).toBe(true);
    });
  });
});
