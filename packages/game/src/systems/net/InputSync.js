import { decodeInput } from '@alostraques/sim';
import { Logger } from '../Logger.js';

const log = Logger.create('InputSync');

const ATTACK_FLAGS = ['lp', 'hp', 'lk', 'hk', 'sp'];

const EMPTY_INPUT = {
  left: false,
  right: false,
  up: false,
  down: false,
  lp: false,
  hp: false,
  lk: false,
  hk: false,
  sp: false,
};

/**
 * Manages input buffering, sending, and consumption for both
 * player and spectator modes. Handles dual-transport routing
 * (DataChannel primary, WebSocket fallback).
 *
 * B3: OR-merges attack flags across buffered frames to prevent input loss.
 */
export class InputSync {
  /**
   * @param {import('./SignalingClient.js').SignalingClient} signaling
   * @param {import('./TransportManager.js').TransportManager} [transport]
   */
  constructor(signaling, transport) {
    this.signaling = signaling;
    this.transport = transport || null;

    // Opponent input buffer (player mode)
    this.remoteInputBuffer = {};
    this.lastRemoteInput = null;

    // Per-player buffers (spectator mode)
    this.remoteInputBufferP1 = {};
    this.lastRemoteInputP1 = null;
    this.remoteInputBufferP2 = {};
    this.lastRemoteInputP2 = null;

    this._onRemoteInput = null;

    // Register input handler on signaling (WS path)
    signaling.on('input', (msg) => this._handleInput(msg));

    // Register checksum/resync handlers as pass-through
    this._onChecksum = null;
    this._onResyncRequest = null;
    this._onResync = null;
    signaling.on('checksum', (msg) => {
      if (this._onChecksum) this._onChecksum(msg.frame, msg.hash);
    });
    signaling.on('resync_request', (msg) => {
      if (this._onResyncRequest) this._onResyncRequest(msg);
    });
    signaling.on('resync', (msg) => {
      if (this._onResync) this._onResync(msg);
    });
  }

  /**
   * Called by TransportManager when a P2P DataChannel message arrives.
   * Only 'input' messages come through here.
   */
  handleP2PInput(msg) {
    this._handleInput(msg);
  }

  /**
   * Send input to remote peer.
   * Uses DataChannel (P2P) if available, with WebSocket relay for spectators.
   * Falls back to WebSocket only if no DataChannel.
   */
  sendInput(frame, inputState, history) {
    const msg = { type: 'input', frame, state: inputState };
    if (history && history.length > 0) {
      msg.history = history;
    }

    const p2p = this.transport?.isWebRTCReady();
    log.trace('Input send', {
      frame,
      transport: p2p ? 'p2p' : 'ws',
      historyLen: history?.length ?? 0,
    });
    if (p2p) {
      // P2P: fast path for opponent
      this.transport.sendP2P(msg);
      // Server: spectator relay only
      this.signaling.send({ ...msg, spectatorOnly: true });
    } else {
      // Fallback: server relays to opponent + spectators
      this.signaling.send(msg);
    }
  }

  sendChecksum(frame, hash) {
    this.signaling.send({ type: 'checksum', frame, hash });
  }

  sendResyncRequest(frame) {
    this.signaling.send({ type: 'resync_request', frame });
  }

  sendResync(snapshot) {
    this.signaling.send({ type: 'resync', snapshot });
  }

  onRemoteInput(cb) {
    this._onRemoteInput = cb;
  }

  onChecksum(cb) {
    this._onChecksum = cb;
  }

  onResyncRequest(cb) {
    this._onResyncRequest = cb;
  }

  onResync(cb) {
    this._onResync = cb;
  }

  /**
   * Get the latest remote input, consuming any pending one-shot attacks.
   * B3: OR-merge attack flags across all buffered frames to avoid losing inputs.
   * @returns {object} input state
   */
  getRemoteInput() {
    const frames = Object.keys(this.remoteInputBuffer).map(Number);
    if (frames.length > 0) {
      const latest = Math.max(...frames);
      const input = { ...this.remoteInputBuffer[latest] };

      for (const frame of frames) {
        const frameInput = this.remoteInputBuffer[frame];
        for (const flag of ATTACK_FLAGS) {
          if (frameInput[flag]) {
            input[flag] = true;
          }
        }
      }

      this.remoteInputBuffer = {};
      this.lastRemoteInput = {
        ...input,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };
      return input;
    }

    if (this.lastRemoteInput) {
      return { ...this.lastRemoteInput };
    }
    return { ...EMPTY_INPUT };
  }

