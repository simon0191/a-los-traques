/**
 * Rollback netcode manager (GGPO-style).
 * Both peers run identical simulations locally with zero perceived input lag.
 * When confirmed input arrives and differs from prediction, the game restores
 * a snapshot and re-simulates forward.
 *
 * Uses SimulationEngine.tick() which operates on FighterSim/CombatSim objects
 * and returns immutable state snapshots.
 */

import {
  captureGameState,
  EMPTY_INPUT,
  encodeInput,
  hashGameState,
  inputsEqual,
  ONLINE_INPUT_DELAY_FRAMES,
  predictInput,
  restoreCombatState,
  restoreFighterState,
  SNAPSHOT_VERSION,
  tick,
} from '@alostraques/sim';

/** How many past inputs to include in each packet for redundancy */
const INPUT_REDUNDANCY = 2;

/** How often (in frames) to send/check checksums */
const CHECKSUM_INTERVAL = 30;

/** How often (in frames) to recalculate adaptive input delay */
const ADAPTIVE_DELAY_INTERVAL = 180;

/**
 * Maximum possible maxRollbackFrames when adaptive delay is active (speed=1).
 * inputDelay caps at 5 → max(7, 5*2+1) = 11.
 */
const MAX_ADAPTIVE_ROLLBACK_FRAMES = 11;

/**
 * How many frames of input/snapshot history to retain for deep rollback.
 * Confirmed remote inputs can arrive well beyond maxRollbackFrames when
 * asymmetric RTT causes one peer to run ahead. Retaining a wider window
 * prevents silent misprediction loss. See RFC 0008.
 */
const HISTORY_RETENTION_FRAMES = 120;

export class RollbackManager {
  /**
   * @param {import('./net/NetworkFacade.js').NetworkFacade} networkManager
   * @param {number} localSlot - 0 for P1, 1 for P2
   * @param {{ inputDelay?: number, maxRollbackFrames?: number }} [options]
   */
  constructor(
    networkManager,
    localSlot,
    { inputDelay = ONLINE_INPUT_DELAY_FRAMES, maxRollbackFrames = 7 } = {},
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

    // State snapshots (frame → immutable GameState from tick())
    this.stateSnapshots = new Map();

    // For prediction: last confirmed remote input
    this.lastConfirmedRemoteInput = EMPTY_INPUT;
    this.lastConfirmedRemoteFrame = -1;

    // Stats
    this.rollbackCount = 0;
    this.maxRollbackDepth = 0;

    // Desync detection — checksum offset computed at construction so both peers
    // agree on the same value (before adaptive delay diverges maxRollbackFrames).
    // Must be beyond the max possible rollback window: max of the initial value
    // (which accounts for speed multiplier) and the adaptive cap (11). See RFC 0007.
    this._checksumSafeOffset = Math.max(maxRollbackFrames, MAX_ADAPTIVE_ROLLBACK_FRAMES) + 2;
    this._localChecksums = new Map(); // frame → hash
    this.desyncCount = 0;
    this._onDesync = null;
    this._onRollback = null; // (frame, depth) callback
    this._onLocalChecksum = null; // (frame, hash) callback
    this._onConfirmedInputs = null; // (frame, p1Input, p2Input) callback

    // Adaptive delay state
    this._adaptiveDelayEnabled = true;

    // Resync state
    this._resyncPending = false;
    this._lastResyncFrame = -1;
    this._resyncCooldown = 60; // min frames between resync attempts
    this._consecutiveDesyncCount = 0;

    // Track last target frame to detect gaps when inputDelay increases. See RFC 0014.
    this._lastLocalTargetFrame = -1;
  }

