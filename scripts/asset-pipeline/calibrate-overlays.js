#!/usr/bin/env node
/**
 * Seed the overlay editor's manifest with pose-derived starting positions.
 *
 * For every (fighter, accessory category) that doesn't already have a
 * calibration in `public/assets/overlays/manifest.json`, compute per-frame
 * anchors from the fighter's `poses.json` (MediaPipe output) and write them
 * into the manifest. Existing entries — whether hand-tuned in the editor or
 * from a previous run — are preserved by default.
 *
 * Usage:
 *   node scripts/asset-pipeline/calibrate-overlays.js
 *   node scripts/asset-pipeline/calibrate-overlays.js --fighter=simon
 *   node scripts/asset-pipeline/calibrate-overlays.js --category=gafas
 *   node scripts/asset-pipeline/calibrate-overlays.js --force    # overwrite
 *   node scripts/asset-pipeline/calibrate-overlays.js --dry-run
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibrateCategoryForFighter } from './overlays/calibrate-hat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MANIFEST_PATH = join(REPO_ROOT, 'public/assets/overlays/manifest.json');
const ACCESSORY_CATALOG_PATH = join(REPO_ROOT, 'src/data/accessories.json');
const FIGHTERS_DIR = join(REPO_ROOT, 'public/assets/fighters');

// Must stay in sync with FIGHTERS_WITH_SPRITES in src/scenes/BootScene.js and
// src/scenes/OverlayEditorScene.js. Only these fighters have sprite strips
// (and therefore poses.json).
const FIGHTERS_WITH_SPRITES = [
  'simon',
  'jeka',
  'chicha',
  'cata',
  'carito',
  'mao',
  'peks',
  'lini',
  'alv',
  'sun',
  'gartner',
  'richi',
  'cami',
  'migue',
  'bozzi',
  'angy',
];

function parseArgs(argv) {
  const out = { force: false, dryRun: false, quiet: false, fighter: null, category: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--force') out.force = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--quiet') out.quiet = true;
    else if (arg.startsWith('--fighter=')) out.fighter = arg.slice('--fighter='.length);
    else if (arg.startsWith('--category=')) out.category = arg.slice('--category='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAtomic(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return { version: 2, updatedAt: null, calibrations: {} };
  }
  const raw = readJson(MANIFEST_PATH);
  return {
    version: raw.version ?? 2,
    updatedAt: raw.updatedAt ?? null,
    calibrations: raw.calibrations ?? {},
  };
}

/**
 * Merge category calibrations into the manifest. Skips any (fighter, category,
 * animation) triple that already has an entry unless --force is passed.
 * Returns a summary of what changed.
 */
function merge(manifest, fighterId, category, catCalibration, { force }) {
  manifest.calibrations[fighterId] ??= {};
  manifest.calibrations[fighterId][category] ??= {};
  const byAnim = manifest.calibrations[fighterId][category];
  let added = 0;
  let skipped = 0;
  for (const [anim, entry] of Object.entries(catCalibration.animations)) {
    if (byAnim[anim] && !force) {
      skipped++;
      continue;
    }
    byAnim[anim] = entry;
    added++;
  }
  return { added, skipped, scale: catCalibration.uniformScale };
}

function main() {
  const args = parseArgs(process.argv);
  const log = args.quiet ? () => {} : (...m) => console.log(...m);

  const accessories = readJson(ACCESSORY_CATALOG_PATH);
  const categories = [...new Set(accessories.map((a) => a.category))];
  const activeCategories = args.category ? [args.category] : categories;
  for (const c of activeCategories) {
    if (!categories.includes(c)) {
      throw new Error(`category '${c}' not in accessory catalog (have: ${categories.join(', ')})`);
    }
  }

  const fighters = args.fighter ? [args.fighter] : FIGHTERS_WITH_SPRITES;
  for (const f of fighters) {
    if (!FIGHTERS_WITH_SPRITES.includes(f)) {
      throw new Error(`fighter '${f}' not in FIGHTERS_WITH_SPRITES`);
    }
  }

  const manifest = loadManifest();
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalMissing = 0;

  for (const fighterId of fighters) {
    const posesPath = join(FIGHTERS_DIR, fighterId, 'poses.json');
    if (!existsSync(posesPath)) {
      log(`skip ${fighterId}: no poses.json`);
      totalMissing++;
      continue;
    }
    const posesJson = readJson(posesPath);
    for (const category of activeCategories) {
      const cat = calibrateCategoryForFighter({
        fighterId,
        category,
        posesJson,
      });
      const { added, skipped, scale } = merge(manifest, fighterId, category, cat, {
        force: args.force,
      });
      log(`${fighterId}/${category}: scale=${scale.toFixed(3)}  +${added} added  ${skipped} kept`);
      totalAdded += added;
      totalSkipped += skipped;
    }
  }

  if (totalAdded > 0) {
    manifest.updatedAt = new Date().toISOString();
  }
  log('');
  log(
    `summary: ${totalAdded} added, ${totalSkipped} kept (use --force to overwrite), ${totalMissing} fighters missing poses.json`,
  );

  if (args.dryRun) {
    log('(dry run — manifest not written)');
    return;
  }
  if (totalAdded === 0) {
    log('(no changes — manifest not rewritten)');
    return;
  }
  writeJsonAtomic(MANIFEST_PATH, manifest);
  log(`wrote ${MANIFEST_PATH}`);
}

main();
