import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FP_SCALE, GROUND_Y_FP, MAX_STAMINA_FP } from '../../src/systems/FixedPoint.js';
import { hashGameState } from '../../src/systems/GameState.js';
import { RollbackManager } from '../../src/systems/RollbackManager.js';

// --- Helpers ---

function makeSnapshot(overrides = {}) {
  return {
    frame: 0,
    p1: {
      simX: 144 * FP_SCALE,
      simY: GROUND_Y_FP,
      hp: 100,
      special: 0,
      stamina: MAX_STAMINA_FP,
      attackCooldown: 0,
      hurtTimer: 0,
      ...overrides.p1,
    },
    p2: {
      simX: 336 * FP_SCALE,
      simY: GROUND_Y_FP,
      hp: 100,
      special: 0,
      stamina: MAX_STAMINA_FP,
      attackCooldown: 0,
      hurtTimer: 0,
      ...overrides.p2,
    },
    combat: {
      timer: 60,
      roundNumber: 1,
      ...overrides.combat,
    },
  };
}

function mockNM() {
  return {
    getPlayerSlot: () => 0,
    sendInput: vi.fn(),
    sendChecksum: vi.fn(),
    drainConfirmedInputs: vi.fn(() => []),
    rtt: 0,
  };
}

function mockFighter(xPx = 100) {
  return {
    simX: xPx * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 0,
    simVY: 0,
    hp: 100,
    special: 0,
    stamina: MAX_STAMINA_FP,
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
    data: { stats: { speed: 3, power: 3, defense: 3 } },
    playerIndex: 0,
    hasAnims: false,
    fighterId: 'test',
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
  };
}

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

// --- Tests ---

describe('hashGameState', () => {
  it('produces the same hash for identical snapshots', () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot();
    expect(hashGameState(s1)).toBe(hashGameState(s2));
  });

  it('produces different hashes for different HP', () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ p1: { hp: 99 } });
    expect(hashGameState(s1)).not.toBe(hashGameState(s2));
  });

  it('produces different hashes for different positions', () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ p2: { simX: 200 * FP_SCALE } });
    expect(hashGameState(s1)).not.toBe(hashGameState(s2));
  });

  it('produces different hashes for different timer values', () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ combat: { timer: 59 } });
    expect(hashGameState(s1)).not.toBe(hashGameState(s2));
  });

  it('produces different hashes for different round numbers', () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ combat: { roundNumber: 2 } });
    expect(hashGameState(s1)).not.toBe(hashGameState(s2));
  });

  it('returns a 32-bit integer', () => {
    const hash = hashGameState(makeSnapshot());
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('is sensitive to field differences (low collision rate)', () => {
    // Generate many different snapshots and verify uniqueness
    const hashes = new Set();
    for (let hp = 0; hp <= 100; hp += 5) {
      hashes.add(hashGameState(makeSnapshot({ p1: { hp } })));
    }
    // All 21 should be unique
    expect(hashes.size).toBe(21);
  });
});

describe('RollbackManager checksum exchange', () => {
  let nm, scene, p1, p2, combat, rm;

  beforeEach(() => {
    nm = mockNM();
    scene = mockScene();
    p1 = mockFighter(144);
    p2 = mockFighter(336);
    combat = mockCombat();
    rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });
  });

  it('sends checksum every 30 frames for confirmed frames', () => {
    for (let i = 0; i < 31; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }
    // At frame 30 (after advancing 30 times, currentFrame becomes 30)
    expect(nm.sendChecksum).toHaveBeenCalledTimes(1);
    const [frame, hash] = nm.sendChecksum.mock.calls[0];
    // Checksum frame is maxRollbackFrames+1 behind current: 30 - 7 - 1 = 22
    expect(frame).toBe(22);
    expect(typeof hash).toBe('number');
  });

  it('does not send checksum before interval', () => {
    for (let i = 0; i < 29; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }
    expect(nm.sendChecksum).not.toHaveBeenCalled();
  });

  it('detects desync when remote hash differs', () => {
    const desyncCb = vi.fn();
    rm._onDesync = desyncCb;

    // Advance to frame 30 so a local checksum is generated
    for (let i = 0; i < 31; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    const [frame, localHash] = nm.sendChecksum.mock.calls[0];
    // Simulate receiving a different hash for the same frame
    rm.handleRemoteChecksum(frame, localHash + 1);

    expect(rm.desyncCount).toBe(1);
    expect(desyncCb).toHaveBeenCalledWith(frame, localHash, localHash + 1);
  });

  it('does not flag desync when hashes match', () => {
    const desyncCb = vi.fn();
    rm._onDesync = desyncCb;

    for (let i = 0; i < 31; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    const [frame, localHash] = nm.sendChecksum.mock.calls[0];
    rm.handleRemoteChecksum(frame, localHash);

    expect(rm.desyncCount).toBe(0);
    expect(desyncCb).not.toHaveBeenCalled();
  });

  it('ignores remote checksum for unknown frames', () => {
    rm.handleRemoteChecksum(999, 12345);
    expect(rm.desyncCount).toBe(0);
  });
});

describe('RollbackManager input redundancy', () => {
  it('sends input history with each packet', () => {
    const nm = mockNM();
    const scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });

    // First frame: no history available
    rm.advance(noInput, scene, p1, p2, combat);
    expect(nm.sendInput).toHaveBeenCalledWith(2, noInput, []);

    // Second frame: 1 history entry
    rm.advance(noInput, scene, p1, p2, combat);
    const call2 = nm.sendInput.mock.calls[1];
    expect(call2[0]).toBe(3); // targetFrame
    expect(call2[2]).toHaveLength(1); // history: [frame 2]
    expect(call2[2][0][0]).toBe(2); // frame number

    // Third frame: 2 history entries
    rm.advance(noInput, scene, p1, p2, combat);
    const call3 = nm.sendInput.mock.calls[2];
    expect(call3[2]).toHaveLength(2); // history: [frame 3, frame 2]
  });
});

