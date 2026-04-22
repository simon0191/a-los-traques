import { EMPTY_INPUT, encodeInput, FP_SCALE, GROUND_Y_FP, MAX_STAMINA_FP } from '@alostraques/sim';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RollbackManager } from '../../apps/game-vite/src/systems/RollbackManager.js';

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
    data: {
      stats: { speed: 3, power: 3, defense: 3 },
      moves: {
        lightPunch: {
          type: 'lightPunch',
          damage: 8,
          startup: 3,
          active: 2,
          recovery: 5,
          hitstun: 12,
          blockstun: 8,
        },
      },
    },
    playerIndex: 0,
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
    resetForRound: vi.fn(),
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

const rightInput = { ...noInput, right: true };

describe('RollbackManager — adaptive input delay gap (RFC 0013)', () => {
  let nm, p1, p2, combat, rm;

  beforeEach(() => {
    nm = mockNM(0);
    p1 = mockFighter(144);
    p2 = mockFighter(336);
    combat = mockCombat();
    rm = new RollbackManager(nm, 0, { inputDelay: 3, maxRollbackFrames: 7 });
  });

  /**
   * Helper: advance N frames with the given input, returning the RollbackManager.
   */
  function advanceFrames(n, input = noInput) {
    for (let i = 0; i < n; i++) {
      rm.advance(input, p1, p2, combat);
    }
  }

  describe('gap detection and fill', () => {
    it('fills gap frame in localInputHistory when inputDelay increases', () => {
      // Advance a few frames at delay=3 to establish baseline
      advanceFrames(5, rightInput);

      // At frame 5, targetFrame was 5+3=8. Now increase delay to 4.
      // Next advance (frame 5) will target 5+4=9. Gap at frame 8+1=9? No —
      // Let me trace: after 5 advances, currentFrame=5, lastLocalTarget=7 (frame 4+3=7).
      // Actually: frame 0→target 3, frame 1→target 4, ..., frame 4→target 7.
      // Now set delay to 4. Frame 5→target 9. Gap at frame 8.

      rm.inputDelay = 4;
      rm.advance(rightInput, p1, p2, combat);

      // After frame 5 with delay=4: target=9, last was 7. Gap at 8.
      expect(rm.localInputHistory.has(8)).toBe(true);
      expect(rm.localInputHistory.get(8)).toBe(encodeInput(rightInput));
      expect(rm.localInputHistory.has(9)).toBe(true);
    });

    it('does not create spurious entries when inputDelay stays the same', () => {
      advanceFrames(5, noInput);

      // localInputHistory should have frames 3,4,5,6,7 (offset by delay=3)
      expect(rm.localInputHistory.size).toBe(5);
      for (let f = 3; f <= 7; f++) {
        expect(rm.localInputHistory.has(f)).toBe(true);
      }
    });

    it('preserves first-written input on collision when inputDelay decreases', () => {
      rm.inputDelay = 4;
      advanceFrames(3, rightInput); // frames 0,1,2 → targets 4,5,6

      const originalValue = rm.localInputHistory.get(6);

      rm.inputDelay = 3;
      const sizeBefore = rm.localInputHistory.size;
      rm.advance(noInput, p1, p2, combat); // frame 3 → target 6 (collision)

      // Size unchanged — no new entry created
      expect(rm.localInputHistory.size).toBe(sizeBefore);
      // First-written value preserved (rightInput), not overwritten with noInput
      expect(rm.localInputHistory.get(6)).toBe(originalValue);
      expect(rm.localInputHistory.get(6)).toBe(encodeInput(rightInput));
    });

    it('fills multiple gap frames when inputDelay jumps by 2', () => {
      advanceFrames(3, noInput); // frames 0,1,2 → targets 3,4,5

      rm.inputDelay = 6; // jump from 3 to 6
      rm.advance(noInput, p1, p2, combat); // frame 3 → target 9, gap at 6,7,8

      expect(rm.localInputHistory.has(6)).toBe(true);
      expect(rm.localInputHistory.has(7)).toBe(true);
      expect(rm.localInputHistory.has(8)).toBe(true);
      expect(rm.localInputHistory.has(9)).toBe(true);
    });
  });

  describe('network send for gap frames', () => {
    it('sends input for gap frames to the remote peer', () => {
      advanceFrames(5, rightInput);
      nm.sendInput.mockClear();

      rm.inputDelay = 4;
      rm.advance(rightInput, p1, p2, combat);

      // Should send for gap frame 8 AND target frame 9
      const sendCalls = nm.sendInput.mock.calls;
      const sentFrames = sendCalls.map((c) => c[0]);
      expect(sentFrames).toContain(8); // gap frame
      expect(sentFrames).toContain(9); // target frame
    });

    it('does not send extra frames when inputDelay is unchanged', () => {
      advanceFrames(3, noInput);
      nm.sendInput.mockClear();

      rm.advance(noInput, p1, p2, combat);

      // Only one sendInput call (for the target frame)
      expect(nm.sendInput).toHaveBeenCalledTimes(1);
    });

    it('does not send for collision frames (already sent by previous advance)', () => {
      rm.inputDelay = 4;
      advanceFrames(3, rightInput); // frames 0,1,2 → targets 4,5,6
      nm.sendInput.mockClear();

      rm.inputDelay = 3;
      rm.advance(noInput, p1, p2, combat); // frame 3 → target 6 (collision)

      // Should NOT send for frame 6 again — it was already sent
      const sentFrames = nm.sendInput.mock.calls.map((c) => c[0]);
      expect(sentFrames).not.toContain(6);
      expect(nm.sendInput).toHaveBeenCalledTimes(0);
    });

    it('sends gap frames with correct redundant history', () => {
      advanceFrames(5, rightInput); // targets 3,4,5,6,7
      nm.sendInput.mockClear();

      rm.inputDelay = 4;
      rm.advance(rightInput, p1, p2, combat); // target 9, gap at 8

      // First call should be for gap frame 8
      const gapCall = nm.sendInput.mock.calls.find((c) => c[0] === 8);
      expect(gapCall).toBeDefined();

      // Gap frame 8's history should include frames 7 and 6
      const gapHistory = gapCall[2];
      const historyFrames = gapHistory.map((h) => h[0]);
      expect(historyFrames).toContain(7);
      expect(historyFrames).toContain(6);
    });
  });

  describe('integration: gap frame prevents EMPTY_INPUT fallback', () => {
    it('_getInputForFrame returns filled input for gap frame, not EMPTY_INPUT', () => {
      advanceFrames(5, rightInput); // targets 3..7

      rm.inputDelay = 4;
      rm.advance(rightInput, p1, p2, combat); // target 9, gap filled at 8

      // _getInputForFrame for the local side should return the filled input
      const input = rm._getInputForFrame(8, true); // P1 is local (slot=0, isP1=true)
      expect(input).toBe(encodeInput(rightInput));
      expect(input).not.toBe(EMPTY_INPUT);
    });
  });
});
