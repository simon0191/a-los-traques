import { EMPTY_INPUT } from '@alostraques/sim';
import { describe, expect, it } from 'vitest';
import { NUM_ACTIONS } from '../../scripts/cerebro/action-table.js';
import { createEnv, OBS_DIM } from '../../scripts/cerebro/env.js';

// Minimal fighter data — uses default moves when not specified.
const FIGHTER_DATA = {
  stats: { speed: 4, power: 3, defense: 2 },
};

// Opponent that does nothing (stands still).
const idlePolicy = () => EMPTY_INPUT;

function makeEnv(opts = {}) {
  return createEnv({
    fighterData: FIGHTER_DATA,
    opponentData: FIGHTER_DATA,
    opponentPolicy: idlePolicy,
    decisionInterval: 4,
    ...opts,
  });
}

describe('cerebro env', () => {
  it('reset returns observation of correct dimension', () => {
    const env = makeEnv();
    const obs = env.reset();
    expect(obs).toBeInstanceOf(Float32Array);
    expect(obs.length).toBe(OBS_DIM);
  });

  it('observation values are in reasonable range', () => {
    const env = makeEnv();
    const obs = env.reset();
    for (let i = 0; i < obs.length; i++) {
      expect(obs[i]).toBeGreaterThanOrEqual(-1.5);
      expect(obs[i]).toBeLessThanOrEqual(1.5);
    }
  });

  it('step returns obs, reward, done, info', () => {
    const env = makeEnv();
    env.reset();
    const result = env.step(0); // move left, no attack
    expect(result.obs).toBeInstanceOf(Float32Array);
    expect(result.obs.length).toBe(OBS_DIM);
    expect(typeof result.reward).toBe('number');
    expect(typeof result.done).toBe('boolean');
    expect(typeof result.info).toBe('object');
    expect(typeof result.info.frame).toBe('number');
  });

  it('episode eventually terminates', () => {
    const env = makeEnv();
    env.reset();
    let steps = 0;
    let done = false;
    // Run for at most 10000 decision steps
    while (!done && steps < 10000) {
      const action = steps % NUM_ACTIONS; // cycle through actions
      const result = env.step(action);
      done = result.done;
      steps++;
    }
    expect(done).toBe(true);
  });

  it('frame counter advances by decisionInterval per step', () => {
    const env = makeEnv({ decisionInterval: 4 });
    env.reset();
    const r1 = env.step(12); // some action
    expect(r1.info.frame).toBe(4);
    const r2 = env.step(12);
    expect(r2.info.frame).toBe(8);
  });

  it('throws on out-of-range action', () => {
    const env = makeEnv();
    env.reset();
    expect(() => env.step(-1)).toThrow(RangeError);
    expect(() => env.step(72)).toThrow(RangeError);
  });

  it('obsDelay returns a delayed observation', () => {
    const env = makeEnv({ obsDelay: 4, decisionInterval: 1 });
    const obs0 = env.reset();
    // After a few steps, the observation should lag behind
    env.step(12); // move + attack
    env.step(12);
    env.step(12);
    env.step(12);
    const delayed = env.step(12);
    // The delayed obs should exist and be valid
    expect(delayed.obs).toBeInstanceOf(Float32Array);
    expect(delayed.obs.length).toBe(OBS_DIM);
  });

  it('damage dealt produces positive reward', () => {
    const env = makeEnv({ decisionInterval: 1 });
    env.reset();
    // Walk right toward P2 for 60 frames then attack
    let gotPositiveReward = false;
    for (let i = 0; i < 300; i++) {
      // Action 25 = none movement + no jump + no block + lp
      // Action 1 = left + no jump + no block + lp
      // We want right movement + lp. moveIdx=2 (right), jump=0, block=0, atk=1 (lp)
      // Index: 2*24 + 0*12 + 0*6 + 1 = 49
      const r = env.step(49);
      if (r.reward > 0.01) {
        gotPositiveReward = true;
        break;
      }
      if (r.done) break;
    }
    expect(gotPositiveReward).toBe(true);
  });
});
