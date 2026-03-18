/** @typedef {{ id: string, fighterId: string|null, ready: boolean }} PlayerSlot */

export default class FightRoom {
  constructor(party) {
    this.party = party;
    /** @type {(PlayerSlot|null)[]} */
    this.players = [null, null];
    this.started = false;
    this.spectators = new Set();
    this.fightInfo = null;
    /** @type {Map<string, number>} shout rate-limit: connId -> last shout timestamp */
    this._shoutCooldowns = new Map();
    /** @type {Map<string, number>} potion rate-limit: connId -> last potion timestamp */
    this._potionCooldowns = new Map();
  }

  onConnect(connection, ctx) {
    // Check if spectator
    const url = new URL(ctx.request.url);
    const isSpectator = url.searchParams.get('spectate') === '1';

    if (isSpectator) {
      this.spectators.add(connection.id);
      const count = this.spectators.size;
      connection.send(JSON.stringify({ type: 'assign_spectator', spectatorCount: count }));
      this._broadcast({ type: 'spectator_count', count });
      // Send fight state catch-up if fight already started
      if (this.fightInfo) {
        connection.send(JSON.stringify({
          type: 'fight_state',
          p1Id: this.fightInfo.p1Id,
          p2Id: this.fightInfo.p2Id,
          stageId: this.fightInfo.stageId,
          started: this.started,
          p1Rounds: this.players[0]?.ready ? 0 : 0,
          p2Rounds: this.players[1]?.ready ? 0 : 0,
          roundNumber: 1
        }));
      }
      return;
    }

    // Clean up stale slots whose connections no longer exist
    this._cleanupStaleSlots();

    // Find open slot
    const slot = this.players[0] === null ? 0 : this.players[1] === null ? 1 : -1;

    if (slot === -1) {
      connection.send(JSON.stringify({ type: 'full' }));
      connection.close();
      return;
    }

    this.players[slot] = { id: connection.id, fighterId: null, ready: false };

    // Tell this player their slot
    connection.send(JSON.stringify({ type: 'assign', player: slot }));

    // Send spectator count if there are spectators
    if (this.spectators.size > 0) {
      connection.send(JSON.stringify({ type: 'spectator_count', count: this.spectators.size }));
    }

    // If both connected, notify both
    if (this.players[0] && this.players[1]) {
      this._broadcast({ type: 'opponent_joined' });
    }
  }

  onMessage(message, connection) {
    let data;
    try {
      data = JSON.parse(/** @type {string} */ (message));
    } catch {
      return;
    }
    const slot = this._slotOf(connection.id);
    const isSpectator = this._isSpectator(connection.id);

    // Handle spectator messages
    if (isSpectator) {
      switch (data.type) {
        case 'shout': {
          const now = Date.now();
          const last = this._shoutCooldowns.get(connection.id) || 0;
          if (now - last < 2000) return; // 2s rate limit
          this._shoutCooldowns.set(connection.id, now);
          this._broadcast({ type: 'shout', text: String(data.text).slice(0, 20) });
          break;
        }
        case 'potion': {
          const now = Date.now();
          const last = this._potionCooldowns.get(connection.id) || 0;
          if (now - last < 15000) return; // 15s rate limit
          this._potionCooldowns.set(connection.id, now);
          const target = data.target === 0 ? 0 : 1;
          const potionType = data.potionType === 'special' ? 'special' : 'hp';
          // Send potion request to host only
          this._sendToHost({ type: 'potion', target, potionType });
          // Broadcast visual feedback to all
          this._broadcast({ type: 'potion_applied', target, potionType });
          break;
        }
      }
      return;
    }

    if (slot === -1) return;

    switch (data.type) {
      case 'ready': {
        if (this.started || this.players[slot].ready) break;
        this.players[slot].fighterId = data.fighterId;
        this.players[slot].ready = true;

        // Relay to opponent
        this._sendToOther(slot, { type: 'opponent_ready', fighterId: data.fighterId });

        // If both ready, send start
        if (this.players[0]?.ready && this.players[1]?.ready) {
          this.started = true;
          const stageIds = ['dojo', 'rooftop', 'beach', 'arcade', 'park'];
          const stageId = stageIds[Math.floor(Math.random() * stageIds.length)];
          this.fightInfo = {
            p1Id: this.players[0].fighterId,
            p2Id: this.players[1].fighterId,
            stageId
          };
          this._broadcast({
            type: 'start',
            p1Id: this.players[0].fighterId,
            p2Id: this.players[1].fighterId,
            stageId
          });
        }
        break;
      }
      case 'input':
        this._sendToOther(slot, data);
        this._broadcastToSpectators({ ...data, slot });
        break;
      case 'sync':
      case 'round_event':
        if (slot !== 0) break;
        this._sendToOther(slot, data);
        this._broadcastToSpectators(data);
        break;
      case 'ping':
        // Echo back directly to sender
        connection.send(JSON.stringify({ type: 'pong', t: data.t }));
        break;
      case 'rematch':
        // Relay directly to opponent
        this._sendToOther(slot, data);
        break;
      case 'leave':
        // Reset both players' ready state so they can re-select fighters
        for (let i = 0; i < 2; i++) {
          if (this.players[i]) {
            this.players[i].ready = false;
            this.players[i].fighterId = null;
          }
        }
        this.started = false;
        this.fightInfo = null;
        this._sendToOther(slot, data);
        break;
    }
  }

