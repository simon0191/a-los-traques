import { Logger } from '../Logger.js';
import { ConnectionMonitor } from './ConnectionMonitor.js';
import { InputSync } from './InputSync.js';
import { SignalingClient } from './SignalingClient.js';
import { SpectatorRelay } from './SpectatorRelay.js';
import { TransportManager } from './TransportManager.js';

const log = Logger.create('NetworkFacade');

/**
 * Composes all networking modules and exposes the same public API
 * as the original NetworkManager. Scenes can swap imports from
 * NetworkManager to NetworkFacade with no behavioral changes.
 */
export class NetworkFacade {
  /**
   * @param {string} roomId
   * @param {string} host - PartyKit host
   * @param {{ spectator?: boolean }} [options]
   */
  constructor(roomId, host, { spectator = false } = {}) {
    this.roomId = roomId;

    // Core signaling layer
    this.signaling = new SignalingClient(roomId, host, { spectator });

    // Transport (WebRTC + signaling relay)
    this.transport = new TransportManager(this.signaling, {
      onP2PMessage: (msg) => {
        // Only input messages come through DataChannel
        if (msg.type === 'input') {
          this.inputSync.handleP2PInput(msg);
        }
      },
    });

    // Input buffering and dual-transport routing
    this.inputSync = new InputSync(this.signaling, this.transport);

    // Ping/pong RTT measurement
    this.monitor = new ConnectionMonitor(this.signaling);

    // Spectator messaging
    this.spectator = new SpectatorRelay(this.signaling);

    // Store host for TURN credential fetching
    this._host = host;

    // Wire opponent_joined → fetch TURN credentials, then init WebRTC
    this.signaling.on('opponent_joined', (msg) => {
      log.debug('Opponent joined', { slot: this.signaling.playerSlot });
      if (!this.signaling.isSpectator) {
        this._fetchTurnThenInitWebRTC();
      }
      if (this._onOpponentJoined) {
        this._onOpponentJoined(msg);
      }
    });

    // Wire opponent_reconnected → re-init WebRTC (credentials already cached)
    this.signaling.on('opponent_reconnected', (msg) => {
      log.debug('Opponent reconnected', { slot: this.signaling.playerSlot });
      if (!this.signaling.isSpectator) {
        this.transport.initWebRTC(this.signaling.playerSlot);
      }
      if (this._onOpponentReconnected) {
        this._onOpponentReconnected(msg);
      }
    });

    // Wire remaining room lifecycle events
    this._onOpponentJoined = null;
    this._onOpponentReconnected = null;

    this.signaling.on('rejoin_ack', () => {
      this.transport.flushPendingWebRTCInit();
      // rejoin_ack confirms our rejoin succeeded. The server only sends
      // opponent_reconnected to the OTHER peer, so we must resume our own
      // ReconnectionManager here.
      if (this._onOpponentReconnected) this._onOpponentReconnected();
    });

    // Room lifecycle callbacks
    this._onError = null;

    // Wire monitor timeout → socket close callback
    this.monitor.onTimeout(() => {
      if (this._onSocketClose) this._onSocketClose();
    });

    // Socket lifecycle callbacks (used by ReconnectionManager)
    this._onSocketClose = null;
    this._onSocketOpen = null;

    this.signaling.onSocketClose(() => {
      if (this._onSocketClose) this._onSocketClose();
    });
    this.signaling.onSocketOpen(() => {
      this.monitor.start();
      if (this._onSocketOpen) this._onSocketOpen();
    });
    this.signaling.onSocketError(() => {
      if (this._onError) this._onError();
    });
  }

  // --- Proxy properties ---

  get sessionId() {
    return this.signaling.sessionId;
  }
  get playerSlot() {
    return this.signaling.playerSlot;
  }
  get connected() {
    return this.signaling.connected;
  }
  get isSpectator() {
    return this.signaling.isSpectator;
  }
  get socket() {
    return this.signaling.socket;
  }
  get latency() {
    return this.monitor.latency;
  }
  get rtt() {
    return this.monitor.rtt;
  }
  get remoteInputBuffer() {
    return this.inputSync.remoteInputBuffer;
  }
  get lastRemoteInput() {
    return this.inputSync.lastRemoteInput;
  }
  get remoteInputBufferP1() {
    return this.inputSync.remoteInputBufferP1;
  }
  get remoteInputBufferP2() {
    return this.inputSync.remoteInputBufferP2;
  }
  get lastRemoteInputP1() {
    return this.inputSync.lastRemoteInputP1;
  }
  get lastRemoteInputP2() {
    return this.inputSync.lastRemoteInputP2;
  }
  /** Compat: FightScene reads this for HUD transport indicator */
  get _webrtcReady() {
    return this.transport.isWebRTCReady();
  }

