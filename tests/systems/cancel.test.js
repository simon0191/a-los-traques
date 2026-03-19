import { describe, expect, it } from 'vitest';
import { STAMINA_COSTS } from '../../src/config.js';
import {
  FP_SCALE,
  GROUND_Y_FP,
  MAX_SPECIAL_FP,
  MAX_STAMINA_FP,
  SPECIAL_COST_FP,
  SPECIAL_TINT_MAX_FRAMES,
} from '../../src/systems/FixedPoint.js';

/** Create a minimal sim fighter for cancel tests. */
function createFighter(moves = {}) {
  const defaultMoves = {
    lightPunch: { type: 'lightPunch', damage: 5, startup: 2, active: 2, recovery: 3, hitstun: 12, blockstun: 8 },
    heavyPunch: { type: 'heavyPunch', damage: 13, startup: 5, active: 3, recovery: 8, hitstun: 20, blockstun: 14 },
    lightKick: { type: 'lightKick', damage: 6, startup: 3, active: 2, recovery: 4, hitstun: 14, blockstun: 9 },
    heavyKick: { type: 'heavyKick', damage: 15, startup: 6, active: 3, recovery: 9, hitstun: 22, blockstun: 15 },
    special: { type: 'special', damage: 28, startup: 9, active: 5, recovery: 14, hitstun: 30, blockstun: 20, cost: 50 },
    ...moves,
  };

  return {
    simX: 100 * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 0,
    simVY: 0,
    hp: 100,
    special: SPECIAL_COST_FP, // start with full meter for cancel tests
    stamina: MAX_STAMINA_FP,
    state: 'idle',
    attackCooldown: 0,
    attackFrameElapsed: 0,
    hurtTimer: 0,
    hitConnected: false,
    currentAttack: null,
    isOnGround: true,
    facingRight: true,
    _prevAnimState: null,
    _specialTintTimer: 0,
    data: { stats: { speed: 3, power: 3, defense: 3 }, moves: defaultMoves },
    sprite: { setTint() {}, clearTint() {} },
    scene: { _muteEffects: true, game: { audioManager: { play() {} } } },
    hasAnims: false,
  };
}

