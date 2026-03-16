/**
 * fighter.js — Generate side-view fighting game sprites as horizontal strips
 *
 * Generates one image per frame (animation + pose), removes background,
 * resizes to 128x128 frames, and assembles each animation into a horizontal strip.
 *
 * Uses first idle frame as reference image for style consistency.
 */

import path from "path";
import fs from "fs";
import { generateImage } from "../generate.js";
import {
  removeBackground,
  cropToContent,
  resizeExact,
  padToAspect,
  appendHorizontal,
} from "../process.js";
import { validateAsset } from "../validate.js";

const STYLE_PREFIX =
  "Neo Geo pixel art, King of Fighters style, side-view fighting game sprite, detailed pixel art, clean edges, vibrant colors, do not use any green colors on the character";

const ANIMATIONS = {
  idle: { frames: 4, label: "standing idle fighting stance, side view" },
  walk: { frames: 4, label: "walking forward, side view" },
  light_punch: { frames: 4, label: "throwing a quick jab punch, side view" },
  heavy_punch: {
    frames: 5,
    label: "throwing a powerful straight punch, side view",
  },
  light_kick: { frames: 4, label: "quick low kick, side view" },
  heavy_kick: {
    frames: 5,
    label: "powerful high roundhouse kick, side view",
  },
  special: {
    frames: 5,
    label: "charging and releasing energy blast, side view",
  },
  block: { frames: 2, label: "blocking with arms raised, side view" },
  hurt: {
    frames: 3,
    label: "getting hit and recoiling in pain, side view",
  },
  knockdown: { frames: 4, label: "falling down knocked out, side view" },
  victory: { frames: 4, label: "celebrating victory pose, side view" },
  defeat: { frames: 3, label: "slumped in defeat, side view" },
  jump: { frames: 3, label: "jumping up in the air, side view" },
};

const FRAME_SIZE = 128;

/**
 * @param {object} config
 * @param {string} config.output - Output directory for strip files (e.g. "assets/fighters/simon/")
 * @param {string} config.description - Fighter appearance description
 * @param {string[]} [config.animations=['idle','walk','light_punch','light_kick','hurt','knockdown']]
 * @param {string[]} [config.referenceImages=[]] - External reference image paths for style consistency
 * @param {string} [config.rawDir] - Directory for raw intermediate outputs
 * @param {boolean} [config.skipGenerate=false]
 * @param {number} [config.retries=3]
 * @param {number} [config.delay=3000]
 * @returns {Promise<{success: boolean, output: string, animations: Object.<string, {success: boolean, frames: number}>}>}
 */
