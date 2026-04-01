/**
 * Always-on lightweight match telemetry counters.
 * Updated via callbacks from RollbackManager and ConnectionMonitor.
 * Zero allocation — just integer increments and array pushes.
 *
 * Total memory: under 200 bytes (excluding rttSamples which caps at ~480 bytes).
 */

const MAX_RTT_SAMPLES = 60;
const RTT_SAMPLE_INTERVAL_MS = 3000;

export class MatchTelemetry {
  /**
   * @param {string} matchId - Room ID or 'local'
   */
  constructor(matchId) {
    this.matchId = matchId;
    this.startedAt = Date.now();
    this.transportMode = 'websocket';
    this.transportChanges = 0;
    this.rollbackCount = 0;
    this.maxRollbackDepth = 0;
    this.desyncCount = 0;
    this.resyncCount = 0;
    this.rttSamples = [];
    this.rttMin = Infinity;
    this.rttMax = 0;
    this.rttSum = 0;
    this.disconnectionCount = 0;
    this.reconnectionCount = 0;

    this._rttSampleTimer = null;
    this._connectionMonitor = null;
  }

  /**
   * Wire to a ConnectionMonitor for periodic RTT sampling.
   * @param {import('./net/ConnectionMonitor.js').ConnectionMonitor} monitor
   */
  wireConnectionMonitor(monitor) {
    this._connectionMonitor = monitor;
    this._rttSampleTimer = setInterval(() => {
      this._sampleRTT();
    }, RTT_SAMPLE_INTERVAL_MS);
  }

  recordRollback(_frame, depth) {
    this.rollbackCount++;
    if (depth > this.maxRollbackDepth) {
      this.maxRollbackDepth = depth;
    }
  }

  recordDesync() {
    this.desyncCount++;
  }

  recordResync() {
    this.resyncCount++;
  }

  recordTransportChange(mode) {
    if (mode !== this.transportMode) {
      this.transportMode = mode;
      this.transportChanges++;
    }
  }

  recordDisconnection() {
    this.disconnectionCount++;
  }

  recordReconnection() {
    this.reconnectionCount++;
  }

  _sampleRTT() {
    if (!this._connectionMonitor) return;
    const rtt = this._connectionMonitor.rtt;
    if (rtt <= 0) return;

    if (this.rttSamples.length >= MAX_RTT_SAMPLES) {
      this.rttSamples.shift();
    }
    this.rttSamples.push(rtt);

    if (rtt < this.rttMin) this.rttMin = rtt;
    if (rtt > this.rttMax) this.rttMax = rtt;
    this.rttSum += rtt;
  }

  /**
   * Get a snapshot of telemetry data for inclusion in debug bundles.
   */
  toJSON() {
    const count = this.rttSamples.length;
    return {
      matchId: this.matchId,
      startedAt: this.startedAt,
      matchDurationMs: Date.now() - this.startedAt,
      transportMode: this.transportMode,
      transportChanges: this.transportChanges,
      rollbackCount: this.rollbackCount,
      maxRollbackDepth: this.maxRollbackDepth,
      desyncCount: this.desyncCount,
      resyncCount: this.resyncCount,
      rttSamples: this.rttSamples.slice(),
      rttMin: this.rttMin === Infinity ? 0 : this.rttMin,
      rttMax: this.rttMax,
      rttAvg: count > 0 ? Math.round(this.rttSum / count) : 0,
      disconnectionCount: this.disconnectionCount,
      reconnectionCount: this.reconnectionCount,
    };
  }

  destroy() {
    if (this._rttSampleTimer) {
      clearInterval(this._rttSampleTimer);
      this._rttSampleTimer = null;
    }
    this._connectionMonitor = null;
  }
}
