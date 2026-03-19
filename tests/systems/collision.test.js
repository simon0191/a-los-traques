import { describe, expect, it } from 'vitest';
import { FIGHTER_BODY_WIDTH, GROUND_Y, STAGE_LEFT, STAGE_RIGHT } from '../../src/config.js';

// Inline the collision resolution logic to test without Phaser dependency
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function resolveBodyCollision(f1, f2) {
  const airThreshold = GROUND_Y - 20;
  if (f1.sprite.y < airThreshold || f2.sprite.y < airThreshold) return;

  const halfW = FIGHTER_BODY_WIDTH / 2;
  const f1x = f1.sprite.x;
  const f2x = f2.sprite.x;

  const overlap = halfW + halfW - Math.abs(f1x - f2x);
  if (overlap <= 0) return;

  const pushEach = overlap / 2;
  const sign = f1x < f2x ? -1 : 1;

  let newF1x = f1x + sign * pushEach;
  let newF2x = f2x - sign * pushEach;

  newF1x = clamp(newF1x, STAGE_LEFT, STAGE_RIGHT);
  newF2x = clamp(newF2x, STAGE_LEFT, STAGE_RIGHT);

  const remainingOverlap = halfW + halfW - Math.abs(newF1x - newF2x);
  if (remainingOverlap > 0) {
    if (newF1x <= STAGE_LEFT + 1) {
      newF2x = newF1x + FIGHTER_BODY_WIDTH;
    } else if (newF1x >= STAGE_RIGHT - 1) {
      newF2x = newF1x - FIGHTER_BODY_WIDTH;
    } else if (newF2x <= STAGE_LEFT + 1) {
      newF1x = newF2x + FIGHTER_BODY_WIDTH;
    } else if (newF2x >= STAGE_RIGHT - 1) {
      newF1x = newF2x - FIGHTER_BODY_WIDTH;
    }
    newF1x = clamp(newF1x, STAGE_LEFT, STAGE_RIGHT);
    newF2x = clamp(newF2x, STAGE_LEFT, STAGE_RIGHT);
  }

  f1.sprite.x = newF1x;
  f2.sprite.x = newF2x;
}

function makeFighter(x, y = GROUND_Y) {
  return { sprite: { x, y } };
}

describe('resolveBodyCollision', () => {
  it('no overlap leaves positions unchanged', () => {
    const f1 = makeFighter(100);
    const f2 = makeFighter(200);
    resolveBodyCollision(f1, f2);
    expect(f1.sprite.x).toBe(100);
    expect(f2.sprite.x).toBe(200);
  });

  it('symmetric overlap pushes both apart equally', () => {
    const center = 240;
    const f1 = makeFighter(center - 5);
    const f2 = makeFighter(center + 5);
    // overlap = 36 - 10 = 26, each pushed 13
    resolveBodyCollision(f1, f2);
    expect(f1.sprite.x).toBeLessThan(center - 5);
    expect(f2.sprite.x).toBeGreaterThan(center + 5);
    // They should be exactly FIGHTER_BODY_WIDTH apart
    expect(f2.sprite.x - f1.sprite.x).toBeCloseTo(FIGHTER_BODY_WIDTH, 5);
  });

  it('fighter at left wall: only other fighter pushed right', () => {
    const f1 = makeFighter(STAGE_LEFT);
    const f2 = makeFighter(STAGE_LEFT + 10);
    resolveBodyCollision(f1, f2);
    expect(f1.sprite.x).toBe(STAGE_LEFT);
    expect(f2.sprite.x).toBe(STAGE_LEFT + FIGHTER_BODY_WIDTH);
  });

  it('fighter at right wall: only other fighter pushed left', () => {
    const f1 = makeFighter(STAGE_RIGHT);
    const f2 = makeFighter(STAGE_RIGHT - 10);
    resolveBodyCollision(f1, f2);
    expect(f1.sprite.x).toBe(STAGE_RIGHT);
    expect(f2.sprite.x).toBe(STAGE_RIGHT - FIGHTER_BODY_WIDTH);
  });

  it('both at same position: separated by FIGHTER_BODY_WIDTH', () => {
    const f1 = makeFighter(240);
    const f2 = makeFighter(240);
    resolveBodyCollision(f1, f2);
    expect(Math.abs(f2.sprite.x - f1.sprite.x)).toBeCloseTo(FIGHTER_BODY_WIDTH, 5);
  });

  it('airborne fighter (y < GROUND_Y - 20): collision skipped', () => {
    const f1 = makeFighter(240, GROUND_Y - 30); // airborne
    const f2 = makeFighter(245, GROUND_Y);
    resolveBodyCollision(f1, f2);
    expect(f1.sprite.x).toBe(240);
    expect(f2.sprite.x).toBe(245);
  });
});