export async function runFighterPipeline(config) {
  const {
    output,
    description,
    animations = [
      "idle",
      "walk",
      "light_punch",
      "light_kick",
      "hurt",
      "knockdown",
    ],
    referenceImages = [],
    rawDir = "assets/_raw/fighters",
    skipGenerate = false,
    retries = 3,
    delay = 3000,
  } = config;

  const fighterName = path.basename(output.replace(/\/+$/, ""));
  const fighterRawDir = config.rawDir
    ? config.rawDir
    : path.join(rawDir, fighterName);

  if (!fs.existsSync(fighterRawDir))
    fs.mkdirSync(fighterRawDir, { recursive: true });
  if (!fs.existsSync(output)) fs.mkdirSync(output, { recursive: true });

  const results = {};
  let referenceImage = null;
  let overallSuccess = false;

  // Count total frames across all animations
  const totalFrames = animations.reduce((sum, animName) => {
    const anim = ANIMATIONS[animName];
    if (!anim) {
      console.warn(`  Unknown animation "${animName}", skipping`);
      return sum;
    }
    return sum + anim.frames;
  }, 0);

  let frameCounter = 0;

  console.log(
    `  Generating ${totalFrames} frames across ${animations.length} animations for "${fighterName}"`
  );

  for (const animName of animations) {
    const anim = ANIMATIONS[animName];
    if (!anim) {
      results[animName] = { success: false, frames: 0 };
      continue;
    }

    console.log(
      `\n  Animation: ${animName} (${anim.frames} frames)`
    );

    const animRawDir = path.join(fighterRawDir, animName);
    if (!fs.existsSync(animRawDir))
      fs.mkdirSync(animRawDir, { recursive: true });

    const framePaths = [];
    let animSuccess = 0;

    for (let f = 0; f < anim.frames; f++) {
      frameCounter++;
      const frameName = `${animName}_${f}`;
      const rawPath = path.join(animRawDir, `${frameName}_raw.png`);
      const noBgPath = path.join(animRawDir, `${frameName}_nobg.png`);
      const croppedPath = path.join(animRawDir, `${frameName}_cropped.png`);
      const paddedPath = path.join(animRawDir, `${frameName}_padded.png`);
      const finalPath = path.join(animRawDir, `${frameName}.png`);

      console.log(
        `    [${frameCounter}/${totalFrames}] ${frameName}`
      );

      if (!skipGenerate) {
        const frameLabel =
          f === 0
            ? `frame 1 of ${anim.frames}, start of motion`
            : f === anim.frames - 1
              ? `frame ${f + 1} of ${anim.frames}, end of motion`
              : `frame ${f + 1} of ${anim.frames}, mid motion`;

        const prompt = `${description}, ${anim.label}, ${frameLabel}, full body visible, single character centered in image, on solid bright green #00FF00 background, ${STYLE_PREFIX}`;

        let generated = false;
        for (let attempt = 1; attempt <= retries; attempt++) {
          const allRefs = [...referenceImages];
          if (referenceImage) allRefs.push(referenceImage);
          const result = await generateImage({
            prompt,
            outputPath: rawPath,
            inputPaths: allRefs.length > 0 ? allRefs : null,
            retries: 1,
            delay,
          });

          if (result.success) {
            generated = true;
            // Use first idle frame as reference for consistency
            if (!referenceImage) {
              referenceImage = rawPath;
              console.log(
                `      Using as reference image for remaining frames`
              );
            }
            break;
          }

          console.warn(
            `      Attempt ${attempt} failed: ${result.error}`
          );
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, delay * attempt));
          }
        }

        if (!generated && !fs.existsSync(rawPath)) {
          console.error(
            `      FAILED: Could not generate frame "${frameName}"`
          );
          // Create a transparent placeholder
          const { execSync } = await import("child_process");
          execSync(
            `magick -size ${FRAME_SIZE}x${FRAME_SIZE} xc:transparent "${finalPath}"`
          );
          framePaths.push(finalPath);
          continue;
        }

        // Rate limit delay
        if (frameCounter < totalFrames) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (!fs.existsSync(rawPath)) {
        console.error(`      SKIP: No raw file for "${frameName}"`);
        const { execSync } = await import("child_process");
        execSync(
          `magick -size ${FRAME_SIZE}x${FRAME_SIZE} xc:transparent "${finalPath}"`
        );
        framePaths.push(finalPath);
        continue;
      }

      // Post-process pipeline
      try {
        // 1. Remove green background
        removeBackground(rawPath, noBgPath);

        // 2. Crop to content
        cropToContent(noBgPath, croppedPath);

        // 3. Pad to 1:1 aspect ratio
        padToAspect(croppedPath, paddedPath, 1, 1);

        // 4. Resize to exact frame dimensions
        resizeExact(paddedPath, finalPath, FRAME_SIZE, FRAME_SIZE);

        // Validate
        const validation = validateAsset(finalPath, {
          width: FRAME_SIZE,
          height: FRAME_SIZE,
          requireAlpha: true,
          maxTransparentPct: 95,
        });

        if (!validation.valid) {
          console.warn(
            `      Validation: ${validation.errors.join(", ")}`
          );
        } else {
          animSuccess++;
        }
      } catch (err) {
        console.warn(
          `      Process error: ${err.message}, using resize-only fallback`
        );
        resizeExact(rawPath, finalPath, FRAME_SIZE, FRAME_SIZE);
      }

      framePaths.push(finalPath);
      console.log(`      OK`);
    }

    // Assemble frames into horizontal strip
    const stripPath = path.join(output, `${animName}.png`);
    appendHorizontal(framePaths, stripPath);

    const stripSuccess = animSuccess > 0;
    results[animName] = { success: stripSuccess, frames: anim.frames };
    if (stripSuccess) overallSuccess = true;

    console.log(
      `    Strip assembled: ${stripPath} (${anim.frames} frames, ${animSuccess} validated)`
    );
  }

  console.log(`\n  Fighter pipeline complete: ${output}`);

  return {
    success: overallSuccess,
    output,
    animations: results,
  };
}
