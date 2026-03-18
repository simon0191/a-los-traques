import { describe, it, expect } from 'vitest';

// Import only the class to call getDifficultyConfig as a method
// We construct with null scene/fighter/opponent since we only test config
import { AIController } from '../../src/systems/AIController.js';

function getConfig(difficulty) {
  // getDifficultyConfig is a regular method, call it directly
  return AIController.prototype.getDifficultyConfig(difficulty);
}

const EXPECTED_KEYS = [
  'thinkInterval', 'missRate', 'canBlock', 'canSpecial',
  'jumpChance', 'backOffChance', 'blockChance', 'idealRange',
  'approachRange', 'tooCloseRange', 'punishRecovery', 'readOpponentState',
];

describe('AI difficulty config', () => {
  const easy = getConfig('easy');
  const medium = getConfig('medium');
  const hard = getConfig('hard');

  it('all three difficulties return configs with all expected keys', () => {
    for (const cfg of [easy, medium, hard]) {
      for (const key of EXPECTED_KEYS) {
        expect(cfg).toHaveProperty(key);
      }
    }
  });

  it('missRate: easy > medium > hard', () => {
    expect(easy.missRate).toBeGreaterThan(medium.missRate);
    expect(medium.missRate).toBeGreaterThan(hard.missRate);
  });

  it('thinkInterval: easy > medium > hard (slower reaction = easier)', () => {
    expect(easy.thinkInterval).toBeGreaterThan(medium.thinkInterval);
    expect(medium.thinkInterval).toBeGreaterThan(hard.thinkInterval);
  });

  it('blockChance: easy(0) < medium < hard', () => {
    expect(easy.blockChance).toBe(0);
    expect(medium.blockChance).toBeGreaterThan(easy.blockChance);
    expect(hard.blockChance).toBeGreaterThan(medium.blockChance);
  });

  it('hard has punishRecovery, easy/medium do not', () => {
    expect(hard.punishRecovery).toBe(true);
    expect(medium.punishRecovery).toBe(false);
    expect(easy.punishRecovery).toBe(false);
  });

  it('all rates are between 0 and 1', () => {
    for (const cfg of [easy, medium, hard]) {
      expect(cfg.missRate).toBeGreaterThanOrEqual(0);
      expect(cfg.missRate).toBeLessThanOrEqual(1);
      expect(cfg.blockChance).toBeGreaterThanOrEqual(0);
      expect(cfg.blockChance).toBeLessThanOrEqual(1);
      expect(cfg.jumpChance).toBeGreaterThanOrEqual(0);
      expect(cfg.jumpChance).toBeLessThanOrEqual(1);
      expect(cfg.backOffChance).toBeGreaterThanOrEqual(0);
      expect(cfg.backOffChance).toBeLessThanOrEqual(1);
    }
  });
});
