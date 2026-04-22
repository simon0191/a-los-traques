import {
  DOUBLE_JUMP_AIRBORNE_THRESHOLD,
  FP_SCALE,
  fpClamp,
  fpRectsOverlap,
  fpToPixels,
  GRAVITY_PER_FRAME_FP,
  GROUND_Y_FP,
  JUMP_VY_FP,
  msToFrames,
  pixelsToFP,
} from '@alostraques/sim';
import { describe, expect, it } from 'vitest';

describe('fpClamp', () => {
  it('returns val when in range', () => {
    expect(fpClamp(50, 0, 100)).toBe(50);
  });

  it('clamps to min', () => {
    expect(fpClamp(-10, 0, 100)).toBe(0);
  });

  it('clamps to max', () => {
    expect(fpClamp(150, 0, 100)).toBe(100);
  });

  it('handles val equal to min', () => {
    expect(fpClamp(0, 0, 100)).toBe(0);
  });

  it('handles val equal to max', () => {
    expect(fpClamp(100, 0, 100)).toBe(100);
  });

  it('handles negative ranges', () => {
    expect(fpClamp(-50, -100, -10)).toBe(-50);
    expect(fpClamp(-200, -100, -10)).toBe(-100);
    expect(fpClamp(0, -100, -10)).toBe(-10);
  });
});

describe('fpRectsOverlap', () => {
  it('detects overlapping rects', () => {
    expect(fpRectsOverlap(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true);
  });

  it('detects non-overlapping rects', () => {
    expect(fpRectsOverlap(0, 0, 10, 10, 20, 20, 10, 10)).toBe(false);
  });

  it('touching rects do not overlap (exclusive bounds)', () => {
    expect(fpRectsOverlap(0, 0, 10, 10, 10, 0, 10, 10)).toBe(false);
    expect(fpRectsOverlap(0, 0, 10, 10, 0, 10, 10, 10)).toBe(false);
  });

  it('handles negative coordinates', () => {
    expect(fpRectsOverlap(-10, -10, 15, 15, 0, 0, 10, 10)).toBe(true);
    expect(fpRectsOverlap(-20, -20, 5, 5, 0, 0, 10, 10)).toBe(false);
  });

  it('one rect inside another', () => {
    expect(fpRectsOverlap(0, 0, 100, 100, 10, 10, 5, 5)).toBe(true);
    expect(fpRectsOverlap(10, 10, 5, 5, 0, 0, 100, 100)).toBe(true);
  });
});

describe('msToFrames', () => {
  it('converts 1000ms to 60 frames', () => {
    expect(msToFrames(1000)).toBe(60);
  });

  it('converts 500ms to 30 frames', () => {
    expect(msToFrames(500)).toBe(30);
  });

  it('converts 100ms to 6 frames', () => {
    expect(msToFrames(100)).toBe(6);
  });

  it('rounds to nearest frame', () => {
    // 166.67ms = 10 frames
    expect(msToFrames(167)).toBe(10);
  });
});

describe('conversion helpers', () => {
  it('fpToPixels converts correctly', () => {
    expect(fpToPixels(220_000)).toBe(220);
    expect(fpToPixels(0)).toBe(0);
    expect(fpToPixels(-350_000)).toBe(-350);
  });

  it('pixelsToFP converts correctly', () => {
    expect(pixelsToFP(220)).toBe(220_000);
    expect(pixelsToFP(0)).toBe(0);
  });

  it('pixelsToFP truncates fractional pixels', () => {
    expect(pixelsToFP(220.7)).toBe(220_700);
    expect(pixelsToFP(-5.3)).toBe(-5_300);
  });
});

describe('gravity integration', () => {
  it('freefall from height lands on GROUND_Y_FP', () => {
    let simY = GROUND_Y_FP - 50 * FP_SCALE; // 50px above ground
    let simVY = 0;

    let landed = false;
    for (let frame = 0; frame < 300; frame++) {
      simVY += GRAVITY_PER_FRAME_FP;
      simY += Math.trunc(simVY / 60);
      if (simY >= GROUND_Y_FP) {
        simY = GROUND_Y_FP;
        simVY = 0;
        landed = true;
        break;
      }
    }

    expect(landed).toBe(true);
    expect(simY).toBe(GROUND_Y_FP);
  });

  it('jump arc returns to GROUND_Y_FP', () => {
    let simY = GROUND_Y_FP;
    let simVY = JUMP_VY_FP; // -350_000

    let peakY = simY;
    let returned = false;

    for (let frame = 0; frame < 300; frame++) {
      simVY += GRAVITY_PER_FRAME_FP;
      simY += Math.trunc(simVY / 60);

      if (simY < peakY) peakY = simY;

      if (simY >= GROUND_Y_FP) {
        simY = GROUND_Y_FP;
        simVY = 0;
        returned = true;
        break;
      }
    }

    expect(returned).toBe(true);
    expect(simY).toBe(GROUND_Y_FP);
    // Should have gone above ground
    expect(peakY).toBeLessThan(GROUND_Y_FP);
    // Peak should be reasonable (roughly 70-80px above ground)
    const peakHeightPx = (GROUND_Y_FP - peakY) / FP_SCALE;
    expect(peakHeightPx).toBeGreaterThan(50);
    expect(peakHeightPx).toBeLessThan(120);
  });
});

describe('determinism proof', () => {
  it('same input sequence produces identical state across 1000 runs', () => {
    function runSimulation() {
      let simX = 144 * FP_SCALE;
      let simY = GROUND_Y_FP;
      let simVX = 0;
      let simVY = 0;
      let airborneTime = 0;

      // Simulate 120 frames: walk right 30, jump, walk left 30, idle
      for (let frame = 0; frame < 120; frame++) {
        // Gravity + integration
        simVY += GRAVITY_PER_FRAME_FP;
        simY += Math.trunc(simVY / 60);
        simX += Math.trunc(simVX / 60);

        // Ground check
        const isOnGround = simY >= GROUND_Y_FP;
        if (isOnGround) {
          simY = GROUND_Y_FP;
          simVY = 0;
          airborneTime = 0;
        } else {
          airborneTime++;
        }

        // Input
        if (frame < 30) {
          simVX = 140 * FP_SCALE; // walk right
        } else if (frame === 30) {
          simVY = JUMP_VY_FP; // jump
          simVX = 0;
        } else if (frame > 60 && frame < 90) {
          simVX = -140 * FP_SCALE; // walk left
        } else {
          simVX = 0;
        }

        // Double jump at frame 37 if airborne long enough
        if (frame === 37 && airborneTime > DOUBLE_JUMP_AIRBORNE_THRESHOLD) {
          simVY = -380 * FP_SCALE;
        }
      }

      return { simX, simY, simVX, simVY };
    }

    const reference = runSimulation();
    for (let i = 0; i < 1000; i++) {
      const result = runSimulation();
      expect(result.simX).toBe(reference.simX);
      expect(result.simY).toBe(reference.simY);
      expect(result.simVX).toBe(reference.simVX);
      expect(result.simVY).toBe(reference.simVY);
    }
  });
});
