import { describe, expect, it } from 'vitest';
import { getCellRenderState } from '../../src/scenes/StageSelectRender.js';

describe('StageSelectRender helper', () => {
  it('returns correctly for a selected cell', () => {
    const state = getCellRenderState({ index: 5, selectedIndex: 5, displayIndex: 5 });
    expect(state.borderAlpha).toBe(1);
    expect(state.borderStroke[1]).toBe(0xffcc00); // yellow
    expect(state.fillStyle).toBe(0x444466);
  });

  it('returns correctly for a hovered but not selected cell', () => {
    const state = getCellRenderState({ index: 3, selectedIndex: 5, displayIndex: 3 });
    expect(state.borderAlpha).toBe(0.5);
    expect(state.borderStroke[1]).toBe(0xffffff); // white
    expect(state.fillStyle).toBe(0x333333);
  });

  it('prioritizes selection over hover', () => {
    // This case happens if displayIndex (preview) is same as selectedIndex
    const state = getCellRenderState({ index: 5, selectedIndex: 5, displayIndex: 5 });
    expect(state.borderAlpha).toBe(1);
    expect(state.borderStroke[1]).toBe(0xffcc00);
  });

  it('returns correctly for a regular (non-selected, non-hovered) cell', () => {
    const state = getCellRenderState({ index: 0, selectedIndex: 5, displayIndex: 3 });
    expect(state.borderAlpha).toBe(0);
    expect(state.fillStyle).toBe(0x333333);
  });
});
