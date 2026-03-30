import PartySocket from 'partysocket';
import { decodeInput } from './InputBuffer.js';
import { WebRTCTransport } from './WebRTCTransport.js';

const PONG_TIMEOUT_MS = 6000;

// Message types that support callback buffering (B5)
const BUFFERABLE_TYPES = ['sync', 'round_event', 'start', 'go_to_stage_select'];

// Map message types to their callback property names
const _TYPE_TO_CALLBACK = {
  sync: '_onSync',
  round_event: '_onRoundEvent',
  start: '_onStart',
  go_to_stage_select: '_onGoToStageSelect',
};

export class NetworkManager {
  /**
   * @param {string} roomId
   * @param {string} host - PartyKit host (e.g. 'localhost:1999' or 'a-los-traques.username.partykit.dev')
   * @param {{ spectator?: boolean }} [options]
   */
  constructor(roomId, host, { spectator = false } = {}) {
    this.roomId = roomId;
    this.playerSlot = -1;
    this.connected = false;
    this.localFrame = 0;
    this.isSpectator = false;
    this.latency = 0;
    this._pingInterval = null;

    // Callbacks (managed via setter properties for bufferable types)
    this._onAssign = null;
    this._onOpponentJoined = null;
    this._onOpponentReady = null;
    this._onGoToStageSelect = null;
    this.__onStart = null;
    this._onRemoteInput = null;
    this._onDisconnect = null;
    this._onRematch = null;
    this._onFull = null;
    this._onError = null;
    this.__onSync = null;
    this.__onRoundEvent = null;
    this._onLeave = null;
    this._onAssignSpectator = null;
    this._onSpectatorCount = null;
    this._onShout = null;
    this._onFightState = null;
    this._onPotionApplied = null;
    this._onPotion = null;
    this._onOpponentReconnecting = null;
    this._onOpponentReconnected = null;
    this._onReturnToSelect = null;
    this._onSocketClose = null;
    this._onSocketOpen = null;
    this._onRejoinAvailable = null;
    this._onChecksum = null;
    this._onResyncRequest = null;
    this._onResync = null;

    // WebRTC P2P transport state
    this._webrtc = null;
    this._transportMode = 'websocket'; // 'websocket' | 'webrtc'
    this._webrtcReady = false;

    // B5: Pending callback messages queue
    this._pendingCallbackMessages = {
      sync: [],
      round_event: [],
      start: [],
    };

    // B5: Define setter properties that flush pending messages when callback is set
    for (const type of BUFFERABLE_TYPES) {
      const privateProp = `__on${type.charAt(0).toUpperCase()}${type.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;
      const publicProp = `_on${type.charAt(0).toUpperCase()}${type.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;
      Object.defineProperty(this, publicProp, {
        get() {
          return this[privateProp];
        },
        set(cb) {
          this[privateProp] = cb;
          if (
            cb &&
            this._pendingCallbackMessages[type] &&
            this._pendingCallbackMessages[type].length > 0
          ) {
            const pending = this._pendingCallbackMessages[type].splice(0);
            for (const msg of pending) {
              cb(msg);
            }
          }
        },
        configurable: true,
        enumerable: true,
      });
    }

    // Input buffer: frame -> inputState
    this.remoteInputBuffer = {};
    this.lastRemoteInput = null;

    // RTT measurement
    this.rtt = 0;

    // Spectator input buffers (one per player slot)
    this.remoteInputBufferP1 = {};
    this.lastRemoteInputP1 = null;
    this.remoteInputBufferP2 = {};
    this.lastRemoteInputP2 = null;

    // B4: Pending messages queue for when disconnected
    this._pendingMessages = [];

    // Determine protocol based on host
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';

    const socketOptions = {
      host: host,
      room: roomId,
      protocol: protocol,
      maxRetries: 3,
      startClosed: false,
    };

    if (spectator) {
      socketOptions.query = { spectate: '1' };
    }

    this.socket = new PartySocket(socketOptions);

    // B2: Store bound handler references for cleanup
    this._boundOnMessage = (event) => {
      // B1: Wrap JSON.parse in try-catch
      try {
        this._handleMessage(JSON.parse(event.data));
      } catch (_e) {
        // Silently ignore malformed messages
        return;
      }
    };
    this._lastPongTime = 0;
    this._pongTimeoutFired = false;

    this._boundOnOpen = () => {
      this.connected = true;
      this._lastPongTime = Date.now();
      this._pongTimeoutFired = false;
      // B4: Flush pending messages on reconnect
      if (this._pendingMessages.length > 0) {
        const pending = this._pendingMessages.splice(0);
        for (const msg of pending) {
          this._send(msg);
        }
      }
      // Start ping measurement
      if (!this._pingInterval) {
        this._pingInterval = setInterval(() => {
          if (
            !this._pongTimeoutFired &&
            this._lastPongTime > 0 &&
            Date.now() - this._lastPongTime > PONG_TIMEOUT_MS
          ) {
            this._pongTimeoutFired = true;
            clearInterval(this._pingInterval);
            this._pingInterval = null;
            if (this._onSocketClose) this._onSocketClose();
            return;
          }
          this._send({ type: 'ping', t: Date.now() });
        }, 3000);
      }
      if (this._onSocketOpen) this._onSocketOpen();
    };
    this._boundOnClose = () => {
      this.connected = false;
      if (this._onSocketClose) this._onSocketClose();
    };
    this._boundOnError = () => {
      if (this._onError) this._onError();
    };

    this.socket.addEventListener('message', this._boundOnMessage);
    this.socket.addEventListener('open', this._boundOnOpen);
    this.socket.addEventListener('close', this._boundOnClose);
    this.socket.addEventListener('error', this._boundOnError);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'assign':
        this.playerSlot = msg.player;
        if (this._onAssign) this._onAssign(msg.player);
        break;
      case 'opponent_joined':
        this._initWebRTC();
        if (this._onOpponentJoined) this._onOpponentJoined();
        break;
      case 'opponent_ready':
        if (this._onOpponentReady) this._onOpponentReady(msg.fighterId);
        break;
      case 'go_to_stage_select':
        if (this._onGoToStageSelect) {
          this._onGoToStageSelect(msg);
        } else {
          this._pendingCallbackMessages.go_to_stage_select.push(msg);
        }
        break;
      case 'start':
        if (this._onStart) {
          this._onStart(msg);
        } else {
          this._pendingCallbackMessages.start.push(msg);
        }
        break;
      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice':
        if (this._webrtc) this._webrtc.handleSignal(msg);
        break;
      case 'input':
        // Always accept WS inputs even when DataChannel is open.
        // The remote peer may still be sending via WS if their DataChannel
        // isn't ready yet (asymmetric reconnection). No duplication risk:
        // when a peer sends via DataChannel, its WS copy uses spectatorOnly
        // so the server won't forward it to the opponent.
        if (this.isSpectator && msg.slot != null) {
          // Spectator: route input to correct player buffer
          const buf = msg.slot === 0 ? 'remoteInputBufferP1' : 'remoteInputBufferP2';
          const lastKey = msg.slot === 0 ? 'lastRemoteInputP1' : 'lastRemoteInputP2';
          this[buf][msg.frame] = msg.state;
          this[lastKey] = msg.state;
        } else {
          this.remoteInputBuffer[msg.frame] = msg.state;
          this.lastRemoteInput = msg.state;
          // Process redundant input history — fill gaps without overwriting confirmed data
          if (msg.history) {
            for (const [hFrame, encodedInput] of msg.history) {
              if (!(hFrame in this.remoteInputBuffer)) {
                this.remoteInputBuffer[hFrame] = decodeInput(encodedInput);
              }
            }
          }
        }
        if (this._onRemoteInput) this._onRemoteInput(msg.frame, msg.state, msg.slot);
        break;
      case 'checksum':
        if (this._onChecksum) this._onChecksum(msg.frame, msg.hash);
        break;
      case 'resync_request':
        if (this._onResyncRequest) this._onResyncRequest(msg);
        break;
      case 'resync':
        if (this._onResync) this._onResync(msg);
        break;
      case 'disconnect':
        if (this._onDisconnect) this._onDisconnect();
        break;
      case 'rematch':
        if (this._onRematch) this._onRematch();
        break;
      case 'full':
        if (this._onFull) this._onFull();
        break;
      case 'sync':
        if (this._onSync) {
          this._onSync(msg);
        } else {
          this._pendingCallbackMessages.sync.push(msg);
        }
        break;
      case 'round_event':
        if (this._onRoundEvent) {
          this._onRoundEvent(msg);
        } else {
          this._pendingCallbackMessages.round_event.push(msg);
        }
        break;
      case 'leave':
        if (this._onLeave) this._onLeave();
        break;
      case 'assign_spectator':
        this.isSpectator = true;
        if (this._onAssignSpectator) this._onAssignSpectator(msg.spectatorCount);
        break;
      case 'spectator_count':
        if (this._onSpectatorCount) this._onSpectatorCount(msg.count);
        break;
      case 'shout':
        if (this._onShout) this._onShout(msg.text);
        break;
      case 'fight_state':
        if (this._onFightState) this._onFightState(msg);
        break;
      case 'potion_applied':
        if (this._onPotionApplied) this._onPotionApplied(msg.target, msg.potionType);
        break;
      case 'potion':
        if (this._onPotion) this._onPotion(msg.target, msg.potionType);
        break;
      case 'opponent_reconnecting':
        if (this._onOpponentReconnecting) this._onOpponentReconnecting();
        break;
      case 'opponent_reconnected':
        this._initWebRTC();
        if (this._onOpponentReconnected) this._onOpponentReconnected();
        break;
      case 'return_to_select':
        if (this._onReturnToSelect) this._onReturnToSelect();
        break;
      case 'rejoin_available':
        if (this._onRejoinAvailable) this._onRejoinAvailable(msg.slot);
        break;
      case 'pong':
        this._lastPongTime = Date.now();
        if (msg.t) {
          this.latency = Date.now() - msg.t;
          this.rtt = this.latency;
        }
        break;
    }
  }

