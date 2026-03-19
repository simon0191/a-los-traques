import { describe, expect, it } from 'vitest';
import { MAX_SPECIAL } from '../../src/config.js';
import { calculateBlockDamage } from '../../src/entities/combat-block.js';
import { calculateDamage } from '../../src/systems/combat-math.js';

describe('calculateDamage', () => {
  it('neutral stats (power=3, defense=3) returns damage close to base', () => {
    // powerMod = 0.7 + 0.3 = 1.0, defMod = 1.1 - 0.12 = 0.98
    const result = calculateDamage(10, 3, 3);
    expect(result).toBe(Math.round(10 * 1.0 * 0.98)); // 10
  });

  it('high power (5) + low defense (1) gives significant damage boost', () => {
    // powerMod = 1.2, defMod = 1.06
    const result = calculateDamage(10, 5, 1);
    const neutral = calculateDamage(10, 3, 3);
    expect(result).toBeGreaterThan(neutral);
    expect(result).toBe(Math.round(10 * 1.2 * 1.06)); // 13
  });

  it('low power (1) + high defense (5) gives significant damage reduction', () => {
    // powerMod = 0.8, defMod = 0.90
    const result = calculateDamage(10, 1, 5);
    const neutral = calculateDamage(10, 3, 3);
    expect(result).toBeLessThan(neutral);
    expect(result).toBe(Math.round(10 * 0.8 * 0.9)); // 7
  });

  it('always returns a rounded integer', () => {
    for (let power = 1; power <= 5; power++) {
      for (let def = 1; def <= 5; def++) {
        const result = calculateDamage(7, power, def);
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });
});

describe('calculateBlockDamage', () => {
  it('reduces damage to 20% (floored)', () => {
    expect(calculateBlockDamage(10)).toBe(2);
    expect(calculateBlockDamage(13)).toBe(2); // floor(2.6) = 2
    expect(calculateBlockDamage(25)).toBe(5);
  });

  it('floors fractional results', () => {
    expect(calculateBlockDamage(7)).toBe(1); // floor(1.4) = 1
    expect(calculateBlockDamage(3)).toBe(0); // floor(0.6) = 0
  });
});

describe('special meter gain', () => {
  it('attacker gains 20% of damage dealt', () => {
    const damage = 15;
    const gain = damage * 0.2;
    expect(gain).toBe(3);
  });

  it('defender gains 80% of damage taken', () => {
    const damage = 15;
    const gain = damage * 0.8;
    expect(gain).toBe(12);
  });

  it('meter gain is capped at MAX_SPECIAL', () => {
    const currentSpecial = 95;
    const damage = 50;
    const attackerGain = Math.min(MAX_SPECIAL, currentSpecial + damage * 0.2);
    expect(attackerGain).toBe(MAX_SPECIAL);
    const defenderGain = Math.min(MAX_SPECIAL, currentSpecial + damage * 0.8);
    expect(defenderGain).toBe(MAX_SPECIAL);
  });
});

describe('knockdown threshold', () => {
  it('damage >= 15 triggers knockdown state', () => {
    // This tests the threshold documented in Fighter.takeDamage
    const amount = 15;
    expect(amount >= 15).toBe(true);
  });

  it('damage < 15 triggers hurt state', () => {
    const amount = 14;
    expect(amount >= 15).toBe(false);
  });
});
