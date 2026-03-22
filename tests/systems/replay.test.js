import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayFromBundle } from '../helpers/replay-engine.js';

const fixturePath = resolve(import.meta.dirname, '../fixtures/known-good-bundle.json');
const bundle = JSON.parse(readFileSync(fixturePath, 'utf-8'));

describe('replay from bundle', () => {
  it('replay is deterministic (same result across runs)', () => {
    const result1 = replayFromBundle(bundle);
    const result2 = replayFromBundle(bundle);

    expect(result1.finalStateHash).toBe(result2.finalStateHash);
  });

  it('produces round events', () => {
    const result = replayFromBundle(bundle);

    expect(result.roundEvents.length).toBeGreaterThan(0);
    for (const event of result.roundEvents) {
      expect(event.frame).toBeGreaterThan(0);
      expect(event.winnerIndex === 0 || event.winnerIndex === 1).toBe(true);
    }
  });

  it('produces a final state hash', () => {
    const result = replayFromBundle(bundle);

    expect(result.finalStateHash).not.toBe(0);
    expect(result.totalFrames).toBeGreaterThan(0);
  });
});
