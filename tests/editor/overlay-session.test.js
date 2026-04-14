import { describe, expect, it } from 'vitest';
import { _internals, OverlaySession } from '../../src/editor/OverlaySession.js';

function makeSession(overrides = {}) {
  return new OverlaySession({
    fighterId: 'cata',
    accessoryId: 'sombrero_catalina',
    animation: 'walk',
    frameCount: 4,
    ...overrides,
  });
}

describe('OverlaySession — construction', () => {
  it('initializes every frame to the default transform', () => {
    const s = makeSession();
    expect(s.frames).toHaveLength(4);
    for (const f of s.frames) {
      expect(f).toEqual({ x: 64, y: 32, rotation: 0, scale: 0.5 });
    }
  });

  it('starts with no keyframes', () => {
    expect(makeSession().keyframes).toEqual([]);
  });

  it('throws on missing identity fields', () => {
    expect(
      () => new OverlaySession({ accessoryId: 'a', animation: 'walk', frameCount: 4 }),
    ).toThrow(/fighterId/);
    expect(() => new OverlaySession({ fighterId: 'c', animation: 'walk', frameCount: 4 })).toThrow(
      /accessoryId/,
    );
    expect(() => new OverlaySession({ fighterId: 'c', accessoryId: 'a', frameCount: 4 })).toThrow(
      /animation/,
    );
  });

  it('rejects non-positive frameCount', () => {
    expect(() => makeSession({ frameCount: 0 })).toThrow(/frameCount/);
    expect(() => makeSession({ frameCount: -1 })).toThrow(/frameCount/);
    expect(() => makeSession({ frameCount: 2.5 })).toThrow(/frameCount/);
  });

  it('sorts provided keyframes', () => {
    const s = makeSession({ keyframes: [3, 0, 2] });
    expect(s.keyframes).toEqual([0, 2, 3]);
  });
});

describe('OverlaySession — applyTransform', () => {
  it('merges partial delta into the target frame', () => {
    const s = makeSession();
    s.applyTransform(0, { x: 5, rotation: 0.1 });
    expect(s.frames[0]).toEqual({ x: 69, y: 32, rotation: 0.1, scale: 0.5 });
  });

  it('clamps scale within [SCALE_MIN, SCALE_MAX]', () => {
    const s = makeSession();
    s.applyTransform(0, { scale: 100 });
    expect(s.frames[0].scale).toBe(_internals.SCALE_MAX);
    s.applyTransform(0, { scale: -100 });
    expect(s.frames[0].scale).toBe(_internals.SCALE_MIN);
  });

  it('does not mutate other frames', () => {
    const s = makeSession();
    s.applyTransform(1, { x: 10 });
    expect(s.frames[0]).toEqual({ x: 64, y: 32, rotation: 0, scale: 0.5 });
    expect(s.frames[2]).toEqual({ x: 64, y: 32, rotation: 0, scale: 0.5 });
    expect(s.frames[1].x).toBe(74);
  });

  it('rejects out-of-range frame indices', () => {
    const s = makeSession();
    expect(() => s.applyTransform(-1, {})).toThrow(/out of range/);
    expect(() => s.applyTransform(4, {})).toThrow(/out of range/);
    expect(() => s.applyTransform(1.5, {})).toThrow(/out of range/);
  });
});

describe('OverlaySession — setTransform and resetFrame', () => {
  it('setTransform replaces the frame wholesale', () => {
    const s = makeSession();
    s.setTransform(2, { x: 10, y: 20, rotation: 1, scale: 0.3 });
    expect(s.frames[2]).toEqual({ x: 10, y: 20, rotation: 1, scale: 0.3 });
  });

  it('setTransform also clamps scale', () => {
    const s = makeSession();
    s.setTransform(0, { x: 0, y: 0, rotation: 0, scale: 99 });
    expect(s.frames[0].scale).toBe(_internals.SCALE_MAX);
  });

  it('resetFrame restores the default transform', () => {
    const s = makeSession();
    s.setTransform(0, { x: 999, y: 999, rotation: 5, scale: 2 });
    s.resetFrame(0);
    expect(s.frames[0]).toEqual({ x: 64, y: 32, rotation: 0, scale: 0.5 });
  });
});

