#!/usr/bin/env node
/**
 * Evaluate a trained El Cerebro ONNX model against the rule-based AI.
 * (RFC 0020 §10 + go/no-go gate §12)
 *
 * Loads the ONNX model in Node.js via onnxruntime-node, runs N matches
 * against the rule-based AI at each difficulty level, and reports win
 * rates + style metrics.
 *
 * Usage:
 *   node scripts/cerebro/evaluate.js --model=simon.onnx --fighter=simon --fights=100
 *   node scripts/cerebro/evaluate.js --model=simon.onnx --fighter=simon --fights=1000 --difficulty=hard_plus
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createCombatSim, createFighterSim, GAME_WIDTH, ROUND_TIME, tick } from '@alostraques/sim';
import { createHeadlessAI, getEncodedInput } from '../balance-sim/ai-input-adapter.js';
import { actionToEncoded, NUM_ACTIONS } from './action-table.js';
import { createEnv, OBS_DIM } from './env.js';

// --- CLI args ---

const { values: args } = parseArgs({
  options: {
    model: { type: 'string' },
    fighter: { type: 'string' },
    fights: { type: 'string', default: '100' },
    difficulty: { type: 'string', default: 'all' },
    seed: { type: 'string', default: '42' },
  },
  strict: false,
});

if (!args.model || !args.fighter) {
  console.error('Usage: node scripts/cerebro/evaluate.js --model=<path.onnx> --fighter=<id>');
  console.error('  --model       Path to ONNX model');
  console.error('  --fighter     Fighter ID (e.g. simon)');
  console.error('  --fights      Matches per difficulty level (default: 100)');
  console.error('  --difficulty  Specific level or "all" (default: all)');
  console.error('  --seed        PRNG seed (default: 42)');
  process.exit(1);
}

const modelPath = resolve(args.model);
const fighterId = args.fighter;
const fightsPerLevel = Number.parseInt(args.fights, 10);
const baseSeed = Number.parseInt(args.seed, 10);

// --- Load fighter data ---

const fightersPath = resolve(import.meta.dirname, '../../packages/game/src/data/fighters.json');
const allFighters = JSON.parse(readFileSync(fightersPath, 'utf-8'));
const fighterData = allFighters.find((f) => f.id === fighterId);

if (!fighterData) {
  console.error(`Fighter "${fighterId}" not found.`);
  process.exit(1);
}

// --- Load ONNX model ---

let ort;
try {
  ort = await import('onnxruntime-node');
} catch {
  console.error('onnxruntime-node not installed. Run: bun add -d onnxruntime-node');
  process.exit(1);
}

console.log(`Loading model: ${modelPath}`);
const session = await ort.InferenceSession.create(modelPath);
console.log(`Model loaded. Input: ${session.inputNames}, Output: ${session.outputNames}`);

/**
 * Run inference on the ONNX model.
 * @param {Float32Array} obs  Observation vector (47 dims)
 * @returns {number} Best action index (argmax of Q-values)
 */
