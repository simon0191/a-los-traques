import { Logger } from '../Logger.js';
import { WebRTCTransport } from '../WebRTCTransport.js';

const log = Logger.create('TransportManager');

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Manages WebRTC P2P transport with WebSocket signaling fallback.
 * Handles TURN credential fetching, WebRTC lifecycle, and dual-transport routing.
 */
export class TransportManager {
  /**
   * @param {import('./SignalingClient.js').SignalingClient} signaling
   * @param {{ onP2PMessage?: (msg: object) => void }} [options]
   */
  constructor(signaling, { onP2PMessage } = {}) {
    this.signaling = signaling;
    this._onP2PMessage = onP2PMessage || null;

    /** @type {WebRTCTransport|null} */
    this._webrtc = null;
    /** @type {'websocket'|'webrtc'} */
    this._transportMode = 'websocket';
    this._webrtcReady = false;

    /** @type {RTCIceServer[]|null} */
    this._iceServers = null;

    /** @type {number|null} Pending WebRTC init slot (deferred until signaling stable) */
    this._pendingWebRTCInit = null;

    /** @type {boolean} True after DC was open then closed (degraded state) */
    this._transportDegraded = false;

    /** @type {Function|null} */
    this._onTransportDegraded = null;
    /** @type {Function|null} */
    this._onTransportRestored = null;

    // Register signaling relay for WebRTC messages
    signaling.on('webrtc_offer', (msg) => this._handleSignal(msg));
    signaling.on('webrtc_answer', (msg) => this._handleSignal(msg));
    signaling.on('webrtc_ice', (msg) => this._handleSignal(msg));
  }

  /**
   * Initialize WebRTC connection.
   * Called when opponent joins or reconnects.
   * @param {number} playerSlot - local player slot (0 = offerer, 1 = answerer)
   */
  initWebRTC(playerSlot) {
    if (typeof RTCPeerConnection === 'undefined') {
      log.warn('WebRTC unavailable (no RTCPeerConnection)');
      return;
    }

    this.destroyWebRTC();

    const isOfferer = playerSlot === 0;
    log.info('WebRTC init', {
      slot: playerSlot,
      offerer: isOfferer,
      iceServers: (this._iceServers || DEFAULT_ICE_SERVERS).length,
    });

    const iceServers = this._iceServers || DEFAULT_ICE_SERVERS;

    this._webrtc = new WebRTCTransport({
      isOfferer,
      iceServers,
      onSignal: (msg) => this.signaling.send(msg),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data);
          if (this._onP2PMessage) this._onP2PMessage(msg);
        } catch (_) {
          // ignore malformed P2P messages
        }
      },
      onOpen: () => {
        this._transportMode = 'webrtc';
        this._webrtcReady = true;
        log.debug('DataChannel open');
        if (this._transportDegraded) {
          this._transportDegraded = false;
          log.debug('Transport restored', { from: 'websocket', to: 'webrtc' });
          if (this._onTransportRestored) this._onTransportRestored();
        }
      },
      onClose: () => {
        const wasOpen = this._webrtcReady;
        this._transportMode = 'websocket';
        this._webrtcReady = false;
        log.debug('DataChannel closed', { wasOpen });
        if (wasOpen) {
          this._transportDegraded = true;
          log.debug('Transport degraded', { from: 'webrtc', to: 'websocket' });
          if (this._onTransportDegraded) this._onTransportDegraded();
        }
      },
      onFailed: () => {
        this._transportMode = 'websocket';
        this._webrtcReady = false;
        this._webrtc = null;
      },
    });

    if (isOfferer) {
      this._webrtc.startOffer();
    }
  }

  /**
   * Destroy WebRTC connection (preserves WebSocket).
   */
  destroyWebRTC() {
    if (this._webrtc) {
      this._webrtc.destroy();
      this._webrtc = null;
    }
    this._transportMode = 'websocket';
    this._webrtcReady = false;
    this._pendingWebRTCInit = null;
  }

  /**
   * Fetch TURN credentials from the PartyKit server.
   * Called before WebRTC negotiation for NAT traversal support.
   * @param {string} host - PartyKit host
   * @param {string} roomId - Room ID
   */
  async fetchTurnCredentials(host, roomId) {
    try {
      const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
      const protocol = isLocal ? 'http' : 'https';
      const url = `${protocol}://${host}/parties/main/${roomId}/turn-creds`;

      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) {
        log.warn('TURN credential fetch failed', { status: response.status });
        return;
      }

      const data = await response.json();
      if (data.iceServers) {
        this._iceServers = data.iceServers;
        log.info('TURN credentials fetched', { count: data.iceServers.length });
      }
    } catch (err) {
      log.warn('TURN credential fetch error', { err: err.message });
      // Non-fatal: fall back to STUN-only
    }
  }

  /**
   * Queue WebRTC init for later (deferred until signaling confirms stable).
   * @param {number} playerSlot
   */
  queueWebRTCInit(playerSlot) {
    this._pendingWebRTCInit = playerSlot;
  }

  /**
   * Flush pending WebRTC init if one is queued.
   */
  flushPendingWebRTCInit() {
    if (this._pendingWebRTCInit !== null) {
      const slot = this._pendingWebRTCInit;
      this._pendingWebRTCInit = null;
      this.initWebRTC(slot);
    }
  }

  /**
   * Cancel pending WebRTC init without executing it.
   */
  cancelPendingWebRTCInit() {
    this._pendingWebRTCInit = null;
  }

  /**
   * Register callback for when DataChannel drops mid-fight (WebSocket still works).
   * @param {Function} cb
   */
  onTransportDegraded(cb) {
    this._onTransportDegraded = cb;
  }

  /**
   * Register callback for when DataChannel is re-established after degradation.
   * @param {Function} cb
   */
  onTransportRestored(cb) {
    this._onTransportRestored = cb;
  }

  /**
   * @returns {boolean} true if DataChannel is open and ready
   */
  isWebRTCReady() {
    return this._webrtcReady;
  }

  /**
   * Send a message directly on the P2P DataChannel.
   * @param {object} msg
   * @returns {boolean} true if sent
   */
  sendP2P(msg) {
    if (this._webrtc && this._webrtcReady) {
      return this._webrtc.send(JSON.stringify(msg));
    }
    return false;
  }

  /**
   * Get current connection info.
   */
  getConnectionInfo() {
    return {
      type: this._transportMode,
      webrtcReady: this._webrtcReady,
    };
  }

  destroy() {
    this.destroyWebRTC();
    this._transportDegraded = false;
    this.signaling.off('webrtc_offer');
    this.signaling.off('webrtc_answer');
    this.signaling.off('webrtc_ice');
    this._onP2PMessage = null;
    this._onTransportDegraded = null;
    this._onTransportRestored = null;
  }

  // --- Internal ---

  _handleSignal(msg) {
    if (this._webrtc) {
      this._webrtc.handleSignal(msg);
    }
  }
}
