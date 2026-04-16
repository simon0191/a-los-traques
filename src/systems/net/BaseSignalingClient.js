import PartySocket from 'partysocket';
import { Logger } from '../Logger.js';

const log = Logger.create('BaseSignalingClient');

/**
 * Common base class for PartyKit-based communication.
 * Handles:
 * - Socket lifecycle (open, close, error)
 * - JSON message parsing
 * - Pending message queue while disconnected (B4)
 * - Cleanup on destroy
 */
export class BaseSignalingClient {
  /**
   * @param {string} roomId
   * @param {string} host - PartyKit host
   * @param {object} [options]
   * @param {object} [options.query] - Additional query params
   */
  constructor(roomId, host, { query = {} } = {}) {
    this.roomId = roomId;
    this.connected = false;

    /** Session ID for client-server log correlation */
    this.sessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);

    /** @type {object[]} B4: messages queued while disconnected */
    this._pendingMessages = [];

    // Socket lifecycle callbacks (optional for subclasses)
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
      query: { ...query, sessionId: this.sessionId },
    };

    this.socket = new PartySocket(socketOptions);

    // Bound handlers for listener cleanup
    this._boundOnMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessageInternal(data);
      } catch (e) {
        log.warn('JSON parse error on message', e);
      }
    };

    this._boundOnOpen = () => {
      this.connected = true;
      log.info('Socket open', { roomId: this.roomId, sessionId: this.sessionId });

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
      log.info('Socket close', { roomId: this.roomId });
      if (this._onSocketClose) this._onSocketClose();
    };

    this._boundOnError = (err) => {
      log.warn('Socket error', { roomId: this.roomId, err });
      if (this._onSocketError) this._onSocketError(err);
    };

    this.socket.addEventListener('message', this._boundOnMessage);
    this.socket.addEventListener('open', this._boundOnOpen);
    this.socket.addEventListener('close', this._boundOnClose);
    this.socket.addEventListener('error', this._boundOnError);
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
   * Internal dispatcher - meant to be overridden by subclasses
   * @param {object} data
   * @protected
   */
  _handleMessageInternal(_data) {
    // Override in subclasses
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
    this._pendingMessages.length = 0;
    this._onSocketOpen = null;
    this._onSocketClose = null;
    this._onSocketError = null;
  }
}
