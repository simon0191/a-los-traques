/**
 * Rollback netcode manager (GGPO-style).
 * Both peers run identical simulations locally with zero perceived input lag.
 * When confirmed input arrives and differs from prediction, the game restores
 * a snapshot and re-simulates forward.
 */

import { ONLINE_INPUT_DELAY } from './FixedPoint.js';
import { captureGameState, hashGameState, restoreGameState } from './GameState.js';
import { EMPTY_INPUT, encodeInput, inputsEqual, predictInput } from './InputBuffer.js';
import { simulateFrame } from './SimulationStep.js';

/** How many past inputs to include in each packet for redundancy */
const INPUT_REDUNDANCY = 2;

/** How often (in frames) to send/check checksums */
const CHECKSUM_INTERVAL = 30;

/** How often (in frames) to recalculate adaptive input delay */
const ADAPTIVE_DELAY_INTERVAL = 180;

export class RollbackManager {
  /**
   * @param {import('./NetworkManager.js').NetworkManager} networkManager
   * @param {number} localSlot - 0 for P1, 1 for P2
   * @param {{ inputDelay?: number, maxRollbackFrames?: number }} [options]
   */
  constructor(
    networkManager,
    localSlot,
    { inputDelay = ONLINE_INPUT_DELAY, maxRollbackFrames = 7 } = {},
  ) {
    this.nm = networkManager;
    this.localSlot = localSlot;
    this.inputDelay = inputDelay;
    this.maxRollbackFrames = maxRollbackFrames;

    this.currentFrame = 0;

    // Input histories (frame → encoded input)
    this.localInputHistory = new Map();
    this.remoteInputHistory = new Map(); // confirmed remote inputs
    this.predictedRemoteInputs = new Map();

    // State snapshots (frame → GameStateSnapshot)
    this.stateSnapshots = new Map();

    // For prediction: last confirmed remote input
    this.lastConfirmedRemoteInput = EMPTY_INPUT;
    this.lastConfirmedRemoteFrame = -1;

    // Stats
    this.rollbackCount = 0;

    // Desync detection
    this._localChecksums = new Map(); // frame → hash
    this.desyncCount = 0;
    this._onDesync = null;

    // Adaptive delay state
    this._adaptiveDelayEnabled = true;
  }

  /**
   * Main rollback loop — call once per visual frame.
   * @param {object} rawLocalInput - { left, right, up, down, lp, hp, lk, hk, sp }
   * @param {object} scene - FightScene (for _muteEffects flag)
   * @param {import('../entities/Fighter.js').Fighter} p1
   * @param {import('../entities/Fighter.js').Fighter} p2
   * @param {import('./CombatSystem.js').CombatSystem} combat
   */
  advance(rawLocalInput, scene, p1, p2, combat) {
    const encodedLocal = encodeInput(rawLocalInput);

    // 1. Store local input at (currentFrame + inputDelay)
    const targetFrame = this.currentFrame + this.inputDelay;
    this.localInputHistory.set(targetFrame, encodedLocal);

    // 2. Send local input to network with frame number + redundant history
    const history = [];
    for (let i = 1; i <= INPUT_REDUNDANCY; i++) {
      const hf = targetFrame - i;
      if (this.localInputHistory.has(hf)) {
        history.push([hf, this.localInputHistory.get(hf)]);
      }
    }
    this.nm.sendInput(targetFrame, rawLocalInput, history);

    // 3. Drain confirmed remote inputs from NetworkManager
    const confirmed = this.nm.drainConfirmedInputs();
    // Encode and store confirmed inputs; build list for misprediction check
    const confirmedEncoded = []; // [frame, encodedInput]
    for (const [frame, inputState] of confirmed) {
      const encoded = encodeInput(inputState);
      this.remoteInputHistory.set(frame, encoded);
      confirmedEncoded.push([frame, encoded]);
      if (frame > this.lastConfirmedRemoteFrame) {
        this.lastConfirmedRemoteFrame = frame;
        this.lastConfirmedRemoteInput = encoded;
      }
    }

    // 4. Detect mispredictions and rollback if needed
    let rollbackFrame = -1;
    for (const [frame, confirmedInput] of confirmedEncoded) {
      const predicted = this.predictedRemoteInputs.get(frame);
      if (predicted !== undefined && !inputsEqual(predicted, confirmedInput)) {
        if (rollbackFrame === -1 || frame < rollbackFrame) {
          rollbackFrame = frame;
        }
      }
    }

    // 5. Rollback and re-simulate if misprediction detected
    if (rollbackFrame >= 0) {
      const framesToRollback = this.currentFrame - rollbackFrame;
      if (framesToRollback <= this.maxRollbackFrames && this.stateSnapshots.has(rollbackFrame)) {
        this.rollbackCount++;

        // Restore snapshot at misprediction frame
        restoreGameState(this.stateSnapshots.get(rollbackFrame), p1, p2, combat);

        // Re-simulate from rollbackFrame to currentFrame
        scene._muteEffects = true;
        for (let f = rollbackFrame; f < this.currentFrame; f++) {
          const p1Input = this._getInputForFrame(f, true);
          const p2Input = this._getInputForFrame(f, false);
          simulateFrame(p1, p2, combat, p1Input, p2Input, { muteEffects: true });

          // Save corrected snapshot
          this.stateSnapshots.set(f + 1, captureGameState(f + 1, p1, p2, combat));
        }
        scene._muteEffects = false;
      }
    }

    // 6. Predict remote input for currentFrame (if not confirmed)
    if (!this.remoteInputHistory.has(this.currentFrame)) {
      const predicted = predictInput(this.lastConfirmedRemoteInput);
      this.predictedRemoteInputs.set(this.currentFrame, predicted);
    }

    // 7. Save snapshot for currentFrame (before simulating)
    this.stateSnapshots.set(this.currentFrame, captureGameState(this.currentFrame, p1, p2, combat));

    // 8. Simulate currentFrame
    const p1Input = this._getInputForFrame(this.currentFrame, true);
    const p2Input = this._getInputForFrame(this.currentFrame, false);
    simulateFrame(p1, p2, combat, p1Input, p2Input);

    // 9. Advance frame
    this.currentFrame++;

    // 10. Prune old data beyond rollback window
    this._pruneOldData();

    // 11. Periodic checksum exchange for desync detection
    if (this.currentFrame > 0 && this.currentFrame % CHECKSUM_INTERVAL === 0) {
      const snapshot = this.stateSnapshots.get(this.currentFrame - 1);
      if (snapshot) {
        const hash = hashGameState(snapshot);
        const checksumFrame = this.currentFrame - 1;
        this._localChecksums.set(checksumFrame, hash);
        this.nm.sendChecksum(checksumFrame, hash);
      }
    }

    // 12. Adaptive input delay recalculation
    if (
      this._adaptiveDelayEnabled &&
      this.currentFrame > 0 &&
      this.currentFrame % ADAPTIVE_DELAY_INTERVAL === 0
    ) {
      this._recalculateInputDelay();
    }
  }

