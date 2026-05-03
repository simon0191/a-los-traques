/**
 * Gym-like environment wrapper for El Cerebro RL training (RFC 0020 §5).
 *
 * Wraps SimulationEngine.tick() with:
 *   - reset()   → start a new match, return initial observation
 *   - step(action) → advance one decision step, return { obs, reward, done, info }
 *   - observe() → extract normalized observation vector from current state
 *
 * The agent controls P1; the opponent (P2) is driven by a callback.
 * Frame-skip: the agent decides every `decisionInterval` frames; the action
 * repeats during intermediate frames. Only decision-point transitions are
 * returned to the caller.
 */

import {
  createCombatSim,
  createFighterSim,
  FP_SCALE,
  GAME_WIDTH,
  GROUND_Y,
  MAX_HP,
  MAX_SPECIAL_FP,
  MAX_STAMINA_FP,
  ROUND_TIME,
  STAGE_LEFT,
  STAGE_RIGHT,
  tick,
} from '@alostraques/sim';
import { actionToEncoded, NUM_ACTIONS } from './action-table.js';

// Observation vector size: 47 floats (RFC 0020 §1).
export const OBS_DIM = 47;

// Max cooldown across all default moves (special: 8+4+10 = 22 frames).
const MAX_COOLDOWN = 22;
const MAX_COMBO = 10;
const MAX_BLOCKSTUN = 12;
const STAGE_WIDTH = STAGE_RIGHT - STAGE_LEFT;

// Default P1/P2 start positions (pixels).
const P1_START_X = GAME_WIDTH * 0.3;
const P2_START_X = GAME_WIDTH * 0.7;

// Max frames per match before forced termination (safety net).
const MAX_MATCH_FRAMES = 60 * 60 * 5; // 5 minutes at 60fps

// State string → one-hot index.
const STATE_MAP = {
  idle: 0,
  walking: 1,
  jumping: 2,
  attacking: 3,
  hurt: 4,
  knockdown: 5,
  blocking: 6,
};
const NUM_STATES = 7;

/**
 * @param {object} opts
 * @param {object} opts.fighterData  Fighter JSON data for P1 (stats + moves)
 * @param {object} opts.opponentData Fighter JSON data for P2
 * @param {(p2: import('@alostraques/sim').FighterSim, p1: import('@alostraques/sim').FighterSim) => number} opts.opponentPolicy
 *   Callback returning a 9-bit encoded input for P2 each frame.
 * @param {number} [opts.decisionInterval=4]  Frames between agent decisions (frame-skip).
 * @param {number} [opts.obsDelay=0]  Observation delay in frames (difficulty knob §8).
 */
