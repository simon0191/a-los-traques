/**
 * OverlaySession — editable state for one (fighter × accessory × animation) overlay.
 *
 * Pure logic, no Phaser or DOM dependencies. Produces/consumes JSON that lives
 * at `assets/overlay-editor/sessions/{fighterId}/{accessoryId}_{animation}.json`.
 *
 * See RFC 0018 for the full design.
 */

const UNDO_STACK_MAX = 50;
const SCALE_MIN = 0.05;
const SCALE_MAX = 4;
const TWO_PI = Math.PI * 2;

/** Default transform for a newly-initialized frame. */
function defaultTransform() {
  return { x: 64, y: 32, rotation: 0, scale: 0.5 };
}

/**
 * Return the shortest signed arc from `from` to `to`, in (-π, π].
 * Used so rotation interpolation between e.g. 170° and -170° traverses 20°,
 * not 340°.
 */
function shortestArcDelta(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta <= -Math.PI) delta += TWO_PI;
  return delta;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  return a + shortestArcDelta(a, b) * t;
}

function lerpTransform(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    rotation: lerpAngle(a.rotation, b.rotation, t),
    scale: lerp(a.scale, b.scale, t),
  };
}

function cloneTransform(t) {
  return { x: t.x, y: t.y, rotation: t.rotation, scale: t.scale };
}

function clampScale(s) {
  if (s < SCALE_MIN) return SCALE_MIN;
  if (s > SCALE_MAX) return SCALE_MAX;
  return s;
}

export class OverlaySession {
  constructor({
    fighterId,
    accessoryId,
    animation,
    frameCount,
    sourceStrip = null,
    accessoryImage = null,
    frames = null,
    keyframes = null,
    undoStack = null,
    lastEditedAt = null,
  }) {
    if (!fighterId) throw new Error('fighterId required');
    if (!accessoryId) throw new Error('accessoryId required');
    if (!animation) throw new Error('animation required');
    if (!Number.isInteger(frameCount) || frameCount < 1) {
      throw new Error('frameCount must be a positive integer');
    }

    this.fighterId = fighterId;
    this.accessoryId = accessoryId;
    this.animation = animation;
    this.frameCount = frameCount;
    this.sourceStrip = sourceStrip;
    this.accessoryImage = accessoryImage;
    this.frames = frames
      ? frames.map(cloneTransform)
      : Array.from({ length: frameCount }, defaultTransform);
    this.keyframes = keyframes ? [...keyframes].sort((a, b) => a - b) : [];
    this.undoStack = undoStack
      ? undoStack.map((s) => ({
          frames: s.frames.map(cloneTransform),
          keyframes: [...s.keyframes],
        }))
      : [];
    this.redoStack = [];
    this.lastEditedAt = lastEditedAt ?? new Date().toISOString();
  }

  /** Merge a partial transform delta into a frame; pushes previous state onto undo. */
  applyTransform(frameIndex, delta) {
    this._assertFrame(frameIndex);
    this._pushUndo();
    const prev = this.frames[frameIndex];
    this.frames[frameIndex] = {
      x: prev.x + (delta.x ?? 0),
      y: prev.y + (delta.y ?? 0),
      rotation: prev.rotation + (delta.rotation ?? 0),
      scale: clampScale(prev.scale + (delta.scale ?? 0)),
    };
    this._touch();
  }

  /** Replace a frame's transform wholesale; pushes previous state onto undo. */
  setTransform(frameIndex, transform) {
    this._assertFrame(frameIndex);
    this._pushUndo();
    this.frames[frameIndex] = {
      x: transform.x,
      y: transform.y,
      rotation: transform.rotation,
      scale: clampScale(transform.scale),
    };
    this._touch();
  }

  /** Reset a frame to the default transform; pushes previous state onto undo. */
  resetFrame(frameIndex) {
    this._assertFrame(frameIndex);
    this._pushUndo();
    this.frames[frameIndex] = defaultTransform();
    this._touch();
  }

  /** Toggle whether `frameIndex` is a keyframe. */
  toggleKeyframe(frameIndex) {
    this._assertFrame(frameIndex);
    this._pushUndo();
    const idx = this.keyframes.indexOf(frameIndex);
    if (idx >= 0) {
      this.keyframes.splice(idx, 1);
    } else {
      this.keyframes.push(frameIndex);
      this.keyframes.sort((a, b) => a - b);
    }
    this._touch();
  }

