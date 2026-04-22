/**
 * Pure transform resolver for cosmetic accessory overlays.
 *
 * Maps a calibration frame (`{x, y, rotation, scale}` in unscaled fighter-frame
 * local coords — top-left origin, 0..FIGHTER_WIDTH by 0..FIGHTER_HEIGHT) onto a
 * Phaser sprite's world-space transform. The overlay sprite must use origin
 * (0.5, 0.5) so rotation is about its own center.
 *
 * The scale formula is shared with the editor's live preview via
 * `src/editor/math.js`, guaranteeing WYSIWYG between calibration and runtime.
 *
 * No Phaser dependency — callable from unit tests.
 */

import { overlayBaseWidth } from '../editor/math.js';

/**
 * @typedef {{x:number, y:number, rotation:number, scale:number}} CalibrationFrame
 */

/**
 * @param {object} args
 * @param {CalibrationFrame} args.cal calibrated transform for the current frame
 * @param {number} args.fighterX world x of fighter sprite (origin 0.5, 1 — bottom-center)
 * @param {number} args.fighterY world y of fighter sprite (origin 0.5, 1 — bottom-center)
 * @param {number} args.fighterWidth fighter frame bounding box width (px)
 * @param {number} args.fighterHeight fighter frame bounding box height (px)
 * @param {boolean} args.facingRight true = sprite not flipped, false = flipX on
 * @param {number} args.accessoryWidth natural width of the accessory source texture (px)
 * @returns {{x:number, y:number, rotation:number, scale:number}|null}
 *   world transform for the overlay sprite, or null when inputs are unusable.
 */
export function resolveOverlayTransform({
  cal,
  fighterX,
  fighterY,
  fighterWidth,
  fighterHeight,
  facingRight,
  accessoryWidth,
}) {
  if (!cal) return null;
  if (!accessoryWidth || accessoryWidth <= 0) return null;

  const halfW = fighterWidth / 2;
  // Fighter sprite origin is bottom-center. Calibration coords are frame-local
  // with top-left origin. When facing left (flipX), mirror x around the frame's
  // horizontal center so the overlay tracks the mirrored sprite content.
  const offsetX = facingRight ? cal.x - halfW : halfW - cal.x;
  const offsetY = cal.y - fighterHeight;

  return {
    x: fighterX + offsetX,
    y: fighterY + offsetY,
    rotation: facingRight ? cal.rotation : -cal.rotation,
    scale: overlayBaseWidth(fighterHeight, cal.scale) / accessoryWidth,
  };
}
