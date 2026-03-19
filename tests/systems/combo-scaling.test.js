import { describe, expect, it } from 'vitest';
import { comboScaledDamage } from '../../src/systems/combat-math.js';

describe('comboScaledDamage', () => {
  it('first hit (comboCount=0) deals full damage', () => {
    expect(comboScaledDamage(10, 0)).toBe(10);
    expect(comboScaledDamage(28, 0)).toBe(28);
  });

  it('second hit (comboCount=1) deals 80% damage', () => {
    expect(comboScaledDamage(10, 1)).toBe(8);
    expect(comboScaledDamage(28, 1)).toBe(22); // trunc(28 * 800 / 1000) = 22
  });

  it('third hit (comboCount=2) deals 65% damage', () => {
    expect(comboScaledDamage(10, 2)).toBe(6); // trunc(10 * 650 / 1000) = 6
    expect(comboScaledDamage(28, 2)).toBe(18); // trunc(28 * 650 / 1000) = 18
  });

  it('fourth+ hit (comboCount=3+) floors at 50% damage', () => {
    expect(comboScaledDamage(10, 3)).toBe(5);
    expect(comboScaledDamage(10, 4)).toBe(5);
    expect(comboScaledDamage(10, 10)).toBe(5);
    expect(comboScaledDamage(28, 3)).toBe(14); // trunc(28 * 500 / 1000) = 14
  });

  it('returns integer results (truncated, not rounded)', () => {
    // 7 * 800 / 1000 = 5.6 → trunc to 5
    expect(comboScaledDamage(7, 1)).toBe(5);
    // 7 * 650 / 1000 = 4.55 → trunc to 4
    expect(comboScaledDamage(7, 2)).toBe(4);
    // 3 * 500 / 1000 = 1.5 → trunc to 1
    expect(comboScaledDamage(3, 3)).toBe(1);
  });

  it('handles zero damage', () => {
    expect(comboScaledDamage(0, 0)).toBe(0);
    expect(comboScaledDamage(0, 3)).toBe(0);
  });

  it('damage decreases monotonically with combo count', () => {
    const base = 20;
    const d0 = comboScaledDamage(base, 0);
    const d1 = comboScaledDamage(base, 1);
    const d2 = comboScaledDamage(base, 2);
    const d3 = comboScaledDamage(base, 3);

    expect(d0).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThan(d3);
  });
});
