import { describe, expect, it } from 'vitest';

// Import only the class to call getDifficultyConfig as a method
// We construct with null scene/fighter/opponent since we only test config
import { AIController } from '../../src/systems/AIController.js';

function getConfig(difficulty) {
  // getDifficultyConfig is a regular method, call it directly
  return AIController.prototype.getDifficultyConfig(difficulty);
}

const EXPECTED_KEYS = [
  'thinkInterval',
  'missRate',
  'canBlock',
  'canSpecial',
  'jumpChance',
  'backOffChance',
  'blockChance',
  'idealRange',
  'approachRange',
  'tooCloseRange',
  'punishRecovery',
  'readOpponentState',
  'reactionJump',
  'specialChance',
  'attackWeights',
  'wallJumpChance',
];

describe('AI difficulty config', () => {
  const levels = [1, 2, 3, 4, 5].map(getConfig);

  it('all 5 levels return configs with all expected keys', () => {
    for (const cfg of levels) {
      for (const key of EXPECTED_KEYS) {
        expect(cfg).toHaveProperty(key);
      }
    }
  });

  it('missRate strictly decreases as level increases', () => {
    for (let i = 0; i < levels.length - 1; i++) {
      expect(levels[i].missRate).toBeGreaterThan(levels[i + 1].missRate);
    }
  });

  it('thinkInterval strictly decreases as level increases', () => {
    for (let i = 0; i < levels.length - 1; i++) {
      expect(levels[i].thinkInterval).toBeGreaterThan(levels[i + 1].thinkInterval);
    }
  });

  it('blockChance increases with levels', () => {
    expect(levels[0].blockChance).toBe(0); // Level 1 (Easy)
    for (let i = 0; i < levels.length - 1; i++) {
      expect(levels[i + 1].blockChance).toBeGreaterThanOrEqual(levels[i].blockChance);
    }
    expect(levels[4].blockChance).toBeGreaterThan(levels[2].blockChance);
  });

  it('level 4 and 5 have punishRecovery', () => {
    expect(levels[3].punishRecovery).toBe(true);
    expect(levels[4].punishRecovery).toBe(true);
    expect(levels[2].punishRecovery).toBe(false);
  });

  it('all rates are between 0 and 1', () => {
    for (const cfg of levels) {
      expect(cfg.missRate).toBeGreaterThanOrEqual(0);
      expect(cfg.missRate).toBeLessThanOrEqual(1);
      expect(cfg.blockChance).toBeGreaterThanOrEqual(0);
      expect(cfg.blockChance).toBeLessThanOrEqual(1);
      expect(cfg.jumpChance).toBeGreaterThanOrEqual(0);
      expect(cfg.jumpChance).toBeLessThanOrEqual(1);
      expect(cfg.backOffChance).toBeGreaterThanOrEqual(0);
      expect(cfg.backOffChance).toBeLessThanOrEqual(1);
      expect(cfg.specialChance).toBeGreaterThanOrEqual(0);
      expect(cfg.specialChance).toBeLessThanOrEqual(1);
      expect(cfg.wallJumpChance).toBeGreaterThanOrEqual(0);
      expect(cfg.wallJumpChance).toBeLessThanOrEqual(1);
    }
  });

  it('named difficulties map correctly', () => {
    expect(getConfig('easy')).toEqual(getConfig(1));
    expect(getConfig('medium')).toEqual(getConfig(3));
    expect(getConfig('hard')).toEqual(getConfig(4));
  });
});

describe('AI decision determinism', () => {
  it('produces identical decisions given the same seed', () => {
    const mockFighter = (x) => ({
      x,
      hp: 100,
      special: 0,
      state: 'idle',
      isOnGround: true,
      data: { stats: { speed: 5 } },
    });

    const createController = (seed, difficulty) => {
      const scene = { rollbackManager: { currentFrame: 0 } };
      const fighter = mockFighter(100);
      const opponent = mockFighter(200);
      const ctrl = new AIController(scene, fighter, opponent, difficulty);
      // Force the specific seed
      ctrl._rng = () => {
        seed += 0x6d2b79f5;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      return ctrl;
    };

    const c1 = createController(42, 3);
    const c2 = createController(42, 3);

    for (let i = 0; i < 50; i++) {
      c1.think();
      c2.think();
      expect(c1.decision).toEqual(c2.decision);
    }
  });
});
