import { describe, expect, it } from 'vitest';

const FIXED_DELTA = 1000 / 60; // 16.667ms

/**
 * Pure function that mimics the fixed-timestep accumulator logic
 * from FightScene.update(). Returns the new accumulator value and
 * how many simulation ticks should run this frame.
 */
function runAccumulator(accumulator, delta, fixedDelta = FIXED_DELTA) {
  accumulator += delta;
  // Spiral-of-death cap: never accumulate more than 4 ticks worth
  if (accumulator > fixedDelta * 4) {
    accumulator = fixedDelta * 4;
  }
  let ticks = 0;
  while (accumulator >= fixedDelta) {
    accumulator -= fixedDelta;
    ticks++;
  }
  return { accumulator, ticks };
}

describe('fixed-timestep accumulator', () => {
  describe('60Hz display', () => {
    it('produces exactly 1 tick per frame', () => {
      const { accumulator, ticks } = runAccumulator(0, FIXED_DELTA);
      expect(ticks).toBe(1);
      expect(accumulator).toBeCloseTo(0, 10);
    });
  });

  describe('120Hz display', () => {
    const halfDelta = FIXED_DELTA / 2; // ~8.333ms

    it('alternates between 0 and 1 tick per frame', () => {
      // First frame: 8.333ms accumulated, not enough for a tick
      const frame1 = runAccumulator(0, halfDelta);
      expect(frame1.ticks).toBe(0);
      expect(frame1.accumulator).toBeCloseTo(halfDelta, 10);

      // Second frame: 8.333 + 8.333 = 16.667ms, exactly 1 tick
      const frame2 = runAccumulator(frame1.accumulator, halfDelta);
      expect(frame2.ticks).toBe(1);
      expect(frame2.accumulator).toBeCloseTo(0, 10);
    });
  });

  describe('30Hz display', () => {
    it('produces exactly 2 ticks per frame', () => {
      const doubleDelta = FIXED_DELTA * 2; // ~33.333ms
      const { accumulator, ticks } = runAccumulator(0, doubleDelta);
      expect(ticks).toBe(2);
      expect(accumulator).toBeCloseTo(0, 10);
    });
  });

  describe('spiral of death cap', () => {
    it('limits ticks when delta is very large (backgrounded tab)', () => {
      const { ticks } = runAccumulator(0, 1000); // 1 second gap
      // Cap clamps accumulator to fixedDelta*4 (~66.67ms). Due to floating
      // point, repeated subtraction of fixedDelta only fits 3 full ticks,
      // leaving ~1 tick of remainder. The key invariant: ticks are bounded
      // to a small number, not 60.
      expect(ticks).toBeLessThanOrEqual(4);
      expect(ticks).toBeGreaterThanOrEqual(3);
    });

    it('limits ticks even with pre-existing accumulator', () => {
      const { ticks } = runAccumulator(FIXED_DELTA * 2, 500);
      expect(ticks).toBeLessThanOrEqual(4);
      expect(ticks).toBeGreaterThanOrEqual(3);
    });

    it('would produce many more ticks without the cap', () => {
      // Without cap, 1000ms / 16.667ms = 60 ticks
      const uncapped = runAccumulator(0, 1000, FIXED_DELTA);
      // With a hypothetical no-cap version:
      let acc = 1000;
      let uncappedTicks = 0;
      while (acc >= FIXED_DELTA) {
        acc -= FIXED_DELTA;
        uncappedTicks++;
      }
      expect(uncappedTicks).toBe(60); // would be 60 ticks
      expect(uncapped.ticks).toBeLessThanOrEqual(4); // capped to ~4
    });

    it('discards excess accumulated time beyond the cap', () => {
      const { accumulator } = runAccumulator(0, 1000);
      // After consuming ticks, remainder should be less than 1 tick
      expect(accumulator).toBeLessThan(FIXED_DELTA);
      expect(accumulator).toBeGreaterThanOrEqual(0);
    });
  });

  describe('consistent tick count over 1 second', () => {
    function simulateOneSecond(frameDelta) {
      let acc = 0;
      let totalTicks = 0;
      const frames = Math.round(1000 / frameDelta);
      for (let i = 0; i < frames; i++) {
        const result = runAccumulator(acc, frameDelta);
        acc = result.accumulator;
        totalTicks += result.ticks;
      }
      return totalTicks;
    }

    it('60Hz produces 60 ticks per second', () => {
      expect(simulateOneSecond(FIXED_DELTA)).toBe(60);
    });

    it('120Hz produces 60 ticks per second', () => {
      expect(simulateOneSecond(FIXED_DELTA / 2)).toBe(60);
    });

    it('144Hz produces ~60 ticks per second', () => {
      // 144Hz frame delta does not divide evenly into the fixed timestep,
      // so floating point rounding may cause +/-1 tick drift per second.
      // The key property: it stays very close to 60.
      const delta144 = 1000 / 144;
      const ticks = simulateOneSecond(delta144);
      expect(ticks).toBeGreaterThanOrEqual(59);
      expect(ticks).toBeLessThanOrEqual(61);
    });

    it('all display rates stay within 1 tick of 60 per second', () => {
      const rates = [30, 48, 50, 60, 72, 90, 120, 144, 240];
      for (const hz of rates) {
        const delta = 1000 / hz;
        const ticks = simulateOneSecond(delta);
        expect(ticks).toBeGreaterThanOrEqual(59);
        expect(ticks).toBeLessThanOrEqual(61);
      }
    });
  });

  describe('sub-frame remainder', () => {
    it('carries fractional remainder between frames', () => {
      // 144Hz: ~6.944ms per frame, less than one tick
      const delta144 = 1000 / 144;
      const frame1 = runAccumulator(0, delta144);
      expect(frame1.ticks).toBe(0);
      expect(frame1.accumulator).toBeCloseTo(delta144, 10);

      // After enough frames, the remainder triggers a tick
      let acc = 0;
      let firstTickFrame = -1;
      for (let i = 0; i < 10; i++) {
        const result = runAccumulator(acc, delta144);
        acc = result.accumulator;
        if (result.ticks > 0 && firstTickFrame === -1) {
          firstTickFrame = i;
        }
      }
      // At 144Hz, a tick fires after ~2.4 frames, so frame index 2 (third frame)
      expect(firstTickFrame).toBe(2);
    });

    it('remainder is always less than one fixed tick', () => {
      const deltas = [10, 12.5, 15, 20, 25, 33.333];
      for (const delta of deltas) {
        const { accumulator } = runAccumulator(0, delta);
        expect(accumulator).toBeLessThan(FIXED_DELTA);
        expect(accumulator).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