export function createEnv({
  fighterData,
  opponentData,
  opponentPolicy,
  decisionInterval = 4,
  obsDelay = 0,
}) {
  let p1, p2, combat, frame;
  let prevP1Hp, prevP2Hp;
  // Ring buffer for delayed observations.
  let obsBuffer;
  let obsBufferIdx;

  /**
   * Compute the maximum attack cooldown for a fighter's moves, used to
   * normalise the `attackCooldown` and `attackFrameElapsed` observations.
   */
  function maxCooldown(data) {
    if (!data?.moves) return MAX_COOLDOWN;
    let max = MAX_COOLDOWN;
    for (const m of Object.values(data.moves)) {
      const total = (m.startup ?? 0) + (m.active ?? 0) + (m.recovery ?? 0);
      if (total > max) max = total;
    }
    return max;
  }

  const p1MaxCooldown = maxCooldown(fighterData);
  const p2MaxCooldown = maxCooldown(opponentData);

  /** Extract a 47-dim normalised observation from the current sim state. */
  function observe() {
    const obs = new Float32Array(OBS_DIM);
    let idx = 0;

    function writeFighter(f, mcd) {
      // Position (2)
      obs[idx++] = f.simX / FP_SCALE / STAGE_RIGHT;
      obs[idx++] = f.simY / FP_SCALE / GROUND_Y;
      // Velocity (2) — normalise by a reasonable max vel (~350 px/s)
      const maxVel = 350;
      obs[idx++] = Math.max(-1, Math.min(1, f.simVX / FP_SCALE / maxVel));
      obs[idx++] = Math.max(-1, Math.min(1, f.simVY / FP_SCALE / maxVel));
      // Resources (3)
      obs[idx++] = f.hp / MAX_HP;
      obs[idx++] = f.stamina / MAX_STAMINA_FP;
      obs[idx++] = f.special / MAX_SPECIAL_FP;
      // State one-hot (7)
      const si = STATE_MAP[f.state] ?? 0;
      for (let j = 0; j < NUM_STATES; j++) obs[idx++] = j === si ? 1 : 0;
      // Attack info (3)
      obs[idx++] = f.attackCooldown / mcd;
      obs[idx++] = (f.attackFrameElapsed ?? 0) / mcd;
      obs[idx++] =
        f.currentAttack &&
        f.attackFrameElapsed >= (f.currentAttack.startup ?? 0) &&
        f.attackFrameElapsed < (f.currentAttack.startup ?? 0) + (f.currentAttack.active ?? 0)
          ? 1
          : 0;
      // Combat (2)
      obs[idx++] = (f.comboCount ?? 0) / MAX_COMBO;
      obs[idx++] = (f.blockTimer ?? 0) / MAX_BLOCKSTUN;
      // Flags (4)
      obs[idx++] = f.isOnGround ? 1 : 0;
      obs[idx++] = f.facingRight ? 1 : 0;
      obs[idx++] = f.hasDoubleJumped ? 1 : 0;
      obs[idx++] = f._isTouchingWall ? 1 : 0;
    }

    writeFighter(p1, p1MaxCooldown);
    writeFighter(p2, p2MaxCooldown);

    // Context (3)
    obs[idx++] = combat.timer / ROUND_TIME;
    const dist = Math.abs(p1.simX - p2.simX) / FP_SCALE;
    obs[idx++] = dist / STAGE_WIDTH;
    const p1Px = p1.simX / FP_SCALE;
    const distToWall = Math.min(p1Px - STAGE_LEFT, STAGE_RIGHT - p1Px);
    obs[idx++] = distToWall / (STAGE_WIDTH / 2);

    return obs;
  }

  /**
   * Compute per-frame reward components from the sim state delta.
   * Called once per sim frame; rewards accumulate over the decision interval.
   */
  function frameReward(events) {
    let r = 0;
    // Damage dealt/received (dense)
    const dmgDealt = prevP2Hp - p2.hp;
    const dmgTaken = prevP1Hp - p1.hp;
    if (dmgDealt > 0) r += dmgDealt / 100;
    if (dmgTaken > 0) r -= dmgTaken / 100;
    prevP1Hp = p1.hp;
    prevP2Hp = p2.hp;

    // Approach reward (dense, +0.0001/frame) — RFC §3
    const velXDir = Math.sign(p1.simVX);
    const opponentDir = Math.sign(p2.simX - p1.simX);
    if (velXDir !== 0 && velXDir === opponentDir) r += 0.0001;

    // Whiff penalty — RFC §3
    for (const evt of events) {
      if (evt.type === 'whiff' && evt.playerIndex === 0) {
        const distPx = Math.abs(p1.simX - p2.simX) / FP_SCALE;
        const avgReach = computeAvgReach(fighterData);
        if (distPx < avgReach * 1.5) r -= 0.01;
      }
    }

    // Corner penalty — RFC §3
    const p1Px = p1.simX / FP_SCALE;
    const wallDist = Math.min(p1Px - STAGE_LEFT, STAGE_RIGHT - p1Px);
    if (wallDist < 30) r -= 0.005;

    return r;
  }

  /** Reset the environment for a new match. Returns initial observation. */
  function reset() {
    p1 = createFighterSim(P1_START_X, 0, fighterData);
    p2 = createFighterSim(P2_START_X, 1, opponentData);
    combat = createCombatSim({ suppressRoundEvents: true });
    frame = 0;
    prevP1Hp = p1.hp;
    prevP2Hp = p2.hp;

    // Init observation delay buffer
    if (obsDelay > 0) {
      obsBuffer = [];
      obsBufferIdx = 0;
      const initial = observe();
      for (let i = 0; i <= obsDelay; i++) obsBuffer.push(new Float32Array(initial));
    }

    return getDelayedObs();
  }

  /** Push current observation into the delay buffer and return the delayed one. */
  function getDelayedObs() {
    const current = observe();
    if (obsDelay <= 0) return current;
    obsBuffer[obsBufferIdx % obsBuffer.length] = current;
    obsBufferIdx++;
    const delayedIdx = (obsBufferIdx - obsDelay - 1 + obsBuffer.length * 100) % obsBuffer.length;
    return new Float32Array(obsBuffer[delayedIdx]);
  }

  /**
   * Step the environment by one decision interval.
   * @param {number} actionIndex  0–71 discrete action
   * @returns {{ obs: Float32Array, reward: number, done: boolean, info: object }}
   */
  function step(actionIndex) {
    if (actionIndex < 0 || actionIndex >= NUM_ACTIONS) {
      throw new RangeError(`actionIndex ${actionIndex} out of range [0, ${NUM_ACTIONS})`);
    }

    const p1Encoded = actionToEncoded(actionIndex);
    let totalReward = 0;
    let roundEvent = null;
    const allEvents = [];

    // Run `decisionInterval` sim frames with the same action.
    for (let s = 0; s < decisionInterval; s++) {
      // Skip round transitions instantly (same pattern as match-runner.js).
      if (!combat.roundActive && combat.transitionTimer > 0) {
        combat.transitionTimer = 0;
        p1.resetForRound(P1_START_X);
        p2.resetForRound(P2_START_X);
        combat.timer = ROUND_TIME;
        combat._timerAccumulator = 0;
        combat.roundActive = true;
        prevP1Hp = p1.hp;
        prevP2Hp = p2.hp;
      }

      if (combat.matchOver || frame >= MAX_MATCH_FRAMES) break;

      const p2Encoded = opponentPolicy(p2, p1);
      const result = tick(p1, p2, combat, p1Encoded, p2Encoded, frame);
      frame++;

      totalReward += frameReward(result.events);
      allEvents.push(...result.events);

      if (result.roundEvent) {
        roundEvent = result.roundEvent;
        // Sparse round outcome reward — RFC §3
        if (roundEvent.winnerIndex === 0) {
          totalReward += roundEvent.type === 'timeup' ? 0.5 : 1.0;
        } else {
          totalReward -= 1.0;
        }
      }
    }

    const done = combat.matchOver || frame >= MAX_MATCH_FRAMES;
    const obs = getDelayedObs();

    return {
      obs,
      reward: totalReward,
      done,
      info: {
        frame,
        roundEvent,
        p1Hp: p1.hp,
        p2Hp: p2.hp,
        p1RoundsWon: combat.p1RoundsWon,
        p2RoundsWon: combat.p2RoundsWon,
        matchOver: combat.matchOver,
        events: allEvents,
      },
    };
  }

  return { reset, step, observe, OBS_DIM, NUM_ACTIONS };
}

/** Compute average reach across a fighter's moves, with fallback. */
function computeAvgReach(fighterData) {
  if (!fighterData?.moves) return 45;
  const reaches = Object.values(fighterData.moves)
    .map((m) => m.reach)
    .filter((r) => typeof r === 'number' && r > 0);
  if (reaches.length === 0) return 45; // global median fallback
  return reaches.reduce((a, b) => a + b, 0) / reaches.length;
}

export { computeAvgReach };
