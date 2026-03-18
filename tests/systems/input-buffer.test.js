import { describe, it, expect } from 'vitest';
import {
  encodeInput, decodeInput, inputsEqual,
  predictInput, EMPTY_INPUT, MOVEMENT_MASK, ATTACK_MASK
} from '../../src/systems/InputBuffer.js';

describe('encodeInput / decodeInput', () => {
  it('empty input encodes to 0', () => {
    const input = { left: false, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };
    expect(encodeInput(input)).toBe(0);
  });

  it('roundtrips all individual buttons', () => {
    const keys = ['left', 'right', 'up', 'down', 'lp', 'hp', 'lk', 'hk', 'sp'];
    for (const key of keys) {
      const input = { left: false, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };
      input[key] = true;
      const encoded = encodeInput(input);
      expect(encoded).toBeGreaterThan(0);
      const decoded = decodeInput(encoded);
      expect(decoded[key]).toBe(true);
      // All other keys should be false
      for (const other of keys) {
        if (other !== key) expect(decoded[other]).toBe(false);
      }
    }
  });

  it('roundtrips all 512 combinations', () => {
    for (let i = 0; i < 512; i++) {
      const decoded = decodeInput(i);
      const reencoded = encodeInput(decoded);
      expect(reencoded).toBe(i);
    }
  });

  it('encodes complex combinations correctly', () => {
    const input = { left: true, right: false, up: true, down: false, lp: true, hp: false, lk: false, hk: false, sp: true };
    const encoded = encodeInput(input);
    const decoded = decodeInput(encoded);
    expect(decoded.left).toBe(true);
    expect(decoded.right).toBe(false);
    expect(decoded.up).toBe(true);
    expect(decoded.down).toBe(false);
    expect(decoded.lp).toBe(true);
    expect(decoded.sp).toBe(true);
  });
});

describe('inputsEqual', () => {
  it('returns true for identical inputs', () => {
    expect(inputsEqual(0, 0)).toBe(true);
    expect(inputsEqual(42, 42)).toBe(true);
    expect(inputsEqual(511, 511)).toBe(true);
  });

  it('returns false for different inputs', () => {
    expect(inputsEqual(0, 1)).toBe(false);
    expect(inputsEqual(42, 43)).toBe(false);
  });
});

describe('predictInput', () => {
  it('keeps movement, strips attacks', () => {
    // left + up + lightPunch
    const input = encodeInput({ left: true, right: false, up: true, down: false, lp: true, hp: false, lk: false, hk: false, sp: false });
    const predicted = predictInput(input);
    const decoded = decodeInput(predicted);
    expect(decoded.left).toBe(true);
    expect(decoded.up).toBe(true);
    expect(decoded.lp).toBe(false);
  });

  it('returns EMPTY_INPUT for all-attacks input', () => {
    const input = encodeInput({ left: false, right: false, up: false, down: false, lp: true, hp: true, lk: true, hk: true, sp: true });
    expect(predictInput(input)).toBe(EMPTY_INPUT);
  });

  it('preserves all movement when no attacks', () => {
    const input = encodeInput({ left: true, right: true, up: true, down: true, lp: false, hp: false, lk: false, hk: false, sp: false });
    expect(predictInput(input)).toBe(input);
  });
});

describe('constants', () => {
  it('EMPTY_INPUT is 0', () => {
    expect(EMPTY_INPUT).toBe(0);
  });

  it('MOVEMENT_MASK covers bits 0-3', () => {
    expect(MOVEMENT_MASK).toBe(0b1111);
  });

  it('ATTACK_MASK covers bits 4-8', () => {
    expect(ATTACK_MASK).toBe(0b111110000);
  });
});
