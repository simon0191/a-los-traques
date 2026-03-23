import { WebRTCTransport } from '../WebRTCTransport.js';

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
      console.log('[TM] WebRTC unavailable (no RTCPeerConnection)');
      return;
    }

    this.destroyWebRTC();

    const isOfferer = playerSlot === 0;
    console.log(`[TM] initWebRTC slot=${playerSlot} offerer=${isOfferer}`);

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
      },
      onClose: () => {
        this._transportMode = 'websocket';
        this._webrtcReady = false;
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
        console.log(`[TM] TURN credential fetch failed: ${response.status}`);
        return;
      }

      const data = await response.json();
      if (data.iceServers) {
        this._iceServers = data.iceServers;
        console.log(`[TM] TURN credentials fetched (${data.iceServers.length} servers)`);
      }
    } catch (err) {
      console.log('[TM] TURN credential fetch error:', err.message);
      // Non-fatal: fall back to STUN-only
    }
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
    this.signaling.off('webrtc_offer');
    this.signaling.off('webrtc_answer');
    this.signaling.off('webrtc_ice');
    this._onP2PMessage = null;
  }

  // --- Internal ---

  _handleSignal(msg) {
    if (this._webrtc) {
      this._webrtc.handleSignal(msg);
    }
  }
}
