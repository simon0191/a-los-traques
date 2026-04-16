import { describe, expect, it } from 'vitest';
import { computeDerived } from '../../scripts/asset-pipeline/pose/orientations.js';

const V = 0.9;

function kp(overrides = {}) {
  const base = {
    nose: { x: 70, y: 30, v: V },
    leftEye: { x: 60, y: 30, v: V },
    rightEye: { x: 80, y: 30, v: V },
    leftEar: { x: 55, y: 32, v: V },
    rightEar: { x: 85, y: 32, v: V },
    leftShoulder: { x: 50, y: 80, v: V },
    rightShoulder: { x: 90, y: 80, v: V },
    leftElbow: { x: 40, y: 100, v: V },
    rightElbow: { x: 100, y: 100, v: V },
    leftWrist: { x: 30, y: 120, v: V },
    rightWrist: { x: 110, y: 120, v: V },
    leftIndex: { x: 30, y: 130, v: V },
    rightIndex: { x: 110, y: 130, v: V },
    leftHip: { x: 55, y: 140, v: V },
    rightHip: { x: 85, y: 140, v: V },
    leftKnee: { x: 55, y: 180, v: V },
    rightKnee: { x: 85, y: 180, v: V },
    leftAnkle: { x: 55, y: 220, v: V },
    rightAnkle: { x: 85, y: 220, v: V },
    leftHeel: { x: 55, y: 224, v: V },
    rightHeel: { x: 85, y: 224, v: V },
    leftFootIndex: { x: 70, y: 226, v: V },
    rightFootIndex: { x: 100, y: 226, v: V },
  };
  return { ...base, ...overrides };
}

describe('computeDerived', () => {
  it('returns null for null keypoints', () => {
    expect(computeDerived(null)).toBeNull();
  });

  it('head roll is 0 when eyes are level', () => {
    const d = computeDerived(kp());
    expect(d.head.roll).toBe(0);
  });

  it('head roll is positive when right eye is higher (image y smaller)', () => {
    const d = computeDerived(
      kp({
        leftEye: { x: 60, y: 30, v: V },
        rightEye: { x: 80, y: 20, v: V },
      }),
    );
    expect(d.head.roll).toBeCloseTo(26.6, 1);
  });

  it('head roll is negative when right eye is lower', () => {
    const d = computeDerived(
      kp({
        leftEye: { x: 60, y: 30, v: V },
        rightEye: { x: 80, y: 40, v: V },
      }),
    );
    expect(d.head.roll).toBeCloseTo(-26.6, 1);
  });

  it('head yaw is 0 when nose is centered on eye midpoint', () => {
    const d = computeDerived(kp());
    expect(d.head.yaw).toBe(0);
  });

  it('head yaw is positive when nose is right of eye midpoint', () => {
    const d = computeDerived(kp({ nose: { x: 75, y: 30, v: V } }));
    expect(d.head.yaw).toBeGreaterThan(0);
  });

  it('head center is the midpoint of the eyes', () => {
    const d = computeDerived(kp());
    expect(d.head.center).toEqual({ x: 70, y: 30 });
  });

  it('torso angle is 90 when fully upright', () => {
    const d = computeDerived(kp());
    expect(d.torso.angle).toBe(90);
  });

  it('torso angle is less than 90 when leaning right', () => {
    const d = computeDerived(
      kp({
        leftShoulder: { x: 70, y: 80, v: V },
        rightShoulder: { x: 110, y: 80, v: V },
      }),
    );
    expect(d.torso.angle).toBeLessThan(90);
    expect(d.torso.angle).toBeGreaterThan(0);
  });

  it('hand angle is 90 when index is directly above wrist', () => {
    const d = computeDerived(
      kp({
        rightWrist: { x: 110, y: 120, v: V },
        rightIndex: { x: 110, y: 100, v: V },
      }),
    );
    expect(d.rightHand.angle).toBe(90);
  });

  it('hand angle is 0 when index is directly right of wrist', () => {
    const d = computeDerived(
      kp({
        rightWrist: { x: 64, y: 64, v: V },
        rightIndex: { x: 84, y: 64, v: V },
      }),
    );
    expect(d.rightHand.angle).toBe(0);
  });

  it('foot angle is 0 when toe points right (horizontal foot)', () => {
    const d = computeDerived(
      kp({
        rightHeel: { x: 85, y: 224, v: V },
        rightFootIndex: { x: 105, y: 224, v: V },
      }),
    );
    expect(d.rightFoot.angle).toBe(0);
  });

  it('skips head when eye visibility is below threshold', () => {
    const d = computeDerived(
      kp({
        leftEye: { x: 60, y: 30, v: 0.1 },
      }),
    );
    expect(d.head).toBeNull();
  });

  it('falls back to elbow→wrist for hand angle when index is low-vis', () => {
    const d = computeDerived(
      kp({
        rightElbow: { x: 110, y: 100, v: V },
        rightWrist: { x: 110, y: 120, v: V },
        rightIndex: { x: 110, y: 130, v: 0.1 },
      }),
    );
    expect(d.rightHand.angle).toBe(-90);
  });

  it('honors custom minVisibility', () => {
    const d = computeDerived(
      kp({
        leftEye: { x: 60, y: 30, v: 0.5 },
      }),
      0.6,
    );
    expect(d.head).toBeNull();
  });

  it('hand returns null when wrist is not visible', () => {
    const d = computeDerived(
      kp({
        rightWrist: { x: 110, y: 120, v: 0.1 },
      }),
    );
    expect(d.rightHand).toBeNull();
  });
});
