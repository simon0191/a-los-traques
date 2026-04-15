/**
 * Shared transform math between the editor preview and the strip exporter.
 *
 * Both consumers convert a session's `frame.scale` into rendering dimensions.
 * Keeping these formulas in one place is the only way to guarantee the editor
 * preview is a 1:1 match with the exported strip — if the formula changes in
 * one place and not the other, calibrations silently drift between what the
 * user saw and what gets baked into overlay PNGs.
 */

/**
 * Width (in base/unscaled pixels) at which an accessory sprite renders inside
 * one fighter animation frame. Height is derived from this using the
 * accessory image's aspect ratio.
 *
 * @param {number} frameHeight the fighter animation frame height (px)
 * @param {number} scale the session's per-frame scale factor
 * @returns {number}
 */
export function overlayBaseWidth(frameHeight, scale) {
  return frameHeight * scale;
}

/**
 * Canvas scale factor for `ctx.scale(...)` during strip export. Converts the
 * accessory image's natural pixel size into the target base width.
 *
 * @param {number} frameHeight the fighter animation frame height (px)
 * @param {number} scale the session's per-frame scale factor
 * @param {number} imageWidth the accessory image's natural width (px)
 * @returns {number}
 */
export function overlayCanvasScale(frameHeight, scale, imageWidth) {
  return overlayBaseWidth(frameHeight, scale) / imageWidth;
}
