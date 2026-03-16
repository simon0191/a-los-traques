import PartySocket from 'partysocket';

const INPUT_DELAY = 3;

export class NetworkManager {
  /**
   * @param {string} roomId
   * @param {string} host - PartyKit host (e.g. 'localhost:1999' or 'a-los-traques.username.partykit.dev')
   */
  constructor(roomId, host) {
    this.roomId = roomId;
    this.playerSlot = -1;
    this.connected = false;
    this.localFrame = 0;

    // Callbacks
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

    // Input buffer: frame -> inputState
    this.remoteInputBuffer = {};
    this.lastRemoteInput = null;

    // Determine protocol based on host
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';

    this.socket = new PartySocket({
      host: host,
      room: roomId,
      protocol: protocol,
      maxRetries: 3,
      startClosed: false
    });

    this.socket.addEventListener('message', (event) => {
      this._handleMessage(JSON.parse(event.data));
    });

    this.socket.addEventListener('open', () => {
      this.connected = true;
    });

    this.socket.addEventListener('close', () => {
      this.connected = false;
    });

    this.socket.addEventListener('error', () => {
      if (this._onError) this._onError();
    });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'assign':
        this.playerSlot = msg.player;
        if (this._onAssign) this._onAssign(msg.player);
        break;
      case 'opponent_joined':
        if (this._onOpponentJoined) this._onOpponentJoined();
        break;
      case 'opponent_ready':
        if (this._onOpponentReady) this._onOpponentReady(msg.fighterId);
        break;
      case 'start':
        if (this._onStart) this._onStart(msg);
        break;
      case 'input':
        this.remoteInputBuffer[msg.frame] = msg.state;
        this.lastRemoteInput = msg.state;
        if (this._onRemoteInput) this._onRemoteInput(msg.frame, msg.state);
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
        if (this._onSync) this._onSync(msg);
        break;
      case 'round_event':
        if (this._onRoundEvent) this._onRoundEvent(msg);
        break;
    }
  }

  // --- Public API: register callbacks ---
  onAssign(cb) { this._onAssign = cb; }
  onOpponentJoined(cb) { this._onOpponentJoined = cb; }
  onOpponentReady(cb) { this._onOpponentReady = cb; }
  onStart(cb) { this._onStart = cb; }
  onRemoteInput(cb) { this._onRemoteInput = cb; }
  onDisconnect(cb) { this._onDisconnect = cb; }
  onRematch(cb) { this._onRematch = cb; }
  onFull(cb) { this._onFull = cb; }
  onError(cb) { this._onError = cb; }
  onSync(cb) { this._onSync = cb; }
  onRoundEvent(cb) { this._onRoundEvent = cb; }

  // --- Public API: send messages ---
  sendReady(fighterId) {
    this._send({ type: 'ready', fighterId });
  }

  sendInput(frame, inputState) {
    this._send({ type: 'input', frame, state: inputState });
  }

  sendRematch() {
    this._send({ type: 'rematch' });
  }

  sendSync(state) {
    this._send({ type: 'sync', ...state });
  }

  sendRoundEvent(event) {
    this._send({ type: 'round_event', ...event });
  }

  /**
   * Get the remote input for the given frame.
   * If not available, repeat the last known input.
   * @param {number} frame
   * @returns {object} input state
   */
  getRemoteInput(frame) {
    if (this.remoteInputBuffer[frame]) {
      const input = this.remoteInputBuffer[frame];
      // Clean up old frames
      for (const key of Object.keys(this.remoteInputBuffer)) {
        if (Number(key) < frame - 30) {
          delete this.remoteInputBuffer[key];
        }
      }
      return input;
    }
    // Fallback: repeat last known input (minus one-shot attacks)
    if (this.lastRemoteInput) {
      return {
        ...this.lastRemoteInput,
        lp: false, hp: false, lk: false, hk: false, sp: false
      };
    }
    return { left: false, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };
  }

  getPlayerSlot() { return this.playerSlot; }
  getInputDelay() { return INPUT_DELAY; }

  destroy() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  _send(msg) {
    if (this.socket && this.connected) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}
