import PartySocket from 'partysocket';
import { Logger } from '../Logger.js';

const log = Logger.create('SignalingClient');

/** Message types that support callback buffering (B5) — handler may not be registered yet when message arrives */
const BUFFERABLE_TYPES = new Set(['sync', 'round_event', 'start', 'frame_sync']);

/**
 * WebSocket signaling client. Owns the PartySocket connection and provides
 * type-based message dispatch. Other modules register handlers via on(type, cb).
 *
 * Implements:
 * - B4: Pending message queue (queue when disconnected, flush on reconnect)
 * - B5: Callback buffering (buffer messages for types with no handler yet, flush on registration)
 */
export class SignalingClient {
  /**
   * @param {string} roomId
   * @param {string} host - PartyKit host (e.g. 'localhost:1999')
   * @param {{ spectator?: boolean }} [options]
   */
  constructor(roomId, host, { spectator = false } = {}) {
    this.roomId = roomId;
    this.playerSlot = -1;
    this.connected = false;
    this.isSpectator = false;

    /** Session ID for client-server log correlation */
    this.sessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);

    /** @type {Map<string, Function>} message type → handler */
    this._handlers = new Map();

    /** @type {Map<string, object[]>} B5: buffered messages for types with no handler yet */
    this._pendingCallbackMessages = new Map();
    for (const type of BUFFERABLE_TYPES) {
      this._pendingCallbackMessages.set(type, []);
    }

    /** @type {object[]} B4: messages queued while disconnected */
    this._pendingMessages = [];

    // Socket lifecycle callbacks
    this._onSocketOpen = null;
    this._onSocketClose = null;
    this._onSocketError = null;

    // Create PartySocket
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';

    const socketOptions = {
      host,
      room: roomId,
      protocol,
      maxRetries: 3,
      startClosed: false,
    };

    socketOptions.query = { sessionId: this.sessionId };
    if (spectator) {
      socketOptions.query.spectate = '1';
    }

    this.socket = new PartySocket(socketOptions);

    // B2: Store bound handler references for cleanup
    this._boundOnMessage = (event) => {
      try {
        this._handleMessage(JSON.parse(event.data));
      } catch (_e) {
        log.warn('JSON parse error on message');
      }
    };

    this._boundOnOpen = () => {
      this.connected = true;
      log.info('Socket open', { roomId, sessionId: this.sessionId });
      // B4: Flush pending messages on reconnect
      if (this._pendingMessages.length > 0) {
        const count = this._pendingMessages.length;
        const pending = this._pendingMessages.splice(0);
        log.debug('Pending queue flush (B4)', { count });
        for (const msg of pending) {
          this.send(msg);
        }
      }
      if (this._onSocketOpen) this._onSocketOpen();
    };

    this._boundOnClose = () => {
      this.connected = false;
      log.info('Socket close', { roomId, sessionId: this.sessionId });
      if (this._onSocketClose) this._onSocketClose();
    };

    this._boundOnError = () => {
      log.warn('Socket error', { roomId });
      if (this._onSocketError) this._onSocketError();
    };

    this.socket.addEventListener('message', this._boundOnMessage);
    this.socket.addEventListener('open', this._boundOnOpen);
    this.socket.addEventListener('close', this._boundOnClose);
    this.socket.addEventListener('error', this._boundOnError);
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
   * Send a message through the WebSocket.
   * If disconnected, queues the message for delivery on reconnect (B4).
   * @param {object} msg
   */
  send(msg) {
    if (this.socket && this.connected) {
      this.socket.send(JSON.stringify(msg));
    } else {
      this._pendingMessages.push(msg);
    }
  }

  /**
   * Register socket lifecycle callbacks.
   */
  onSocketOpen(cb) {
    this._onSocketOpen = cb;
  }
  onSocketClose(cb) {
    this._onSocketClose = cb;
  }
  onSocketError(cb) {
    this._onSocketError = cb;
  }

  /**
   * Clear handlers for the given message types.
   * Used during scene transitions (resetForReselect).
   * @param {string[]} types
   */
  resetHandlers(types) {
    for (const type of types) {
      this._handlers.delete(type);
    }
  }

  /**
   * Tear down the socket and all handlers.
   */
  destroy() {
    if (this.socket) {
      this.socket.removeEventListener('message', this._boundOnMessage);
      this.socket.removeEventListener('open', this._boundOnOpen);
      this.socket.removeEventListener('close', this._boundOnClose);
      this.socket.removeEventListener('error', this._boundOnError);
      this.socket.close();
      this.socket = null;
    }

    this._handlers.clear();
    this._pendingCallbackMessages.clear();
    this._pendingMessages.length = 0;
    this._onSocketOpen = null;
    this._onSocketClose = null;
    this._onSocketError = null;
    this._boundOnMessage = null;
    this._boundOnOpen = null;
    this._boundOnClose = null;
    this._boundOnError = null;
  }

  // --- Internal ---

  _handleMessage(msg) {
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
