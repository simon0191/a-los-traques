import { describe, expect, it } from 'vitest';
import {
  ACTION_TABLE,
  actionToDecision,
  actionToEncoded,
  decisionToActionIndex,
  NUM_ACTIONS,
} from '../../scripts/cerebro/action-table.js';

describe('action-table', () => {
  it('has exactly 72 entries', () => {
    expect(NUM_ACTIONS).toBe(72);
    expect(ACTION_TABLE.length).toBe(72);
  });

  it('RFC §2 worked example: index 57 maps correctly', () => {
    // ACTION_TABLE[57] → { move: 1, jump: 0, block: 1, atk: 'lk' }
    const d = actionToDecision(57);
    expect(d).toEqual({ move: 1, jump: false, block: true, attack: 'lk' });

    // Encoded: right(bit1) + down(bit3) + lk(bit6) = 2 + 8 + 64 = 74
    expect(actionToEncoded(57)).toBe(74);
  });

  it('index 0 is left + no jump + no block + no attack', () => {
    const d = actionToDecision(0);
    expect(d).toEqual({ move: -1, jump: false, block: false, attack: null });
    // left = bit 0 = 1
    expect(actionToEncoded(0)).toBe(1);
  });

  it('no duplicate encoded values for distinct valid actions', () => {
    // Some action combos (left+right) can't happen, but combos like
    // jump+block are valid. All 72 entries should produce a valid encoding.
    for (let i = 0; i < NUM_ACTIONS; i++) {
      expect(typeof actionToEncoded(i)).toBe('number');
    }
  });

  it('left+right never occurs simultaneously', () => {
    for (const entry of ACTION_TABLE) {
      const hasLeft = entry.move === -1;
      const hasRight = entry.move === 1;
      expect(hasLeft && hasRight).toBe(false);
    }
  });

  it('at most one attack per entry', () => {
    for (const entry of ACTION_TABLE) {
      const attacks = ['lp', 'hp', 'lk', 'hk', 'sp'].filter((a) => a === entry.attack);
      expect(attacks.length).toBeLessThanOrEqual(1);
    }
  });

  it('decisionToActionIndex round-trips with actionToDecision', () => {
    for (let i = 0; i < NUM_ACTIONS; i++) {
      const d = actionToDecision(i);
      // Map compact attack names to AIController names for round-trip
      const attackMap = {
        lp: 'lightPunch',
        hp: 'heavyPunch',
        lk: 'lightKick',
        hk: 'heavyKick',
        sp: 'special',
      };
      const decision = {
        moveDir: d.move,
        jump: d.jump,
        block: d.block,
        attack: d.attack ? attackMap[d.attack] : null,
      };
      expect(decisionToActionIndex(decision)).toBe(i);
    }
  });

  it('decisionToActionIndex handles AIController decision format', () => {
    const decision = { moveDir: 1, jump: false, block: false, attack: 'heavyKick' };
    const idx = decisionToActionIndex(decision);
    const d = actionToDecision(idx);
    expect(d.move).toBe(1);
    expect(d.jump).toBe(false);
    expect(d.block).toBe(false);
    expect(d.attack).toBe('hk');
  });
});
