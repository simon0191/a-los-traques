import { describe, expect, it } from 'vitest';
import { resolveOverlayTransform } from '../../src/entities/overlay-transform.js';

// Defaults that mirror the shipped fighter dimensions so the test exercises the
// same numbers the runtime uses.
const BASE = {
  fighterWidth: 128,
  fighterHeight: 128,
  accessoryWidth: 128,
};

function makeArgs(overrides = {}) {
  return {
    cal: { x: 64, y: 32, rotation: 0, scale: 1 },
    fighterX: 240,
    fighterY: 220,
    facingRight: true,
    ...BASE,
    ...overrides,
  };
}

describe('resolveOverlayTransform', () => {
  it('places the overlay center at the calibrated frame-local coords when facing right', () => {
    // fighterX=240 is sprite center; sprite origin is bottom-center, so the
    // frame's top-left sits at (240-64, 220-128) = (176, 92). Calibration
    // (64, 32) should put the overlay center at (176+64, 92+32) = (240, 124).
    const out = resolveOverlayTransform(makeArgs());
    expect(out.x).toBe(240);
    expect(out.y).toBe(124);
    expect(out.rotation).toBe(0);
    expect(out.scale).toBe(1); // overlayBaseWidth(128, 1) / 128 = 1
  });

  it('mirrors x around the fighter center when facing left', () => {
    // Shift the head-anchor off-center so mirroring is observable.
    const right = resolveOverlayTransform(
      makeArgs({ cal: { x: 50, y: 30, rotation: 0, scale: 1 } }),
    );
    const left = resolveOverlayTransform(
      makeArgs({ cal: { x: 50, y: 30, rotation: 0, scale: 1 }, facingRight: false }),
    );
    // Both overlays are equidistant from fighterX on opposite sides.
    expect(right.x).toBe(240 + (50 - 64)); // 226
    expect(left.x).toBe(240 + (64 - 50)); // 254
    // Y does not flip with facing direction.
    expect(left.y).toBe(right.y);
  });

  it('negates rotation when facing left so the mirrored sprite tilts the correct way', () => {
    const cal = { x: 64, y: 32, rotation: 0.5, scale: 1 };
    const right = resolveOverlayTransform(makeArgs({ cal }));
    const left = resolveOverlayTransform(makeArgs({ cal, facingRight: false }));
    expect(right.rotation).toBe(0.5);
    expect(left.rotation).toBe(-0.5);
  });

  it('computes scale from fighterHeight × cal.scale ÷ accessoryWidth', () => {
    // Accessory smaller than a frame: should render at >1× scale so it covers
    // the calibrated base width.
    const out = resolveOverlayTransform(makeArgs({ accessoryWidth: 64 }));
    expect(out.scale).toBe(2); // 128 × 1 / 64

    // Calibrated half-size on a native-size PNG.
    const half = resolveOverlayTransform(
      makeArgs({ cal: { x: 64, y: 32, rotation: 0, scale: 0.5 } }),
    );
    expect(half.scale).toBe(0.5); // 128 × 0.5 / 128
  });

  it('accounts for fighterHeight when positioning vertically', () => {
    // With fighterHeight=100, the frame's top is at fighterY-100. cal.y=25
    // should land 25 px below the top, i.e. fighterY-75.
    const out = resolveOverlayTransform(
      makeArgs({ cal: { x: 64, y: 25, rotation: 0, scale: 1 }, fighterHeight: 100 }),
    );
    expect(out.y).toBe(220 - 75);
  });

  it('returns null when the calibration is missing', () => {
    expect(resolveOverlayTransform(makeArgs({ cal: null }))).toBeNull();
    expect(resolveOverlayTransform(makeArgs({ cal: undefined }))).toBeNull();
  });

  it('returns null when accessory width is zero or missing', () => {
    expect(resolveOverlayTransform(makeArgs({ accessoryWidth: 0 }))).toBeNull();
    expect(resolveOverlayTransform(makeArgs({ accessoryWidth: undefined }))).toBeNull();
  });

  it('is symmetric: a centered anchor stays centered regardless of facing', () => {
    const right = resolveOverlayTransform(
      makeArgs({ cal: { x: 64, y: 32, rotation: 0, scale: 1 } }),
    );
    const left = resolveOverlayTransform(
      makeArgs({ cal: { x: 64, y: 32, rotation: 0, scale: 1 }, facingRight: false }),
    );
    expect(left.x).toBe(right.x);
  });
});
