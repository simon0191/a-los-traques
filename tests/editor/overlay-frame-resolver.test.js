import { describe, expect, it, vi } from 'vitest';
import { resolveOverlayFrame } from '../../src/editor/OverlayFrameResolver.js';

/**
 * The frame-index mirroring between the fighter sprite and its overlay
 * sprites is the single point where a silent desync could cause accessories
 * to land on the wrong frame — e.g. if a fighter anim's framerate changes,
 * or if the anim key convention shifts. These tests lock the resolver's
 * behavior so Fighter.js can't drift unnoticed.
 */

const baseInput = () => ({
  fighterId: 'simon',
  accessoryId: 'sombrero_catalina',
  animKey: 'simon_idle',
  frameName: 2,
  textureExists: () => true,
});

describe('resolveOverlayFrame', () => {
  it('returns the fighter-scoped overlay key and the exact frame index', () => {
    const result = resolveOverlayFrame(baseInput());
    expect(result).toEqual({
      overlayKey: 'overlay_simon_sombrero_catalina_idle',
      frameName: 2,
    });
  });

  it('defaults frameName to 0 when the fighter sprite has no named frame yet', () => {
    const result = resolveOverlayFrame({ ...baseInput(), frameName: undefined });
    expect(result).toEqual({
      overlayKey: 'overlay_simon_sombrero_catalina_idle',
      frameName: 0,
    });
  });

  it('strips the fighter prefix from the anim key regardless of anim length', () => {
    const result = resolveOverlayFrame({ ...baseInput(), animKey: 'simon_heavy_punch' });
    expect(result.overlayKey).toBe('overlay_simon_sombrero_catalina_heavy_punch');
  });

  it('uses the raw anim key as the suffix when the fighter prefix is missing', () => {
    // Defensive: an unprefixed anim key still yields a deterministic lookup
    // (used to hide instead of guessing).
    const result = resolveOverlayFrame({ ...baseInput(), animKey: 'custom_anim' });
    expect(result.overlayKey).toBe('overlay_simon_sombrero_catalina_custom_anim');
  });

  it('does not strip a prefix that happens to match but is not followed by an underscore', () => {
    // e.g. fighterId='sim' should not chop the leading 'sim' from 'simon_idle'.
    // Guard: `simon_idle`.startsWith('sim_') is false, so no strip happens.
    const result = resolveOverlayFrame({
      ...baseInput(),
      fighterId: 'sim',
      animKey: 'simon_idle',
    });
    expect(result.overlayKey).toBe('overlay_sim_sombrero_catalina_simon_idle');
  });

  it('returns null when the overlay texture is not loaded', () => {
    const textureExists = vi.fn().mockReturnValue(false);
    const result = resolveOverlayFrame({ ...baseInput(), textureExists });
    expect(result).toBeNull();
    expect(textureExists).toHaveBeenCalledWith('overlay_simon_sombrero_catalina_idle');
  });

  it('returns null on missing required inputs', () => {
    expect(resolveOverlayFrame({ ...baseInput(), fighterId: null })).toBeNull();
    expect(resolveOverlayFrame({ ...baseInput(), accessoryId: '' })).toBeNull();
    expect(resolveOverlayFrame({ ...baseInput(), animKey: undefined })).toBeNull();
  });

  it('returns null if no textureExists predicate is supplied', () => {
    expect(resolveOverlayFrame({ ...baseInput(), textureExists: null })).toBeNull();
  });

  it('preserves string frame names verbatim (Phaser atlas textures)', () => {
    // Spritesheets give numeric frame names, but atlas-backed textures expose
    // strings. The resolver must pass either through untouched so the Phaser
    // setTexture call downstream behaves correctly.
    const result = resolveOverlayFrame({ ...baseInput(), frameName: 'frame-07' });
    expect(result.frameName).toBe('frame-07');
  });
});
