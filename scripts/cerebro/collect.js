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
 *   node scripts/cerebro/collect.js --fighter=simon --episodes=10000 --difficulty=hard_plus
 *   node scripts/cerebro/collect.js --fighter=simon --episodes=5000 --opponent-model=checkpoints/simon/final.onnx
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHeadlessAI, getEncodedInput } from '../balance-sim/ai-input-adapter.js';
import { actionToEncoded, decisionToActionIndex, NUM_ACTIONS } from './action-table.js';
import { createEnv, OBS_DIM } from './env.js';
import { createStorage } from './storage.js';

// --- CLI args ---

const { values: args } = parseArgs({
  options: {
    fighter: { type: 'string' },
    episodes: { type: 'string', default: '1000' },
    difficulty: { type: 'string', default: 'hard' },
    'opponent-difficulty': { type: 'string' },
    'opponent-model': { type: 'string' },
    'frame-skip': { type: 'string', default: '4' },
    'out-dir': { type: 'string' },
    'batch-size': { type: 'string', default: '10000' },
    seed: { type: 'string', default: '42' },
  },
  strict: false,
});

if (!args.fighter) {
  console.error('Usage: node scripts/cerebro/collect.js --fighter=<id> [--episodes=N]');
  console.error('  --fighter            Fighter ID (e.g. simon, jeka, alv)');
  console.error('  --episodes           Number of matches (default: 1000)');
  console.error('  --difficulty         AI difficulty for data agent (default: hard)');
  console.error('  --opponent-difficulty Opponent rule-based difficulty (default: same)');
  console.error('  --opponent-model     ONNX model path for opponent (self-play)');
  console.error('  --frame-skip         Decision interval in frames (default: 4)');
  console.error('  --out-dir            Output directory (default: data/cerebro/<fighter>/)');
  console.error('  --batch-size         Transitions per batch file (default: 10000)');
  console.error('  --seed               PRNG seed (default: 42)');
  process.exit(1);
}

const fighterId = args.fighter;
const episodes = Number.parseInt(args.episodes, 10);
const difficulty = args.difficulty;
const opponentDifficulty = args['opponent-difficulty'] ?? difficulty;
const opponentModelPath = args['opponent-model'] ?? null;
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

// --- Load ONNX opponent model (if self-play) ---

let onnxSession = null;
let ort = null;
if (opponentModelPath) {
  try {
    ort = await import('onnxruntime-node');
    onnxSession = await ort.InferenceSession.create(resolve(opponentModelPath));
    console.log(`Opponent model loaded: ${opponentModelPath}`);
  } catch (err) {
    console.error(`Failed to load opponent model: ${err.message}`);
    process.exit(1);
  }
}

