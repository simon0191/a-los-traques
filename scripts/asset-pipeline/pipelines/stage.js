/**
 * stage.js — Generate fight stage backgrounds
 *
 * Generates a single background image via Gemini and resizes
 * to the target dimensions (480x270).
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateImage } from '../generate.js';
import { getImageDimensions, resizeExact } from '../process.js';

const STYLE_PREFIX =
  'Neo Geo pixel art, King of Fighters style background, detailed pixel art scene, wide landscape format, atmospheric lighting, vibrant colors';

const STAGE_WIDTH = 480;
const STAGE_HEIGHT = 270;

/**
 * @param {object} config
 * @param {string} config.output - Final output image path (e.g. "assets/stages/dojo.png")
 * @param {string} config.prompt - Scene description for the stage
 * @param {string} [config.rawDir='assets/_raw/stages'] - Directory for raw intermediate outputs
 * @param {boolean} [config.skipGenerate=false]
 * @param {number} [config.retries=3]
 * @param {number} [config.delay=3000]
 * @returns {Promise<{success: boolean, output: string}>}
 */
export async function runStagePipeline(config) {
  const {
    output,
    prompt,
    rawDir = 'assets/_raw/stages',
    skipGenerate = false,
    retries = 3,
    delay = 3000,
  } = config;

  const stageName = path.basename(output, '.png');

  if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });

  const outputDir = path.dirname(output);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const rawPath = path.join(rawDir, `${stageName}_raw.png`);

  console.log(`  Generating stage background: "${stageName}"`);

  if (!skipGenerate) {
    const fullPrompt = `${prompt}, ${STYLE_PREFIX}`;

    let generated = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      const result = await generateImage({
        prompt: fullPrompt,
        outputPath: rawPath,
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
      console.error(`    FAILED: Could not generate stage "${stageName}"`);
      return { success: false, output };
    }
  }

  if (!fs.existsSync(rawPath)) {
    console.error(`    SKIP: No raw file for stage "${stageName}"`);
    return { success: false, output };
  }

  // Resize to exact stage dimensions
  resizeExact(rawPath, output, STAGE_WIDTH, STAGE_HEIGHT);

  // Validate dimensions
  const dims = getImageDimensions(output);
  if (dims.width !== STAGE_WIDTH || dims.height !== STAGE_HEIGHT) {
    console.error(
      `    Dimension mismatch: expected ${STAGE_WIDTH}x${STAGE_HEIGHT}, got ${dims.width}x${dims.height}`,
    );
    return { success: false, output };
  }

  console.log(`    Stage generated: ${output} (${STAGE_WIDTH}x${STAGE_HEIGHT})`);

  return { success: true, output };
}