  /**
   * Handle a remote checksum message. Compare against local hash for that frame.
   * @param {number} frame
   * @param {number} remoteHash
   */
  handleRemoteChecksum(frame, remoteHash) {
    const localHash = this._localChecksums.get(frame);
    if (localHash === undefined) return; // We don't have this frame's hash yet
    if (localHash !== remoteHash) {
      this.desyncCount++;
      if (this._onDesync) {
        this._onDesync(frame, localHash, remoteHash);
      }
    }
  }

  /**
   * Get the input for a given frame for a given side.
   * @param {number} frame
   * @param {boolean} isP1 - true for P1, false for P2
   * @returns {number} encoded input
   */
  _getInputForFrame(frame, isP1) {
    const isLocal = (isP1 && this.localSlot === 0) || (!isP1 && this.localSlot === 1);

    if (isLocal) {
      return this.localInputHistory.get(frame) || EMPTY_INPUT;
    } else {
      // Remote: use confirmed if available, otherwise predicted
      if (this.remoteInputHistory.has(frame)) {
        return this.remoteInputHistory.get(frame);
      }
      if (this.predictedRemoteInputs.has(frame)) {
        return this.predictedRemoteInputs.get(frame);
      }
      return predictInput(this.lastConfirmedRemoteInput);
    }
  }

  /**
   * Recalculate input delay based on smoothed RTT.
   * Adjusts gradually to avoid jarring jumps.
   */
  _recalculateInputDelay() {
    const rtt = this.nm.rtt || 0;
    const oneWayFrames = Math.ceil(rtt / 2 / 16.667);
    const optimal = Math.max(1, Math.min(5, oneWayFrames + 1));
    // Only increase by 1 per check to avoid jarring jumps
    if (optimal > this.inputDelay) {
      this.inputDelay = Math.min(this.inputDelay + 1, optimal);
    } else {
      this.inputDelay = optimal;
    }
    // Scale rollback window with delay
    this.maxRollbackFrames = Math.max(7, this.inputDelay * 2 + 1);
  }

  /**
   * Prune old snapshots, inputs, and predictions beyond the rollback window.
   */
  _pruneOldData() {
    const minFrame = this.currentFrame - this.maxRollbackFrames - 2;
    if (minFrame < 0) return;

    for (const map of [
      this.stateSnapshots,
      this.localInputHistory,
      this.remoteInputHistory,
      this.predictedRemoteInputs,
      this._localChecksums,
    ]) {
      for (const key of map.keys()) {
        if (key < minFrame) {
          map.delete(key);
        }
      }
    }
  }
}
