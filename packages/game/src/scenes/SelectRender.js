/**
 * Pure helper to resolve the display and selection state during fighter selection.
 * @param {Object} state - Current selection state
 * @param {boolean} state.p1Confirmed
 * @param {boolean} state.p2SelectionMode
 * @param {boolean} state.p2Confirmed
 * @param {number} state.p1Index
 * @param {number} state.p2Index
 * @param {Object} action - The action being performed
 * @param {string} action.type - 'hover', 'out', or 'commit'
 * @param {number} action.index - The cell index being interacted with
 * @returns {Object} { p1Index, p2Index, displayP1Index, displayP2Index }
 */
export function resolveSelectionState(state, action) {
  let nextP1Index = state.p1Index;
  let nextP2Index = state.p2Index;
  let displayP1Index = state.p1Index;
  let displayP2Index = state.p2Index;

  if (!state.p1Confirmed) {
    if (action.type === 'commit') {
      nextP1Index = action.index;
      displayP1Index = action.index;
    } else if (action.type === 'hover') {
      displayP1Index = action.index;
    } else if (action.type === 'out') {
      displayP1Index = state.p1Index;
    }
  } else if (state.p2SelectionMode && !state.p2Confirmed) {
    if (action.type === 'commit') {
      nextP2Index = action.index;
      displayP2Index = action.index;
    } else if (action.type === 'hover') {
      displayP2Index = action.index;
    } else if (action.type === 'out') {
      displayP2Index = state.p2Index;
    }
  }

  return {
    p1Index: nextP1Index,
    p2Index: nextP2Index,
    displayP1Index,
    displayP2Index,
  };
}
