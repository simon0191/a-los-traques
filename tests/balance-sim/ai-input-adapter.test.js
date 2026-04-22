import { createFighterSim, decodeInput } from '@alostraques/sim';
import { describe, expect, it } from 'vitest';
import { GAME_WIDTH } from '../../apps/game-vite/src/config.js';
import fightersData from '../../apps/game-vite/src/data/fighters.json' with { type: 'json' };
import { createHeadlessAI, getEncodedInput } from '../../scripts/balance-sim/ai-input-adapter.js';

const P1_START_X = Math.trunc(GAME_WIDTH * 0.3);
const P2_START_X = Math.trunc(GAME_WIDTH * 0.7);

// Close enough for AI to consider attacking (within approachRange)
const CLOSE_X1 = 200;
const CLOSE_X2 = 250;

function makeFighters(p1Id = 'simon', p2Id = 'jeka', { close = false } = {}) {
  const p1Data = fightersData.find((f) => f.id === p1Id);
  const p2Data = fightersData.find((f) => f.id === p2Id);
  const x1 = close ? CLOSE_X1 : P1_START_X;
  const x2 = close ? CLOSE_X2 : P2_START_X;
  const p1 = createFighterSim(x1, 0, p1Data);
  const p2 = createFighterSim(x2, 1, p2Data);
  return { p1, p2 };
}

describe('createHeadlessAI', () => {
  it('creates an AI controller without a Phaser scene', () => {
    const { p1, p2 } = makeFighters();
    const ai = createHeadlessAI(p1, p2, 'hard', 42);
    expect(ai).toBeDefined();
    expect(ai.fighter).toBe(p1);
    expect(ai.opponent).toBe(p2);
    expect(ai.difficulty).toBe('hard');
  });
});

describe('getEncodedInput', () => {
  it('returns a valid encoded input integer', () => {
    const { p1, p2 } = makeFighters();
    const ai = createHeadlessAI(p1, p2, 'hard', 42);
    const input = getEncodedInput(ai);
    expect(typeof input).toBe('number');
    expect(input).toBeGreaterThanOrEqual(0);
    expect(input).toBeLessThan(512); // 9 bits max
  });

  it('produces deterministic outputs with the same seed', () => {
    const inputs1 = [];
    const inputs2 = [];

    for (let run = 0; run < 2; run++) {
      const { p1, p2 } = makeFighters();
      const ai = createHeadlessAI(p1, p2, 'hard', 42);
      const target = run === 0 ? inputs1 : inputs2;
      for (let i = 0; i < 100; i++) {
        target.push(getEncodedInput(ai));
      }
    }

    expect(inputs1).toEqual(inputs2);
  });

  it('produces different outputs with different seeds when in attack range', () => {
    // Fighters must be close so the AI makes RNG-dependent decisions (attack/block)
    const { p1: p1a, p2: p2a } = makeFighters('simon', 'jeka', { close: true });
    const { p1: p1b, p2: p2b } = makeFighters('simon', 'jeka', { close: true });
    const ai1 = createHeadlessAI(p1a, p2a, 'hard', 1);
    const ai2 = createHeadlessAI(p1b, p2b, 'hard', 99999);

    const inputs1 = [];
    const inputs2 = [];
    for (let i = 0; i < 100; i++) {
      inputs1.push(getEncodedInput(ai1));
      inputs2.push(getEncodedInput(ai2));
    }

    // With different seeds the sequences should diverge
    expect(inputs1).not.toEqual(inputs2);
  });

  it('consumes attack decisions (fires only once)', () => {
    // Position fighters close so AI will decide to attack
    const { p1, p2 } = makeFighters('simon', 'jeka', { close: true });
    const ai = createHeadlessAI(p1, p2, 'hard', 42);

    // Run until the AI decides to attack
    let attackFrame = -1;
    for (let i = 0; i < 200; i++) {
      const input = getEncodedInput(ai);
      const decoded = decodeInput(input);
      if (decoded.lp || decoded.hp || decoded.lk || decoded.hk || decoded.sp) {
        attackFrame = i;
        break;
      }
    }

    // AI should eventually attack (hard difficulty, thinkInterval=5)
    expect(attackFrame).toBeGreaterThanOrEqual(0);

    // The frame immediately after should NOT repeat the same attack
    // (it was consumed), unless think() fires again on this exact frame
    const nextInput = getEncodedInput(ai);
    const nextDecoded = decodeInput(nextInput);
    const hasAttack =
      nextDecoded.lp || nextDecoded.hp || nextDecoded.lk || nextDecoded.hk || nextDecoded.sp;
    // Attack was consumed, so next frame should have no attack
    // (unless think() coincidentally fires again — but even then, it resets first)
    expect(hasAttack).toBe(false);
  });

  it('decodes to valid input fields', () => {
    const { p1, p2 } = makeFighters();
    const ai = createHeadlessAI(p1, p2, 'hard', 42);

    for (let i = 0; i < 50; i++) {
      const input = getEncodedInput(ai);
      const decoded = decodeInput(input);
      // All fields should be booleans
      for (const key of ['left', 'right', 'up', 'down', 'lp', 'hp', 'lk', 'hk', 'sp']) {
        expect(typeof decoded[key]).toBe('boolean');
      }
      // Can't press left and right simultaneously
      expect(decoded.left && decoded.right).toBe(false);
    }
  });
});
