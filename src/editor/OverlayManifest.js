/**
 * OverlayManifest — in-memory model of the consolidated overlay calibration
 * file at `public/assets/overlays/manifest.json` (RFC 0018 v2).
 *
 * Replaces the v1 per-combo `sessions/*.json` files. The game loads this
 * single JSON in BootScene to position accessories per fighter.
 */

export const MANIFEST_PATH = 'public/assets/overlays/manifest.json';
export const MANIFEST_VERSION = 2;

function emptyManifest() {
  return { version: MANIFEST_VERSION, updatedAt: null, calibrations: {} };
}

function cloneFrame(f) {
  return { x: f.x, y: f.y, rotation: f.rotation, scale: f.scale };
}

export class OverlayManifest {
  constructor(data = null) {
    const m = data ?? emptyManifest();
    this.version = m.version ?? MANIFEST_VERSION;
    this.updatedAt = m.updatedAt ?? null;
    // Shape: calibrations[fighterId][accessoryId][animation] = { frameCount, frames, keyframes, lastEditedAt }
    this.calibrations = m.calibrations ?? {};
  }

  has(fighterId, accessoryId, animation) {
    return Boolean(this.calibrations?.[fighterId]?.[accessoryId]?.[animation]);
  }

  get(fighterId, accessoryId, animation) {
    const e = this.calibrations?.[fighterId]?.[accessoryId]?.[animation];
    return e ?? null;
  }

  set(fighterId, accessoryId, animation, entry) {
    if (!this.calibrations[fighterId]) this.calibrations[fighterId] = {};
    if (!this.calibrations[fighterId][accessoryId]) this.calibrations[fighterId][accessoryId] = {};
    this.calibrations[fighterId][accessoryId][animation] = {
      frameCount: entry.frameCount,
      frames: entry.frames.map(cloneFrame),
      keyframes: [...(entry.keyframes ?? [])].sort((a, b) => a - b),
      lastEditedAt: entry.lastEditedAt ?? new Date().toISOString(),
    };
    this.updatedAt = new Date().toISOString();
  }

  delete(fighterId, accessoryId, animation) {
    const byAcc = this.calibrations[fighterId];
    if (!byAcc?.[accessoryId]?.[animation]) return;
    delete byAcc[accessoryId][animation];
    if (Object.keys(byAcc[accessoryId]).length === 0) delete byAcc[accessoryId];
    if (Object.keys(byAcc).length === 0) delete this.calibrations[fighterId];
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      version: this.version,
      updatedAt: this.updatedAt,
      calibrations: this.calibrations,
    };
  }

  static fromJSON(obj) {
    return new OverlayManifest(obj);
  }
}
