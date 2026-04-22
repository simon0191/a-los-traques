import { describe, expect, it } from 'vitest';
import {
  MANIFEST_VERSION,
  OverlayManifest,
} from '../../packages/game/src/editor/OverlayManifest.js';

function makeEntry(overrides = {}) {
  return {
    frameCount: 4,
    frames: [
      { x: 64, y: 32, rotation: 0, scale: 0.5 },
      { x: 65, y: 33, rotation: 0.1, scale: 0.55 },
      { x: 66, y: 34, rotation: 0.2, scale: 0.6 },
      { x: 67, y: 35, rotation: 0.3, scale: 0.65 },
    ],
    keyframes: [0, 3],
    ...overrides,
  };
}

describe('OverlayManifest', () => {
  it('initializes empty', () => {
    const m = new OverlayManifest();
    expect(m.version).toBe(MANIFEST_VERSION);
    expect(m.calibrations).toEqual({});
  });

  it('round-trips through JSON preserving entries', () => {
    const m = new OverlayManifest();
    m.set('simon', 'sombrero_catalina', 'idle', makeEntry());
    const roundtripped = OverlayManifest.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(roundtripped.get('simon', 'sombrero_catalina', 'idle')).toMatchObject({
      frameCount: 4,
      keyframes: [0, 3],
    });
  });

  it('has() reports calibration presence by (fighter, accessory, anim)', () => {
    const m = new OverlayManifest();
    expect(m.has('simon', 'hat', 'idle')).toBe(false);
    m.set('simon', 'hat', 'idle', makeEntry());
    expect(m.has('simon', 'hat', 'idle')).toBe(true);
    expect(m.has('simon', 'hat', 'walk')).toBe(false);
    expect(m.has('alv', 'hat', 'idle')).toBe(false);
  });

  it('set() sorts keyframes and clones frames', () => {
    const m = new OverlayManifest();
    const entry = makeEntry({ keyframes: [3, 1, 0] });
    m.set('s', 'h', 'idle', entry);
    const stored = m.get('s', 'h', 'idle');
    expect(stored.keyframes).toEqual([0, 1, 3]);
    // mutating the source entry must not affect the stored copy
    entry.frames[0].x = 999;
    expect(m.get('s', 'h', 'idle').frames[0].x).toBe(64);
  });

  it('set() bumps updatedAt', async () => {
    const m = new OverlayManifest();
    expect(m.updatedAt).toBeNull();
    m.set('s', 'h', 'idle', makeEntry());
    expect(typeof m.updatedAt).toBe('string');
  });

  it('delete() removes an entry and prunes empty parents', () => {
    const m = new OverlayManifest();
    m.set('s', 'h', 'idle', makeEntry());
    m.set('s', 'h', 'walk', makeEntry());
    m.delete('s', 'h', 'idle');
    expect(m.has('s', 'h', 'idle')).toBe(false);
    expect(m.has('s', 'h', 'walk')).toBe(true);
    m.delete('s', 'h', 'walk');
    expect(m.calibrations.s).toBeUndefined();
  });

  it('delete() is a no-op on missing entries', () => {
    const m = new OverlayManifest();
    expect(() => m.delete('nope', 'h', 'idle')).not.toThrow();
  });

  it('accepts a legacy v1 object and preserves empty calibrations', () => {
    const m = OverlayManifest.fromJSON({ version: 1, entries: [] });
    expect(m.version).toBe(1);
    expect(m.calibrations).toEqual({});
    expect(m.has('x', 'y', 'z')).toBe(false);
  });
});
