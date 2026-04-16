/**
 * poses.js — Extract per-frame pose keypoints from fighter sprite strips.
 *
 * For each animation strip `{output}/{anim}.png`, splits the horizontal
 * strip into 128x128 frames, invokes the Python MediaPipe detector once
 * per animation, computes derived orientation angles, and writes a single
 * consolidated `{output}/poses.json` covering every animation.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDerived } from '../pose/orientations.js';
import { appendHorizontal, getImageDimensions } from '../process.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSE_PYTHON_DIR = path.resolve(__dirname, '..', 'pose');
const DETECT_SCRIPT = path.join(POSE_PYTHON_DIR, 'detect.py');
const FRAME_SIZE = 128;
const DEFAULT_ANIMATIONS = [
  'idle',
  'walk',
  'light_punch',
  'heavy_punch',
  'light_kick',
  'heavy_kick',
  'special',
  'block',
  'hurt',
  'knockdown',
  'victory',
  'defeat',
  'jump',
];

function splitStrip(stripPath, outDir, frameCount) {
  fs.mkdirSync(outDir, { recursive: true });
  const alreadySplit = Array.from({ length: frameCount }, (_, i) =>
    path.join(outDir, `frame_${i}.png`),
  ).every((p) => fs.existsSync(p));
  if (alreadySplit) return;

  for (const f of fs.readdirSync(outDir)) {
    if (/^frame_\d+(_debug)?\.png$/.test(f)) {
      fs.unlinkSync(path.join(outDir, f));
    }
  }

  // +repage BEFORE -crop is critical: the fighter pipeline leaves a
  // 128x128 page geometry on the strip, and -crop would otherwise respect
  // that and produce only the first frame.
  execSync(
    `magick "${stripPath}" +repage -crop ${FRAME_SIZE}x${FRAME_SIZE} +repage "${path.join(outDir, 'frame_%d.png')}"`,
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
}

function runDetector(frameDir, debugDir) {
  const debugArg = debugDir ? ` --debug-dir "${debugDir}"` : '';
  const cmd = `uv run --project "${POSE_PYTHON_DIR}" python "${DETECT_SCRIPT}" --input-dir "${frameDir}"${debugArg}`;

  const stdout = execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}

function assembleDebugStrip(debugDir, frameCount, outputPath) {
  const paths = [];
  for (let i = 0; i < frameCount; i++) {
    const p = path.join(debugDir, `frame_${i}_debug.png`);
    if (!fs.existsSync(p)) return false;
    paths.push(p);
  }
  appendHorizontal(paths, outputPath);
  return true;
}

function writeAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

/**
 * @param {object} config
 * @param {string} config.output - Fighter output dir (e.g. "public/assets/fighters/simon/")
 * @param {string} config.fighter - Fighter id (e.g. "simon")
 * @param {string[]} [config.animations] - Animations to process
 * @param {string} [config.rawDir="assets/_raw/poses"] - Intermediate frame dir
 * @param {number} [config.minVisibility=0.3] - Landmark visibility threshold
 * @param {boolean} [config.debug=false] - Emit skeleton-overlay previews
 */
export async function runPosesPipeline(config) {
  const {
    output,
    fighter,
    animations = DEFAULT_ANIMATIONS,
    rawDir = 'assets/_raw/poses',
    minVisibility = 0.3,
    debug = false,
  } = config;

  if (!output) throw new Error('poses manifest missing "output"');
  if (!fighter) throw new Error('poses manifest missing "fighter"');

  const animationsOut = {};
  const errors = [];
  const summary = [];

  for (const anim of animations) {
    const stripPath = path.join(output, `${anim}.png`);
    if (!fs.existsSync(stripPath)) {
      console.warn(`  - skip ${anim}: strip not found at ${stripPath}`);
      continue;
    }

    const dims = getImageDimensions(stripPath);
    if (dims.height !== FRAME_SIZE || dims.width % FRAME_SIZE !== 0) {
      errors.push({
        name: `${fighter}/${anim}`,
        error: `unexpected strip dimensions ${dims.width}x${dims.height} (expected Nx128)`,
      });
      continue;
    }
    const frameCount = dims.width / FRAME_SIZE;

    const frameDir = path.join(rawDir, fighter, anim);
    const debugDir = debug ? frameDir : null;

    try {
      splitStrip(stripPath, frameDir, frameCount);
    } catch (err) {
      errors.push({ name: `${fighter}/${anim}`, error: `split failed: ${err.message}` });
      continue;
    }

    let frames;
    try {
      frames = runDetector(frameDir, debugDir);
    } catch (err) {
      errors.push({ name: `${fighter}/${anim}`, error: `detector failed: ${err.message}` });
      continue;
    }

    const enriched = frames.map((f) => ({
      index: f.index,
      detected: f.detected,
      avgVisibility: f.avgVisibility,
      keypoints: f.keypoints,
      derived: f.detected ? computeDerived(f.keypoints, minVisibility) : null,
    }));

    animationsOut[anim] = { frameCount, frames: enriched };

    const detectedCount = enriched.filter((f) => f.detected).length;
    summary.push(
      `  - ${fighter}/${anim}: ${detectedCount}/${frameCount} frames detected` +
        (detectedCount < frameCount ? ' (review debug strip)' : ''),
    );

    if (debug) {
      const debugStripPath = path.join(rawDir, fighter, `${anim}_debug.png`);
      try {
        assembleDebugStrip(frameDir, frameCount, debugStripPath);
      } catch (err) {
        console.warn(`  - debug strip failed for ${anim}: ${err.message}`);
      }
    }
  }

  const manifest = {
    version: 1,
    fighter,
    frameSize: FRAME_SIZE,
    model: 'mediapipe-pose-blazepose-ghum-heavy',
    generatedAt: new Date().toISOString(),
    animations: animationsOut,
  };

  fs.mkdirSync(output, { recursive: true });
  const outPath = path.join(output, 'poses.json');
  writeAtomic(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('');
  for (const line of summary) console.log(line);

  return {
    success: errors.length === 0,
    output: outPath,
    errors,
  };
}