  /**
   * Main rollback loop — call once per fixed timestep.
   *
   * Uses SimulationEngine.tick() on p1.sim / p2.sim / combat.sim.
   * Events from resim ticks are discarded; only current-frame events returned.
   *
   * @param {object} rawLocalInput - { left, right, up, down, lp, hp, lk, hk, sp }
   * @param {import('../entities/Fighter.js').Fighter} p1
   * @param {import('../entities/Fighter.js').Fighter} p2
   * @param {import('./CombatSystem.js').CombatSystem} combat
   * @returns {{ roundEvent: { type: 'ko'|'timeup', winnerIndex: number } | null }}
   */
  advance(rawLocalInput, p1, p2, combat) {
    const encodedLocal = encodeInput(rawLocalInput);

    // 1. Store local input at (currentFrame + inputDelay)
    const targetFrame = this.currentFrame + this.inputDelay;

    // Fill gap frames created by inputDelay increase (e.g., 3→4 skips one frame).
    // Without this, the gap frame gets EMPTY_INPUT locally and a stale prediction
    // remotely, causing permanent uncorrectable divergence. See RFC 0014.
    if (this._lastLocalTargetFrame >= 0 && targetFrame > this._lastLocalTargetFrame + 1) {
      for (let f = this._lastLocalTargetFrame + 1; f < targetFrame; f++) {
        this.localInputHistory.set(f, encodedLocal);
      }
    }

    // On collision (delay decrease, e.g. 4→3), the first-written input is authoritative.
    // Overwriting would cause the remote peer to see two different confirmed inputs for
    // the same frame, triggering unnecessary rollback churn or — if the second message
    // is lost — a desync. See RFC 0014.
    const alreadyStored = this.localInputHistory.has(targetFrame);
    if (!alreadyStored) {
      this.localInputHistory.set(targetFrame, encodedLocal);
    }

    // 2. Send local input to network with frame number + redundant history.
    // Send any gap frames so the remote peer gets confirmed inputs for them.
    // Skip sending for collision frames (already sent by previous advance).
    if (this._lastLocalTargetFrame >= 0 && targetFrame > this._lastLocalTargetFrame + 1) {
      for (let f = this._lastLocalTargetFrame + 1; f < targetFrame; f++) {
        const hist = [];
        for (let i = 1; i <= INPUT_REDUNDANCY; i++) {
          const hf = f - i;
          if (this.localInputHistory.has(hf)) hist.push([hf, this.localInputHistory.get(hf)]);
        }
        this.nm.sendInput(f, rawLocalInput, hist);
      }
    }

    if (!alreadyStored) {
      const history = [];
      for (let i = 1; i <= INPUT_REDUNDANCY; i++) {
        const hf = targetFrame - i;
        if (this.localInputHistory.has(hf)) {
          history.push([hf, this.localInputHistory.get(hf)]);
        }
      }
      this.nm.sendInput(targetFrame, rawLocalInput, history);
    }

    this._lastLocalTargetFrame = targetFrame;

    // 3. Drain confirmed remote inputs from NetworkManager
    const confirmed = this.nm.drainConfirmedInputs();
    const confirmedEncoded = [];
    for (const [frame, inputState] of confirmed) {
      const encoded = encodeInput(inputState);
      this.remoteInputHistory.set(frame, encoded);
      confirmedEncoded.push([frame, encoded]);
      if (frame > this.lastConfirmedRemoteFrame) {
        this.lastConfirmedRemoteFrame = frame;
        this.lastConfirmedRemoteInput = encoded;
      }
    }

    // 4. Detect mispredictions and rollback if needed.
    // Compare confirmed input against the remoteInput stored in the snapshot,
    // not the predictedRemoteInputs map (which may be pruned). See RFC 0008.
    let rollbackFrame = -1;
    for (const [frame, confirmedInput] of confirmedEncoded) {
      const snap = this.stateSnapshots.get(frame);
      if (
        snap &&
        snap.remoteInput !== undefined &&
        !inputsEqual(snap.remoteInput, confirmedInput)
      ) {
        if (rollbackFrame === -1 || frame < rollbackFrame) {
          rollbackFrame = frame;
        }
      }
    }

    // Get sim objects for tick()
    const p1Sim = p1.sim || p1;
    const p2Sim = p2.sim || p2;
    const combatSim = combat.sim || combat;

    // 5. Rollback and re-simulate if misprediction detected
    if (rollbackFrame >= 0) {
      let actualRollbackFrame = rollbackFrame;
      if (!this.stateSnapshots.has(actualRollbackFrame)) {
        const available = [...this.stateSnapshots.keys()].filter((f) => f >= rollbackFrame);
        if (available.length > 0) {
          actualRollbackFrame = Math.min(...available);
        }
      }

      if (this.stateSnapshots.has(actualRollbackFrame)) {
        const depth = this.currentFrame - actualRollbackFrame;
        this.rollbackCount++;
        if (depth > this.maxRollbackDepth) this.maxRollbackDepth = depth;
        this._onRollback?.(actualRollbackFrame, depth);

        // Restore snapshot into live sim objects
        const snap = this.stateSnapshots.get(actualRollbackFrame);
        restoreFighterState(p1Sim, snap.p1);
        restoreFighterState(p2Sim, snap.p2);
        restoreCombatState(combatSim, snap.combat);

        // Resim: replay frames. Events from resim ticks are discarded —
        // only the current-frame tick's events are returned to the caller.
        for (let f = actualRollbackFrame; f < this.currentFrame; f++) {
          const p1Input = this._getInputForFrame(f, true);
          const p2Input = this._getInputForFrame(f, false);
          // Update pre-tick snapshot with the (now corrected) remote input
          const snapAtF = this.stateSnapshots.get(f);
          if (snapAtF) snapAtF.remoteInput = this.localSlot === 0 ? p2Input : p1Input;
          // tick() mutates sim objects and returns immutable snapshot
          const { state } = tick(p1Sim, p2Sim, combatSim, p1Input, p2Input, f);
          state.confirmed = this._isFrameConfirmed(f);
          this.stateSnapshots.set(f + 1, state);
        }
      }
    }

    // 6. Predict remote input for currentFrame (if not confirmed)
    if (!this.remoteInputHistory.has(this.currentFrame)) {
      const predicted = predictInput(this.lastConfirmedRemoteInput);
      this.predictedRemoteInputs.set(this.currentFrame, predicted);
    }

    // 7. Save snapshot for currentFrame (before simulating).
    // Store which remote input will be used (confirmed or predicted) so the
    // misprediction check in step 4 can compare against it later. See RFC 0008.
    const preTickSnap = captureGameState(this.currentFrame, p1Sim, p2Sim, combatSim);
    preTickSnap.confirmed = this._isFrameConfirmed(this.currentFrame);
    preTickSnap.remoteInput = this.remoteInputHistory.has(this.currentFrame)
      ? this.remoteInputHistory.get(this.currentFrame)
      : this.predictedRemoteInputs.get(this.currentFrame);
    this.stateSnapshots.set(this.currentFrame, preTickSnap);

    // 8. Simulate currentFrame via tick()
    const p1Input = this._getInputForFrame(this.currentFrame, true);
    const p2Input = this._getInputForFrame(this.currentFrame, false);
    this._onConfirmedInputs?.(this.currentFrame, p1Input, p2Input);
    const { state, events, roundEvent } = tick(
      p1Sim,
      p2Sim,
      combatSim,
      p1Input,
      p2Input,
      this.currentFrame,
    );

    // Store the post-tick snapshot (immutable)
    state.confirmed = this._isFrameConfirmed(this.currentFrame);
    this.stateSnapshots.set(this.currentFrame + 1, state);

    // 9. Advance frame (sprite sync + event consumption handled by caller)
    this.currentFrame++;

    // 12. Prune old data beyond rollback window
    this._pruneOldData();

    // 13. Periodic checksum exchange for desync detection
    if (this.currentFrame > 0 && this.currentFrame % CHECKSUM_INTERVAL === 0) {
      const checksumFrame = this.currentFrame - this._checksumSafeOffset;
      const snapshot = this.stateSnapshots.get(checksumFrame);
      if (snapshot && checksumFrame >= 0) {
        const hash = hashGameState(snapshot);
        this._localChecksums.set(checksumFrame, hash);
        this._onLocalChecksum?.(checksumFrame, hash);
        this.nm.sendChecksum(checksumFrame, hash);
      }
    }

    // 13. Adaptive input delay recalculation
    if (
      this._adaptiveDelayEnabled &&
      this.currentFrame > 0 &&
      this.currentFrame % ADAPTIVE_DELAY_INTERVAL === 0
    ) {
      this._recalculateInputDelay();
    }

    // 14. Return deferred round event + sim events for caller to handle
    return { roundEvent, events };
  }

