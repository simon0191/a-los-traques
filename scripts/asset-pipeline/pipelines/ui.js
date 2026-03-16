/**
 * ui.js — Generate a UI element, remove background, crop, and resize
 */

import path from "path";
import fs from "fs";
import { generateImage } from "../generate.js";
import { removeBackground, cropToContent, resizeExact } from "../process.js";
import { validateAsset } from "../validate.js";

const STYLE_PREFIX = "Neo Geo pixel art, King of Fighters style UI element, clean edges, vibrant colors, do not use any green colors in the element";

/**
 * @param {object} config
 * @param {string} config.output - Final output path
 * @param {string} config.prompt - UI element description
 * @param {number} config.width - Target width
 * @param {number} config.height - Target height
 * @param {boolean} [config.removeBackground=true] - Whether to remove background
 * @param {string} [config.rawDir] - Directory for raw outputs
 * @param {boolean} [config.skipGenerate=false]
 * @param {string[]} [config.referenceImages=[]] - Reference image paths for style consistency
 * @param {number} [config.retries=3]
 * @param {number} [config.delay=3000]
 */
export async function runUIPipeline(config) {
  const {
    output,
    prompt,
    width,
    height,
    removeBackground: shouldRemoveBg = true,
    rawDir = "assets/_raw/ui",
    skipGenerate = false,
    referenceImages = [],
    retries = 3,
    delay = 3000,
  } = config;

  const name = path.basename(output, ".png");
  const rawPath = path.join(rawDir, `${name}_raw.png`);
  const noBgPath = path.join(rawDir, `${name}_nobg.png`);
  const croppedPath = path.join(rawDir, `${name}_cropped.png`);

  if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
  const outputDir = path.dirname(output);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`  Generating UI element: ${name}`);

  if (!skipGenerate) {
    const bgInstruction = shouldRemoveBg
      ? "on solid bright green #00FF00 background"
      : "";
    const fullPrompt = `${prompt}, ${bgInstruction}, ${STYLE_PREFIX}`;

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
      console.error(`  FAILED: Could not generate UI element "${name}"`);
      return { success: false, error: "Generation failed" };
    }
  }

  if (!fs.existsSync(rawPath)) {
    return { success: false, error: "Raw file missing" };
  }

  try {
    let currentPath = rawPath;

    if (shouldRemoveBg) {
      removeBackground(currentPath, noBgPath);
      currentPath = noBgPath;

      cropToContent(currentPath, croppedPath);
      currentPath = croppedPath;
    }

    resizeExact(currentPath, output, width, height);
  } catch (err) {
    console.warn(`  Process error: ${err.message}, using resize-only fallback`);
    resizeExact(rawPath, output, width, height);
  }

  const validation = validateAsset(output, { width, height });
  if (!validation.valid) {
    console.warn(`  Validation: ${validation.errors.join(", ")}`);
  }

  console.log(`  OK: ${output} (${width}x${height})`);
  return { success: true, output };
}
