/**
 * WebRTC DataChannel transport for P2P game inputs.
 * Uses unreliable/unordered mode (UDP-like) — the rollback system handles loss natively.
 *
 * State machine: idle → signaling → connecting → open → closed|failed
 */

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const DEFAULT_TIMEOUT_MS = 5000;

export class WebRTCTransport {
  /**
   * @param {object} opts
   * @param {boolean} opts.isOfferer - true for P1 (slot 0), false for P2
   * @param {(msg: object) => void} opts.onSignal - send signaling message via WebSocket
   * @param {(data: string) => void} opts.onMessage - incoming DataChannel message
   * @param {() => void} opts.onOpen - DataChannel opened
   * @param {() => void} opts.onClose - DataChannel closed after being open
   * @param {() => void} opts.onFailed - connection failed or timed out
   * @param {number} [opts.timeoutMs=5000] - max time to establish connection
   * @param {RTCIceServer[]} [opts.iceServers] - ICE server configuration (STUN/TURN)
   */
  constructor({
    isOfferer,
    onSignal,
    onMessage,
    onOpen,
    onClose,
    onFailed,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    iceServers = DEFAULT_ICE_SERVERS,
  }) {
    this._isOfferer = isOfferer;
    this._onSignal = onSignal;
    this._onMessage = onMessage;
    this._onOpen = onOpen;
    this._onClose = onClose;
    this._onFailed = onFailed;
    this._timeoutMs = timeoutMs;
    this._iceServers = iceServers;

    /** @type {'idle'|'signaling'|'connecting'|'open'|'closed'|'failed'} */
    this.state = 'idle';

    /** @type {RTCPeerConnection|null} */
    this._pc = null;
    /** @type {RTCDataChannel|null} */
    this._dc = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._timeout = null;
  }

  /** P1 calls this to create an offer and DataChannel. */
  async startOffer() {
    if (this.state !== 'idle') return;
    this.state = 'signaling';

    this._startTimeout();
    this._createPeerConnection();

    // Offerer creates the DataChannel
    this._dc = this._pc.createDataChannel('inputs', {
      ordered: false,
      maxRetransmits: 0,
    });
    this._setupDataChannel(this._dc);

    try {
      const offer = await this._pc.createOffer();
      await this._pc.setLocalDescription(offer);
      this._log('offer created');
      this._onSignal({ type: 'webrtc_offer', sdp: offer.sdp });
    } catch (err) {
      this._log('startOffer error', err);
      this._fail();
    }
  }

  /**
   * Handle an incoming signaling message (offer, answer, or ICE candidate).
   * @param {object} msg
   */
  async handleSignal(msg) {
    try {
      switch (msg.type) {
        case 'webrtc_offer': {
          if (this._isOfferer) return; // offerer shouldn't receive offers
          if (this.state !== 'idle') return;
          this.state = 'signaling';

          this._startTimeout();
          this._createPeerConnection();

          await this._pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }),
          );
          const answer = await this._pc.createAnswer();
          await this._pc.setLocalDescription(answer);
          this._log('answer created');
          this._onSignal({ type: 'webrtc_answer', sdp: answer.sdp });
          break;
        }
        case 'webrtc_answer': {
          if (!this._isOfferer) return; // answerer shouldn't receive answers
          if (!this._pc) return;
          await this._pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }),
          );
          this._log('answer received');
          break;
        }
        case 'webrtc_ice': {
          if (!this._pc) return;
          if (msg.candidate) {
            await this._pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          }
          break;
        }
      }
    } catch (err) {
      this._log('handleSignal error', err);
      this._fail();
    }
  }

  /**
   * Send data on the DataChannel.
   * @param {string} data
   * @returns {boolean} true if sent, false if channel not open
   */
  send(data) {
    if (this._dc && this._dc.readyState === 'open') {
      this._dc.send(data);
      return true;
    }
    return false;
  }

  /** @returns {boolean} */
  isOpen() {
    return this._dc != null && this._dc.readyState === 'open';
  }

  /** Tear down everything. */
  destroy() {
    this._clearTimeout();
    if (this._dc) {
      this._dc.onopen = null;
      this._dc.onclose = null;
      this._dc.onmessage = null;
      try {
        this._dc.close();
      } catch (_) {
        /* ignore */
      }
      this._dc = null;
    }
    if (this._pc) {
      this._pc.onicecandidate = null;
      this._pc.ondatachannel = null;
      this._pc.onconnectionstatechange = null;
      try {
        this._pc.close();
      } catch (_) {
        /* ignore */
      }
      this._pc = null;
    }
    if (this.state !== 'closed' && this.state !== 'failed') {
      this.state = 'closed';
    }
  }

  // --- Private ---

  _createPeerConnection() {
    this._pc = new RTCPeerConnection({ iceServers: this._iceServers });

    this._pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._onSignal({ type: 'webrtc_ice', candidate: event.candidate.toJSON() });
      }
    };

    // Answerer receives the DataChannel here
    this._pc.ondatachannel = (event) => {
      this._log('remote DataChannel received');
      this._dc = event.channel;
      this._setupDataChannel(this._dc);
    };

    this._pc.onconnectionstatechange = () => {
      const connState = this._pc?.connectionState;
      this._log('PC state:', connState);
      if (connState === 'failed' || connState === 'disconnected') {
        if (this.state === 'open') {
          this.state = 'closed';
          this._clearTimeout();
          this._onClose();
        } else if (this.state !== 'closed' && this.state !== 'failed') {
          this._fail();
        }
      }
    };
  }

  _setupDataChannel(dc) {
    dc.onopen = () => {
      this._log('DataChannel open');
      this.state = 'open';
      this._clearTimeout();
      this._onOpen();
    };

    dc.onclose = () => {
      this._log('DataChannel closed');
      if (this.state === 'open') {
        this.state = 'closed';
        this._onClose();
      }
    };

    dc.onmessage = (event) => {
      this._onMessage(event.data);
    };

    if (this.state === 'signaling') {
      this.state = 'connecting';
    }
  }

  _startTimeout() {
    this._timeout = setTimeout(() => {
      this._timeout = null;
      if (this.state !== 'open') {
        this._fail();
      }
    }, this._timeoutMs);
  }

  _clearTimeout() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
  }

  _fail() {
    this._log(`failed (was ${this.state})`);
    this.state = 'failed';
    this._clearTimeout();
    this.destroy();
    this._onFailed();
  }

  _log(...args) {
    console.log(`[WebRTC ${this._isOfferer ? 'P1' : 'P2'}]`, ...args);
  }
}
