import { Logger } from '../Logger.js';

const log = Logger.create('ConnectionMonitor');

const PONG_TIMEOUT_MS = 6000;
const PING_INTERVAL_MS = 3000;

/**
 * Monitors connection quality via ping/pong RTT measurement.
 * Detects pong timeout and fires socket close callback.
 */
export class ConnectionMonitor {
  /**
   * @param {import('./SignalingClient.js').SignalingClient} signaling
   */
  constructor(signaling) {
    this.signaling = signaling;
    this.latency = 0;
    this.rtt = 0;

    this._pingInterval = null;
    this._lastPongTime = 0;
    this._pongTimeoutFired = false;
    this._onTimeout = null;

    // Register pong handler
    signaling.on('pong', (msg) => this._handlePong(msg));
  }

  /**
   * Start periodic ping measurement.
   * Call when socket opens.
   */
  start() {
    this._lastPongTime = Date.now();
    this._pongTimeoutFired = false;

    if (this._pingInterval) return;

    this._pingInterval = setInterval(() => {
      if (
        !this._pongTimeoutFired &&
        this._lastPongTime > 0 &&
        Date.now() - this._lastPongTime > PONG_TIMEOUT_MS
      ) {
        this._pongTimeoutFired = true;
        log.warn('Pong timeout', {
          lastPongTime: this._lastPongTime,
          elapsed: Date.now() - this._lastPongTime,
        });
        this.stop();
        if (this._onTimeout) this._onTimeout();
        return;
      }
      this.signaling.send({ type: 'ping', t: Date.now() });
    }, PING_INTERVAL_MS);
  }

  /**
   * Stop periodic pings.
   */
  stop() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  /**
   * Register callback for pong timeout.
   * @param {Function} cb
   */
  onTimeout(cb) {
    this._onTimeout = cb;
  }

  sendPing() {
    this.signaling.send({ type: 'ping', t: Date.now() });
  }

  getRTT() {
    return this.rtt;
  }

  destroy() {
    this.stop();
    this.signaling.off('pong');
    this._onTimeout = null;
  }

  _handlePong(msg) {
    this._lastPongTime = Date.now();
    if (msg.t) {
      this.latency = Date.now() - msg.t;
      this.rtt = this.latency;
      log.debug('Pong received', { rtt: this.rtt });
    }
  }
}
