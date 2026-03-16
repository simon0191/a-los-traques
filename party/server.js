/** @typedef {{ id: string, fighterId: string|null, ready: boolean }} PlayerSlot */

export default class FightRoom {
  constructor(party) {
    this.party = party;
    /** @type {(PlayerSlot|null)[]} */
    this.players = [null, null];
    this.started = false;
  }

  onConnect(connection, ctx) {
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

    // If both connected, notify both
    if (this.players[0] && this.players[1]) {
      this._broadcast({ type: 'opponent_joined' });
    }
  }

  onMessage(message, connection) {
    const data = JSON.parse(/** @type {string} */ (message));
    const slot = this._slotOf(connection.id);
    if (slot === -1) return;

    switch (data.type) {
      case 'ready': {
        this.players[slot].fighterId = data.fighterId;
        this.players[slot].ready = true;

        // Relay to opponent
        this._sendToOther(slot, { type: 'opponent_ready', fighterId: data.fighterId });

        // If both ready, send start
        if (this.players[0]?.ready && this.players[1]?.ready) {
          this.started = true;
          const stageIds = ['dojo', 'rooftop', 'beach', 'arcade', 'park'];
          const stageId = stageIds[Math.floor(Math.random() * stageIds.length)];
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
      case 'sync':
      case 'round_event':
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
        this._sendToOther(slot, data);
        break;
    }
  }

  onClose(connection) {
    const slot = this._slotOf(connection.id);
    if (slot === -1) return;

    this.players[slot] = null;
    this._sendToOther(slot, { type: 'disconnect' });
  }

  _slotOf(connId) {
    if (this.players[0]?.id === connId) return 0;
    if (this.players[1]?.id === connId) return 1;
    return -1;
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

  _broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const conn of this.party.getConnections()) {
      conn.send(json);
    }
  }
}
