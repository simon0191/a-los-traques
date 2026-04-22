import { decodeInput } from '@alostraques/sim';

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

  /**
   * Build P1 and P2 ReplayInputSources from confirmed input pairs.
   * @param {Array<{ frame: number, p1: number, p2: number }>} confirmedInputs
   * @param {number} totalFrames
   * @returns {{ p1: ReplayInputSource, p2: ReplayInputSource }}
   */
  static fromConfirmedInputs(confirmedInputs, totalFrames) {
    const p1Sparse = confirmedInputs.map((c) => ({ frame: c.frame, encoded: c.p1 }));
    const p2Sparse = confirmedInputs.map((c) => ({ frame: c.frame, encoded: c.p2 }));
    return {
      p1: new ReplayInputSource(p1Sparse, totalFrames),
      p2: new ReplayInputSource(p2Sparse, totalFrames),
    };
  }
}