  /**
   * Get the latest remote input for a specific player slot (spectator mode).
   * B3: OR-merge attack flags across all buffered frames.
   * @param {number} slot - 0 for P1, 1 for P2
   * @returns {object} input state
   */
  getRemoteInputForSlot(slot) {
    const buf = slot === 0 ? this.remoteInputBufferP1 : this.remoteInputBufferP2;
    const lastKey = slot === 0 ? 'lastRemoteInputP1' : 'lastRemoteInputP2';

    const frames = Object.keys(buf).map(Number);
    if (frames.length > 0) {
      const latest = Math.max(...frames);
      const input = { ...buf[latest] };

      for (const frame of frames) {
        const frameInput = buf[frame];
        for (const flag of ATTACK_FLAGS) {
          if (frameInput[flag]) {
            input[flag] = true;
          }
        }
      }

      if (slot === 0) {
        this.remoteInputBufferP1 = {};
        this.lastRemoteInputP1 = {
          ...input,
          lp: false,
          hp: false,
          lk: false,
          hk: false,
          sp: false,
        };
      } else {
        this.remoteInputBufferP2 = {};
        this.lastRemoteInputP2 = {
          ...input,
          lp: false,
          hp: false,
          lk: false,
          hk: false,
          sp: false,
        };
      }
      return input;
    }

    if (this[lastKey]) {
      return { ...this[lastKey] };
    }
    return { ...EMPTY_INPUT };
  }

  /**
   * Drain all confirmed remote inputs indexed by frame.
   * Used by RollbackManager to process confirmed inputs.
   * @returns {Array<[number, object]>}
   */
  drainConfirmedInputs() {
    const entries = Object.entries(this.remoteInputBuffer).map(([frame, state]) => [
      Number(frame),
      state,
    ]);
    this.remoteInputBuffer = {};
    return entries;
  }

  /**
   * Reset input buffers and callbacks for scene transitions.
   */
  reset() {
    this.remoteInputBuffer = {};
    this.lastRemoteInput = null;
    this.remoteInputBufferP1 = {};
    this.lastRemoteInputP1 = null;
    this.remoteInputBufferP2 = {};
    this.lastRemoteInputP2 = null;
    this._onRemoteInput = null;
    this._onChecksum = null;
    this._onResyncRequest = null;
    this._onResync = null;
  }

  destroy() {
    this.signaling.off('input');
    this.signaling.off('checksum');
    this.signaling.off('resync_request');
    this.signaling.off('resync');
    this.reset();
  }

  // --- Internal ---

  _handleInput(msg) {
    if (this.signaling.isSpectator && msg.slot != null) {
      // Spectator: route input to correct player buffer
      const buf = msg.slot === 0 ? 'remoteInputBufferP1' : 'remoteInputBufferP2';
      const lastKey = msg.slot === 0 ? 'lastRemoteInputP1' : 'lastRemoteInputP2';
      this[buf][msg.frame] = msg.state;
      this[lastKey] = msg.state;
    } else {
      this.remoteInputBuffer[msg.frame] = msg.state;
      this.lastRemoteInput = msg.state;
      const bufferDepth = Object.keys(this.remoteInputBuffer).length;
      log.debug('Input arrival', { frame: msg.frame, bufferDepth });
      // Process redundant input history — fill gaps without overwriting confirmed data
      if (msg.history) {
        let gapCount = 0;
        for (const [hFrame, encodedInput] of msg.history) {
          if (!(hFrame in this.remoteInputBuffer)) {
            this.remoteInputBuffer[hFrame] = decodeInput(encodedInput);
            gapCount++;
          }
        }
        if (gapCount > 0) {
          log.debug('Redundant history applied', { frame: msg.frame, gapCount });
        }
      }
    }
    if (this._onRemoteInput) this._onRemoteInput(msg.frame, msg.state, msg.slot);
  }
}
