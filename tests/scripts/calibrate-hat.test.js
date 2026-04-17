import { describe, expect, it } from 'vitest';
import {
  _internals,
  anchorFromKeypoints,
  calibrateAnimation,
  calibrateCategoryForFighter,
  computeUniformScale,
} from '../../scripts/asset-pipeline/overlays/calibrate-hat.js';

const { FIGHTER_HEIGHT, SOMBRERO_WIDTH_RATIO, GAFAS_WIDTH_RATIO, SOMBRERO_HEAD_OVERLAP_PX } =
  _internals;

// Synthetic frame matching the poses.json shape produced by the MediaPipe
// pipeline: keypoints with {x, y, v}, derived head/torso/hand/foot.
function makeFrame({ detected = true, overrides = {} } = {}) {
  const base = {
    index: 0,
    detected,
    avgVisibility: 0.99,
    keypoints: {
      nose: { x: 64, y: 20, v: 1 },
      leftEye: { x: 66, y: 18, v: 1 },
      rightEye: { x: 62, y: 18, v: 1 },
      leftEar: { x: 68, y: 19, v: 1 },
      rightEar: { x: 60, y: 19, v: 1 },
      leftShoulder: { x: 76, y: 36, v: 1 },
      rightShoulder: { x: 52, y: 36, v: 1 },
      ...(overrides.keypoints ?? {}),
    },
    derived: {
      head: { center: { x: 64, y: 19 }, roll: 0, yaw: 0, pitch: 0 },
    },
  };
  if (!detected) base.derived = null;
  return { ...base, ...overrides, keypoints: base.keypoints, derived: base.derived };
}

function makeAnim(frames, frameCount = frames.length) {
  return { frameCount, frames: frames.map((f, i) => ({ ...f, index: i })) };
}

describe('computeUniformScale', () => {
  it('derives sombrero scale from shoulder width of idle[0]', () => {
    const poses = {
      animations: {
        idle: { frameCount: 1, frames: [makeFrame()] },
      },
    };
    const scale = computeUniformScale(poses, 'sombreros');
    // shoulders 24 apart; 24 * 1.3 / 128
    expect(scale).toBeCloseTo((24 * SOMBRERO_WIDTH_RATIO) / FIGHTER_HEIGHT, 5);
  });

  it('gafas scale uses the narrower width ratio', () => {
    const poses = {
      animations: { idle: { frameCount: 1, frames: [makeFrame()] } },
    };
    const scale = computeUniformScale(poses, 'gafas');
    expect(scale).toBeCloseTo((24 * GAFAS_WIDTH_RATIO) / FIGHTER_HEIGHT, 5);
  });

  it('falls back to a non-idle animation if idle is fully undetected', () => {
    const poses = {
      animations: {
        idle: { frameCount: 1, frames: [makeFrame({ detected: false })] },
        walk: { frameCount: 1, frames: [makeFrame()] },
      },
    };
    const scale = computeUniformScale(poses, 'sombreros');
    expect(scale).toBeGreaterThan(0);
  });

  it('returns a safe default when no frame is detectable', () => {
    const poses = {
      animations: {
        idle: { frameCount: 1, frames: [makeFrame({ detected: false })] },
      },
    };
    const scale = computeUniformScale(poses, 'sombreros');
    expect(scale).toBe(_internals.DEFAULT_SOMBRERO_SCALE);
  });

  it('clamps absurdly small shoulder distances to SCALE_MIN', () => {
    const tiny = makeFrame({
      overrides: {
        keypoints: {
          leftShoulder: { x: 64, y: 36, v: 1 },
          rightShoulder: { x: 64.1, y: 36, v: 1 },
        },
      },
    });
    const scale = computeUniformScale(
      { animations: { idle: { frameCount: 1, frames: [tiny] } } },
      'sombreros',
    );
    expect(scale).toBe(0.05);
  });
});

