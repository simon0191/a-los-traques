import { encodeInput } from '@alostraques/sim';
import { captureGameState, hashGameState } from './GameState.js';

/**
 * Records fight events for E2E testing and debugging.
 * Only instantiated when autoplay/recording is active.
 * Exposes all data via window.__FIGHT_LOG.
 */
export class FightRecorder {
  constructor({ fightId, roomId, playerSlot, fighterId, opponentId, stageId, config }) {
    this._lastEncodedInput = -1;
    this._lastConfirmedP1 = -1;
    this._lastConfirmedP2 = -1;

    this.log = {
      fightId,
      roomId,
      playerSlot,
      fighterId,
      opponentId,
      stageId,
      config: config || {},
      startedAt: Date.now(),
      completedAt: null,
      matchComplete: false,
      result: null,

      // Per-frame input log (sparse — only when input changes)
      inputs: [],

      // Confirmed input pairs from rollback system (sparse — both P1+P2 as simulated)
      confirmedInputs: [],

      // Periodic state checksums
      checksums: [],

      // Round events
      roundEvents: [],

      // Network events
      networkEvents: [],

      // Rollback stats
      rollbackCount: 0,
      maxRollbackFrames: 0,
      desyncCount: 0,
      totalFrames: 0,

      // Final state
      finalState: null,
      finalStateHash: null,
    };

    window.__FIGHT_LOG = this.log;
  }

  /**
   * Record local input (sparse — only when it changes).
   */
  recordInput(frame, inputObj) {
    const encoded = encodeInput(inputObj);
    if (encoded !== this._lastEncodedInput) {
      this.log.inputs.push({ frame, encoded });
      this._lastEncodedInput = encoded;
    }
    this.log.totalFrames = frame;
  }

  /**
   * Record confirmed input pair (post-rollback) for exact replay.
   * Sparse — only stores when either input changes.
   */
  recordConfirmedInputs(frame, p1, p2) {
    if (p1 !== this._lastConfirmedP1 || p2 !== this._lastConfirmedP2) {
      this.log.confirmedInputs.push({ frame, p1, p2 });
      this._lastConfirmedP1 = p1;
      this._lastConfirmedP2 = p2;
    }
  }

  /**
   * Record a checksum from the rollback system.
   */
  recordChecksum(frame, hash) {
    this.log.checksums.push({ frame, hash });
  }

  /**
   * Record a round event (KO, timeup, etc.).
   */
  recordRoundEvent(frame, event) {
    this.log.roundEvents.push({ frame, ...event });
  }

  /**
   * Record a network event (connect, disconnect, rollback, desync, etc.).
   */
  recordNetworkEvent(type, data) {
    this.log.networkEvents.push({ time: Date.now(), type, ...data });
  }

  /**
   * Record that a rollback occurred.
   */
  recordRollback(frame, depth) {
    this.log.rollbackCount++;
    if (depth > this.log.maxRollbackFrames) {
      this.log.maxRollbackFrames = depth;
    }
    this.log.networkEvents.push({ time: Date.now(), type: 'rollback', frame, depth });
  }

  /**
   * Record a desync detection.
   */
  recordDesync(frame, localHash, remoteHash) {
    this.log.desyncCount++;
    this.log.networkEvents.push({
      time: Date.now(),
      type: 'desync',
      frame,
      localHash,
      remoteHash,
    });
  }

  /**
   * Capture final game state at match end from live fighter/combat objects.
   */
  captureEndState(p1, p2, combat, frame) {
    const snapshot = captureGameState(frame, p1, p2, combat);
    this.log.finalState = snapshot;
    this.log.finalStateHash = hashGameState(snapshot);
    this.log.completedAt = Date.now();
  }
}
