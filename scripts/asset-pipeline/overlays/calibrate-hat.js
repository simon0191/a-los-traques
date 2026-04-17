/**
 * Pure calibration logic that turns a fighter's `poses.json` into seeded
 * overlay-manifest entries (RFC 0018 v2). No file I/O, no Phaser — lives
 * under scripts/ so it can be unit-tested against fixtures.
 *
 * The overlay manifest stores calibrations per (fighter, accessory category,
 * animation). Scale is nominally per-frame but the editor enforces a single
 * value across every frame of every animation for a given (fighter, category).
 * We honor that constraint by computing scale once from idle[0] (or the
 * earliest-available detected frame) and broadcasting it.
 *
 * See CLAUDE.md § "Accessory calibration" for caller docs.
 */

const FIGHTER_HEIGHT = 128;

// Rendered-width target relative to shoulder distance. Shoulders are used
// instead of ears because MediaPipe clusters both ears on the visible side
// of the face in 3/4-view sprites, giving an unreliable ~3 px span.
const SOMBRERO_WIDTH_RATIO = 1.3;
const GAFAS_WIDTH_RATIO = 0.85;

// Sombreros are placed so the bottom edge sits just below the top of the
// head; this small overlap reads as "snug on the head" rather than floating.
const SOMBRERO_HEAD_OVERLAP_PX = 2;

// Assumed rendered aspect ratio (height / width) when we don't know the exact
// accessory PNG. Sombreros in the catalog are ~1:1 (one is 1.25:1); gafas are
// slightly taller than wide. Calibrations that don't match reality perfectly
// are expected — the editor is where the user tunes.
const SOMBRERO_ASPECT = 1.0;
const GAFAS_ASPECT = 1.1;

// Visibility below this is treated as "unreliable" for keypoint lookup.
const VIS_THRESHOLD = 0.3;

// Editor-wide floor/ceiling for scale. Mirrors OverlaySession SCALE_MIN/MAX.
const SCALE_MIN = 0.05;
const SCALE_MAX = 4;

const DEFAULT_SOMBRERO_SCALE = 0.3;
const DEFAULT_GAFAS_SCALE = 0.2;
const DEFAULT_TRANSFORM = { x: 64, y: 32, rotation: 0, scale: DEFAULT_SOMBRERO_SCALE };

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function visible(kp) {
  return kp && typeof kp.x === 'number' && typeof kp.y === 'number' && (kp.v ?? 1) >= VIS_THRESHOLD;
}

