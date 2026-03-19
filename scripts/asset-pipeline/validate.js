/**
 * validate.js — Asset validation functions
 *
 * Checks dimensions, alpha, content, and color count.
 */

import fs from 'node:fs';
import { getColorCount, getImageDimensions, getTransparentPercent, hasAlpha } from './process.js';

/**
 * Validate an image asset against requirements.
 *
 * @param {string} imagePath - Path to the image
 * @param {object} opts
 * @param {number} [opts.width] - Expected exact width
 * @param {number} [opts.height] - Expected exact height
 * @param {boolean} [opts.requireAlpha=false] - Require alpha channel
 * @param {number} [opts.maxTransparentPct=90] - Max % of transparent pixels (rejects blank images)
 * @param {number} [opts.minColors=2] - Minimum unique colors
 * @param {number} [opts.maxColors] - Maximum unique colors
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAsset(imagePath, opts = {}) {
  const errors = [];

  if (!fs.existsSync(imagePath)) {
    return { valid: false, errors: [`File does not exist: ${imagePath}`] };
  }

  const stats = fs.statSync(imagePath);
  if (stats.size === 0) {
    return { valid: false, errors: ['File is empty (0 bytes)'] };
  }

  // Check dimensions
  if (opts.width || opts.height) {
    const dims = getImageDimensions(imagePath);
    if (opts.width && dims.width !== opts.width) {
      errors.push(`Width: expected ${opts.width}, got ${dims.width}`);
    }
    if (opts.height && dims.height !== opts.height) {
      errors.push(`Height: expected ${opts.height}, got ${dims.height}`);
    }
  }

  // Check alpha
  if (opts.requireAlpha) {
    if (!hasAlpha(imagePath)) {
      errors.push('Missing alpha channel');
    }
  }

  // Check not blank
  const maxTrans = opts.maxTransparentPct ?? 90;
  try {
    const transPct = getTransparentPercent(imagePath);
    if (transPct > maxTrans) {
      errors.push(`Too transparent: ${transPct.toFixed(1)}% (max ${maxTrans}%)`);
    }
  } catch {
    // Skip transparency check if no alpha channel
  }

  // Check color count
  const colorCount = getColorCount(imagePath);
  const minColors = opts.minColors ?? 2;
  if (colorCount < minColors) {
    errors.push(`Too few colors: ${colorCount} (min ${minColors})`);
  }
  if (opts.maxColors && colorCount > opts.maxColors) {
    errors.push(`Too many colors: ${colorCount} (max ${opts.maxColors})`);
  }

  return { valid: errors.length === 0, errors };
}
