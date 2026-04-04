/**
 * stage.js — Generate fight stage backgrounds
 *
 * Generates a single background image (static) or multi-frame animation strip
 * via Gemini and resizes to the target dimensions (480x270 per frame).
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateImage } from '../generate.js';
import { appendHorizontal, getImageDimensions, resizeExact } from '../process.js';

const STYLE_PREFIX =
  'Neo Geo pixel art, King of Fighters style background, detailed pixel art scene, wide landscape format, atmospheric lighting, vibrant colors';

const STAGE_WIDTH = 480;
const STAGE_HEIGHT = 270;

/**
 * @param {object} config
 * @param {string} config.output - Final output image path (e.g. "assets/stages/dojo.png")
 * @param {string} config.prompt - Scene description for the stage
 * @param {boolean} [config.animated=false] - Whether to generate an animated strip
 * @param {number} [config.animFrames=1] - Number of frames for animated stages
 * @param {string} [config.baseImage] - Existing image to use as frame 0 (remaining frames generated)
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
    animated = false,
    animFrames = 1,
    baseImage,
    rawDir = 'assets/_raw/stages',
    skipGenerate = false,
    retries = 3,
    delay = 3000,
  } = config;

  const stageName = path.basename(output, '.png');

  if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });

  const outputDir = path.dirname(output);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  if (animated && animFrames > 1) {
    return runAnimatedStagePipeline({
      stageName,
      prompt,
      baseImage,
      rawDir,
      output,
      skipGenerate,
      retries,
      delay,
      animFrames,
    });
  }

  // --- Static stage (original path) ---
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

/**
 * Generate an animated stage as a horizontal strip of frames.
 * If baseImage is provided, it becomes frame 0 and only the remaining
 * frames are generated via Gemini using it as reference.
 */
async function runAnimatedStagePipeline({
  stageName,
  prompt,
  baseImage,
  rawDir,
  output,
  skipGenerate,
  retries,
  delay,
  animFrames,
}) {
  console.log(`  Generating animated stage: "${stageName}" (${animFrames} frames)`);

  const framePaths = [];
  let referenceFrame = null;
  let startFrame = 0;

  // If a base image is provided, use it as frame 0
  if (baseImage) {
    if (!fs.existsSync(baseImage)) {
      console.error(`    Base image not found: ${baseImage}`);
      return { success: false, output };
    }
    const finalPath = path.join(rawDir, `${stageName}_frame0.png`);
    resizeExact(baseImage, finalPath, STAGE_WIDTH, STAGE_HEIGHT);
    framePaths.push(finalPath);
    referenceFrame = baseImage;
    startFrame = 1;
    console.log(`    Frame 0 (base image): ${finalPath}`);
  }

  for (let f = startFrame; f < animFrames; f++) {
    const rawPath = path.join(rawDir, `${stageName}_frame${f}_raw.png`);
    const finalPath = path.join(rawDir, `${stageName}_frame${f}.png`);

    if (!skipGenerate) {
      const framePrompt = `${prompt}, frame ${f + 1} of ${animFrames} of a subtle looping animation, ${STYLE_PREFIX}`;
      const inputPaths = referenceFrame ? [referenceFrame] : null;

      let generated = false;
      for (let attempt = 1; attempt <= retries; attempt++) {
        const result = await generateImage({
          prompt: framePrompt,
          outputPath: rawPath,
          inputPaths,
          retries: 1,
          delay,
        });

        if (result.success) {
          generated = true;
          break;
        }

        console.warn(`    Frame ${f} attempt ${attempt} failed: ${result.error}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delay * attempt));
        }
      }

      if (!generated && !fs.existsSync(rawPath)) {
        console.error(`    FAILED: Could not generate frame ${f}`);
        return { success: false, output };
      }

      // Use first generated frame as reference if no base image was provided
      if (!referenceFrame) referenceFrame = rawPath;
    }

    if (!fs.existsSync(rawPath)) {
      console.error(`    SKIP: No raw file for frame ${f}`);
      return { success: false, output };
    }

    resizeExact(rawPath, finalPath, STAGE_WIDTH, STAGE_HEIGHT);
    framePaths.push(finalPath);
    console.log(`    Frame ${f} ready: ${finalPath}`);
  }

  // Assemble horizontal strip
  appendHorizontal(framePaths, output);

  // Validate total strip dimensions
  const dims = getImageDimensions(output);
  const expectedWidth = STAGE_WIDTH * animFrames;
  if (dims.width !== expectedWidth || dims.height !== STAGE_HEIGHT) {
    console.error(
      `    Dimension mismatch: expected ${expectedWidth}x${STAGE_HEIGHT}, got ${dims.width}x${dims.height}`,
    );
    return { success: false, output };
  }

  console.log(
    `    Animated stage generated: ${output} (${expectedWidth}x${STAGE_HEIGHT}, ${animFrames} frames)`,
  );

  return { success: true, output };
}
