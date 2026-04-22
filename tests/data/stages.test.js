import { describe, expect, it } from 'vitest';
import stages from '../../apps/game-vite/src/data/stages.json';

const REQUIRED_FIELDS = ['id', 'name', 'bgColor', 'groundColor', 'description', 'texture'];

describe('stages.json data validation', () => {
  it('has at least one stage', () => {
    expect(stages.length).toBeGreaterThan(0);
  });

  it('every stage has required fields', () => {
    for (const s of stages) {
      for (const field of REQUIRED_FIELDS) {
        expect(s, `${s.id || 'unknown'} missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it('texture values start with stages_', () => {
    for (const s of stages) {
      if (s.texture) {
        expect(s.texture, `${s.id} texture`).toMatch(/^stages_/);
      }
    }
  });

  it('colors are valid hex strings', () => {
    for (const s of stages) {
      expect(s.bgColor, `${s.id} bgColor`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(s.groundColor, `${s.id} groundColor`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('no duplicate stage IDs', () => {
    const ids = stages.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
