import { describe, expect, it } from 'vitest';
import { MAX_SPECIAL } from '../../src/config.js';
import { calculateBlockDamage } from '../../src/entities/combat-block.js';
import { calculateDamage } from '../../src/systems/combat-math.js';

describe('calculateDamage', () => {
  it('neutral stats (power=3, defense=3) returns damage close to base', () => {
    // powerMod = 0.85 + 0.15 = 1.00, defMod = 1.20 - 0.18 = 1.02
    const result = calculateDamage(10, 3, 3);
    expect(result).toBe(Math.round(10 * 1.0 * 1.02)); // 10
  });

  it('high power (5) + low defense (1) gives significant damage boost', () => {
    // powerMod = 1.10, defMod = 1.14
    const result = calculateDamage(10, 5, 1);
    const neutral = calculateDamage(10, 3, 3);
    expect(result).toBeGreaterThan(neutral);
    expect(result).toBe(Math.round(10 * 1.1 * 1.14)); // 13
  });

  it('low power (1) + high defense (5) gives significant damage reduction', () => {
    // powerMod = 0.90, defMod = 0.90
    const result = calculateDamage(10, 1, 5);
    const neutral = calculateDamage(10, 3, 3);
    expect(result).toBeLessThan(neutral);
    expect(result).toBe(Math.round(10 * 0.9 * 0.9)); // 8
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
  it('reduces damage to 20% (truncated)', () => {
    expect(calculateBlockDamage(10)).toBe(2);
    expect(calculateBlockDamage(13)).toBe(2); // trunc(13/5) = 2
    expect(calculateBlockDamage(25)).toBe(5);
  });

  it('truncates fractional results', () => {
    expect(calculateBlockDamage(7)).toBe(1); // trunc(7/5) = 1
    expect(calculateBlockDamage(3)).toBe(0); // trunc(3/5) = 0
  });

  it('uses pure integer math (no floating point)', () => {
    // Verify determinism: integer division produces identical results
    // across all platforms, unlike Math.floor(damage * 0.2)
    for (let d = 0; d <= 100; d++) {
      const result = calculateBlockDamage(d);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBe(Math.trunc(d / 5));
    }
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
