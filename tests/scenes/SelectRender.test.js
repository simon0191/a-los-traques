import { describe, expect, it } from 'vitest';
import { resolveSelectionState } from '../../packages/game/src/scenes/SelectRender.js';

describe('SelectRender helper (resolveSelectionState)', () => {
  const baseState = {
    p1Confirmed: false,
    p2SelectionMode: false,
    p2Confirmed: false,
    p1Index: 0,
    p2Index: 0,
  };

  it('mouse sweep scenario: hovering across cells does not mutate official selection', () => {
    const state = { ...baseState, p1Index: 0 };

    // Hover cell 1
    let result = resolveSelectionState(state, { type: 'hover', index: 1 });
    expect(result.p1Index).toBe(0); // Official selection unchanged
    expect(result.displayP1Index).toBe(1); // Display updates

    // Out cell 1
    result = resolveSelectionState(state, { type: 'out', index: 1 });
    expect(result.p1Index).toBe(0);
    expect(result.displayP1Index).toBe(0); // Restored to official selection
  });

  it('commit action updates official selection', () => {
    const result = resolveSelectionState(baseState, { type: 'commit', index: 5 });
    expect(result.p1Index).toBe(5);
    expect(result.displayP1Index).toBe(5);
  });

  it('P2 selection mode respects P2 states', () => {
    const p2State = {
      ...baseState,
      p1Confirmed: true,
      p2SelectionMode: true,
      p1Index: 5,
      p2Index: 8,
    };

    // Hover cell 12
    let result = resolveSelectionState(p2State, { type: 'hover', index: 12 });
    expect(result.p1Index).toBe(5);
    expect(result.p2Index).toBe(8);
    expect(result.displayP2Index).toBe(12);

    // Commit cell 12
    result = resolveSelectionState(p2State, { type: 'commit', index: 12 });
    expect(result.p2Index).toBe(12);
    expect(result.displayP2Index).toBe(12);
  });
});
