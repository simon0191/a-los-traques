/**
 * Adapter that converts AIController decisions into encoded input integers
 * compatible with SimulationEngine.tick().
 *
 * AIController.applyDecisions() mutates the fighter directly, but tick()
 * expects encoded inputs. This adapter reads the decision object and
 * produces the same encoded integer that applyInputToFighter() would consume.
 */

import { encodeInput } from '@alostraques/sim';
import { AIController } from '../../apps/game-vite/src/systems/AIController.js';

/**
 * Create a headless AI controller (no Phaser scene needed).
 * @param {import('@alostraques/sim').FighterSim} fighter
 * @param {import('@alostraques/sim').FighterSim} opponent
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {number} seed
 * @returns {AIController}
 */
export function createHeadlessAI(fighter, opponent, difficulty, seed) {
  const ai = new AIController(null, fighter, opponent, difficulty);
  ai.setSeed(seed);
  return ai;
}

/**
 * Tick the AI and return an encoded input integer for this frame.
 * Reads AIController.decision and converts to the format expected by tick().
 * Consumes single-shot decisions (attack, jump) to prevent repeating.
 *
 * @param {AIController} ai
 * @returns {number} Encoded input integer (9 bits)
 */
export function getEncodedInput(ai) {
  // Tick the AI frame counter; fires think() when interval elapses
  ai.update(0, 0);

  const d = ai.decision;

  const encoded = encodeInput({
    left: d.moveDir < 0,
    right: d.moveDir > 0,
    up: d.jump,
    down: d.block,
    lp: d.attack === 'lightPunch',
    hp: d.attack === 'heavyPunch',
    lk: d.attack === 'lightKick',
    hk: d.attack === 'heavyKick',
    sp: d.attack === 'special',
  });

  // Consume single-shot decisions so they don't repeat every frame
  // until the next think() cycle. Movement (moveDir) persists intentionally.
  if (d.jump) d.jump = false;
  if (d.attack) d.attack = null;

  return encoded;
}
