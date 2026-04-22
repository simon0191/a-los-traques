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

  it('prioritizes selection over hover when indices collide', () => {
    // If the index matches both selected and display, it should show selection style
    const state = getCellRenderState({ index: 5, selectedIndex: 5, displayIndex: 5 });
    expect(state.borderAlpha).toBe(1);
    expect(state.borderStroke[1]).toBe(0xffcc00); // yellow
  });

  it('correctly handles non-selected cell when another is hovered', () => {
    const state = getCellRenderState({ index: 0, selectedIndex: 5, displayIndex: 3 });
    expect(state.borderAlpha).toBe(0);
    expect(state.borderStroke).toBeNull();
    expect(state.fillStyle).toBe(0x333333);
  });
});