  // --- Public API: register callbacks ---

  onAssign(cb) {
    this.signaling.on('assign', (msg) => cb(msg.player));
  }
  onOpponentJoined(cb) {
    this._onOpponentJoined = cb;
    if (cb && this._pendingOpponentJoined) {
      const msg = this._pendingOpponentJoined;
      this._pendingOpponentJoined = null;
      cb(msg);
    }
  }
  onOpponentReady(cb) {
    this.signaling.on('opponent_ready', (msg) => cb(msg.fighterId));
  }
  onGoToStageSelect(cb) {
    this.signaling.on('go_to_stage_select', cb);
  }
  onStart(cb) {
    this.signaling.on('start', cb);
  }
  onRemoteInput(cb) {
    this.inputSync.onRemoteInput(cb);
  }
  onDisconnect(cb) {
    this.signaling.on('disconnect', cb);
  }
  onRematch(cb) {
    this.signaling.on('rematch', cb);
  }
  onFull(cb) {
    this.signaling.on('full', cb);
  }
  onError(cb) {
    this._onError = cb;
  }
  onSync(cb) {
    this.spectator.onSync(cb);
  }
  onRoundEvent(cb) {
    this.spectator.onRoundEvent(cb);
  }
  onLeave(cb) {
    this.signaling.on('leave', cb);
  }
  onAssignSpectator(cb) {
    this.spectator.onAssignSpectator(cb);
  }
  onSpectatorCount(cb) {
    this.spectator.onSpectatorCount(cb);
  }
  onShout(cb) {
    this.spectator.onShout(cb);
  }
  onFightState(cb) {
    this.spectator.onFightState(cb);
  }
  onPotionApplied(cb) {
    this.spectator.onPotionApplied(cb);
  }
  onPotion(cb) {
    this.spectator.onPotion(cb);
  }
  onOpponentReconnecting(cb) {
    this.signaling.on('opponent_reconnecting', cb);
  }
  onOpponentReconnected(cb) {
    this._onOpponentReconnected = cb;
    if (cb && this._pendingOpponentReconnected) {
      const msg = this._pendingOpponentReconnected;
      this._pendingOpponentReconnected = null;
      cb(msg);
    }
  }
  onReturnToSelect(cb) {
    this.signaling.on('return_to_select', cb);
  }
  onRejoinAvailable(cb) {
    this.signaling.on('rejoin_available', (msg) => cb(msg.slot));
  }
  onFrameZeroSync(cb) {
    this.signaling.on('frame_sync', cb);
  }
  onChecksum(cb) {
    this.inputSync.onChecksum(cb);
  }
  onResyncRequest(cb) {
    this.inputSync.onResyncRequest(cb);
  }
  onResync(cb) {
    this.inputSync.onResync(cb);
  }
  onSocketClose(cb) {
    this._onSocketClose = cb;
  }
  onSocketOpen(cb) {
    this._onSocketOpen = cb;
  }
  onTransportDegraded(cb) {
    this.transport.onTransportDegraded(cb);
  }
  onTransportRestored(cb) {
    this.transport.onTransportRestored(cb);
  }
  onDebugRequest(cb) {
    this.signaling.on('debug_request', cb);
  }
  onDebugResponse(cb) {
    this.signaling.on('debug_response', cb);
  }

  // --- Public API: send messages ---

