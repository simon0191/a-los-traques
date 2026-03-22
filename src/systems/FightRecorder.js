import { captureGameState, hashGameState } from './GameState.js';
import { encodeInput } from './InputBuffer.js';

/**
 * Records fight events for E2E testing and debugging.
 * Only instantiated when autoplay/recording is active.
 * Exposes all data via window.__FIGHT_LOG.
 */
export class FightRecorder {
  constructor({ roomId, playerSlot, fighterId, opponentId, stageId }) {
    this._lastEncodedInput = -1;

    this.log = {
      roomId,
      playerSlot,
      fighterId,
      opponentId,
      stageId,
      startedAt: Date.now(),
      completedAt: null,
      matchComplete: false,
      result: null,

      // Per-frame input log (sparse — only when input changes)
      inputs: [],

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
   * Capture final game state at match end.
   */
  captureEndState(p1, p2, combat, frame) {
    const snapshot = captureGameState(frame, p1, p2, combat);
    this.log.finalState = snapshot;
    this.log.finalStateHash = hashGameState(snapshot);
    this.log.completedAt = Date.now();
  }
}
