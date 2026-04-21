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
    // Shape: calibrations[fighterId][category][animation] = { frameCount, frames, keyframes, lastEditedAt }
    this.calibrations = m.calibrations ?? {};
  }

  has(fighterId, category, animation) {
    return Boolean(this.calibrations?.[fighterId]?.[category]?.[animation]);
  }

  get(fighterId, category, animation) {
    const e = this.calibrations?.[fighterId]?.[category]?.[animation];
    return e ?? null;
  }

  set(fighterId, category, animation, entry) {
    if (!this.calibrations[fighterId]) this.calibrations[fighterId] = {};
    if (!this.calibrations[fighterId][category]) this.calibrations[fighterId][category] = {};
    this.calibrations[fighterId][category][animation] = {
      frameCount: entry.frameCount,
      frames: entry.frames.map(cloneFrame),
      keyframes: [...(entry.keyframes ?? [])].sort((a, b) => a - b),
      lastEditedAt: entry.lastEditedAt ?? new Date().toISOString(),
    };
    this.updatedAt = new Date().toISOString();
  }

  delete(fighterId, category, animation) {
    const byCat = this.calibrations[fighterId];
    if (!byCat?.[category]?.[animation]) return;
    delete byCat[category][animation];
    if (Object.keys(byCat[category]).length === 0) delete byCat[category];
    if (Object.keys(byCat).length === 0) delete this.calibrations[fighterId];
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
