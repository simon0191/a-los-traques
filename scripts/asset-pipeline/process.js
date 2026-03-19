/**
 * process.js — ImageMagick-based post-processing functions
 *
 * All functions shell out to `magick` (ImageMagick 7).
 */

import { execSync } from 'node:child_process';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    throw new Error(`ImageMagick command failed: ${cmd}\n${err.stderr || err.message}`);
  }
}

/**
 * Resize an image to exact dimensions using nearest-neighbor interpolation.
 */
export function resizeExact(inputPath, outputPath, width, height) {
  run(`magick "${inputPath}" -filter point -resize ${width}x${height}! "${outputPath}"`);
}

/**
 * Crop to content bounding box (trim transparent/uniform borders).
 */
export function cropToContent(inputPath, outputPath, padding = 0) {
  if (padding > 0) {
    run(
      `magick "${inputPath}" -trim -bordercolor transparent -border ${padding} +repage "${outputPath}"`,
    );
  } else {
    run(`magick "${inputPath}" -trim +repage "${outputPath}"`);
  }
}

/**
 * Remove green background using chroma-key.
 *
 * Targets pixels with green hue (70-170°) and saturation >20%, making
 * them transparent. This preserves interior pixels regardless of
 * brightness since it operates on hue, not color distance.
 *
 * Gemini consistently generates bright green backgrounds when asked,
 * making this approach reliable.
 *
 * @param {number} [hueMin=70] - Minimum hue in degrees to remove
 * @param {number} [hueMax=170] - Maximum hue in degrees to remove
 * @param {number} [minSaturation=0.20] - Minimum saturation (0-1) to target
 */
export function removeBackground(
  inputPath,
  outputPath,
  { hueMin = 70, hueMax = 170, minSaturation = 0.2 } = {},
) {
  run(
    `magick "${inputPath}" -alpha set ` +
      `-channel A -fx "(u.hue*360>${hueMin} && u.hue*360<${hueMax} && u.saturation>${minSaturation}) ? 0 : 1" ` +
      `"${outputPath}"`,
  );
}

/**
 * Pad image to match a target aspect ratio, centering content.
 */
export function padToAspect(inputPath, outputPath, targetW, targetH) {
  const dims = getImageDimensions(inputPath);
  const currentRatio = dims.width / dims.height;
  const targetRatio = targetW / targetH;

  let newW, newH;
  if (currentRatio > targetRatio) {
    // Too wide — pad height
    newW = dims.width;
    newH = Math.round(dims.width / targetRatio);
  } else {
    // Too tall — pad width
    newH = dims.height;
    newW = Math.round(dims.height * targetRatio);
  }

  run(
    `magick "${inputPath}" -gravity center -background transparent -extent ${newW}x${newH} "${outputPath}"`,
  );
}

/**
 * Horizontally append multiple images into a single row.
 */
export function appendHorizontal(inputPaths, outputPath) {
  const inputs = inputPaths.map((p) => `"${p}"`).join(' ');
  run(`magick ${inputs} +append "${outputPath}"`);
}

/**
 * Create a grid from individual frame images.
 *
 * @param {string[]} framePaths - Ordered list of frame image paths
 * @param {string} outputPath - Output sheet path
 * @param {number} cols - Number of columns
 * @param {number} frameWidth - Width of each frame
 * @param {number} frameHeight - Height of each frame
 */
export function assembleGrid(framePaths, outputPath, cols, frameWidth, frameHeight) {
  const rows = Math.ceil(framePaths.length / cols);
  const totalW = cols * frameWidth;
  const totalH = rows * frameHeight;

  // Build a single magick command that composites all frames at once
  let cmd = `magick -size ${totalW}x${totalH} xc:"rgba(0,0,0,0)"`;
  for (let i = 0; i < framePaths.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * frameWidth;
    const y = row * frameHeight;
    cmd += ` "${framePaths[i]}" -geometry +${x}+${y} -composite`;
  }
  cmd += ` -define png:color-type=6 "${outputPath}"`;
  run(cmd);
}

/**
 * Get image dimensions.
 */
export function getImageDimensions(inputPath) {
  const result = run(`magick identify -format "%w %h" "${inputPath}"`);
  const [width, height] = result.split(' ').map(Number);
  return { width, height };
}

/**
 * Get number of unique colors in the image.
 */
export function getColorCount(imagePath) {
  const result = run(`magick identify -format "%k" "${imagePath}"`);
  return parseInt(result, 10);
}

/**
 * Check if image has an alpha channel.
 */
export function hasAlpha(imagePath) {
  const result = run(`magick identify -format "%A" "${imagePath}"`);
  return result.toLowerCase() !== 'undefined' && result.toLowerCase() !== 'false';
}

/**
 * Get percentage of transparent pixels.
 */
export function getTransparentPercent(imagePath) {
  const result = run(`magick "${imagePath}" -alpha extract -format "%[fx:mean*100]" info:`);
  // mean of alpha channel: 1.0 = fully opaque, 0.0 = fully transparent
  // So transparent percentage = (1 - mean) * 100
  const opaquePct = parseFloat(result);
  return 100 - opaquePct;
}