describe('anchorFromKeypoints — sombreros', () => {
  const uniformScale = 0.3;

  it('anchors x at derived head center', () => {
    const anchor = anchorFromKeypoints(makeFrame(), { category: 'sombreros', uniformScale });
    expect(anchor.x).toBe(64);
  });

  it('y places hat bottom just below the top of head landmarks', () => {
    const anchor = anchorFromKeypoints(makeFrame(), { category: 'sombreros', uniformScale });
    // Top-of-head = min(eye.y) = 18. renderedHeight = 128*0.3*1.0 = 38.4
    // y_center = 18 + 2 - 19.2 = 0.8
    expect(anchor.y).toBeCloseTo(
      18 + SOMBRERO_HEAD_OVERLAP_PX - (FIGHTER_HEIGHT * uniformScale) / 2,
      3,
    );
  });

  it('returns the uniform scale passed in', () => {
    const anchor = anchorFromKeypoints(makeFrame(), { category: 'sombreros', uniformScale });
    expect(anchor.scale).toBe(uniformScale);
  });

  it('returns null for undetected frames', () => {
    const anchor = anchorFromKeypoints(makeFrame({ detected: false }), {
      category: 'sombreros',
      uniformScale,
    });
    expect(anchor).toBeNull();
  });

  it('ignores ear/eye keypoints below the visibility threshold', () => {
    const frame = makeFrame({
      overrides: {
        keypoints: {
          leftEye: { x: 66, y: 18, v: 0.1 }, // below threshold — ignored
          rightEye: { x: 62, y: 18, v: 0.1 }, // below threshold — ignored
          leftEar: { x: 68, y: 19, v: 0.1 },
          rightEar: { x: 60, y: 19, v: 0.1 },
          nose: { x: 64, y: 25, v: 1 },
        },
      },
    });
    const anchor = anchorFromKeypoints(frame, { category: 'sombreros', uniformScale });
    // Only nose visible → top = 25
    expect(anchor.y).toBeCloseTo(
      25 + SOMBRERO_HEAD_OVERLAP_PX - (FIGHTER_HEIGHT * uniformScale) / 2,
      3,
    );
  });
});

describe('anchorFromKeypoints — gafas', () => {
  const uniformScale = 0.15;

  it('anchors y at the eye-line midpoint', () => {
    const anchor = anchorFromKeypoints(makeFrame(), { category: 'gafas', uniformScale });
    expect(anchor.y).toBe(18); // (leftEye.y + rightEye.y) / 2
  });

  it('falls back to nose y if an eye is missing', () => {
    const frame = makeFrame({
      overrides: {
        keypoints: {
          leftEye: { x: 66, y: 18, v: 0.1 },
          rightEye: { x: 62, y: 18, v: 1 },
          nose: { x: 64, y: 22, v: 1 },
        },
      },
    });
    const anchor = anchorFromKeypoints(frame, { category: 'gafas', uniformScale });
    expect(anchor.y).toBe(22);
  });

  it('x at head.center, not the midpoint of the eyes', () => {
    const frame = makeFrame({
      overrides: {
        keypoints: {
          leftEye: { x: 70, y: 18, v: 1 }, // off-center
          rightEye: { x: 60, y: 18, v: 1 },
        },
        derived: { head: { center: { x: 64, y: 19 }, roll: 0, yaw: 0, pitch: 0 } },
      },
    });
    const anchor = anchorFromKeypoints(frame, { category: 'gafas', uniformScale });
    expect(anchor.x).toBe(64);
  });
});