  onClose(connection) {
    // Handle spectator disconnect
    if (this._isSpectator(connection.id)) {
      this.spectators.delete(connection.id);
      this._shoutCooldowns.delete(connection.id);
      this._potionCooldowns.delete(connection.id);
      this._broadcast({ type: 'spectator_count', count: this.spectators.size });
      return;
    }

    const slot = this._slotOf(connection.id);
    if (slot === -1) return;

    this.players[slot] = null;
    this._sendToOther(slot, { type: 'disconnect' });
    this._broadcastToSpectators({ type: 'disconnect' });

    // Reset room to pre-match state so reconnection can start a new match
    this.started = false;
    this.fightInfo = null;
    const otherSlot = slot === 0 ? 1 : 0;
    if (this.players[otherSlot]) {
      this.players[otherSlot].ready = false;
      this.players[otherSlot].fighterId = null;
    }
  }

  _slotOf(connId) {
    if (this.players[0]?.id === connId) return 0;
    if (this.players[1]?.id === connId) return 1;
    return -1;
  }

  _isSpectator(connId) {
    return this.spectators.has(connId);
  }

  /** Remove player slots whose connection is no longer alive */
  _cleanupStaleSlots() {
    const liveIds = new Set();
    for (const conn of this.party.getConnections()) {
      liveIds.add(conn.id);
    }
    for (let i = 0; i < 2; i++) {
      if (this.players[i] && !liveIds.has(this.players[i].id)) {
        this.players[i] = null;
      }
    }
  }

  _sendToOther(slot, msg) {
    const otherSlot = slot === 0 ? 1 : 0;
    const other = this.players[otherSlot];
    if (!other) return;

    const json = JSON.stringify(msg);
    for (const conn of this.party.getConnections()) {
      if (conn.id === other.id) {
        conn.send(json);
        break;
      }
    }
  }

  _sendToHost(msg) {
    const host = this.players[0];
    if (!host) return;

    const json = JSON.stringify(msg);
    for (const conn of this.party.getConnections()) {
      if (conn.id === host.id) {
        conn.send(json);
        break;
      }
    }
  }

  _broadcastToSpectators(msg) {
    if (this.spectators.size === 0) return;
    const json = JSON.stringify(msg);
    for (const conn of this.party.getConnections()) {
      if (this.spectators.has(conn.id)) {
        conn.send(json);
      }
    }
  }

  _broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const conn of this.party.getConnections()) {
      conn.send(json);
    }
  }
}