  // --- Public API: register callbacks ---
  onAssign(cb) {
    this._onAssign = cb;
  }
  onOpponentJoined(cb) {
    this._onOpponentJoined = cb;
  }
  onOpponentReady(cb) {
    this._onOpponentReady = cb;
  }
  onGoToStageSelect(cb) {
    this._onGoToStageSelect = cb;
  }
  onStart(cb) {
    this._onStart = cb;
  }
  onRemoteInput(cb) {
    this._onRemoteInput = cb;
  }
  onDisconnect(cb) {
    this._onDisconnect = cb;
  }
  onRematch(cb) {
    this._onRematch = cb;
  }
  onFull(cb) {
    this._onFull = cb;
  }
  onError(cb) {
    this._onError = cb;
  }
  onSync(cb) {
    this._onSync = cb;
  }
  onRoundEvent(cb) {
    this._onRoundEvent = cb;
  }
  onLeave(cb) {
    this._onLeave = cb;
  }
  onAssignSpectator(cb) {
    this._onAssignSpectator = cb;
  }
  onSpectatorCount(cb) {
    this._onSpectatorCount = cb;
  }
  onShout(cb) {
    this._onShout = cb;
  }
  onFightState(cb) {
    this._onFightState = cb;
  }
  onPotionApplied(cb) {
    this._onPotionApplied = cb;
  }
  onPotion(cb) {
    this._onPotion = cb;
  }
  onOpponentReconnecting(cb) {
    this._onOpponentReconnecting = cb;
  }
  onOpponentReconnected(cb) {
    this._onOpponentReconnected = cb;
  }
  onReturnToSelect(cb) {
    this._onReturnToSelect = cb;
  }
  onRejoinAvailable(cb) {
    this._onRejoinAvailable = cb;
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

  // --- Public API: send messages ---
  sendReady(fighterId) {
    this._send({ type: 'ready', fighterId });
  }

  sendStageSelect(stageId, isRandomStage = false) {
    this._send({ type: 'select_stage', stageId, isRandomStage });
  }

  sendInput(frame, inputState, history) {
    const msg = { type: 'input', frame, state: inputState };
    if (history && history.length > 0) {
      msg.history = history;
    }
    if (this._webrtcReady) {
      // P2P: fast path for opponent (includes history for unreliable channel)
      this._webrtc.send(JSON.stringify(msg));
      // Server: spectator relay only (server won't forward to opponent)
      this._send({ ...msg, spectatorOnly: true });
    } else {
      // Fallback: server relays to opponent + spectators
      this._send(msg);
    }
  }

  sendChecksum(frame, hash) {
    this._send({ type: 'checksum', frame, hash });
  }

  sendResyncRequest(frame) {
    this._send({ type: 'resync_request', frame });
  }

  sendResync(snapshot) {
    this._send({ type: 'resync', snapshot });
  }

  sendRematch() {
    this._send({ type: 'rematch' });
  }

  sendLeave() {
    this._send({ type: 'leave' });
  }

  sendSync(state) {
    this._send({ type: 'sync', ...state });
  }

  sendRoundEvent(event) {
    this._send({ type: 'round_event', ...event });
  }

  sendShout(text) {
    this._send({ type: 'shout', text });
  }

  sendPotion(target, potionType) {
    this._send({ type: 'potion', target, potionType });
  }

  sendRejoin(slot, reset = false) {
    const msg = { type: 'rejoin', slot };
    if (reset) msg.reset = true;
    this._send(msg);
  }

  sendPing() {
    this._send({ type: 'ping', t: Date.now() });
  }

  getRTT() {
    return this.rtt;
  }

  /**
   * Get the latest remote input, consuming any pending one-shot attacks.
   * Frame parameter is unused — we always consume the newest input since
   * host/guest frame counters are not synchronized.
   * B3: OR-merge attack flags across all buffered frames to avoid losing inputs.
   * @returns {object} input state
   */
  getRemoteInput() {
    // If there are buffered inputs, consume them all
    const frames = Object.keys(this.remoteInputBuffer).map(Number);
    if (frames.length > 0) {
      const latest = Math.max(...frames);
      const input = { ...this.remoteInputBuffer[latest] };

      // B3: OR-merge attack flags from ALL buffered frames
      const attackFlags = ['lp', 'hp', 'lk', 'hk', 'sp'];
      for (const frame of frames) {
        const frameInput = this.remoteInputBuffer[frame];
        for (const flag of attackFlags) {
          if (frameInput[flag]) {
            input[flag] = true;
          }
        }
      }

      // Clear all buffered inputs — they've been consumed
      this.remoteInputBuffer = {};
      // Update lastRemoteInput for movement continuity,
      // but strip one-shot attacks so they don't repeat
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
    // No new input: repeat last known movement (attacks already stripped)
    if (this.lastRemoteInput) {
      return { ...this.lastRemoteInput };
    }
    return {
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

      // B3: OR-merge attack flags from ALL buffered frames
      const attackFlags = ['lp', 'hp', 'lk', 'hk', 'sp'];
      for (const frame of frames) {
        const frameInput = buf[frame];
        for (const flag of attackFlags) {
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
    return {
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
  }

  /**
   * Drain all confirmed remote inputs indexed by frame.
   * Returns entries and clears the buffer.
   * Used by RollbackManager to process confirmed inputs.
   * @returns {Array<[number, object]>} Array of [frame, inputState] pairs
   */
  drainConfirmedInputs() {
    const entries = Object.entries(this.remoteInputBuffer).map(([frame, state]) => [
      Number(frame),
      state,
    ]);
    this.remoteInputBuffer = {};
    return entries;
  }

  getPlayerSlot() {
    return this.playerSlot;
  }

  resetForReselect() {
    // Note: WebRTC is intentionally preserved across reselect — the P2P
    // connection established during selection should persist into the fight.
    // Only destroy/leave/reconnection should tear it down.
    this.remoteInputBuffer = {};
    this.lastRemoteInput = null;
    this.remoteInputBufferP1 = {};
    this.lastRemoteInputP1 = null;
    this.remoteInputBufferP2 = {};
    this.lastRemoteInputP2 = null;
    this.localFrame = 0;
    this._onOpponentReady = null;
    this._onGoToStageSelect = null;
    this._onStart = null;
    this._onRemoteInput = null;
    this._onRematch = null;
    this._onLeave = null;
    this._onSync = null;
    this._onRoundEvent = null;
    this._onOpponentReconnecting = null;
    this._onOpponentReconnected = null;
    this._onReturnToSelect = null;
    this._onSocketClose = null;
    this._onSocketOpen = null;
    this._onRejoinAvailable = null;
    this._onChecksum = null;
    this._onResyncRequest = null;
    this._onResync = null;
    
    // Clear pending messages for bufferable types
    for (const type of BUFFERABLE_TYPES) {
      if (this._pendingCallbackMessages[type]) {
        this._pendingCallbackMessages[type] = [];
      }
    }
  }

  destroy() {
    this._destroyWebRTC();
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (this.socket) {
      // B2: Remove event listeners before closing
      this.socket.removeEventListener('message', this._boundOnMessage);
      this.socket.removeEventListener('open', this._boundOnOpen);
      this.socket.removeEventListener('close', this._boundOnClose);
      this.socket.removeEventListener('error', this._boundOnError);
      this.socket.close();
      this.socket = null;
    }

    // B2: Null out all callback properties
    this._onAssign = null;
    this._onOpponentJoined = null;
    this._onOpponentReady = null;
    this._onStart = null;
    this._onRemoteInput = null;
    this._onDisconnect = null;
    this._onRematch = null;
    this._onFull = null;
    this._onError = null;
    this._onSync = null;
    this._onRoundEvent = null;
    this._onLeave = null;
    this._onAssignSpectator = null;
    this._onSpectatorCount = null;
    this._onShout = null;
    this._onFightState = null;
    this._onPotionApplied = null;
    this._onPotion = null;
    this._onOpponentReconnecting = null;
    this._onOpponentReconnected = null;
    this._onReturnToSelect = null;
    this._onSocketClose = null;
    this._onSocketOpen = null;
    this._onRejoinAvailable = null;
    this._onChecksum = null;
    this._onResyncRequest = null;
    this._onResync = null;

    // Clear bound handler references
    this._boundOnMessage = null;
    this._boundOnOpen = null;
    this._boundOnClose = null;
    this._boundOnError = null;
  }

  _initWebRTC() {
    // Don't init for spectators or if WebRTC APIs aren't available
    if (this.isSpectator) return;
    if (typeof RTCPeerConnection === 'undefined') {
      console.log('[NM] WebRTC unavailable (no RTCPeerConnection)');
      return;
    }

    // Clean up any existing WebRTC connection
    this._destroyWebRTC();

    const isOfferer = this.playerSlot === 0;
    console.log(`[NM] _initWebRTC slot=${this.playerSlot} offerer=${isOfferer}`);

    this._webrtc = new WebRTCTransport({
      isOfferer,
      onSignal: (msg) => this._send(msg),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'input') {
            this.remoteInputBuffer[msg.frame] = msg.state;
            this.lastRemoteInput = msg.state;
            // Process redundant input history — fill gaps from P2P packet loss
            if (msg.history) {
              for (const [hFrame, encodedInput] of msg.history) {
                if (!(hFrame in this.remoteInputBuffer)) {
                  this.remoteInputBuffer[hFrame] = decodeInput(encodedInput);
                }
              }
            }
            if (this._onRemoteInput) this._onRemoteInput(msg.frame, msg.state);
          }
        } catch (_) {
          // ignore malformed P2P messages
        }
      },
      onOpen: () => {
        this._transportMode = 'webrtc';
        this._webrtcReady = true;
      },
      onClose: () => {
        this._transportMode = 'websocket';
        this._webrtcReady = false;
      },
      onFailed: () => {
        // Silent fallback — stay on WebSocket
        this._transportMode = 'websocket';
        this._webrtcReady = false;
        this._webrtc = null;
      },
    });

    if (isOfferer) {
      this._webrtc.startOffer();
    }
  }

  _destroyWebRTC() {
    if (this._webrtc) {
      this._webrtc.destroy();
      this._webrtc = null;
    }
    this._transportMode = 'websocket';
    this._webrtcReady = false;
  }

  _send(msg) {
    if (this.socket && this.connected) {
      this.socket.send(JSON.stringify(msg));
    } else {
      // B4: Queue messages when disconnected, flush on reconnect
      this._pendingMessages.push(msg);
    }
  }
}
