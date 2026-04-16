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