  /**
   * Handle a remote checksum message. Compare against local hash for that frame.
   */
  handleRemoteChecksum(frame, remoteHash) {
    const localHash = this._localChecksums.get(frame);
    if (localHash === undefined) return;
    if (localHash !== remoteHash) {
      this.desyncCount++;
      this._consecutiveDesyncCount++;
      if (this._onDesync) {
        this._onDesync(frame, localHash, remoteHash);
      }
    } else {
      this._consecutiveDesyncCount = 0;
    }
  }

  /**
   * Apply an authoritative state snapshot to resync after desync.
   * Treats resync as a deep rollback: restores snapshot state and resimulates
   * forward to currentFrame, keeping the frame counter in sync between peers.
   * See RFC 0010.
   */
  applyResync(snapshot, p1, p2, combat) {
    if (snapshot.version !== undefined && snapshot.version !== SNAPSHOT_VERSION) {
      console.warn(
        `[RESYNC] Rejected snapshot: version ${snapshot.version} !== ${SNAPSHOT_VERSION}`,
      );
      return;
    }

    const p1Sim = p1.sim || p1;
    const p2Sim = p2.sim || p2;
    const combatSim = combat.sim || combat;

    const resyncFrame = snapshot.frame;
    const oldFrame = this.currentFrame;

    // If the gap exceeds our retention window, we can't resimulate — fall back to rewind
    if (oldFrame - resyncFrame > HISTORY_RETENTION_FRAMES) {
      restoreFighterState(p1Sim, snapshot.p1);
      restoreFighterState(p2Sim, snapshot.p2);
      restoreCombatState(combatSim, snapshot.combat);
      this.currentFrame = resyncFrame;
      this.stateSnapshots.clear();
      this.localInputHistory.clear();
      this.remoteInputHistory.clear();
      this.predictedRemoteInputs.clear();
      this._localChecksums.clear();
      const fallbackSnap = captureGameState(resyncFrame, p1Sim, p2Sim, combatSim);
      fallbackSnap.confirmed = true;
      this.stateSnapshots.set(resyncFrame, fallbackSnap);
      this.lastConfirmedRemoteInput = EMPTY_INPUT;
      this.lastConfirmedRemoteFrame = resyncFrame - 1;
      this._resyncPending = false;
      this._lastResyncFrame = resyncFrame;
      this._consecutiveDesyncCount = 0;
      return;
    }

    // 1. Restore state at resync frame
    restoreFighterState(p1Sim, snapshot.p1);
    restoreFighterState(p2Sim, snapshot.p2);
    restoreCombatState(combatSim, snapshot.combat);

    // 2. Store authoritative snapshot at resync frame
    const resyncSnap = captureGameState(resyncFrame, p1Sim, p2Sim, combatSim);
    resyncSnap.confirmed = true;
    this.stateSnapshots.set(resyncFrame, resyncSnap);

    // 3. Resimulate forward from resyncFrame to oldFrame (like a deep rollback)
    for (let f = resyncFrame; f < oldFrame; f++) {
      const p1Input = this._getInputForFrame(f, true);
      const p2Input = this._getInputForFrame(f, false);
      const { state } = tick(p1Sim, p2Sim, combatSim, p1Input, p2Input, f);
      state.confirmed = this._isFrameConfirmed(f);
      state.remoteInput = this.localSlot === 0 ? p2Input : p1Input;
      this.stateSnapshots.set(f + 1, state);
    }

    // 4. currentFrame stays at oldFrame — no rewind, no frame gap (RFC 0010)

    this._resyncPending = false;
    this._lastResyncFrame = this.currentFrame;
    this._consecutiveDesyncCount = 0;
  }