/** Average two points; returns null if either is missing/invisible. */
function midpoint(a, b) {
  if (!visible(a) || !visible(b)) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Euclidean distance between two keypoints; null if either is invalid. */
function distance(a, b) {
  if (!visible(a) || !visible(b)) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Tilt (radians) of the eye line in the fighter's sprite, matching Phaser's
 * `setRotation` convention (y-down; positive rotates the sprite's +x axis
 * downward in screen — i.e. clockwise visually).
 *
 * Pose keypoints are subject-relative: `leftEye` is the subject's own left
 * eye, which lives on the viewer's right side of a facing-right sprite. So
 * the screen-x axis runs from `rightEye` (viewer-left) to `leftEye`
 * (viewer-right). When the subject tilts their head toward their own left
 * shoulder (clockwise from the viewer's perspective), `leftEye` drops — its
 * y grows. That yields a positive rotation, which is what we want.
 *
 * Returns null if either eye is occluded.
 */
function eyeLineRotation(kp) {
  if (!visible(kp?.leftEye) || !visible(kp?.rightEye)) return null;
  return Math.atan2(kp.leftEye.y - kp.rightEye.y, kp.leftEye.x - kp.rightEye.x);
}

/**
 * Lowest y across visible face landmarks — approximates "top of head" better
 * than head.center because it tracks the actual eyeline/hairline rather than
 * the average of all face points.
 */
function headTopY(keypoints) {
  const candidates = ['leftEye', 'rightEye', 'leftEar', 'rightEar', 'nose']
    .map((k) => keypoints[k])
    .filter(visible)
    .map((k) => k.y);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/**
 * Compute the category-uniform scale for a fighter from the earliest detected
 * frame in the poses file. Falls back to category-specific default.
 *
 * @param {object} posesJson the fighter's poses.json
 * @param {'sombreros'|'gafas'} category
 */
export function computeUniformScale(posesJson, category) {
  const ratio = category === 'gafas' ? GAFAS_WIDTH_RATIO : SOMBRERO_WIDTH_RATIO;
  const defaultScale = category === 'gafas' ? DEFAULT_GAFAS_SCALE : DEFAULT_SOMBRERO_SCALE;

  const anims = posesJson?.animations ?? {};
  // Idle first so the scale matches the sprite's neutral pose.
  const animOrder = ['idle', ...Object.keys(anims).filter((k) => k !== 'idle')];

  for (const animName of animOrder) {
    const anim = anims[animName];
    if (!anim?.frames) continue;
    for (const frame of anim.frames) {
      if (!frame.detected) continue;
      const shoulderWidth = distance(frame.keypoints?.leftShoulder, frame.keypoints?.rightShoulder);
      if (shoulderWidth && shoulderWidth > 0) {
        return clamp((shoulderWidth * ratio) / FIGHTER_HEIGHT, SCALE_MIN, SCALE_MAX);
      }
    }
  }
  return defaultScale;
}

/**
 * Compute the per-frame anchor transform for one pose frame.
 *
 * @param {object} frame one entry from `animations[name].frames`
 * @param {object} opts
 * @param {'sombreros'|'gafas'} opts.category
 * @param {number} opts.uniformScale the (fighter, category) shared scale
 * @returns {{x, y, rotation, scale}|null} null if the frame can't be anchored
 */
export function anchorFromKeypoints(frame, { category, uniformScale }) {
  if (!frame?.detected) return null;
  const kp = frame.keypoints ?? {};
  const derivedHead = frame.derived?.head?.center;
  const x = derivedHead?.x ?? kp.nose?.x;
  if (typeof x !== 'number') return null;

  const renderedWidth = FIGHTER_HEIGHT * uniformScale;

  if (category === 'gafas') {
    // Center on the eye line so glasses sit across the eyes. Fall back to
    // nose y if an eye is occluded, or head.center.y as a last resort.
    const eyeMid = midpoint(kp.leftEye, kp.rightEye);
    const y = eyeMid?.y ?? kp.nose?.y ?? derivedHead?.y;
    if (typeof y !== 'number') return null;
    // Tilt with the head when both eyes are visible.
    const rotation = eyeLineRotation(kp) ?? 0;
    return { x, y, rotation, scale: uniformScale };
  }

  // sombreros: place the center of the hat so its bottom edge sits just
  // below the top of the head (~2 px overlap). Rendered height depends on
  // aspect ratio, so we subtract half the expected rendered height.
  const renderedHeight = renderedWidth * SOMBRERO_ASPECT;
  const top = headTopY(kp);
  if (typeof top !== 'number') return null;
  const y = top + SOMBRERO_HEAD_OVERLAP_PX - renderedHeight / 2;
  return { x, y, rotation: 0, scale: uniformScale };
}

/** Find the transform of the nearest detected frame, preferring earlier. */
function nearestDetected(frames, idx) {
  for (let d = 1; d < frames.length; d++) {
    if (idx - d >= 0 && frames[idx - d]._transform) return frames[idx - d]._transform;
    if (idx + d < frames.length && frames[idx + d]._transform) return frames[idx + d]._transform;
  }
  return null;
}

/**
 * Calibrate a single animation into `{frameCount, frames, keyframes}` ready
 * to merge into the manifest.
 *
 * @param {object} animation `posesJson.animations[name]`
 * @param {object} opts
 * @param {'sombreros'|'gafas'} opts.category
 * @param {number} opts.uniformScale
 * @param {{x,y,rotation,scale}} opts.fallback transform when no frame in this
 *   animation is detectable (e.g. block, hurt). Typically the idle[0] anchor.
 */
export function calibrateAnimation(animation, { category, uniformScale, fallback }) {
  if (!animation?.frames) throw new Error('animation.frames required');
  const frameCount = animation.frameCount ?? animation.frames.length;

  // First pass: compute per-frame anchor where possible.
  const annotated = animation.frames.map((f) => ({
    _frame: f,
    _transform: anchorFromKeypoints(f, { category, uniformScale }),
  }));

  // Second pass: fill undetected frames with nearest detected, else fallback.
  const frames = annotated.map((a, i) => {
    if (a._transform) return a._transform;
    const nearest = nearestDetected(annotated, i);
    if (nearest) return { ...nearest };
    return { ...fallback };
  });

  // Keyframes mark frames that came from real pose data — the editor's
  // `I` (interpolate) then only rewrites filled frames, preserving seeds.
  const keyframes = annotated.map((a, i) => (a._transform ? i : -1)).filter((i) => i >= 0);

  return { frameCount, frames, keyframes };
}

/**
 * Produce manifest entries for every animation of one (fighter, category).
 * Returns an object whose shape matches
 * `manifest.calibrations[fighterId][category]`.
 *
 * @param {object} opts
 * @param {string} opts.fighterId
 * @param {'sombreros'|'gafas'} opts.category
 * @param {object} opts.posesJson the fighter's poses.json contents
 * @param {string} opts.lastEditedAt ISO timestamp stamped onto every entry
 * @param {number} [opts.uniformScale] override for the computed scale
 */
export function calibrateCategoryForFighter({
  fighterId,
  category,
  posesJson,
  lastEditedAt,
  uniformScale,
}) {
  if (!fighterId) throw new Error('fighterId required');
  if (category !== 'sombreros' && category !== 'gafas') {
    throw new Error(`unsupported category: ${category}`);
  }
  if (!posesJson?.animations) throw new Error('posesJson.animations required');

  const scale = uniformScale ?? computeUniformScale(posesJson, category);

  // Compute the fallback from idle[0] — any fighter-wide animation that fails
  // detection (e.g. knockdown) copies this instead of the center default.
  const idleFrame0 = posesJson.animations.idle?.frames?.[0];
  const fallback = (idleFrame0 &&
    anchorFromKeypoints(idleFrame0, { category, uniformScale: scale })) ?? {
    ...DEFAULT_TRANSFORM,
    scale,
  };

  const stamp = lastEditedAt ?? new Date().toISOString();
  const out = {};
  for (const [animName, anim] of Object.entries(posesJson.animations)) {
    const { frameCount, frames, keyframes } = calibrateAnimation(anim, {
      category,
      uniformScale: scale,
      fallback,
    });
    out[animName] = { frameCount, frames, keyframes, lastEditedAt: stamp };
  }
  return { animations: out, uniformScale: scale };
}

export const _internals = {
  FIGHTER_HEIGHT,
  SOMBRERO_WIDTH_RATIO,
  GAFAS_WIDTH_RATIO,
  SOMBRERO_HEAD_OVERLAP_PX,
  SOMBRERO_ASPECT,
  GAFAS_ASPECT,
  VIS_THRESHOLD,
  DEFAULT_SOMBRERO_SCALE,
  DEFAULT_GAFAS_SCALE,
  DEFAULT_TRANSFORM,
  headTopY,
  distance,
  midpoint,
  eyeLineRotation,
};