describe('calibrateAnimation', () => {
  const uniformScale = 0.3;
  const fallback = { x: 50, y: 10, rotation: 0, scale: uniformScale };

  it('marks detected frames as keyframes', () => {
    const anim = makeAnim([
      makeFrame(),
      makeFrame({ detected: false }),
      makeFrame(),
      makeFrame({ detected: false }),
    ]);
    const { keyframes } = calibrateAnimation(anim, {
      category: 'sombreros',
      uniformScale,
      fallback,
    });
    expect(keyframes).toEqual([0, 2]);
  });

  it('fills undetected frames with the nearest detected transform (prev preferred)', () => {
    const anim = makeAnim([
      makeFrame({ overrides: { keypoints: { nose: { x: 10, y: 20, v: 1 } } } }),
      makeFrame({ detected: false }),
      makeFrame({ overrides: { keypoints: { nose: { x: 90, y: 20, v: 1 } } } }),
    ]);
    const { frames, keyframes } = calibrateAnimation(anim, {
      category: 'sombreros',
      uniformScale,
      fallback,
    });
    // frame 1 undetected → copies frame 0 (prev)
    expect(frames[1]).toEqual(frames[0]);
    expect(keyframes).toEqual([0, 2]);
  });

  it('uses fallback when no frame in the animation is detected', () => {
    const anim = makeAnim([makeFrame({ detected: false }), makeFrame({ detected: false })]);
    const { frames, keyframes } = calibrateAnimation(anim, {
      category: 'sombreros',
      uniformScale,
      fallback,
    });
    expect(frames[0]).toEqual(fallback);
    expect(frames[1]).toEqual(fallback);
    expect(keyframes).toEqual([]);
  });

  it('emits one frame per source frame', () => {
    const anim = makeAnim([makeFrame(), makeFrame(), makeFrame(), makeFrame(), makeFrame()]);
    const { frameCount, frames } = calibrateAnimation(anim, {
      category: 'sombreros',
      uniformScale,
      fallback,
    });
    expect(frameCount).toBe(5);
    expect(frames).toHaveLength(5);
  });
});

describe('calibrateCategoryForFighter', () => {
  const baseFrame = () => makeFrame();
  const poses = () => ({
    animations: {
      idle: { frameCount: 2, frames: [baseFrame(), baseFrame()] },
      walk: { frameCount: 2, frames: [baseFrame(), baseFrame()] },
      block: {
        frameCount: 2,
        frames: [makeFrame({ detected: false }), makeFrame({ detected: false })],
      },
    },
  });

  it('produces one entry per animation with shared scale', () => {
    const { animations, uniformScale } = calibrateCategoryForFighter({
      fighterId: 'simon',
      category: 'sombreros',
      posesJson: poses(),
    });
    expect(Object.keys(animations)).toEqual(['idle', 'walk', 'block']);
    for (const entry of Object.values(animations)) {
      for (const f of entry.frames) expect(f.scale).toBe(uniformScale);
    }
  });

  it('each entry has frameCount, frames, keyframes, lastEditedAt', () => {
    const { animations } = calibrateCategoryForFighter({
      fighterId: 'simon',
      category: 'sombreros',
      posesJson: poses(),
    });
    const idle = animations.idle;
    expect(idle.frameCount).toBe(2);
    expect(idle.frames).toHaveLength(2);
    expect(idle.keyframes).toEqual([0, 1]);
    expect(typeof idle.lastEditedAt).toBe('string');
  });

  it('fully-undetected animations fall back to the idle[0] anchor', () => {
    const { animations } = calibrateCategoryForFighter({
      fighterId: 'simon',
      category: 'sombreros',
      posesJson: poses(),
    });
    const idleFirst = animations.idle.frames[0];
    const blockFirst = animations.block.frames[0];
    expect(blockFirst).toEqual({
      x: idleFirst.x,
      y: idleFirst.y,
      rotation: idleFirst.rotation,
      scale: idleFirst.scale,
    });
    expect(animations.block.keyframes).toEqual([]);
  });

  it('rejects unsupported categories', () => {
    expect(() =>
      calibrateCategoryForFighter({
        fighterId: 'simon',
        category: 'pulseras',
        posesJson: poses(),
      }),
    ).toThrow(/unsupported category/);
  });

  it('honors a uniformScale override', () => {
    const { animations, uniformScale } = calibrateCategoryForFighter({
      fighterId: 'simon',
      category: 'sombreros',
      posesJson: poses(),
      uniformScale: 0.42,
    });
    expect(uniformScale).toBe(0.42);
    expect(animations.idle.frames[0].scale).toBe(0.42);
  });
});
