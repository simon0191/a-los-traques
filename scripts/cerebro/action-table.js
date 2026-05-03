/**
 * Action table for El Cerebro RL agent (RFC 0020 §2).
 *
 * Maps a discrete action index (0-71) to the 9-bit encoded input that
 * SimulationEngine.tick() expects. The multi-discrete space is:
 *
 *   Movement: left(-1) / none(0) / right(1)  →  3 options
 *   Jump:     no(0) / yes(1)                  →  2 options
 *   Block:    no(0) / yes(1)                  →  2 options
 *   Attack:   none / lp / hp / lk / hk / sp   →  6 options
 *
 *   Total: 3 × 2 × 2 × 6 = 72 combinations
 *
 * Iteration order (outermost → innermost): movement → jump → block → attack.
 * Strides: movement(24) × jump(12) × block(6) × attack(1).
 *
 * Index formula: (moveIdx * 24) + (jump * 12) + (block * 6) + attackIdx
 *   where moveIdx: left=0, none=1, right=2
 *         attackIdx: none=0, lp=1, hp=2, lk=3, hk=4, sp=5
 */

import { encodeInput } from '@alostraques/sim';

const MOVEMENTS = [-1, 0, 1]; // left, none, right
const ATTACKS = [null, 'lp', 'hp', 'lk', 'hk', 'sp'];

/**
 * Precomputed table: ACTION_TABLE[actionIndex] = { encoded, move, jump, block, attack }
 * - `encoded`: 9-bit integer ready for SimulationEngine.tick()
 * - `move/jump/block/attack`: human-readable fields for debugging
 */
const ACTION_TABLE = [];

for (const move of MOVEMENTS) {
  for (const jump of [0, 1]) {
    for (const block of [0, 1]) {
      for (const atk of ATTACKS) {
        const inputObj = {
          left: move === -1,
          right: move === 1,
          up: jump === 1,
          down: block === 1,
          lp: atk === 'lp',
          hp: atk === 'hp',
          lk: atk === 'lk',
          hk: atk === 'hk',
          sp: atk === 'sp',
        };
        ACTION_TABLE.push({
          encoded: encodeInput(inputObj),
          move,
          jump: jump === 1,
          block: block === 1,
          attack: atk,
        });
      }
    }
  }
}

/** Total number of discrete actions (72). */
export const NUM_ACTIONS = ACTION_TABLE.length;

/**
 * Convert a discrete action index to a 9-bit encoded input.
 * @param {number} actionIndex  0–71
 * @returns {number} encoded input for SimulationEngine.tick()
 */
export function actionToEncoded(actionIndex) {
  return ACTION_TABLE[actionIndex].encoded;
}

/**
 * Convert a discrete action index to a human-readable object.
 * @param {number} actionIndex  0–71
 * @returns {{ move: number, jump: boolean, block: boolean, attack: string|null }}
 */
export function actionToDecision(actionIndex) {
  const a = ACTION_TABLE[actionIndex];
  return { move: a.move, jump: a.jump, block: a.block, attack: a.attack };
}

/**
 * Convert a human-readable decision (AIController format) to an action index.
 * Used to label data collected from the rule-based AI.
 *
 * @param {{ moveDir: number, jump: boolean, block: boolean, attack: string|null }} decision
 * @returns {number} action index 0–71
 */
export function decisionToActionIndex(decision) {
  const moveIdx = decision.moveDir < 0 ? 0 : decision.moveDir > 0 ? 2 : 1;
  const jumpIdx = decision.jump ? 1 : 0;
  const blockIdx = decision.block ? 1 : 0;

  // Map AIController attack names to our compact names
  let atkIdx = 0;
  if (decision.attack) {
    const map = { lightPunch: 1, heavyPunch: 2, lightKick: 3, heavyKick: 4, special: 5 };
    atkIdx = map[decision.attack] ?? 0;
  }

  return moveIdx * 24 + jumpIdx * 12 + blockIdx * 6 + atkIdx;
}

export { ACTION_TABLE };
