import { describe, expect, it } from 'vitest';
import { STAMINA_COSTS } from '../../src/config.js';
import {
  FP_SCALE,
  GROUND_Y_FP,
  MAX_STAMINA_FP,
  SPECIAL_COST_FP,
  SPECIAL_TINT_MAX_FRAMES,
} from '../../src/systems/FixedPoint.js';

/** Create a minimal sim fighter for attack phase tests. */
function createFighter(moves = {}) {
  const defaultMoves = {
    lightPunch: { type: 'lightPunch', damage: 5, startup: 2, active: 2, recovery: 3 },
    heavyPunch: { type: 'heavyPunch', damage: 13, startup: 5, active: 3, recovery: 8 },
    lightKick: { type: 'lightKick', damage: 6, startup: 3, active: 2, recovery: 4 },
    heavyKick: { type: 'heavyKick', damage: 15, startup: 6, active: 3, recovery: 9 },
    special: { type: 'special', damage: 28, startup: 9, active: 5, recovery: 14, cost: 50 },
    ...moves,
  };

  const fighter = {
    simX: 100 * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 0,
    simVY: 0,
    hp: 100,
    special: 0,
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

  return fighter;
}

/** Simulate attack() on a fighter. */
function attack(fighter, type) {
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

/** Simulate one update tick (cooldown + frame tracking). */
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

/** Get hitbox (phase-gated). */
function getAttackHitbox(fighter) {
  if (fighter.state !== 'attacking' || !fighter.currentAttack) return null;
  const move = fighter.currentAttack;
  if (
    fighter.attackFrameElapsed < move.startup ||
    fighter.attackFrameElapsed >= move.startup + move.active
  ) {
    return null;
  }
  const reach = (move.type.includes('Kick') ? 55 : 45) * FP_SCALE;
  const dir = fighter.facingRight ? 1 : -1;
  return {
    x: fighter.simX + dir * 10 * FP_SCALE,
    y: fighter.simY - 50 * FP_SCALE,
    w: reach * dir,
    h: 40 * FP_SCALE,
  };
}

describe('attack phase tracking', () => {
  it('hitbox is null during startup frames', () => {
    const f = createFighter();
    attack(f, 'lightPunch'); // startup: 2, active: 2, recovery: 3

    // Frame 0: just attacked, no tick yet
    expect(f.attackFrameElapsed).toBe(0);
    expect(getAttackHitbox(f)).toBeNull();

    // Frame 1: first tick (attackFrameElapsed = 1, still in startup)
    tick(f);
    expect(f.attackFrameElapsed).toBe(1);
    expect(getAttackHitbox(f)).toBeNull();
  });

  it('hitbox is active during active frames', () => {
    const f = createFighter();
    attack(f, 'lightPunch'); // startup: 2, active: 2, recovery: 3

    // Tick through startup (2 frames)
    tick(f); // elapsed = 1
    tick(f); // elapsed = 2 (startup done, first active frame)

    expect(f.attackFrameElapsed).toBe(2);
    expect(getAttackHitbox(f)).not.toBeNull();

    // Second active frame
    tick(f); // elapsed = 3
    expect(f.attackFrameElapsed).toBe(3);
    expect(getAttackHitbox(f)).not.toBeNull();
  });

  it('hitbox is null during recovery frames', () => {
    const f = createFighter();
    attack(f, 'lightPunch'); // startup: 2, active: 2, recovery: 3

    // Tick through startup + active (4 frames)
    tick(f); // 1
    tick(f); // 2
    tick(f); // 3
    tick(f); // 4 (first recovery frame)

    expect(f.attackFrameElapsed).toBe(4);
    expect(getAttackHitbox(f)).toBeNull();
  });

  it('hitbox is null after attack completes', () => {
    const f = createFighter();
    attack(f, 'lightPunch'); // total: 7 frames

    for (let i = 0; i < 7; i++) tick(f);

    expect(f.state).toBe('idle');
    expect(getAttackHitbox(f)).toBeNull();
  });

  it('heavy kick has correct phase boundaries', () => {
    const f = createFighter();
    attack(f, 'heavyKick'); // startup: 6, active: 3, recovery: 9

    // Startup (frames 1-6)
    for (let i = 0; i < 5; i++) {
      tick(f);
      expect(getAttackHitbox(f), `frame ${i + 1} should be startup`).toBeNull();
    }

    // First active frame (frame 6 -> elapsed = 6 = startup)
    tick(f);
    expect(f.attackFrameElapsed).toBe(6);
    expect(getAttackHitbox(f), 'first active frame').not.toBeNull();

    // Active frames (7, 8)
    tick(f);
    expect(getAttackHitbox(f), 'second active frame').not.toBeNull();
    tick(f);
    expect(getAttackHitbox(f), 'third active frame').not.toBeNull();

    // Recovery starts (frame 9 -> elapsed = 9 = startup + active)
    tick(f);
    expect(f.attackFrameElapsed).toBe(9);
    expect(getAttackHitbox(f), 'first recovery frame').toBeNull();
  });

  it('attackFrameElapsed resets on new attack', () => {
    const f = createFighter();
    attack(f, 'lightPunch');

    // Tick a few frames
    tick(f);
    tick(f);
    tick(f);
    tick(f);
    tick(f);
    tick(f);
    tick(f); // attack completes

    expect(f.state).toBe('idle');

    // Start new attack
    attack(f, 'heavyPunch');
    expect(f.attackFrameElapsed).toBe(0);
  });

  it('special attack phase tracking works', () => {
    const f = createFighter();
    f.special = SPECIAL_COST_FP; // give enough meter
    attack(f, 'special'); // startup: 9, active: 5, recovery: 14

    // Startup: elapsed 0 is checked before any tick
    expect(getAttackHitbox(f), 'elapsed 0 (startup)').toBeNull();

    // Ticks 1-8 remain in startup (elapsed < 9)
    for (let i = 0; i < 8; i++) {
      tick(f);
      expect(
        getAttackHitbox(f),
        `startup tick ${i + 1}, elapsed ${f.attackFrameElapsed}`,
      ).toBeNull();
    }

    // Tick 9: elapsed = 9 = startup → first active frame
    tick(f);
    expect(f.attackFrameElapsed).toBe(9);
    expect(getAttackHitbox(f), 'first active frame').not.toBeNull();

    // Active frames (4 more ticks, elapsed 10-13)
    for (let i = 0; i < 4; i++) {
      tick(f);
      expect(getAttackHitbox(f), `active frame elapsed ${f.attackFrameElapsed}`).not.toBeNull();
    }
    expect(f.attackFrameElapsed).toBe(13);

    // Tick 14: elapsed = 14 = startup(9) + active(5) → recovery
    tick(f);
    expect(f.attackFrameElapsed).toBe(14);
    expect(getAttackHitbox(f), 'recovery').toBeNull();
  });

  it('boundary: hitbox active at exactly startup frame count', () => {
    const f = createFighter({
      lightPunch: { type: 'lightPunch', damage: 5, startup: 1, active: 2, recovery: 3 },
    });
    attack(f, 'lightPunch'); // startup: 1

    // After 1 tick, elapsed = 1 = startup, should be active
    tick(f);
    expect(f.attackFrameElapsed).toBe(1);
    expect(getAttackHitbox(f)).not.toBeNull();
  });

  it('boundary: hitbox null at exactly startup + active', () => {
    const f = createFighter({
      lightPunch: { type: 'lightPunch', damage: 5, startup: 1, active: 1, recovery: 3 },
    });
    attack(f, 'lightPunch');

    tick(f); // elapsed = 1 (active)
    expect(getAttackHitbox(f)).not.toBeNull();

    tick(f); // elapsed = 2 = startup(1) + active(1), should be recovery
    expect(getAttackHitbox(f)).toBeNull();
  });
});
