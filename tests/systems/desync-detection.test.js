import { FP_SCALE, GROUND_Y_FP, MAX_STAMINA_FP } from '@alostraques/sim';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashGameState } from '../../packages/game/src/systems/GameState.js';
import { RollbackManager } from '../../packages/game/src/systems/RollbackManager.js';

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
  let nm, _scene, p1, p2, combat, rm;

  beforeEach(() => {
    nm = mockNM();
    _scene = mockScene();
    p1 = mockFighter(144);
    p2 = mockFighter(336);
    combat = mockCombat();
    rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });
  });

  it('sends checksum every 30 frames for confirmed frames', () => {
    for (let i = 0; i < 31; i++) {
      rm.advance(noInput, p1, p2, combat);
    }
    // At frame 30 (after advancing 30 times, currentFrame becomes 30)
    expect(nm.sendChecksum).toHaveBeenCalledTimes(1);
    const [frame, hash] = nm.sendChecksum.mock.calls[0];
    // Checksum frame uses fixed offset: 30 - 13 = 17 (see RFC 0007)
    expect(frame).toBe(17);
    expect(typeof hash).toBe('number');
  });

  it('does not send checksum before interval', () => {
    for (let i = 0; i < 29; i++) {
      rm.advance(noInput, p1, p2, combat);
    }
    expect(nm.sendChecksum).not.toHaveBeenCalled();
  });

  it('detects desync when remote hash differs', () => {
    const desyncCb = vi.fn();
    rm._onDesync = desyncCb;

    // Advance to frame 30 so a local checksum is generated
    for (let i = 0; i < 31; i++) {
      rm.advance(noInput, p1, p2, combat);
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
      rm.advance(noInput, p1, p2, combat);
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

  it('checksum frame uses fixed offset regardless of maxRollbackFrames', () => {
    // Create two managers with different maxRollbackFrames (simulates different RTT)
    const nm1 = mockNM();
    const nm2 = mockNM();
    const rm1 = new RollbackManager(nm1, 0, { inputDelay: 2, maxRollbackFrames: 7 });
    const rm2 = new RollbackManager(nm2, 1, { inputDelay: 2, maxRollbackFrames: 11 });

    const _s = mockScene();
    const p1a = mockFighter(144);
    const p2a = mockFighter(336);
    const ca = mockCombat();
    const p1b = mockFighter(144);
    const p2b = mockFighter(336);
    const cb = mockCombat();

    for (let i = 0; i < 31; i++) {
      rm1.advance(noInput, p1a, p2a, ca);
      rm2.advance(noInput, p1b, p2b, cb);
    }

    // Both should checksum the same frame (30 - 13 = 17) despite different maxRollbackFrames
    const [frame1] = nm1.sendChecksum.mock.calls[0];
    const [frame2] = nm2.sendChecksum.mock.calls[0];
    expect(frame1).toBe(frame2);
    expect(frame1).toBe(17);
  });

  it('detects desync between peers with different maxRollbackFrames', () => {
    // Simulate P1 with low RTT (maxRollback=7) and P2 with high RTT (maxRollback=11)
    const nm1 = mockNM();
    const nm2 = mockNM();
    const rm1 = new RollbackManager(nm1, 0, { inputDelay: 2, maxRollbackFrames: 7 });
    const rm2 = new RollbackManager(nm2, 1, { inputDelay: 2, maxRollbackFrames: 11 });
    const desyncCb = vi.fn();
    rm2._onDesync = desyncCb;

    const p1a = mockFighter(144);
    const p2a = mockFighter(336);
    const ca = mockCombat();
    const p1b = mockFighter(144);
    const p2b = mockFighter(336);
    const cb = mockCombat();

    // Advance both to frame 30
    for (let i = 0; i < 31; i++) {
      rm1.advance(noInput, p1a, p2a, ca);
      rm2.advance(noInput, p1b, p2b, cb);
    }

    // P1 sent checksum for frame 17
    const [frame1, hash1] = nm1.sendChecksum.mock.calls[0];

    // Feed P1's checksum to P2 — should find a matching local frame
    rm2.handleRemoteChecksum(frame1, hash1 + 1); // deliberately wrong hash

    // P2 should detect desync (it has a local hash for frame 17 too)
    expect(rm2.desyncCount).toBe(1);
    expect(desyncCb).toHaveBeenCalledOnce();
  });
});

describe('RollbackManager input redundancy', () => {
  it('sends input history with each packet', () => {
    const nm = mockNM();
    const _scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });

    // First frame: no history available
    rm.advance(noInput, p1, p2, combat);
    expect(nm.sendInput).toHaveBeenCalledWith(2, noInput, []);

    // Second frame: 1 history entry
    rm.advance(noInput, p1, p2, combat);
    const call2 = nm.sendInput.mock.calls[1];
    expect(call2[0]).toBe(3); // targetFrame
    expect(call2[2]).toHaveLength(1); // history: [frame 2]
    expect(call2[2][0][0]).toBe(2); // frame number

    // Third frame: 2 history entries
    rm.advance(noInput, p1, p2, combat);
    const call3 = nm.sendInput.mock.calls[2];
    expect(call3[2]).toHaveLength(2); // history: [frame 3, frame 2]
  });
});

