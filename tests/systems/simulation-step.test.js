import { describe, it, expect } from 'vitest';
import { encodeInput, EMPTY_INPUT } from '../../src/systems/InputBuffer.js';
import { FIXED_DELTA } from '../../src/systems/SimulationStep.js';

describe('FIXED_DELTA', () => {
  it('equals 1000/60 for 60fps', () => {
    expect(FIXED_DELTA).toBeCloseTo(16.6667, 3);
  });
});

describe('encodeInput for simulation', () => {
  it('EMPTY_INPUT produces no movement or attacks', () => {
    expect(EMPTY_INPUT).toBe(0);
  });

  it('left + right produces correct encoding', () => {
    const encoded = encodeInput({
      left: true, right: true, up: false, down: false,
      lp: false, hp: false, lk: false, hk: false, sp: false
    });
    expect(encoded).toBe(0b11); // bits 0 and 1
  });
});

describe('determinism', () => {
  it('same inputs produce same encoded values', () => {
    const input = {
      left: true, right: false, up: true, down: false,
      lp: true, hp: false, lk: false, hk: false, sp: false
    };
    const a = encodeInput(input);
    const b = encodeInput(input);
    expect(a).toBe(b);
  });
});
