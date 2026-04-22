/**
 * Headless replay engine — replays a fight from a reproducibility bundle
 * using pure simulation (no Phaser, no browser).
 */

import {
  captureGameState,
  createCombatSim,
  createFighterSim,
  hashGameState,
} from '@alostraques/sim';
import { GAME_WIDTH, ROUNDS_TO_WIN } from '../../packages/game/src/config.js';
import fightersData from '../../packages/game/src/data/fighters.json' with { type: 'json' };
import { simulateFrame } from '../../packages/game/src/systems/SimulationStep.js';
import { expandSparseInputs } from './input-utils.js';

const P1_START_X = Math.trunc(GAME_WIDTH * 0.3);
const P2_START_X = Math.trunc(GAME_WIDTH * 0.7);

/**
 * Replay a fight from a bundle and return the final state.
 *
 * @param {object} bundle - Reproducibility bundle (from bundle-generator)
 * @returns {{ finalStateHash: number, roundEvents: Array, totalFrames: number }}
 */
export function replayFromBundle(bundle) {
  const p1Data = fightersData.find((f) => f.id === bundle.config.p1FighterId);
  const p2Data = fightersData.find((f) => f.id === bundle.config.p2FighterId);

  if (!p1Data) throw new Error(`Fighter not found: ${bundle.config.p1FighterId}`);
  if (!p2Data) throw new Error(`Fighter not found: ${bundle.config.p2FighterId}`);

  const p1 = createFighterSim(P1_START_X, 0, p1Data);
  const p2 = createFighterSim(P2_START_X, 1, p2Data);
  const combat = createCombatSim();

  const totalFrames = Math.max(bundle.p1.totalFrames, bundle.p2.totalFrames);

  // Prefer confirmed input pairs (exact post-rollback inputs) over raw per-player inputs
  let p1Inputs, p2Inputs;
  if (bundle.confirmedInputs?.length > 0) {
    p1Inputs = expandSparseInputs(
      bundle.confirmedInputs.map((c) => ({ frame: c.frame, encoded: c.p1 })),
      totalFrames,
    );
    p2Inputs = expandSparseInputs(
      bundle.confirmedInputs.map((c) => ({ frame: c.frame, encoded: c.p2 })),
      totalFrames,
    );
  } else {
    p1Inputs = expandSparseInputs(bundle.p1.inputs, totalFrames);
    p2Inputs = expandSparseInputs(bundle.p2.inputs, totalFrames);
  }

  const roundEvents = [];
  let roundTransitionCooldown = 0;

  for (let frame = 0; frame <= totalFrames; frame++) {
    // Handle round transition cooldown (fighters reset between rounds)
    if (roundTransitionCooldown > 0) {
      roundTransitionCooldown--;
      if (roundTransitionCooldown === 0) {
        p1.resetForRound(P1_START_X);
        p2.resetForRound(P2_START_X);
        combat.startRound();
      }
      continue;
    }

    const roundEvent = simulateFrame(p1, p2, combat, p1Inputs[frame], p2Inputs[frame]);

    if (roundEvent) {
      roundEvents.push({ frame, ...roundEvent });
      combat.stopRound();

      if (roundEvent.winnerIndex === 0) combat.p1RoundsWon++;
      else combat.p2RoundsWon++;

      if (combat.p1RoundsWon >= ROUNDS_TO_WIN || combat.p2RoundsWon >= ROUNDS_TO_WIN) {
        combat.matchOver = true;
        break;
      }

      combat.roundNumber++;
      // Brief cooldown before next round starts (matches real game behavior)
      roundTransitionCooldown = 60;
    }
  }

  const finalSnapshot = captureGameState(totalFrames, p1, p2, combat);
  const finalHash = hashGameState(finalSnapshot);

  return {
    finalState: finalSnapshot,
    finalStateHash: finalHash,
    roundEvents,
    totalFrames,
    matchOver: combat.matchOver,
  };
}
