/**
 * Pure state machine for managing graceful reconnection during online fights.
 * No Phaser or WebSocket dependencies — fully testable with injectable clock.
 *
 * States: 'connected' → 'reconnecting' → 'connected' | 'disconnected'
 */
export class ReconnectionManager {
  /**
   * @param {{ gracePeriodMs?: number, now?: () => number }} [options]
   */
  constructor({ gracePeriodMs = 20000, now = Date.now } = {}) {
    this._gracePeriodMs = gracePeriodMs;
    this._now = now;
    this._state = 'connected';
    this._reconnectStartTime = 0;
    this._localRestored = false;
    this._destroyed = false;

    this._onPauseCb = null;
    this._onResumeCb = null;
    this._onDisconnectCb = null;
  }

  get state() {
    return this._state;
  }

  isReconnecting() {
    return this._state === 'reconnecting';
  }

  elapsed() {
    if (this._state !== 'reconnecting') return 0;
    return this._now() - this._reconnectStartTime;
  }

  // --- Events (called by integration layer) ---

  handleConnectionLost() {
    if (this._destroyed) return;
    if (this._state === 'disconnected') return;
    if (this._state === 'reconnecting') {
      // Re-entrant: reset timer without re-firing onPause
      this._reconnectStartTime = this._now();
      return;
    }
    this._enterReconnecting();
  }

  handleConnectionRestored() {
    if (this._destroyed) return;
    if (this._state !== 'reconnecting') return;
    this._localRestored = true;
    // Do NOT fire onResume yet — wait for server confirmation via handleOpponentReconnected
  }

  handleOpponentReconnecting() {
    if (this._destroyed) return;
    if (this._state === 'disconnected') return;
    if (this._state === 'reconnecting') {
      // Re-entrant: reset timer without re-firing onPause
      this._reconnectStartTime = this._now();
      return;
    }
    this._enterReconnecting();
  }

  handleOpponentReconnected() {
    if (this._destroyed) return;
    if (this._state !== 'reconnecting') return;
    this._state = 'connected';
    this._localRestored = false;
    this._reconnectStartTime = 0;
    if (this._onResumeCb) this._onResumeCb();
  }

  handleOpponentDisconnected() {
    if (this._destroyed) return;
    if (this._state === 'disconnected') return;
    this._enterDisconnected();
  }

  // --- Callbacks ---

  onPause(cb) {
    this._onPauseCb = cb;
  }

  onResume(cb) {
    this._onResumeCb = cb;
  }

  onDisconnect(cb) {
    this._onDisconnectCb = cb;
  }

  // --- Tick (call each frame, even while paused) ---

  tick() {
    if (this._destroyed) return;
    if (this._state !== 'reconnecting') return;
    if (this._now() - this._reconnectStartTime >= this._gracePeriodMs) {
      this._enterDisconnected();
    }
  }

  destroy() {
    this._destroyed = true;
    this._onPauseCb = null;
    this._onResumeCb = null;
    this._onDisconnectCb = null;
  }

  // --- Internal ---

  _enterReconnecting() {
    this._state = 'reconnecting';
    this._reconnectStartTime = this._now();
    this._localRestored = false;
    if (this._onPauseCb) this._onPauseCb();
  }

  _enterDisconnected() {
    this._state = 'disconnected';
    this._reconnectStartTime = 0;
    this._localRestored = false;
    if (this._onDisconnectCb) this._onDisconnectCb();
  }
}