  /**
   * Capture the current simulation state for resync.
   * Returns a fresh snapshot at currentFrame rather than searching for an older
   * confirmed snapshot — a recent snapshot minimizes the resimulation window
   * on the receiving peer. See RFC 0010.
   */
  captureResyncSnapshot(p1, p2, combat) {
    const p1Sim = p1.sim || p1;
    const p2Sim = p2.sim || p2;
    const combatSim = combat.sim || combat;
    return captureGameState(this.currentFrame, p1Sim, p2Sim, combatSim);
  }

  /**
   * Whether a resync request should be sent (cooldown check).
   */
  shouldRequestResync() {
    if (this._resyncPending) return false;
    if (
      this._lastResyncFrame >= 0 &&
      this.currentFrame - this._lastResyncFrame < this._resyncCooldown
    ) {
      return false;
    }
    return true;
  }

  /**
   * Whether P1 should request resync from P2 instead of sending its own state.
   * Returns true when consecutive desyncs exceed the threshold, indicating
   * that P1's authoritative state may itself be the source of divergence.
   * See RFC 0008 Phase 3.
   */
  shouldReverseResync() {
    return this._consecutiveDesyncCount >= 2;
  }

  /**
   * Capture frame-0 state and return its hash for sync exchange.
   * Stores the frame-0 snapshot (tagged confirmed) and resets currentFrame.
   * @returns {number} 32-bit hash of the frame-0 state
   */
  getFrame0SyncHash(p1, p2, combat) {
    const p1Sim = p1.sim || p1;
    const p2Sim = p2.sim || p2;
    const combatSim = combat.sim || combat;
    const snapshot = captureGameState(0, p1Sim, p2Sim, combatSim);
    snapshot.confirmed = true; // frame 0 has no inputs — always confirmed
    this.stateSnapshots.set(0, snapshot);
    this.currentFrame = 0;
    return hashGameState(snapshot);
  }

