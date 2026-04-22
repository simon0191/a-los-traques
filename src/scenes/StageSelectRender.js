/**
 * Pure helper to determine the visual state of a stage selection cell.
 * @param {Object} params
 * @param {number} params.index - Current cell index
 * @param {number} params.selectedIndex - Officially selected index
 * @param {number} params.displayIndex - Currently previewed/hovered index
 * @returns {Object} Render properties
 */
export function getCellRenderState({ index, selectedIndex, displayIndex }) {
  if (index === selectedIndex) {
    // Officially selected
    return {
      borderAlpha: 1,
      borderStroke: [3, 0xffcc00],
      fillStyle: 0x444466,
    };
  }
  if (index === displayIndex) {
    // Hovering preview
    return {
      borderAlpha: 0.5,
      borderStroke: [2, 0xffffff],
      fillStyle: 0x333333,
    };
  }
  // Not selected nor hovered
  return {
    borderAlpha: 0,
    borderStroke: null,
    fillStyle: 0x333333,
  };
}
