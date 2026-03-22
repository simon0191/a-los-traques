/**
 * Expand a sparse input log into a dense array.
 * Sparse format: [{ frame, encoded }] — only records when input changes.
 * Dense format: number[] where index = frame, value = encoded input.
 *
 * @param {Array<{ frame: number, encoded: number }>} sparseInputs
 * @param {number} totalFrames
 * @returns {number[]}
 */
export function expandSparseInputs(sparseInputs, totalFrames) {
  const dense = new Array(totalFrames + 1).fill(0);
  let lastEncoded = 0;
  let sparseIdx = 0;

  for (let frame = 0; frame <= totalFrames; frame++) {
    if (sparseIdx < sparseInputs.length && sparseInputs[sparseIdx].frame === frame) {
      lastEncoded = sparseInputs[sparseIdx].encoded;
      sparseIdx++;
    }
    dense[frame] = lastEncoded;
  }

  return dense;
}