  /**
   * Validate a remote peer's frame-0 hash against local state.
   * @returns {{ match: boolean, localHash: number, remoteHash: number }}
   */
  validateFrame0Hash(remoteHash, p1, p2, combat) {
    const localHash = this.getFrame0SyncHash(p1, p2, combat);
    return { match: localHash === remoteHash, localHash, remoteHash };
  }

  /**
   * Check whether both local and remote inputs for a frame are confirmed.
   */
  _isFrameConfirmed(frame) {
    return this.localInputHistory.has(frame) && this.remoteInputHistory.has(frame);
  }

  /**
   * Get the input for a given frame for a given side.
   */
  _getInputForFrame(frame, isP1) {
    const isLocal = (isP1 && this.localSlot === 0) || (!isP1 && this.localSlot === 1);

    if (isLocal) {
      return this.localInputHistory.get(frame) || EMPTY_INPUT;
    }
    if (this.remoteInputHistory.has(frame)) {
      return this.remoteInputHistory.get(frame);
    }
    if (this.predictedRemoteInputs.has(frame)) {
      return this.predictedRemoteInputs.get(frame);
    }
    return predictInput(this.lastConfirmedRemoteInput);
  }

  _recalculateInputDelay() {
    const rtt = this.nm.rtt;
    if (!rtt) return; // No RTT data yet — don't adjust
    // RTT is measured to the server. In relay mode (the common case), the actual
    // input path is sender→server→receiver, so one-way relay latency ≈ full RTT.
    // This overestimates for P2P (where inputs bypass the server), but the floor
    // at ONLINE_INPUT_DELAY_FRAMES prevents the delay from going too low.
    const oneWayFrames = Math.ceil(rtt / 16.667);
    const optimal = Math.max(ONLINE_INPUT_DELAY_FRAMES, Math.min(5, oneWayFrames + 1));
    if (optimal > this.inputDelay) {
      this.inputDelay = Math.min(this.inputDelay + 1, optimal);
    } else {
      this.inputDelay = optimal;
    }
    this.maxRollbackFrames = Math.max(7, this.inputDelay * 2 + 1);
  }

  _pruneOldData() {
    const minFrame = this.currentFrame - HISTORY_RETENTION_FRAMES;
    if (minFrame < 0) return;

    for (const map of [
      this.localInputHistory,
      this.remoteInputHistory,
      this.predictedRemoteInputs,
      this.stateSnapshots,
    ]) {
      for (const key of map.keys()) {
        if (key < minFrame) {
          map.delete(key);
        }
      }
    }

    // Checksums need a wider retention window: they're computed at CHECKSUM_SAFE_OFFSET
    // behind currentFrame and must survive until the remote peer's checksum arrives
    // (up to one full CHECKSUM_INTERVAL later via network).
    const checksumMinFrame = this.currentFrame - this._checksumSafeOffset - CHECKSUM_INTERVAL;
    for (const key of this._localChecksums.keys()) {
      if (key < checksumMinFrame) {
        this._localChecksums.delete(key);
      }
    }
  }
}
