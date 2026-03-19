import { describe, expect, it } from 'vitest';
import { FP_SCALE } from '../../src/systems/FixedPoint.js';
import { EMPTY_INPUT, encodeInput } from '../../src/systems/InputBuffer.js';

describe('FP_SCALE', () => {
  it('equals 1000 for 1000x scaling', () => {
    expect(FP_SCALE).toBe(1000);
  });
});

describe('encodeInput for simulation', () => {
  it('EMPTY_INPUT produces no movement or attacks', () => {
    expect(EMPTY_INPUT).toBe(0);
  });

  it('left + right produces correct encoding', () => {
    const encoded = encodeInput({
      left: true,
      right: true,
      up: false,
      down: false,
      lp: false,
      hp: false,
      lk: false,
      hk: false,
      sp: false,
    });
    expect(encoded).toBe(0b11); // bits 0 and 1
  });
});

describe('determinism', () => {
  it('same inputs produce same encoded values', () => {
    const input = {
      left: true,
      right: false,
      up: true,
      down: false,
      lp: true,
      hp: false,
      lk: false,
      hk: false,
      sp: false,
    };
    const a = encodeInput(input);
    const b = encodeInput(input);
    expect(a).toBe(b);
  });
});