/** Run ONNX inference for opponent in self-play mode. */
function onnxInferAction(obs) {
  const inputTensor = new ort.Tensor('float32', obs, [1, OBS_DIM]);
  const results = onnxSession.runSync
    ? onnxSession.runSync({ [onnxSession.inputNames[0]]: inputTensor })
    : null;

  // Fallback for async-only runtimes — use random action
  if (!results) return Math.floor(Math.random() * NUM_ACTIONS);

  const qValues = results[onnxSession.outputNames[0]].data;
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

// --- Opponent observation extraction (mirrors env.js but for P2's perspective) ---

function extractOppObs(p2, p1, combat) {
  const obs = new Float32Array(OBS_DIM);
  let idx = 0;
  const maxVel = 350;

  const writeFighter = (f) => {
    obs[idx++] = f.simX / 1000 / 460;
    obs[idx++] = f.simY / 1000 / 220;
    obs[idx++] = Math.max(-1, Math.min(1, f.simVX / 1000 / maxVel));
    obs[idx++] = Math.max(-1, Math.min(1, f.simVY / 1000 / maxVel));
    obs[idx++] = f.hp / 100;
    obs[idx++] = f.stamina / 100000;
    obs[idx++] = f.special / 100000;
    const stateMap = {
      idle: 0,
      walking: 1,
      jumping: 2,
      attacking: 3,
      hurt: 4,
      knockdown: 5,
      blocking: 6,
    };
    const si = stateMap[f.state] ?? 0;
    for (let j = 0; j < 7; j++) obs[idx++] = j === si ? 1 : 0;
    obs[idx++] = f.attackCooldown / 22;
    obs[idx++] = (f.attackFrameElapsed ?? 0) / 22;
    obs[idx++] =
      f.currentAttack &&
      f.attackFrameElapsed >= (f.currentAttack.startup ?? 0) &&
      f.attackFrameElapsed < (f.currentAttack.startup ?? 0) + (f.currentAttack.active ?? 0)
        ? 1
        : 0;
    obs[idx++] = (f.comboCount ?? 0) / 10;
    obs[idx++] = (f.blockTimer ?? 0) / 12;
    obs[idx++] = f.isOnGround ? 1 : 0;
    obs[idx++] = f.facingRight ? 1 : 0;
    obs[idx++] = f.hasDoubleJumped ? 1 : 0;
    obs[idx++] = f._isTouchingWall ? 1 : 0;
  };

  // From P2's perspective: self = p2, opponent = p1
  writeFighter(p2);
  writeFighter(p1);

  obs[idx++] = (combat?.timer ?? 60) / 60;
  const dist = Math.abs(p2.simX - p1.simX) / 1000;
  obs[idx++] = dist / 440;
  const p2Px = p2.simX / 1000;
  obs[idx++] = Math.min(p2Px - 20, 460 - p2Px) / 220;

  return obs;
}

// --- Run collection ---

const opponentLabel = opponentModelPath
  ? `ONNX (${opponentModelPath})`
  : `rule-based ${opponentDifficulty}`;
console.log(`\n=== El Cerebro: Data Collection ===`);
console.log(`Fighter: ${fighterId}`);
console.log(`Episodes: ${episodes}`);
console.log(`P1 difficulty: ${difficulty}`);
console.log(`Opponent: ${opponentLabel}`);
console.log(`Frame skip: ${frameSkip}`);
console.log(`Output: ${outDir}/`);
console.log('');

const storage = createStorage({ outDir, batchSize });
const startTime = Date.now();
let totalSteps = 0;

for (let ep = 0; ep < episodes; ep++) {
  const seed = baseSeed + ep * 2;

  let p1Ai = null;
  let p2Ai = null;
  let p1Action = 0;

  const opponentPolicy = (p2, p1) => {
    // Init P1 rule-based AI lazily (for action labeling)
    if (!p1Ai) {
      p1Ai = createHeadlessAI(p1, p2, difficulty, seed);
    }
    p1Ai.update(0, 0);
    const d = p1Ai.decision;
    p1Action = decisionToActionIndex(d);
    if (d.jump) d.jump = false;
    if (d.attack) d.attack = null;

    // Opponent: ONNX model or rule-based
    if (onnxSession) {
      const oppObs = extractOppObs(p2, p1, null);
      const oppAction = onnxInferAction(oppObs);
      return actionToEncoded(oppAction);
    }
    if (!p2Ai) {
      p2Ai = createHeadlessAI(p2, p1, opponentDifficulty, seed + 10000);
    }
    return getEncodedInput(p2Ai);
  };

  const env = createEnv({
    fighterData,
    opponentData: fighterData,
    opponentPolicy,
    decisionInterval: frameSkip,
  });

  let obs = env.reset();
  let done = false;

  while (!done) {
    const action = p1Action;
    const result = env.step(action);
    storage.add(obs, action, result.reward, result.obs, result.done);
    totalSteps++;
    obs = result.obs;
    done = result.done;
  }

  if ((ep + 1) % 100 === 0 || ep === episodes - 1) {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (ep + 1) / elapsed;
    console.log(`  ep ${ep + 1}/${episodes} | ${totalSteps} transitions | ${rate.toFixed(0)} ep/s`);
  }
}

storage.flush();

const elapsed = (Date.now() - startTime) / 1000;
console.log(`\n=== Collection Complete ===`);
console.log(`Episodes: ${episodes}`);
console.log(`Transitions: ${storage.totalTransitions()}`);
console.log(`Time: ${elapsed.toFixed(1)}s (${(episodes / elapsed).toFixed(0)} ep/s)`);
console.log(`Output: ${outDir}/`);