describe('OverlaySession — keyframes', () => {
  it('toggles in and out of the keyframe set', () => {
    const s = makeSession();
    s.toggleKeyframe(2);
    expect(s.keyframes).toEqual([2]);
    s.toggleKeyframe(0);
    expect(s.keyframes).toEqual([0, 2]);
    s.toggleKeyframe(2);
    expect(s.keyframes).toEqual([0]);
  });
});

describe('OverlaySession — copyFromPrev', () => {
  it('copies transform from the previous frame', () => {
    const s = makeSession();
    s.setTransform(0, { x: 99, y: 99, rotation: 1, scale: 0.9 });
    s.copyFromPrev(1);
    expect(s.frames[1]).toEqual({ x: 99, y: 99, rotation: 1, scale: 0.9 });
  });

  it('is a no-op on frame 0', () => {
    const s = makeSession();
    const before = { ...s.frames[0] };
    s.copyFromPrev(0);
    expect(s.frames[0]).toEqual(before);
    expect(s.undoStack).toHaveLength(0); // no-op shouldn't pollute undo
  });
});

describe('OverlaySession — interpolate', () => {
  it('is a no-op with zero keyframes', () => {
    const s = makeSession();
    s.setTransform(1, { x: 100, y: 0, rotation: 0, scale: 0.5 });
    s.interpolate();
    expect(s.frames[1].x).toBe(100);
  });

  it('broadcasts a single keyframe to every other frame', () => {
    const s = makeSession();
    s.setTransform(1, { x: 20, y: 10, rotation: 1, scale: 0.7 });
    s.toggleKeyframe(1);
    s.interpolate();
    for (let i = 0; i < s.frameCount; i++) {
      expect(s.frames[i]).toEqual({ x: 20, y: 10, rotation: 1, scale: 0.7 });
    }
  });

  it('linearly interpolates x/y/scale between two keyframes', () => {
    const s = makeSession();
    s.setTransform(0, { x: 0, y: 0, rotation: 0, scale: 0.2 });
    s.setTransform(2, { x: 20, y: 40, rotation: 0, scale: 0.6 });
    s.toggleKeyframe(0);
    s.toggleKeyframe(2);
    s.interpolate();
    // frame 1 is the midpoint
    expect(s.frames[1].x).toBeCloseTo(10);
    expect(s.frames[1].y).toBeCloseTo(20);
    expect(s.frames[1].scale).toBeCloseTo(0.4);
  });

  it('clamps frames outside the keyframe range to the nearest keyframe', () => {
    const s = makeSession({ frameCount: 5 });
    s.setTransform(1, { x: 10, y: 0, rotation: 0, scale: 0.5 });
    s.setTransform(3, { x: 30, y: 0, rotation: 0, scale: 0.5 });
    s.toggleKeyframe(1);
    s.toggleKeyframe(3);
    s.interpolate();
    expect(s.frames[0].x).toBe(10); // clamped to first keyframe
    expect(s.frames[4].x).toBe(30); // clamped to last keyframe
    expect(s.frames[2].x).toBeCloseTo(20); // midpoint
  });

  it('interpolates rotation along the shortest arc across ±π', () => {
    const s = makeSession();
    const near_pi = Math.PI - 0.1;
    const near_neg_pi = -(Math.PI - 0.1); // equivalent to "just past +π going forward"
    s.setTransform(0, { x: 0, y: 0, rotation: near_pi, scale: 0.5 });
    s.setTransform(2, { x: 0, y: 0, rotation: near_neg_pi, scale: 0.5 });
    s.toggleKeyframe(0);
    s.toggleKeyframe(2);
    s.interpolate();
    // Total arc between the two should be ~0.2 rad (the short way), NOT ~2π - 0.2
    // so the midpoint should be at ±π, not somewhere near 0.
    const mid = s.frames[1].rotation;
    // Normalize to [0, 2π) to compare against π
    const norm = ((mid % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const distanceFromPi = Math.min(Math.abs(norm - Math.PI), Math.abs(norm + Math.PI));
    expect(distanceFromPi).toBeLessThan(0.05);
  });
});

describe('OverlaySession — undo/redo', () => {
  it('restores the previous state on undo', () => {
    const s = makeSession();
    s.applyTransform(0, { x: 5 });
    s.applyTransform(0, { x: 10 });
    expect(s.frames[0].x).toBe(79); // 64 + 5 + 10
    s.undo();
    expect(s.frames[0].x).toBe(69); // back to after first apply
    s.undo();
    expect(s.frames[0].x).toBe(64); // back to initial
  });

  it('redo re-applies an undone mutation', () => {
    const s = makeSession();
    s.applyTransform(0, { x: 5 });
    s.undo();
    s.redo();
    expect(s.frames[0].x).toBe(69);
  });

  it('returns false when there is nothing to undo/redo', () => {
    const s = makeSession();
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
  });

  it('clears the redo stack on any new mutation', () => {
    const s = makeSession();
    s.applyTransform(0, { x: 5 });
    s.undo();
    expect(s.redoStack).toHaveLength(1);
    s.applyTransform(0, { y: 1 });
    expect(s.redoStack).toHaveLength(0);
  });

  it('bounds the undo stack at UNDO_STACK_MAX entries', () => {
    const s = makeSession();
    for (let i = 0; i < _internals.UNDO_STACK_MAX + 10; i++) {
      s.applyTransform(0, { x: 1 });
    }
    expect(s.undoStack.length).toBe(_internals.UNDO_STACK_MAX);
  });
});

describe('OverlaySession — toJSON / fromJSON roundtrip', () => {
  it('preserves frames, keyframes, identity, and timestamps', () => {
    const original = makeSession({ sourceStrip: 'x.png', accessoryImage: 'y.png' });
    original.applyTransform(1, { x: 3, rotation: 0.2 });
    original.toggleKeyframe(0);
    original.toggleKeyframe(2);

    const obj = original.toJSON();
    const restored = OverlaySession.fromJSON(obj);

    expect(restored.fighterId).toBe(original.fighterId);
    expect(restored.accessoryId).toBe(original.accessoryId);
    expect(restored.animation).toBe(original.animation);
    expect(restored.frameCount).toBe(original.frameCount);
    expect(restored.sourceStrip).toBe('x.png');
    expect(restored.accessoryImage).toBe('y.png');
    expect(restored.frames).toEqual(original.frames);
    expect(restored.keyframes).toEqual(original.keyframes);
    expect(restored.lastEditedAt).toBe(original.lastEditedAt);
  });

  it('preserves the undo stack', () => {
    const s = makeSession();
    s.applyTransform(0, { x: 5 });
    s.applyTransform(1, { y: 7 });
    const restored = OverlaySession.fromJSON(s.toJSON());
    expect(restored.undoStack).toHaveLength(2);
    restored.undo();
    expect(restored.frames[1].y).toBe(32); // default
  });
});

describe('shortestArcDelta internals', () => {
  it('returns the short way around the circle', () => {
    const { shortestArcDelta } = _internals;
    expect(shortestArcDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(shortestArcDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    // 170° → -170° is +20°, not -340°
    const r170 = (170 * Math.PI) / 180;
    const rNeg170 = (-170 * Math.PI) / 180;
    expect(shortestArcDelta(r170, rNeg170)).toBeCloseTo((20 * Math.PI) / 180);
  });
});
