/**
 * portrait.js — Generate a single character portrait and resize
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateImage } from '../generate.js';
import { resizeExact } from '../process.js';
import { validateAsset } from '../validate.js';

const STYLE_PREFIX =
  'Neo Geo pixel art, King of Fighters style, detailed pixel art portrait, clean edges, vibrant colors';

/**
 * @param {object} config
 * @param {string} config.output - Final portrait output path
 * @param {string} config.prompt - Character description
 * @param {number} [config.width=128]
 * @param {number} [config.height=128]
 * @param {string} [config.rawDir] - Directory for raw outputs
 * @param {boolean} [config.skipGenerate=false]
 * @param {string[]} [config.referenceImages=[]] - Reference image paths for style consistency
 * @param {number} [config.retries=3]
 * @param {number} [config.delay=3000]
 */
export async function runPortraitPipeline(config) {
  const {
    output,
    prompt,
    width = 128,
    height = 128,
    rawDir = 'assets/_raw/portraits',
    skipGenerate = false,
    referenceImages = [],
    retries = 3,
    delay = 3000,
  } = config;

  const name = path.basename(output, '.png');
  const rawPath = path.join(rawDir, `${name}_raw.png`);

  if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
  const outputDir = path.dirname(output);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`  Generating portrait: ${name}`);

  if (!skipGenerate) {
    const fullPrompt = `${prompt}, head and shoulders portrait, centered, ${STYLE_PREFIX}`;

    let generated = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      const result = await generateImage({
        prompt: fullPrompt,
        outputPath: rawPath,
        inputPaths: referenceImages.length > 0 ? referenceImages : null,
        retries: 1,
        delay,
      });

      if (result.success) {
        generated = true;
        break;
      }
      console.warn(`    Attempt ${attempt} failed: ${result.error}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delay * attempt));
      }
    }

    if (!generated && !fs.existsSync(rawPath)) {
      console.error(`  FAILED: Could not generate portrait "${name}"`);
      return { success: false, error: 'Generation failed' };
    }
  }

  if (!fs.existsSync(rawPath)) {
    return { success: false, error: 'Raw file missing' };
  }

  // Resize to target dimensions
  resizeExact(rawPath, output, width, height);

  const validation = validateAsset(output, { width, height, minColors: 2 });
  if (!validation.valid) {
    console.warn(`  Validation: ${validation.errors.join(', ')}`);
  }

  console.log(`  OK: ${output} (${width}x${height})`);
  return { success: true, output };
}
