#!/usr/bin/env node

/**
 * cli.js -- Asset pipeline entry point for A Los Traques
 *
 * Usage:
 *   node scripts/asset-pipeline/cli.js <type> <config.json> [--skip-generate] [--delay N] [--retries N] [--ref PATH]
 *
 * Types: fighter, portrait, stage, ui, reference
 */

import fs from "fs";
import { runFighterPipeline } from "./pipelines/fighter.js";
import { runPortraitPipeline } from "./pipelines/portrait.js";
import { runStagePipeline } from "./pipelines/stage.js";
import { runUIPipeline } from "./pipelines/ui.js";
import { runReferencePipeline } from "./pipelines/reference.js";

const PIPELINES = {
  fighter: runFighterPipeline,
  portrait: runPortraitPipeline,
  stage: runStagePipeline,
  ui: runUIPipeline,
  reference: runReferencePipeline,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { type: null, configPath: null, skipGenerate: false, delay: 3000, retries: 3, refs: [] };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--skip-generate":
        opts.skipGenerate = true;
        break;
      case "--delay":
        opts.delay = parseInt(args[++i], 10);
        break;
      case "--retries":
        opts.retries = parseInt(args[++i], 10);
        break;
      case "--ref":
        opts.refs.push(args[++i]);
        break;
      default:
        positional.push(args[i]);
    }
  }

  opts.type = positional[0];
  opts.configPath = positional[1];
  return opts;
}

async function main() {
  const opts = parseArgs();

  if (!opts.type || !opts.configPath) {
    console.error("Usage: node cli.js <type> <config.json> [--skip-generate] [--delay N] [--retries N]");
    console.error(`Types: ${Object.keys(PIPELINES).join(", ")}`);
    process.exit(1);
  }

  if (!PIPELINES[opts.type]) {
    console.error(`Unknown pipeline type: "${opts.type}"`);
    console.error(`Available: ${Object.keys(PIPELINES).join(", ")}`);
    process.exit(1);
  }

  if (!fs.existsSync(opts.configPath)) {
    console.error(`Config file not found: ${opts.configPath}`);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(opts.configPath, "utf-8"));
  } catch (err) {
    console.error(`Error reading config: ${err.message}`);
    process.exit(1);
  }

  // Merge CLI flags into config
  config.skipGenerate = opts.skipGenerate;
  config.delay = opts.delay;
  config.retries = opts.retries;

  // Merge reference images from CLI --ref flags with manifest referenceImages
  const manifestRefs = config.referenceImages || [];
  config.referenceImages = [...manifestRefs, ...opts.refs];

  console.log(`\n=== Asset Pipeline: ${opts.type} ===`);
  console.log(`Config: ${opts.configPath}`);
  console.log(`Output: ${config.output}`);
  console.log(`Skip generate: ${opts.skipGenerate}`);
  console.log(`Delay: ${opts.delay}ms, Retries: ${opts.retries}`);
  if (config.referenceImages.length > 0) {
    console.log(`Reference images: ${config.referenceImages.join(", ")}`);
  }
  console.log();

  const pipeline = PIPELINES[opts.type];
  const result = await pipeline(config);

  console.log("\n=== Pipeline Complete ===");
  if (result.success) {
    console.log(`Output: ${result.output}`);
  } else {
    console.error("Pipeline finished with errors");
    if (result.errors?.length) {
      for (const err of result.errors) {
        console.error(`  - ${err.name || err.id}: ${err.error}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
