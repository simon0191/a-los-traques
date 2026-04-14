/**
 * OverlayExporter — composites an OverlaySession's per-frame transforms into a
 * horizontal sprite strip matching the fighter's animation frame layout.
 *
 * Pure function: no Phaser, no direct DOM. The caller supplies the accessory
 * image (a `CanvasImageSource`) and a `createCanvas` factory so this module is
 * testable in Node.
 *
 * See RFC 0018 for the full design.
 */

/**
 * Render an overlay strip canvas from a session.
 *
 * The output canvas has dimensions `frameWidth * frameCount` × `frameHeight`.
 * Each frame's transform is applied relative to the frame's own origin
 * (`i * frameWidth`, `0`) — the accessory image is drawn centered at
 * `(x, y)` within that origin, then rotated and scaled around that same point.
 *
 * @param {object} opts
 * @param {import('./OverlaySession.js').OverlaySession} opts.session
 * @param {CanvasImageSource} opts.accessoryImage loaded accessory image
 * @param {number} opts.frameWidth width of one fighter animation frame
 * @param {number} opts.frameHeight height of one fighter animation frame
 * @param {(w: number, h: number) => { getContext(type: '2d'): CanvasRenderingContext2D }} opts.createCanvas
 *   factory returning a canvas-like object with `getContext('2d')`
 * @returns the composited strip canvas
 */
export function exportOverlayStrip({
  session,
  accessoryImage,
  frameWidth,
  frameHeight,
  createCanvas,
}) {
  if (!session) throw new Error('session required');
  if (!accessoryImage) throw new Error('accessoryImage required');
  if (!frameWidth || !frameHeight) throw new Error('frame dimensions required');
  if (typeof createCanvas !== 'function') throw new Error('createCanvas factory required');

  const { frameCount, frames } = session;
  const canvas = createCanvas(frameWidth * frameCount, frameHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  const imgW = accessoryImage.width;
  const imgH = accessoryImage.height;

  for (let i = 0; i < frameCount; i++) {
    const t = frames[i];
    ctx.save();
    ctx.translate(i * frameWidth + t.x, t.y);
    ctx.rotate(t.rotation);
    ctx.scale(t.scale, t.scale);
    ctx.drawImage(accessoryImage, -imgW / 2, -imgH / 2);
    ctx.restore();
  }
  return canvas;
}
