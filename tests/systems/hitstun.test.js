import {
  calculateBlockDamage,
  FP_SCALE,
  GROUND_Y_FP,
  HURT_TIMER_KNOCKDOWN,
  HURT_TIMER_LIGHT,
  KNOCKBACK_VX_FP,
  KNOCKBACK_VY_FP,
  MAX_SPECIAL_FP,
} from '@alostraques/sim';
import { describe, expect, it } from 'vitest';

/** Create minimal fighter for hitstun tests. */
function createFighter(overrides = {}) {
  return {
    simX: 100 * FP_SCALE,
    simY: GROUND_Y_FP,
    simVX: 0,
    simVY: 0,
    hp: 100,
    special: 0,
    state: 'idle',
    hurtTimer: 0,
    sprite: { clearTint() {} },
    ...overrides,
  };
}

/** Replicate Fighter.takeDamage with per-move stun support. */
function takeDamage(fighter, amount, attackerSimX, stunFrames) {
  if (fighter.state === 'blocking') {
    amount = calculateBlockDamage(amount);
    fighter.sprite.clearTint();
  }
  fighter.hp = Math.max(0, fighter.hp - amount);
  fighter.special = Math.min(MAX_SPECIAL_FP, fighter.special + amount * 800);
  const knockDir = fighter.simX > attackerSimX ? 1 : -1;
  fighter.simVX = knockDir * KNOCKBACK_VX_FP;
  if (stunFrames != null) {
    if (amount >= 15) {
      fighter.state = 'knockdown';
      fighter.hurtTimer = stunFrames;
      fighter.simVY = KNOCKBACK_VY_FP;
    } else {
      fighter.state = 'hurt';
      fighter.hurtTimer = stunFrames;
    }
  } else if (amount >= 15) {
    fighter.state = 'knockdown';
    fighter.hurtTimer = HURT_TIMER_KNOCKDOWN;
    fighter.simVY = KNOCKBACK_VY_FP;
  } else {
    fighter.state = 'hurt';
    fighter.hurtTimer = HURT_TIMER_LIGHT;
  }
  return fighter.hp <= 0;
}

describe('per-move hitstun', () => {
  it('applies hitstun from move data on hit', () => {
    const f = createFighter();
    takeDamage(f, 5, 50 * FP_SCALE, 12);
    expect(f.state).toBe('hurt');
    expect(f.hurtTimer).toBe(12);
  });

  it('applies blockstun from move data on block', () => {
    const f = createFighter({ state: 'blocking' });
    takeDamage(f, 13, 50 * FP_SCALE, 14);
    // Blocked damage: floor(13 * 0.2) = 2, which is < 15 so state is 'hurt'
    expect(f.hurtTimer).toBe(14);
  });

  it('heavy hit with hitstun triggers knockdown', () => {
    const f = createFighter();
    takeDamage(f, 15, 50 * FP_SCALE, 22);
    expect(f.state).toBe('knockdown');
    expect(f.hurtTimer).toBe(22);
    expect(f.simVY).toBe(KNOCKBACK_VY_FP);
  });

  it('falls back to HURT_TIMER_LIGHT when no stunFrames provided', () => {
    const f = createFighter();
    takeDamage(f, 5, 50 * FP_SCALE);
    expect(f.state).toBe('hurt');
    expect(f.hurtTimer).toBe(HURT_TIMER_LIGHT);
  });

  it('falls back to HURT_TIMER_KNOCKDOWN for heavy hit without stunFrames', () => {
    const f = createFighter();
    takeDamage(f, 15, 50 * FP_SCALE);
    expect(f.state).toBe('knockdown');
    expect(f.hurtTimer).toBe(HURT_TIMER_KNOCKDOWN);
  });

  it('different moves produce different hitstun values', () => {
    const f1 = createFighter();
    const f2 = createFighter();

    takeDamage(f1, 5, 50 * FP_SCALE, 12); // light punch
    takeDamage(f2, 6, 50 * FP_SCALE, 14); // light kick

    expect(f1.hurtTimer).toBe(12);
    expect(f2.hurtTimer).toBe(14);
    expect(f1.hurtTimer).not.toBe(f2.hurtTimer);
  });

  it('stunFrames of 0 is treated as provided (uses 0)', () => {
    const f = createFighter();
    takeDamage(f, 5, 50 * FP_SCALE, 0);
    expect(f.hurtTimer).toBe(0);
  });
});