async function inferAction(obs) {
  const inputTensor = new ort.Tensor('float32', obs, [1, OBS_DIM]);
  const results = await session.run({ [session.inputNames[0]]: inputTensor });
  const qValues = results[session.outputNames[0]].data;

  // Argmax
  let bestIdx = 0;
  let bestQ = qValues[0];
  for (let i = 1; i < NUM_ACTIONS; i++) {
    if (qValues[i] > bestQ) {
      bestQ = qValues[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

// --- Run evaluation ---

const P1_START_X = GAME_WIDTH * 0.3;
const P2_START_X = GAME_WIDTH * 0.7;
const MAX_FRAMES = 18000;

const DIFFICULTIES =
  args.difficulty === 'all'
    ? ['easy', 'easy_plus', 'medium', 'hard', 'hard_plus']
    : [args.difficulty];

console.log(`\n=== El Cerebro: Evaluation ===`);
console.log(`Fighter: ${fighterId}`);
console.log(`Model: ${modelPath}`);
console.log(`Fights per level: ${fightsPerLevel}`);
console.log(`Difficulties: ${DIFFICULTIES.join(', ')}`);
console.log('');

const results = {};

for (const diff of DIFFICULTIES) {
  let wins = 0;
  let losses = 0;
  let totalDmgDealt = 0;
  let totalDmgTaken = 0;
  let totalHits = 0;
  let totalWhiffs = 0;
  let totalBlocks = 0;
  let totalSpecials = 0;
  const actionCounts = new Int32Array(NUM_ACTIONS);

  for (let fight = 0; fight < fightsPerLevel; fight++) {
    const seed = baseSeed + fight * 2;

    // P2 = rule-based AI opponent. Lazy-init from the env's internal
    // fighter refs so the AI reads live state, not stale externals.
    let p2Ai = null;
    const opponentPolicy = (p2Ref, p1Ref) => {
      if (!p2Ai) p2Ai = createHeadlessAI(p2Ref, p1Ref, diff, seed + 10000);
      return getEncodedInput(p2Ai);
    };

    const env = createEnv({
      fighterData,
      opponentData: fighterData,
      opponentPolicy,
      decisionInterval: 4,
    });

    let obs = env.reset();
    let done = false;

    while (!done) {
      const action = await inferAction(obs);
      actionCounts[action]++;
      const result = env.step(action);
      obs = result.obs;
      done = result.done;

      // Collect stats from events
      for (const evt of result.info.events) {
        if (evt.type === 'hit' && evt.attackerIndex === 0) {
          totalHits++;
          totalDmgDealt += evt.damage ?? 0;
        }
        if (evt.type === 'hit' && evt.attackerIndex === 1) {
          totalDmgTaken += evt.damage ?? 0;
        }
        if (evt.type === 'whiff' && evt.attackerIndex === 0) totalWhiffs++;
        if (evt.type === 'hit_blocked' && evt.attackerIndex === 0) totalBlocks++;
        if (evt.type === 'special_charge' && evt.attackerIndex === 0) totalSpecials++;
      }

      if (result.info.matchOver) {
        if (result.info.p1RoundsWon > result.info.p2RoundsWon) wins++;
        else losses++;
      }
    }
  }

  const winRate = wins / fightsPerLevel;
  const totalActions = actionCounts.reduce((a, b) => a + b, 0);
  const uniqueActions = actionCounts.filter((c) => c > 0).length;

  // Max action repeat %
  let maxRepeatPct = 0;
  for (let i = 0; i < NUM_ACTIONS; i++) {
    const pct = totalActions > 0 ? actionCounts[i] / totalActions : 0;
    if (pct > maxRepeatPct) maxRepeatPct = pct;
  }

  results[diff] = {
    wins,
    losses,
    winRate,
    avgDmgDealt: totalDmgDealt / fightsPerLevel,
    avgDmgTaken: totalDmgTaken / fightsPerLevel,
    avgHits: totalHits / fightsPerLevel,
    avgWhiffs: totalWhiffs / fightsPerLevel,
    avgBlocks: totalBlocks / fightsPerLevel,
    uniqueActions,
    maxActionRepeatPct: maxRepeatPct,
  };

  console.log(
    `  ${diff.padEnd(12)} | win: ${(winRate * 100).toFixed(1)}% (${wins}/${fightsPerLevel}) | dmg: ${results[diff].avgDmgDealt.toFixed(0)}/${results[diff].avgDmgTaken.toFixed(0)} | hits: ${results[diff].avgHits.toFixed(1)} | whiffs: ${results[diff].avgWhiffs.toFixed(1)} | actions: ${uniqueActions}/72 | max-repeat: ${(maxRepeatPct * 100).toFixed(1)}%`,
  );
}

// --- Go/No-Go Assessment ---

console.log('\n=== Go/No-Go Gate (RFC 0020 §12) ===');

const hardPlus = results.hard_plus ?? results[DIFFICULTIES[DIFFICULTIES.length - 1]];
if (hardPlus) {
  const checks = [
    {
      name: 'Win >50% vs hard_plus',
      pass: hardPlus.winRate > 0.5,
      value: `${(hardPlus.winRate * 100).toFixed(1)}%`,
    },
    {
      name: 'Unique actions >5',
      pass: hardPlus.uniqueActions > 5,
      value: `${hardPlus.uniqueActions}/72`,
    },
    {
      name: 'Max action repeat <40%',
      pass: hardPlus.maxActionRepeatPct < 0.4,
      value: `${(hardPlus.maxActionRepeatPct * 100).toFixed(1)}%`,
    },
    {
      name: 'Deals damage (avgHits >5)',
      pass: hardPlus.avgHits > 5,
      value: `${hardPlus.avgHits.toFixed(1)}`,
    },
  ];

  for (const c of checks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}: ${c.value}`);
  }

  const allPass = checks.every((c) => c.pass);
  console.log(
    `\n  Verdict: ${allPass ? '🟢 GO — proceed to Phase 3' : '🔴 NO-GO — needs more training or design changes'}`,
  );
}

console.log('');
