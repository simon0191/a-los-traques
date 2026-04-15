/**
 * OverlayFrameResolver — pure lookup that maps a fighter's current animation
 * state onto the corresponding overlay strip texture.
 *
 * Extracted from `Fighter._syncOverlayAnimation` so the frame-index mirroring
 * logic is testable without a Phaser scene. The Fighter calls this on every
 * syncSprite() tick; if it returns null, the overlay sprite is hidden.
 *
 * Keeping this pure guarantees that the overlay renders exactly the same
 * frame index as the fighter sprite — the primary correctness property of
 * the cosmetic overlay system and the point where a silent regression would
 * be hardest to spot without dedicated tests.
 */

/**
 * Resolve the overlay texture key and frame to display for a single fighter.
 *
 * @param {object} opts
 * @param {string} opts.fighterId e.g. `'simon'`
 * @param {string} opts.accessoryId e.g. `'sombrero_catalina'`
 * @param {string|null|undefined} opts.animKey Phaser anim key currently playing
 *   on the fighter sprite, e.g. `'simon_idle'` or `'idle'`
 * @param {number|string|null|undefined} opts.frameName current frame name/index
 *   from the fighter sprite (`sprite.frame.name`)
 * @param {(key: string) => boolean} opts.textureExists predicate — usually
 *   `scene.textures.exists.bind(scene.textures)`
 * @returns {{ overlayKey: string, frameName: number|string }|null}
 *   the overlay texture key + frame to apply, or `null` when the overlay
 *   should be hidden (missing inputs, or no strip loaded for this combo).
 */
export function resolveOverlayFrame({ fighterId, accessoryId, animKey, frameName, textureExists }) {
  if (!fighterId || !accessoryId || !animKey) return null;
  if (typeof textureExists !== 'function') return null;

  // Fighter anim keys are `${fighterId}_${animName}` by BootScene convention.
  // Strip the prefix to recover the anim name; fall back to the raw key so a
  // differently-named anim still produces a deterministic lookup.
  const prefix = `${fighterId}_`;
  const animName = animKey.startsWith(prefix) ? animKey.slice(prefix.length) : animKey;

  const overlayKey = `overlay_${fighterId}_${accessoryId}_${animName}`;
  if (!textureExists(overlayKey)) return null;

  // Default to frame 0 when the fighter sprite hasn't produced a named frame
  // yet (e.g. immediately after a setTexture before the next render tick).
  return { overlayKey, frameName: frameName ?? 0 };
}