/** Simulate attack (replicates Fighter.attack logic). */
function attack(fighter, type) {
  // Normal-to-special cancel
  if (fighter.attackCooldown > 0 && fighter.state === 'attacking') {
    if (type === 'special' && fighter.hitConnected && fighter.currentAttack?.type !== 'special') {
      const move = fighter.currentAttack;
      const cancelEnd = move.startup + move.active + 4;
      if (fighter.attackFrameElapsed >= move.startup && fighter.attackFrameElapsed < cancelEnd) {
        fighter.attackCooldown = 0;
        fighter.attackFrameElapsed = 0;
        fighter.hitConnected = false;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  if (fighter.attackCooldown > 0 || fighter.state === 'hurt' || fighter.state === 'knockdown') {
    return false;
  }
  if (type === 'special' && fighter.special < SPECIAL_COST_FP) return false;
  const staCost = (STAMINA_COSTS[type] || 15) * FP_SCALE;
  if (fighter.stamina < staCost) return false;
  fighter.stamina -= staCost;
  const moveData = fighter.data.moves[type];
  if (!moveData) return false;
  fighter.state = 'attacking';
  fighter._prevAnimState = null;
  fighter.hitConnected = false;
  fighter.attackFrameElapsed = 0;
  fighter.currentAttack = { type, ...moveData };
  fighter.attackCooldown = moveData.startup + moveData.active + moveData.recovery;
  if (type === 'special') {
    fighter.special -= SPECIAL_COST_FP;
    fighter._specialTintTimer = Math.min(fighter.attackCooldown, SPECIAL_TINT_MAX_FRAMES);
  }
  return true;
}

/** Simulate one tick. */
function tick(fighter) {
  if (fighter.attackCooldown > 0) {
    fighter.attackCooldown--;
    fighter.attackFrameElapsed++;
  }
  if (fighter.attackCooldown <= 0 && fighter.state === 'attacking') {
    fighter.state = 'idle';
    fighter.currentAttack = null;
  }
}

describe('normal-to-special cancel', () => {
  it('cancel on hit during active frames succeeds', () => {
    const f = createFighter();
    attack(f, 'lightPunch'); // startup: 2, active: 2

    // Advance to active frame (elapsed = 2)
    tick(f); // 1
    tick(f); // 2 (first active frame)

    // Simulate hit connected
    f.hitConnected = true;

    // Cancel into special
    const result = attack(f, 'special');
    expect(result).toBe(true);
    expect(f.currentAttack.type).toBe('special');
    expect(f.attackFrameElapsed).toBe(0);
  });

  it('cancel on hit during early recovery frames succeeds (within 4f window)', () => {
    const f = createFighter();
    attack(f, 'lightPunch'); // startup: 2, active: 2, recovery: 3

    // Advance to first recovery frame (elapsed = 4 = startup + active)
    tick(f); tick(f); tick(f); tick(f);
    expect(f.attackFrameElapsed).toBe(4);

    f.hitConnected = true;

    // cancelEnd = startup(2) + active(2) + 4 = 8, elapsed(4) < 8 → allowed
    const result = attack(f, 'special');
    expect(result).toBe(true);
    expect(f.currentAttack.type).toBe('special');
  });

  it('cancel fails on whiff (hitConnected = false)', () => {
    const f = createFighter();
    attack(f, 'lightPunch');

    tick(f); tick(f); // active frame
    // hitConnected remains false

    const result = attack(f, 'special');
    expect(result).toBe(false);
    expect(f.currentAttack.type).toBe('lightPunch'); // still on original attack
  });

  it('cancel fails outside cancel window (late recovery)', () => {
    const f = createFighter();
    attack(f, 'heavyPunch'); // startup: 5, active: 3, recovery: 8

    // cancelEnd = 5 + 3 + 4 = 12. Advance to elapsed = 12
    for (let i = 0; i < 12; i++) tick(f);
    expect(f.attackFrameElapsed).toBe(12);

    f.hitConnected = true;

    // elapsed(12) >= cancelEnd(12) → outside window
    const result = attack(f, 'special');
    expect(result).toBe(false);
  });

  it('cancel fails during startup (before hit can happen)', () => {
    const f = createFighter();
    attack(f, 'heavyPunch'); // startup: 5

    tick(f); // elapsed = 1 (still startup)
    f.hitConnected = true; // shouldn't happen in practice, but test the gate

    // elapsed(1) < startup(5) → outside cancel window
    const result = attack(f, 'special');
    expect(result).toBe(false);
  });

  it('cancel special→special is blocked', () => {
    const f = createFighter();
    f.special = SPECIAL_COST_FP * 2; // enough for two specials
    attack(f, 'special'); // startup: 9, active: 5

    // Advance to active frame
    for (let i = 0; i < 9; i++) tick(f);
    f.hitConnected = true;

    // Try to cancel special into special
    const result = attack(f, 'special');
    expect(result).toBe(false);
    expect(f.currentAttack.type).toBe('special'); // still on original special
  });

  it('cancel normal→normal is blocked', () => {
    const f = createFighter();
    attack(f, 'lightPunch');

    tick(f); tick(f); // active frame
    f.hitConnected = true;

    // Try to cancel into another normal
    const result = attack(f, 'heavyPunch');
    expect(result).toBe(false);
  });

  it('cancel requires special meter', () => {
    const f = createFighter();
    f.special = 0; // no meter
    attack(f, 'lightPunch');

    tick(f); tick(f); // active frame
    f.hitConnected = true;

    const result = attack(f, 'special');
    expect(result).toBe(false); // fails due to meter check after cancel grant
  });

  it('cancel requires stamina', () => {
    const f = createFighter();
    f.stamina = 0; // no stamina
    attack(f, 'lightPunch');

    tick(f); tick(f);
    f.hitConnected = true;

    const result = attack(f, 'special');
    expect(result).toBe(false); // fails due to stamina check
  });

  it('cancel resets hitConnected for the new attack', () => {
    const f = createFighter();
    attack(f, 'lightPunch');

    tick(f); tick(f);
    f.hitConnected = true;

    attack(f, 'special');
    // After cancel, the new special starts fresh
    expect(f.hitConnected).toBe(false);
    expect(f.attackFrameElapsed).toBe(0);
  });
});
