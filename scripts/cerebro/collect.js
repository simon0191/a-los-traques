#!/usr/bin/env node
/**
 * Data collection CLI for El Cerebro (RFC 0020 §5, Tier 1).
 *
 * Runs N headless matches using the existing simulation, collects
 * (obs, action, reward, next_obs, done) transitions, and writes them
 * to disk in NumPy format for Python training.
 *
 * Usage:
 *   node scripts/cerebro/collect.js --fighter=simon --episodes=1000
 *   node scripts/cerebro/collect.js --fighter=simon --episodes=100000 --difficulty=hard_plus
 *
 * The agent (P1) is driven by the rule-based AI; the opponent (P2)
 * is also rule-based. This produces bootstrap data for offline DQN
 * training (Phase A of RFC §5).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHeadlessAI, getEncodedInput } from '../balance-sim/ai-input-adapter.js';
import { decisionToActionIndex } from './action-table.js';
import { createEnv } from './env.js';
import { createStorage } from './storage.js';

// --- CLI args ---

const { values: args } = parseArgs({
  options: {
    fighter: { type: 'string' },
    episodes: { type: 'string', default: '1000' },
    difficulty: { type: 'string', default: 'hard' },
    'opponent-difficulty': { type: 'string' },
    'frame-skip': { type: 'string', default: '4' },
    'out-dir': { type: 'string' },
    'batch-size': { type: 'string', default: '10000' },
    seed: { type: 'string', default: '42' },
  },
  strict: false,
});

if (!args.fighter) {
  console.error('Usage: node scripts/cerebro/collect.js --fighter=<id> [--episodes=N]');
  console.error('  --fighter        Fighter ID (e.g. simon, jeka, alv)');
  console.error('  --episodes       Number of matches to run (default: 1000)');
  console.error('  --difficulty     AI difficulty for data agent (default: hard)');
  console.error('  --opponent-difficulty  Opponent difficulty (default: same as --difficulty)');
  console.error('  --frame-skip     Decision interval in frames (default: 4)');
  console.error('  --out-dir        Output directory (default: data/cerebro/<fighter>/)');
  console.error('  --batch-size     Transitions per batch file (default: 10000)');
  console.error('  --seed           PRNG seed (default: 42)');
  process.exit(1);
}

const fighterId = args.fighter;
const episodes = Number.parseInt(args.episodes, 10);
const difficulty = args.difficulty;
const opponentDifficulty = args['opponent-difficulty'] ?? difficulty;
const frameSkip = Number.parseInt(args['frame-skip'], 10);
const outDir = args['out-dir'] ?? `data/cerebro/${fighterId}`;
const batchSize = Number.parseInt(args['batch-size'], 10);
const baseSeed = Number.parseInt(args.seed, 10);

// --- Load fighter data ---

const fightersPath = resolve(import.meta.dirname, '../../packages/game/src/data/fighters.json');
const allFighters = JSON.parse(readFileSync(fightersPath, 'utf-8'));
const fighterData = allFighters.find((f) => f.id === fighterId);

if (!fighterData) {
  const ids = allFighters.map((f) => f.id).join(', ');
  console.error(`Fighter "${fighterId}" not found. Available: ${ids}`);
  process.exit(1);
}

// --- Run collection ---

console.log(`\n=== El Cerebro: Data Collection ===`);
console.log(`Fighter: ${fighterId}`);
console.log(`Episodes: ${episodes}`);
console.log(`Difficulty: ${difficulty} (opponent: ${opponentDifficulty})`);
console.log(`Frame skip: ${frameSkip}`);
console.log(`Output: ${outDir}/`);
console.log('');

const storage = createStorage({ outDir, batchSize });
const startTime = Date.now();
let totalSteps = 0;

for (let ep = 0; ep < episodes; ep++) {
  const seed = baseSeed + ep * 2;

  // Create AI controllers for both sides.
  // We need the FighterSim references, but the env creates them internally.
  // Instead, use the env's opponentPolicy callback to drive P2 with AI,
  // and collect P1's actions from a separate AI instance.

  // Strategy: create the env, then create AI controllers that reference
  // the env's internal fighters. Since env.js doesn't expose internals,
  // we use a two-pass approach: the opponent policy callback receives
  // (p2, p1) FighterSim refs, and we create the AI on first call.

  let p1Ai = null;
  let p2Ai = null;

  const opponentPolicy = (p2, p1) => {
    if (!p2Ai) {
      p2Ai = createHeadlessAI(p2, p1, opponentDifficulty, seed + 10000);
    }
    return getEncodedInput(p2Ai);
  };

  const env = createEnv({
    fighterData,
    opponentData: fighterData, // mirror match for bootstrap
    opponentPolicy,
    decisionInterval: frameSkip,
  });

  let obs = env.reset();

  // Create P1 AI — we need it to generate actions, but we also need the
  // FighterSim references. Use a lazy init via a wrapper env step.
  // Actually, for data collection we need P1's AI to decide actions.
  // The env's step() takes an action index, so we:
  // 1. Create a temporary env just to get fighter refs (wasteful)
  // OR 2. Drive P1 with a separate AI that we init lazily.
  //
  // Cleanest: the opponentPolicy already shows the pattern. For P1,
  // we create the AI from the fighters the env uses internally.
  // But env.js doesn't expose them. Let's use a different approach:
  // create our own fighters just for AI decision-making, then map
  // decisions to action indices.

  // Simpler: create a standalone AI that references the actual sim fighters.
  // We can extract them from the env via a hook. But env.js is a closure.
  //
  // Pragmatic solution: create a separate sim just for AI decisions,
  // and sync state from observations. BUT that's complex and fragile.
  //
  // Best solution: modify nothing, just use random actions for now and
  // label them, OR accept that for bootstrap collection the agent IS
  // the rule-based AI. We run the match headless (like balance-sim)
  // and record transitions from P1's perspective.

  // Let's use the match-runner pattern directly instead of going through
  // env.step(). We import the sim primitives and run the loop ourselves,
  // but use env.observe() equivalent for observations and env's reward
  // shaping.

  // Actually, the simplest correct approach: the env already handles
  // everything. We just need to pick P1's action. For bootstrap data
  // collection, P1's action comes from the rule-based AI. We can create
  // a parallel AI controller and convert its decisions to action indices.
  //
  // The issue is that the AI needs FighterSim references. We solve this
  // by having the opponentPolicy callback also init P1's AI (since it
  // receives both fighter refs).

  let p1Action = 0; // Will be set by the first opponentPolicy call

  // Patch: capture fighter refs from the opponent policy callback
  const origPolicy = opponentPolicy;
  const wrappedPolicy = (p2, p1) => {
    if (!p1Ai) {
      p1Ai = createHeadlessAI(p1, p2, difficulty, seed);
    }
    // Tick P1's AI and capture its decision as an action index
    p1Ai.update(0, 0);
    const d = p1Ai.decision;
    p1Action = decisionToActionIndex(d);
    // Consume single-shot decisions
    if (d.jump) d.jump = false;
    if (d.attack) d.attack = null;

    return origPolicy(p2, p1);
  };

  // Re-create env with wrapped policy
  const env2 = createEnv({
    fighterData,
    opponentData: fighterData,
    opponentPolicy: wrappedPolicy,
    decisionInterval: frameSkip,
  });

  obs = env2.reset();
  let done = false;

  while (!done) {
    // P1's action was set by the wrappedPolicy during the previous step
    // (or is 0 for the first step — acceptable since the AI hasn't ticked yet).
    // We step with the action the AI chose.
    const action = p1Action;
    const result = env2.step(action);

    storage.add(obs, action, result.reward, result.obs, result.done);
    totalSteps++;

    obs = result.obs;
    done = result.done;
  }

  // Progress reporting
  if ((ep + 1) % 100 === 0 || ep === episodes - 1) {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (ep + 1) / elapsed;
    console.log(`  ep ${ep + 1}/${episodes} | ${totalSteps} transitions | ${rate.toFixed(0)} ep/s`);
  }
}

// Flush remaining transitions
storage.flush();

const elapsed = (Date.now() - startTime) / 1000;
console.log(`\n=== Collection Complete ===`);
console.log(`Episodes: ${episodes}`);
console.log(`Transitions: ${storage.totalTransitions()}`);
console.log(`Time: ${elapsed.toFixed(1)}s (${(episodes / elapsed).toFixed(0)} ep/s)`);
console.log(`Output: ${outDir}/`);
