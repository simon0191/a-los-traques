/**
 * reference.js — Generate a "golden reference" image for a fighter
 *
 * Produces a single high-quality neutral standing pose that establishes
 * the character's canonical appearance. This reference is then used by
 * the fighter pipeline to keep all animation frames visually consistent.
 *
 * Output: assets/references/{id}_ref.png (raw) and {id}_ref_clean.png (processed)
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateImage } from '../generate.js';
import { cropToContent, padToAspect, removeBackground, resizeExact } from '../process.js';

const REF_SIZE = 256;

// Green chroma-key background (default)
const GREEN_BG = {
  promptColor: 'bright green #00FF00',
  styleNote: 'do not use any green colors on the character',
  hueMin: 70,
  hueMax: 170,
};

// Magenta chroma-key background (when character uses green)
const MAGENTA_BG = {
  promptColor: 'bright magenta #FF00FF',
  styleNote: 'do not use any magenta or pink colors on the character',
  hueMin: 280,
  hueMax: 340,
};

function pickBackground(description) {
  return /green/i.test(description) ? MAGENTA_BG : GREEN_BG;
}

/**
 * @param {object} config
 * @param {string} config.output - Output directory (e.g. "assets/references/")
 * @param {string} config.id - Fighter ID (e.g. "simon")
 * @param {string} config.description - Fighter appearance description
 * @param {string[]} [config.referenceImages=[]] - Photo reference paths
 * @param {boolean} [config.skipGenerate=false]
 * @param {number} [config.retries=3]
 * @param {number} [config.delay=3000]
 * @returns {Promise<{success: boolean, output: string, rawPath: string, cleanPath: string}>}
 */
export async function runReferencePipeline(config) {
  const {
    output = 'assets/references/',
    id,
    description,
    referenceImages = [],
    skipGenerate = false,
    retries = 3,
    delay = 3000,
  } = config;

  if (!id) throw new Error("Reference pipeline requires 'id' in config");
  if (!description) throw new Error("Reference pipeline requires 'description' in config");

  if (!fs.existsSync(output)) fs.mkdirSync(output, { recursive: true });

  const rawPath = path.join(output, `${id}_ref.png`);
  const noBgPath = path.join(output, `${id}_ref_nobg.png`);
  const croppedPath = path.join(output, `${id}_ref_cropped.png`);
  const paddedPath = path.join(output, `${id}_ref_padded.png`);
  const cleanPath = path.join(output, `${id}_ref_clean.png`);

  console.log(`  Generating golden reference for "${id}"`);

  const bg = pickBackground(description);
  const STYLE_PREFIX = `Neo Geo pixel art, King of Fighters style, side-view fighting game sprite, detailed pixel art, clean edges, vibrant colors, ${bg.styleNote}`;

  if (!skipGenerate) {
    const prompt =
      `Character design for a fighting game: ${description}. ` +
      `Standing neutral pose, arms slightly raised in fighting ready position. ` +
      `IMPORTANT: The character MUST face RIGHT. The character's chest, face, and front of body MUST point toward the RIGHT side of the image. The character should be in profile/three-quarter view looking RIGHT. This is a strict requirement. ` +
      `Full body visible head to toe, single character, centered. ` +
      `Solid ${bg.promptColor} background. ` +
      STYLE_PREFIX;

    let generated = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      const result = await generateImage({
        prompt,
        outputPath: rawPath,
        inputPaths: referenceImages.length > 0 ? referenceImages : null,
        retries: 1,
        delay,
      });

      if (result.success) {
        generated = true;
        console.log(`    Raw reference generated: ${rawPath} (${result.bytes} bytes)`);
        break;
      }

      console.warn(`    Attempt ${attempt} failed: ${result.error}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delay * attempt));
      }
    }

    if (!generated) {
      console.error(`  FAILED: Could not generate reference for "${id}"`);
      return { success: false, output, rawPath, cleanPath };
    }
  }

  if (!fs.existsSync(rawPath)) {
    console.error(`  No raw file found at ${rawPath}`);
    return { success: false, output, rawPath, cleanPath };
  }

  // Post-process: remove BG, crop, pad, resize
  try {
    removeBackground(rawPath, noBgPath, { hueMin: bg.hueMin, hueMax: bg.hueMax });
    cropToContent(noBgPath, croppedPath);
    padToAspect(croppedPath, paddedPath, 1, 1);
    resizeExact(paddedPath, cleanPath, REF_SIZE, REF_SIZE);
    console.log(`    Clean reference: ${cleanPath}`);
  } catch (err) {
    console.warn(`    Process error: ${err.message}, using resize-only fallback`);
    resizeExact(rawPath, cleanPath, REF_SIZE, REF_SIZE);
  }

  console.log(`  Reference pipeline complete for "${id}"`);
  return { success: true, output, rawPath, cleanPath };
}
