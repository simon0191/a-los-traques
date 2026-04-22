import {
  FIGHTER_BODY_WIDTH_FP,
  FP_SCALE,
  fpClamp,
  GROUND_Y_FP,
  STAGE_LEFT_FP,
  STAGE_RIGHT_FP,
} from '@alostraques/sim';
import { describe, expect, it } from 'vitest';

// Inline the FP collision resolution logic to test without Phaser dependency
function resolveBodyCollision(f1, f2) {
  const airThreshold = GROUND_Y_FP - 20 * FP_SCALE;
  if (f1.simY < airThreshold || f2.simY < airThreshold) return;

  const halfW = FIGHTER_BODY_WIDTH_FP / 2;
  const f1x = f1.simX;
  const f2x = f2.simX;

  const overlap = halfW + halfW - Math.abs(f1x - f2x);
  if (overlap <= 0) return;

  const pushEach = Math.trunc(overlap / 2);
  const sign = f1x < f2x ? -1 : 1;

  let newF1x = f1x + sign * pushEach;
  let newF2x = f2x - sign * pushEach;

  newF1x = fpClamp(newF1x, STAGE_LEFT_FP, STAGE_RIGHT_FP);
  newF2x = fpClamp(newF2x, STAGE_LEFT_FP, STAGE_RIGHT_FP);

  const remainingOverlap = halfW + halfW - Math.abs(newF1x - newF2x);
  if (remainingOverlap > 0) {
    if (newF1x <= STAGE_LEFT_FP + 1 * FP_SCALE) {
      newF2x = newF1x + FIGHTER_BODY_WIDTH_FP;
    } else if (newF1x >= STAGE_RIGHT_FP - 1 * FP_SCALE) {
      newF2x = newF1x - FIGHTER_BODY_WIDTH_FP;
    } else if (newF2x <= STAGE_LEFT_FP + 1 * FP_SCALE) {
      newF1x = newF2x + FIGHTER_BODY_WIDTH_FP;
    } else if (newF2x >= STAGE_RIGHT_FP - 1 * FP_SCALE) {
      newF1x = newF2x - FIGHTER_BODY_WIDTH_FP;
    }
    newF1x = fpClamp(newF1x, STAGE_LEFT_FP, STAGE_RIGHT_FP);
    newF2x = fpClamp(newF2x, STAGE_LEFT_FP, STAGE_RIGHT_FP);
  }

  f1.simX = newF1x;
  f2.simX = newF2x;
}

function makeFighter(xPx, simY = GROUND_Y_FP) {
  return { simX: xPx * FP_SCALE, simY };
}

describe('resolveBodyCollision (FP)', () => {
  it('no overlap leaves positions unchanged', () => {
    const f1 = makeFighter(100);
    const f2 = makeFighter(200);
    resolveBodyCollision(f1, f2);
    expect(f1.simX).toBe(100 * FP_SCALE);
    expect(f2.simX).toBe(200 * FP_SCALE);
  });

  it('symmetric overlap pushes both apart equally', () => {
    const center = 240;
    const f1 = makeFighter(center - 5);
    const f2 = makeFighter(center + 5);
    resolveBodyCollision(f1, f2);
    expect(f1.simX).toBeLessThan((center - 5) * FP_SCALE);
    expect(f2.simX).toBeGreaterThan((center + 5) * FP_SCALE);
    // They should be exactly FIGHTER_BODY_WIDTH_FP apart
    expect(f2.simX - f1.simX).toBe(FIGHTER_BODY_WIDTH_FP);
  });

  it('fighter at left wall: only other fighter pushed right', () => {
    const f1 = { simX: STAGE_LEFT_FP, simY: GROUND_Y_FP };
    const f2 = { simX: STAGE_LEFT_FP + 10 * FP_SCALE, simY: GROUND_Y_FP };
    resolveBodyCollision(f1, f2);
    expect(f1.simX).toBe(STAGE_LEFT_FP);
    expect(f2.simX).toBe(STAGE_LEFT_FP + FIGHTER_BODY_WIDTH_FP);
  });

  it('fighter at right wall: only other fighter pushed left', () => {
    const f1 = { simX: STAGE_RIGHT_FP, simY: GROUND_Y_FP };
    const f2 = { simX: STAGE_RIGHT_FP - 10 * FP_SCALE, simY: GROUND_Y_FP };
    resolveBodyCollision(f1, f2);
    expect(f1.simX).toBe(STAGE_RIGHT_FP);
    expect(f2.simX).toBe(STAGE_RIGHT_FP - FIGHTER_BODY_WIDTH_FP);
  });

  it('both at same position: separated by FIGHTER_BODY_WIDTH_FP', () => {
    const f1 = makeFighter(240);
    const f2 = makeFighter(240);
    resolveBodyCollision(f1, f2);
    expect(Math.abs(f2.simX - f1.simX)).toBe(FIGHTER_BODY_WIDTH_FP);
  });

  it('airborne fighter: collision skipped', () => {
    const f1 = { simX: 240 * FP_SCALE, simY: GROUND_Y_FP - 30 * FP_SCALE };
    const f2 = { simX: 245 * FP_SCALE, simY: GROUND_Y_FP };
    resolveBodyCollision(f1, f2);
    expect(f1.simX).toBe(240 * FP_SCALE);
    expect(f2.simX).toBe(245 * FP_SCALE);
  });
});