describe('RollbackManager adaptive input delay', () => {
  it('increases delay for high RTT', () => {
    const nm = mockNM();
    const scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    // Simulate high latency
    nm.rtt = 150; // 150ms RTT

    // Advance 180 frames to trigger adaptive delay check
    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    // oneWayFrames = ceil(75/16.667) = 5, optimal = min(5, 5+1) = 5
    // Gradual increase: 3 -> 4 (max +1 per check)
    expect(rm.inputDelay).toBe(4);
  });

  it('decreases delay for low RTT', () => {
    const nm = mockNM();
    const scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    // Simulate LAN latency
    nm.rtt = 5; // 5ms RTT

    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    // oneWayFrames = ceil(2.5/16.667) = 1, optimal = max(1, min(5, 1+1)) = 2
    // Decrease is immediate: 3 -> 2
    expect(rm.inputDelay).toBe(2);
  });

  it('clamps delay to minimum of 1', () => {
    const nm = mockNM();
    const scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    nm.rtt = 0;

    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    // oneWayFrames = ceil(0) = 0, optimal = max(1, 0+1) = 1
    expect(rm.inputDelay).toBeGreaterThanOrEqual(1);
  });

  it('scales maxRollbackFrames with delay', () => {
    const nm = mockNM();
    const scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    nm.rtt = 150;

    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    // After delay increases to 4: maxRollback = max(7, 4*2+1) = 9
    expect(rm.maxRollbackFrames).toBe(9);
  });
});

describe('RollbackManager resync', () => {
  let nm, scene, p1, p2, combat;

  beforeEach(() => {
    nm = mockNM();
    scene = mockScene();
    p1 = mockFighter(144);
    p2 = mockFighter(336);
    combat = mockCombat();
  });

  it('applyResync restores state and resets frame counter', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    // Advance a few frames
    for (let i = 0; i < 10; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }
    expect(rm.currentFrame).toBe(10);

    // Create a snapshot as if from P1 at frame 8
    const snapshot = makeSnapshot({ p1: { hp: 75 }, combat: { timer: 55 } });
    snapshot.frame = 8;

    rm.applyResync(snapshot, p1, p2, combat);

    expect(rm.currentFrame).toBe(8);
    expect(p1.hp).toBe(75);
    expect(combat.timer).toBe(55);
  });

  it('applyResync clears all histories', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 5; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    expect(rm.stateSnapshots.size).toBeGreaterThan(0);
    expect(rm.localInputHistory.size).toBeGreaterThan(0);
    expect(rm.predictedRemoteInputs.size).toBeGreaterThan(0);

    const snapshot = makeSnapshot();
    snapshot.frame = 4;
    rm.applyResync(snapshot, p1, p2, combat);

    // Only the baseline snapshot should remain
    expect(rm.stateSnapshots.size).toBe(1);
    expect(rm.stateSnapshots.has(4)).toBe(true);
    expect(rm.localInputHistory.size).toBe(0);
    expect(rm.predictedRemoteInputs.size).toBe(0);
    expect(rm._localChecksums.size).toBe(0);
  });

  it('applyResync resets resync pending flag', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });
    rm._resyncPending = true;

    const snapshot = makeSnapshot();
    snapshot.frame = 0;
    rm.applyResync(snapshot, p1, p2, combat);

    expect(rm._resyncPending).toBe(false);
  });

  it('applyResync ignores very stale snapshots', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 20; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    // Snapshot from frame 5 is too old (currentFrame=20, maxRollback=7, threshold=13)
    const snapshot = makeSnapshot({ p1: { hp: 50 } });
    snapshot.frame = 5;
    rm.applyResync(snapshot, p1, p2, combat);

    // Should be ignored — frame counter unchanged
    expect(rm.currentFrame).toBe(20);
    expect(p1.hp).toBe(100); // not changed to 50
  });

  it('captureResyncSnapshot returns latest snapshot', () => {
    const rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 5; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    const snapshot = rm.captureResyncSnapshot(p1, p2, combat);
    expect(snapshot).toBeDefined();
    expect(snapshot.frame).toBe(4); // currentFrame - 1
  });

  it('shouldRequestResync respects cooldown', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    expect(rm.shouldRequestResync()).toBe(true);

    // Simulate a resync at frame 10
    rm._lastResyncFrame = 10;
    rm.currentFrame = 30; // only 20 frames later, cooldown is 60

    expect(rm.shouldRequestResync()).toBe(false);

    rm.currentFrame = 71; // 61 frames later, past cooldown

    expect(rm.shouldRequestResync()).toBe(true);
  });

  it('shouldRequestResync returns false when pending', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });
    rm._resyncPending = true;

    expect(rm.shouldRequestResync()).toBe(false);
  });

  it('applyResync is idempotent for same frame', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 5; i++) {
      rm.advance(noInput, scene, p1, p2, combat);
    }

    const snapshot = makeSnapshot({ p1: { hp: 80 } });
    snapshot.frame = 4;

    rm.applyResync(snapshot, p1, p2, combat);
    expect(rm.currentFrame).toBe(4);
    expect(p1.hp).toBe(80);

    // Apply again — should succeed without error
    rm.applyResync(snapshot, p1, p2, combat);
    expect(rm.currentFrame).toBe(4);
    expect(p1.hp).toBe(80);
  });
});