  /** Copy the transform from frame `frameIndex - 1` onto `frameIndex` (no-op on frame 0). */
  copyFromPrev(frameIndex) {
    this._assertFrame(frameIndex);
    if (frameIndex === 0) return;
    this._pushUndo();
    this.frames[frameIndex] = cloneTransform(this.frames[frameIndex - 1]);
    this._touch();
  }

  /**
   * Fill non-keyframe frames via linear interpolation between surrounding keyframes.
   *
   * - 0 keyframes → no-op
   * - 1 keyframe  → broadcast that transform to every frame
   * - 2+          → lerp between each adjacent pair; rotation uses shortest-arc;
   *                 frames outside the keyframe range clamp to the nearest keyframe.
   */
  interpolate() {
    if (this.keyframes.length === 0) return;
    this._pushUndo();

    if (this.keyframes.length === 1) {
      const kf = this.keyframes[0];
      const t = cloneTransform(this.frames[kf]);
      for (let i = 0; i < this.frameCount; i++) {
        if (i !== kf) this.frames[i] = cloneTransform(t);
      }
      this._touch();
      return;
    }

    const kfs = this.keyframes;
    // Clamp frames before the first keyframe
    const first = kfs[0];
    for (let i = 0; i < first; i++) {
      this.frames[i] = cloneTransform(this.frames[first]);
    }
    // Clamp frames after the last keyframe
    const last = kfs[kfs.length - 1];
    for (let i = last + 1; i < this.frameCount; i++) {
      this.frames[i] = cloneTransform(this.frames[last]);
    }
    // Interpolate between adjacent keyframe pairs
    for (let p = 0; p < kfs.length - 1; p++) {
      const a = kfs[p];
      const b = kfs[p + 1];
      const span = b - a;
      for (let i = a + 1; i < b; i++) {
        this.frames[i] = lerpTransform(this.frames[a], this.frames[b], (i - a) / span);
      }
    }
    this._touch();
  }

  /** Pop the last mutation off the undo stack; pushes current state onto redo. */
  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
    this._touch();
    return true;
  }

  /** Pop the last undone mutation off the redo stack; pushes current state onto undo. */
  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this._snapshot());
    this._restore(this.redoStack.pop());
    this._touch();
    return true;
  }

  /** Serialize to a plain object suitable for JSON.stringify. */
  toJSON() {
    return {
      fighterId: this.fighterId,
      accessoryId: this.accessoryId,
      animation: this.animation,
      frameCount: this.frameCount,
      sourceStrip: this.sourceStrip,
      accessoryImage: this.accessoryImage,
      frames: this.frames.map(cloneTransform),
      keyframes: [...this.keyframes],
      undoStack: this.undoStack.map((s) => ({
        frames: s.frames.map(cloneTransform),
        keyframes: [...s.keyframes],
      })),
      lastEditedAt: this.lastEditedAt,
    };
  }

  /** Deserialize a plain object produced by `toJSON`. */
  static fromJSON(obj) {
    return new OverlaySession({
      fighterId: obj.fighterId,
      accessoryId: obj.accessoryId,
      animation: obj.animation,
      frameCount: obj.frameCount,
      sourceStrip: obj.sourceStrip,
      accessoryImage: obj.accessoryImage,
      frames: obj.frames,
      keyframes: obj.keyframes,
      undoStack: obj.undoStack,
      lastEditedAt: obj.lastEditedAt,
    });
  }

  // --- internals ---

  _assertFrame(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.frameCount) {
      throw new Error(`frame index out of range: ${i}`);
    }
  }

  _snapshot() {
    return {
      frames: this.frames.map(cloneTransform),
      keyframes: [...this.keyframes],
    };
  }

  _restore(snapshot) {
    this.frames = snapshot.frames.map(cloneTransform);
    this.keyframes = [...snapshot.keyframes];
  }

  _pushUndo() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > UNDO_STACK_MAX) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  _touch() {
    this.lastEditedAt = new Date().toISOString();
  }
}

// Exposed for unit tests; not part of the public API.
export const _internals = {
  defaultTransform,
  shortestArcDelta,
  lerp,
  lerpAngle,
  lerpTransform,
  clampScale,
  UNDO_STACK_MAX,
  SCALE_MIN,
  SCALE_MAX,
};