  sendReady(fighterId) {
    this.signaling.send({ type: 'ready', fighterId });
  }
  sendStageSelect(stageId, isRandomStage = false) {
    this.signaling.send({ type: 'select_stage', stageId, isRandomStage });
  }
  sendInput(frame, inputState, history) {
    this.inputSync.sendInput(frame, inputState, history);
  }
  sendFrameZeroSync(hash) {
    this.signaling.send({ type: 'frame_sync', hash });
  }
  sendChecksum(frame, hash) {
    this.inputSync.sendChecksum(frame, hash);
  }
  sendResyncRequest(frame) {
    this.inputSync.sendResyncRequest(frame);
  }
  sendResync(snapshot) {
    this.inputSync.sendResync(snapshot);
  }
  sendRematch() {
    this.signaling.send({ type: 'rematch' });
  }
  sendLeave() {
    this.signaling.send({ type: 'leave' });
  }
  sendSync(state) {
    this.spectator.sendSync(state);
  }
  sendRoundEvent(event) {
    this.spectator.sendRoundEvent(event);
  }
  sendShout(text) {
    this.spectator.sendShout(text);
  }
  sendPotion(target, potionType) {
    this.spectator.sendPotion(target, potionType);
  }
  sendDebugRequest() {
    this.signaling.send({ type: 'debug_request' });
  }
  sendDebugResponse(bundle) {
    this.signaling.send({ type: 'debug_response', bundle });
  }
  sendRejoin(slot, reset = false) {
    const msg = { type: 'rejoin', slot };
    if (reset) msg.reset = true;
    this.signaling.send(msg);
  }
  /**
   * Queue WebRTC init for after signaling confirms stable (rejoin_ack).
   * Called by the reconnecting peer before sendRejoin.
   */
  queueWebRTCInit() {
    this.transport.queueWebRTCInit(this.signaling.playerSlot);
  }
  sendPing() {
    this.monitor.sendPing();
  }
  getRTT() {
    return this.monitor.getRTT();
  }

  // --- Public API: input consumption ---

  getRemoteInput() {
    return this.inputSync.getRemoteInput();
  }
  getRemoteInputForSlot(slot) {
    return this.inputSync.getRemoteInputForSlot(slot);
  }
  drainConfirmedInputs() {
    return this.inputSync.drainConfirmedInputs();
  }
  getPlayerSlot() {
    return this.signaling.playerSlot;
  }

  // --- Lifecycle ---

  resetForReselect() {
    this.inputSync.reset();
    this.spectator.reset();
    // Clear room lifecycle callbacks that are scene-specific
    this._onOpponentReady = null;
    this._onOpponentJoined = null;
    this._onOpponentReconnected = null;
    this._onSocketClose = null;
    this._onSocketOpen = null;
    this._onError = null;

    // Reset signaling handlers for scene-specific types
    this.signaling.resetHandlers([
      'opponent_ready',
      'go_to_stage_select',
      'start',
      'rematch',
      'leave',
      'opponent_reconnecting',
      'opponent_reconnected',
      'return_to_select',
      'rejoin_available',
    ]);
    // Cancel any pending WebRTC init from reconnection flow
    this.transport.cancelPendingWebRTCInit();
    // Note: WebRTC is intentionally preserved across reselect
  }

  /**
   * Fetch TURN credentials then init WebRTC.
   * Called on opponent_joined. Non-blocking: WebRTC init proceeds
   * even if TURN fetch fails (falls back to STUN-only).
   */
  async _fetchTurnThenInitWebRTC() {
    try {
      await this.transport.fetchTurnCredentials(this._host, this.roomId);
      log.info('TURN fetch complete', { iceServers: this.transport._iceServers?.length ?? 0 });
    } catch (_) {
      log.warn('TURN fetch failed, proceeding with STUN-only');
    }
    log.debug('WebRTC init trigger', {
      slot: this.signaling.playerSlot,
      offerer: this.signaling.playerSlot === 0,
    });
    this.transport.initWebRTC(this.signaling.playerSlot);
  }

  destroy() {
    this.monitor.destroy();
    this.transport.destroy();
    this.inputSync.destroy();
    this.spectator.destroy();
    this.signaling.destroy();

    this._onOpponentJoined = null;
    this._onOpponentReady = null;
    this._onOpponentReconnected = null;
    this._onDisconnect = null;
    this._onRematch = null;
    this._onFull = null;
    this._onLeave = null;
    this._onError = null;
    this._onOpponentReconnecting = null;
    this._onReturnToSelect = null;
    this._onRejoinAvailable = null;
    this._onSocketClose = null;
    this._onSocketOpen = null;
  }
}
