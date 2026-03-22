import { decodeInput } from './InputBuffer.js';

/**
 * Provides recorded inputs frame-by-frame for browser replay mode.
 * Expands sparse input log into a dense lookup.
 */
export class ReplayInputSource {
  /**
   * @param {Array<{ frame: number, encoded: number }>} sparseInputs
   * @param {number} totalFrames
   */
  constructor(sparseInputs, totalFrames) {
    this._inputs = new Array(totalFrames + 1).fill(0);
    let lastEncoded = 0;
    let sparseIdx = 0;

    for (let frame = 0; frame <= totalFrames; frame++) {
      if (sparseIdx < sparseInputs.length && sparseInputs[sparseIdx].frame === frame) {
        lastEncoded = sparseInputs[sparseIdx].encoded;
        sparseIdx++;
      }
      this._inputs[frame] = lastEncoded;
    }

    this.totalFrames = totalFrames;
  }

  /**
   * Get the encoded input for a given frame.
   */
  getEncoded(frame) {
    return this._inputs[frame] ?? 0;
  }

  /**
   * Get the decoded input object for a given frame.
   */
  getInput(frame) {
    return decodeInput(this.getEncoded(frame));
  }
}
