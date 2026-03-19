import { describe, expect, it } from 'vitest';
import { MAX_STAMINA } from '../../src/config.js';
import fighters from '../../src/data/fighters.json';

const REQUIRED_FIELDS = ['id', 'name', 'stats', 'moves'];
const _STAT_KEYS = ['hp', 'speed', 'power', 'defense', 'special'];
const MOVE_TYPES = ['lightPunch', 'heavyPunch', 'lightKick', 'heavyKick', 'special'];
const MOVE_FIELDS = ['damage', 'startup', 'active', 'recovery'];

describe('fighters.json data validation', () => {
  it('has 16 fighters', () => {
    expect(fighters.length).toBe(16);
  });

  it('every fighter has required fields', () => {
    for (const f of fighters) {
      for (const field of REQUIRED_FIELDS) {
        expect(f, `${f.id || 'unknown'} missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it('stats are numbers in valid range (hp=100, others 1-5)', () => {
    for (const f of fighters) {
      expect(f.stats.hp).toBe(100);
      for (const key of ['speed', 'power', 'defense', 'special']) {
        const val = f.stats[key];
        expect(val, `${f.id}.stats.${key} = ${val}`).toBeGreaterThanOrEqual(1);
        expect(val, `${f.id}.stats.${key} = ${val}`).toBeLessThanOrEqual(5);
        expect(Number.isFinite(val), `${f.id}.stats.${key} not a number`).toBe(true);
      }
    }
  });

  it('all 5 move types exist per fighter', () => {
    for (const f of fighters) {
      for (const move of MOVE_TYPES) {
        expect(f.moves, `${f.id} missing move ${move}`).toHaveProperty(move);
      }
    }
  });

  it('each move has damage, startup, active, recovery as positive numbers', () => {
    for (const f of fighters) {
      for (const moveType of MOVE_TYPES) {
        const move = f.moves[moveType];
        for (const field of MOVE_FIELDS) {
          const val = move[field];
          expect(val, `${f.id}.moves.${moveType}.${field}`).toBeGreaterThan(0);
          expect(Number.isFinite(val), `${f.id}.moves.${moveType}.${field} not a number`).toBe(
            true,
          );
        }
      }
    }
  });

  it('special move costs do not exceed MAX_STAMINA', () => {
    for (const f of fighters) {
      const cost = f.moves.special.cost;
      if (cost !== undefined) {
        expect(cost, `${f.id} special cost`).toBeLessThanOrEqual(MAX_STAMINA);
      }
    }
  });

  it('no duplicate fighter IDs', () => {
    const ids = fighters.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
