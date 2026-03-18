import PartySocket from 'partysocket';

const INPUT_DELAY = 3;

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
    this._onLeave = null;
    this._onAssignSpectator = null;
    this._onSpectatorCount = null;
    this._onShout = null;
    this._onFightState = null;
    this._onPotionApplied = null;
    this._onPotion = null;

    // Input buffer: frame -> inputState
    this.remoteInputBuffer = {};
    this.lastRemoteInput = null;

    // Spectator input buffers (one per player slot)
    this.remoteInputBufferP1 = {};
    this.lastRemoteInputP1 = null;
    this.remoteInputBufferP2 = {};
    this.lastRemoteInputP2 = null;

    // Determine protocol based on host
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';

    const socketOptions = {
      host: host,
      room: roomId,
      protocol: protocol,
      maxRetries: 3,
      startClosed: false
    };

    if (spectator) {
      socketOptions.query = { spectate: '1' };
    }

    this.socket = new PartySocket(socketOptions);

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
        if (this.isSpectator && msg.slot != null) {
          // Spectator: route input to correct player buffer
          const buf = msg.slot === 0 ? 'remoteInputBufferP1' : 'remoteInputBufferP2';
          const lastKey = msg.slot === 0 ? 'lastRemoteInputP1' : 'lastRemoteInputP2';
          this[buf][msg.frame] = msg.state;
          this[lastKey] = msg.state;
        } else {
          this.remoteInputBuffer[msg.frame] = msg.state;
          this.lastRemoteInput = msg.state;
        }
        if (this._onRemoteInput) this._onRemoteInput(msg.frame, msg.state, msg.slot);
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
  onLeave(cb) { this._onLeave = cb; }
  onAssignSpectator(cb) { this._onAssignSpectator = cb; }
  onSpectatorCount(cb) { this._onSpectatorCount = cb; }
  onShout(cb) { this._onShout = cb; }
  onFightState(cb) { this._onFightState = cb; }
  onPotionApplied(cb) { this._onPotionApplied = cb; }
  onPotion(cb) { this._onPotion = cb; }

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

  /**
   * Get the latest remote input, consuming any pending one-shot attacks.
   * Frame parameter is unused — we always consume the newest input since
   * host/guest frame counters are not synchronized.
   * @returns {object} input state
   */
  getRemoteInput() {
    // If there are buffered inputs, consume the latest one
    const frames = Object.keys(this.remoteInputBuffer).map(Number);
    if (frames.length > 0) {
      const latest = Math.max(...frames);
      const input = this.remoteInputBuffer[latest];
      // Clear all buffered inputs — they've been consumed
      this.remoteInputBuffer = {};
      // Update lastRemoteInput for movement continuity,
      // but strip one-shot attacks so they don't repeat
      this.lastRemoteInput = {
        ...input,
        lp: false, hp: false, lk: false, hk: false, sp: false
      };
      return input;
    }
    // No new input: repeat last known movement (attacks already stripped)
    if (this.lastRemoteInput) {
      return { ...this.lastRemoteInput };
    }
    return { left: false, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };
  }

  /**
   * Get the latest remote input for a specific player slot (spectator mode).
   * @param {number} slot - 0 for P1, 1 for P2
   * @returns {object} input state
   */
  getRemoteInputForSlot(slot) {
    const buf = slot === 0 ? this.remoteInputBufferP1 : this.remoteInputBufferP2;
    const lastKey = slot === 0 ? 'lastRemoteInputP1' : 'lastRemoteInputP2';

    const frames = Object.keys(buf).map(Number);
    if (frames.length > 0) {
      const latest = Math.max(...frames);
      const input = buf[latest];
      if (slot === 0) {
        this.remoteInputBufferP1 = {};
        this.lastRemoteInputP1 = { ...input, lp: false, hp: false, lk: false, hk: false, sp: false };
      } else {
        this.remoteInputBufferP2 = {};
        this.lastRemoteInputP2 = { ...input, lp: false, hp: false, lk: false, hk: false, sp: false };
      }
      return input;
    }
    if (this[lastKey]) {
      return { ...this[lastKey] };
    }
    return { left: false, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };
  }

  getPlayerSlot() { return this.playerSlot; }
  getInputDelay() { return INPUT_DELAY; }

  resetForReselect() {
    this.remoteInputBuffer = {};
    this.lastRemoteInput = null;
    this.remoteInputBufferP1 = {};
    this.lastRemoteInputP1 = null;
    this.remoteInputBufferP2 = {};
    this.lastRemoteInputP2 = null;
    this.localFrame = 0;
    this._onOpponentReady = null;
    this._onStart = null;
    this._onRemoteInput = null;
    this._onRematch = null;
    this._onLeave = null;
    this._onSync = null;
    this._onRoundEvent = null;
  }

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
