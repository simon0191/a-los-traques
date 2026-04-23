import { Logger } from '../Logger.js';
import { BaseSignalingClient } from './BaseSignalingClient.js';

const log = Logger.create('SignalingClient');

/** Message types that support callback buffering (B5) — handler may not be registered yet when message arrives */
const BUFFERABLE_TYPES = new Set([
  'sync',
  'round_event',
  'start',
  'frame_sync',
  'go_to_stage_select',
  'opponent_ready',
  'opponent_unready',
  'rematch',
  'leave',
  'opponent_joined',
  // Peer's accessory picks can arrive before AccessorySelectScene subscribes
  // (e.g. peer confirms immediately on an auto-skip while we're still fading in).
  'accessories',
]);

/**
 * WebSocket signaling client. Extends BaseSignalingClient for core PartySocket lifecycle.
 * Provides type-based message dispatch and callback buffering (B5).
 */
export class SignalingClient extends BaseSignalingClient {
  /**
   * @param {string} roomId
   * @param {string} host - PartyKit host
   * @param {{ spectator?: boolean }} [options]
   */
  constructor(roomId, host, { spectator = false } = {}) {
    const query = {};
    if (spectator) query.spectate = '1';

    super(roomId, host, { query });

    this.playerSlot = -1;
    this.isSpectator = false;

    /** @type {Map<string, Function>} message type → handler */
    this._handlers = new Map();

    /** @type {Map<string, object[]>} B5: buffered messages for types with no handler yet */
    this._pendingCallbackMessages = new Map();
    for (const type of BUFFERABLE_TYPES) {
      this._pendingCallbackMessages.set(type, []);
    }
  }

  /**
   * Register a handler for a message type.
   * For bufferable types (sync, round_event, start), any messages received
   * before the handler was registered are flushed immediately.
   * @param {string} type - Message type
   * @param {Function} cb - Handler callback
   */
  on(type, cb) {
    this._handlers.set(type, cb);
    log.debug('Handler registered', { type });

    // B5: Flush any buffered messages for this type
    const pending = this._pendingCallbackMessages.get(type);
    if (cb && pending && pending.length > 0) {
      const messages = pending.splice(0);
      log.debug('Callback buffer flush (B5)', { type, count: messages.length });
      for (const msg of messages) {
        cb(msg);
      }
    }
  }

  /**
   * Unregister handler for a message type.
   * @param {string} type
   */
  off(type) {
    this._handlers.delete(type);
  }

  /**
   * Clear handlers and pending buffers for the given message types.
   * Used during scene transitions (resetForReselect).
   * @param {string[]} types
   */
  resetHandlers(types) {
    for (const type of types) {
      this._handlers.delete(type);
      const pending = this._pendingCallbackMessages.get(type);
      if (pending) {
        pending.length = 0;
      }
    }
  }

  /**
   * Tear down the socket and all handlers.
   */
  destroy() {
    super.destroy();
    this._handlers.clear();
    this._pendingCallbackMessages.clear();
  }

  /**
   * Public alias for testing and internal dispatch.
   * @param {object} msg
   */
  _handleMessage(msg) {
    this._handleMessageInternal(msg);
  }

  // --- Internal ---

  _handleMessageInternal(msg) {
    // Handle assign specially — sets playerSlot
    if (msg.type === 'assign') {
      this.playerSlot = msg.player;
    }

    // Handle assign_spectator — sets isSpectator
    if (msg.type === 'assign_spectator') {
      this.isSpectator = true;
    }

    const handler = this._handlers.get(msg.type);
    if (handler) {
      log.trace('Message dispatch', { type: msg.type, hasHandler: true });
      handler(msg);
      return;
    }
    log.trace('Message dispatch', { type: msg.type, hasHandler: false });

    // B5: Buffer messages for types that support it when no handler registered
    if (BUFFERABLE_TYPES.has(msg.type)) {
      const pending = this._pendingCallbackMessages.get(msg.type);
      if (pending) {
        pending.push(msg);
      }
    }
  }
}
