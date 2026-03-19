/**
 * assemble.js — Combine individual frames/tiles into sheets
 */

import { appendHorizontal, assembleGrid } from './process.js';

/**
 * Assemble tiles into a horizontal row (tileset).
 *
 * @param {string[]} tilePaths - Ordered tile image paths
 * @param {string} outputPath - Output tileset path
 */
export function assembleTileRow(tilePaths, outputPath) {
  appendHorizontal(tilePaths, outputPath);
}

/**
 * Assemble character frames into a sprite sheet grid.
 *
 * @param {string[]} framePaths - Frame images in order: [dir0_frame0, dir0_frame1, ..., dir1_frame0, ...]
 * @param {string} outputPath - Output sheet path
 * @param {number} cols - Frames per direction (columns)
 * @param {number} frameWidth - Single frame width
 * @param {number} frameHeight - Single frame height
 */
export function assembleSpriteSheet(framePaths, outputPath, cols, frameWidth, frameHeight) {
  assembleGrid(framePaths, outputPath, cols, frameWidth, frameHeight);
}