describe('RollbackManager adaptive input delay', () => {
  it('increases delay for high RTT', () => {
    const nm = mockNM();
    const _scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    // Simulate high latency
    nm.rtt = 150; // 150ms RTT

    // Advance 180 frames to trigger adaptive delay check
    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    // oneWayFrames = ceil(150/16.667) = 9, optimal = max(3, min(5, 10)) = 5
    // Gradual increase: 3 -> 4 (max +1 per check)
    expect(rm.inputDelay).toBe(4);
  });

  it('does not decrease delay below ONLINE_INPUT_DELAY_FRAMES for low RTT', () => {
    const nm = mockNM();
    const _scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    // Simulate LAN latency
    nm.rtt = 5; // 5ms RTT

    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    // oneWayFrames = ceil(5/16.667) = 1, optimal = max(3, min(5, 1+1)) = 3
    // Floor at ONLINE_INPUT_DELAY_FRAMES: stays at 3
    expect(rm.inputDelay).toBe(3);
  });

  it('does not adjust delay when RTT is 0 (no data)', () => {
    const nm = mockNM();
    const _scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    nm.rtt = 0;

    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    // RTT=0 means no data — inputDelay stays unchanged
    expect(rm.inputDelay).toBe(3);
  });

  it('scales maxRollbackFrames with delay', () => {
    const nm = mockNM();
    const _scene = mockScene();
    const p1 = mockFighter(144);
    const p2 = mockFighter(336);
    const combat = mockCombat();
    const rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });

    nm.rtt = 150;

    for (let i = 0; i < 181; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    // After delay increases to 4: maxRollback = max(7, 4*2+1) = 9
    expect(rm.maxRollbackFrames).toBe(9);
  });
});

describe('RollbackManager resync', () => {
  let nm, _scene, p1, p2, combat;

  beforeEach(() => {
    nm = mockNM();
    _scene = mockScene();
    p1 = mockFighter(144);
    p2 = mockFighter(336);
    combat = mockCombat();
  });

  it('applyResync restores state and resimulates forward (RFC 0010)', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    // Advance a few frames
    for (let i = 0; i < 10; i++) {
      rm.advance(noInput, p1, p2, combat);
    }
    expect(rm.currentFrame).toBe(10);

    // Create a snapshot as if from P1 at frame 8
    const snapshot = makeSnapshot({ p1: { hp: 75 }, combat: { timer: 55 } });
    snapshot.frame = 8;

    rm.applyResync(snapshot, p1, p2, combat);

    // RFC 0010: currentFrame stays at 10, state is resimulated forward
    expect(rm.currentFrame).toBe(10);
  });

  it('applyResync preserves input histories (RFC 0010)', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 5; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    expect(rm.stateSnapshots.size).toBeGreaterThan(0);
    expect(rm.localInputHistory.size).toBeGreaterThan(0);
    expect(rm.predictedRemoteInputs.size).toBeGreaterThan(0);

    const localHistorySize = rm.localInputHistory.size;
    const snapshot = makeSnapshot();
    snapshot.frame = 2;
    rm.applyResync(snapshot, p1, p2, combat);

    // RFC 0010: input histories are preserved, not cleared
    expect(rm.localInputHistory.size).toBe(localHistorySize);
    // Snapshots rebuilt during resimulation (frame 2 through 5)
    expect(rm.stateSnapshots.has(2)).toBe(true);
    expect(rm.stateSnapshots.has(5)).toBe(true);
  });

  it('applyResync resets resync pending flag', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });
    rm._resyncPending = true;

    const snapshot = makeSnapshot();
    snapshot.frame = 0;
    rm.applyResync(snapshot, p1, p2, combat);

    expect(rm._resyncPending).toBe(false);
  });

  it('applyResync accepts snapshots outside rollback window without rewinding (RFC 0010)', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 20; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    // Snapshot from frame 5 is outside rollback window but within retention window
    const snapshot = makeSnapshot({ p1: { hp: 50 } });
    snapshot.frame = 5;
    rm.applyResync(snapshot, p1, p2, combat);

    // RFC 0010: currentFrame stays at 20, state resimulated forward from frame 5
    expect(rm.currentFrame).toBe(20);
  });

  it('captureResyncSnapshot returns current frame snapshot (RFC 0010)', () => {
    const rm = new RollbackManager(nm, 0, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 5; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    const snapshot = rm.captureResyncSnapshot(p1, p2, combat);
    expect(snapshot).toBeDefined();
    expect(snapshot.frame).toBe(5); // currentFrame (RFC 0010)
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

  it('applyResync is idempotent for same frame (RFC 0010)', () => {
    const rm = new RollbackManager(nm, 1, { inputDelay: 2, maxRollbackFrames: 7 });

    for (let i = 0; i < 5; i++) {
      rm.advance(noInput, p1, p2, combat);
    }

    const snapshot = makeSnapshot({ p1: { hp: 80 } });
    snapshot.frame = 4;

    rm.applyResync(snapshot, p1, p2, combat);
    // RFC 0010: currentFrame stays at 5
    expect(rm.currentFrame).toBe(5);

    // Apply again — should succeed without error
    rm.applyResync(snapshot, p1, p2, combat);
    expect(rm.currentFrame).toBe(5);
  });
});
