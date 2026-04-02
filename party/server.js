/** @typedef {{ id: string, fighterId: string|null, ready: boolean }} PlayerSlot */

const GRACE_PERIOD_MS = 20000;

/**
 * Server room states (formal state machine).
 */
const RoomState = {
  EMPTY: 'empty',
  WAITING: 'waiting',
  SELECTING: 'selecting',
  READY_CHECK: 'ready_check',
  STAGE_SELECT: 'stage_select',
  CREATING_FIGHT: 'creating_fight',
  FIGHTING: 'fighting',
  RECONNECTING: 'reconnecting',
};

/**
 * Valid state transitions: { [currentState]: { [event]: nextState } }
 */
const ROOM_TRANSITIONS = {
  [RoomState.EMPTY]: {
    player_connected: RoomState.WAITING,
  },
  [RoomState.WAITING]: {
    second_connected: RoomState.SELECTING,
    player_disconnected: RoomState.EMPTY,
  },
  [RoomState.SELECTING]: {
    first_ready: RoomState.READY_CHECK,
    ws_close: RoomState.RECONNECTING,
    leave: RoomState.WAITING,
  },
  [RoomState.READY_CHECK]: {
    both_ready: RoomState.STAGE_SELECT,
    ready_player_disconnected: RoomState.SELECTING,
    non_ready_leave: RoomState.WAITING,
    ws_close: RoomState.RECONNECTING,
  },
  [RoomState.STAGE_SELECT]: {
    stage_chosen: RoomState.CREATING_FIGHT,
    ws_close: RoomState.RECONNECTING,
    leave: RoomState.SELECTING,
  },
  [RoomState.CREATING_FIGHT]: {
    fight_created: RoomState.FIGHTING,
    ws_close: RoomState.RECONNECTING,
    leave: RoomState.SELECTING,
  },
  [RoomState.FIGHTING]: {
    ws_close: RoomState.RECONNECTING,
    leave: RoomState.SELECTING,
  },
  [RoomState.RECONNECTING]: {
    rejoin_fighting: RoomState.FIGHTING,
    rejoin_creating_fight: RoomState.CREATING_FIGHT,
    rejoin_selecting: RoomState.SELECTING,
    rejoin_ready_check: RoomState.READY_CHECK,
    rejoin_stage_select: RoomState.STAGE_SELECT,
    grace_expired: RoomState.WAITING,
  },
};

export default class FightRoom {
  constructor(party) {
    this.party = party;
    /** @type {(PlayerSlot|null)[]} */
    this.players = [null, null];
    this.roomState = RoomState.EMPTY;
    /** @type {string|null} state before entering reconnecting */
    this._stateBeforeGrace = null;
    this.spectators = new Set();
    this.fightInfo = null;
    /** @type {Map<string, number>} shout rate-limit: connId -> last shout timestamp */
    this._shoutCooldowns = new Map();
    /** @type {Map<string, number>} potion rate-limit: connId -> last potion timestamp */
    this._potionCooldowns = new Map();
    /** @type {(ReturnType<typeof setTimeout>|null)[]} grace period timers per slot */
    this._graceTimers = [null, null];
    /** @type {Map<string, string>} connectionId -> sessionId for log correlation */
    this._sessionIds = new Map();
    /** @type {Array<object>} Ring buffer of last 50 server events */
    this._eventLog = [];
    this._eventLogMax = 50;
  }

  /**
   * Structured log: writes JSON to console (for wrangler tail) and ring buffer.
   */
  _log(entry) {
    const full = { ts: Date.now(), roomId: this.party.id, ...entry };
    console.log(JSON.stringify(full));
    this._eventLog.push(full);
    if (this._eventLog.length > this._eventLogMax) {
      this._eventLog.shift();
    }
  }

  /**
   * Attempt a room state transition. Returns true if valid, false if rejected.
   */
  _transition(event) {
    const transitions = ROOM_TRANSITIONS[this.roomState];
    if (!transitions || !transitions[event]) return false;
    const from = this.roomState;
    this.roomState = transitions[event];
    this._log({ type: 'state_transition', from, to: this.roomState, event });
    return true;
  }

  /**
   * HTTP request handler for TURN credential generation.
   */
  async onRequest(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname.endsWith('/turn-creds') && request.method === 'GET') {
      const response = await this._handleTurnCreds();
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
      return response;
    }

    if (url.pathname.endsWith('/diagnostics') && request.method === 'GET') {
      const diagToken = this.party.env?.DIAG_TOKEN;
      if (diagToken) {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${diagToken}`) {
          return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }
      }
      const response = Response.json(this._getDiagnostics());
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
      return response;
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }

  async _handleTurnCreds() {
    const keyId = this.party.env?.CLOUDFLARE_TURN_KEY_ID;
    const apiToken = this.party.env?.CLOUDFLARE_TURN_API_TOKEN;

    if (!keyId || !apiToken) {
      return Response.json({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
    }

    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: 86400 }),
        },
      );

      if (!response.ok) {
        this._log({ type: 'turn_error', reason: 'api_error', status: response.status });
        return Response.json(
          {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          },
          { status: 200 },
        );
      }

      const data = await response.json();
      const iceServers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
      return Response.json({ iceServers });
    } catch (err) {
      this._log({ type: 'turn_error', reason: 'fetch_error', error: err.message });
      return Response.json(
        {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
        { status: 200 },
      );
    }
  }

  onConnect(connection, ctx) {
    const url = new URL(ctx.request.url);
    const isSpectator = url.searchParams.get('spectate') === '1';
    const sessionId = url.searchParams.get('sessionId') || null;
    if (sessionId) {
      this._sessionIds.set(connection.id, sessionId);
    }

    if (isSpectator) {
      this.spectators.add(connection.id);
      const count = this.spectators.size;
      connection.send(JSON.stringify({ type: 'assign_spectator', spectatorCount: count }));
      this._broadcast({ type: 'spectator_count', count });
      if (this.fightInfo) {
        connection.send(
          JSON.stringify({
            type: 'fight_state',
            p1Id: this.fightInfo.p1Id,
            p2Id: this.fightInfo.p2Id,
            stageId: this.fightInfo.stageId,
            started: this.roomState === RoomState.FIGHTING,
            p1Rounds: 0,
            p2Rounds: 0,
            roundNumber: 1,
          }),
        );
      }
      return;
    }

    this._cleanupStaleSlots();

    const slot = this.players[0] === null ? 0 : this.players[1] === null ? 1 : -1;

    if (slot === -1) {
      const graceSlot = this._graceTimers[0] ? 0 : this._graceTimers[1] ? 1 : -1;
      if (graceSlot !== -1) {
        connection.send(JSON.stringify({ type: 'rejoin_available', slot: graceSlot }));
        return;
      }
      connection.send(JSON.stringify({ type: 'full' }));
      connection.close();
      return;
    }

    this.players[slot] = { id: connection.id, fighterId: null, ready: false };
    this._log({ type: 'connect', slot, sessionId, roomState: this.roomState });
    connection.send(JSON.stringify({ type: 'assign', player: slot }));

    if (this.spectators.size > 0) {
      connection.send(JSON.stringify({ type: 'spectator_count', count: this.spectators.size }));
    }

    // State transitions on connect
    if (this.players[0] && this.players[1]) {
      this._transition('second_connected');
      this._broadcast({ type: 'opponent_joined' });
    } else if (this.roomState === RoomState.EMPTY) {
      this._transition('player_connected');
    }
  }

  onMessage(message, connection) {
    let data;
    try {
      data = JSON.parse(/** @type {string} */ (message));
    } catch {
      return;
    }

    // Handle rejoin before slot lookup (new connection doesn't have a slot yet)
    if (data.type === 'rejoin') {
      this._handleRejoin(data, connection);
      return;
    }

    const slot = this._slotOf(connection.id);
    const isSpectator = this._isSpectator(connection.id);

    if (isSpectator) {
      this._handleSpectatorMessage(data, connection);
      return;
    }

    if (slot === -1) return;

    switch (data.type) {
      case 'ready':
        this._handleReady(slot, data);
        break;
      case 'input':
        if (!data.spectatorOnly) {
          this._sendToOther(slot, data);
        }
        this._broadcastToSpectators({ ...data, slot });
        break;
      case 'checksum':
      case 'resync_request':
      case 'resync':
        this._sendToOther(slot, data);
        break;
      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice':
        this._sendToOther(slot, data);
        break;
      case 'frame_sync':
        this._sendToOther(slot, data);
        break;
      case 'sync':
      case 'round_event':
        if (slot !== 0) break;
        this._sendToOther(slot, data);
        this._broadcastToSpectators(data);
        break;
      case 'ping':
        connection.send(JSON.stringify({ type: 'pong', t: data.t }));
        break;
      case 'rematch':
        this._sendToOther(slot, data);
        break;
      case 'select_stage':
        this._handleStageSelect(slot, data);
        break;
      case 'fight_created':
        // Only P1 (slot 0) can confirm fight creation
        if (slot !== 0) break;
        if (this._transition('fight_created')) {
          this._broadcast({
            type: 'start',
            fightId: this.fightInfo.fightId,
            p1Id: this.fightInfo.p1Id,
            p2Id: this.fightInfo.p2Id,
            stageId: this.fightInfo.stageId,
            isRandomStage: this.fightInfo.isRandomStage,
          });
        }
        break;
      case 'fight_confirmed':
        this._sendToOther(slot, data);
        break;
      case 'debug_request':
      case 'debug_response':
        this._sendToOther(slot, data);
        break;
      case 'leave':
        this._handleLeave(slot);
        break;
    }
  }

  _handleReady(slot, data) {
    // Validate state: ready only accepted in SELECTING or READY_CHECK
    if (this.roomState !== RoomState.SELECTING && this.roomState !== RoomState.READY_CHECK) return;
    if (this.players[slot].ready) return;

    this.players[slot].fighterId = data.fighterId;
    this.players[slot].ready = true;

    this._sendToOther(slot, { type: 'opponent_ready', fighterId: data.fighterId });

    if (this.players[0]?.ready && this.players[1]?.ready) {
      // Both ready → STAGE_SELECT
      this._transition('both_ready');
      this._broadcast({
        type: 'go_to_stage_select',
        p1Id: this.players[0].fighterId,
        p2Id: this.players[1].fighterId,
      });
    } else if (this.roomState === RoomState.SELECTING) {
      // First ready → READY_CHECK
      this._transition('first_ready');
    }
  }

  _handleStageSelect(slot, data) {
    if (this.roomState !== RoomState.STAGE_SELECT) return;
    if (slot !== 0) return; // Only Player 1 can select stage

    if (this._transition('stage_chosen')) {
      const fightId = crypto.randomUUID();
      this.fightInfo = {
        fightId,
        p1Id: this.players[0].fighterId,
        p2Id: this.players[1].fighterId,
        stageId: data.stageId,
        isRandomStage: data.isRandomStage || false,
      };
      // Send create_fight to P1 only — P1 creates the DB record, then sends fight_created
      this._sendToHost({
        type: 'create_fight',
        fightId,
        p1Id: this.players[0].fighterId,
        p2Id: this.players[1].fighterId,
        stageId: data.stageId,
        isRandomStage: data.isRandomStage || false,
      });
    }
  }

  _handleLeave(slot) {
    if (this._graceTimers[slot]) {
      clearTimeout(this._graceTimers[slot]);
      this._graceTimers[slot] = null;
    }
    for (let i = 0; i < 2; i++) {
      if (this.players[i]) {
        this.players[i].ready = false;
        this.players[i].fighterId = null;
      }
    }
    this._transition('leave');
    this.fightInfo = null;
    this._sendToOther(slot, { type: 'leave' });
  }

  _handleRejoin(data, connection) {
    const rejoinSlot = data.slot;
    if (rejoinSlot !== 0 && rejoinSlot !== 1) return;

    const sessionId = this._sessionIds.get(connection.id) || null;
    this._log({
      type: 'rejoin',
      slot: rejoinSlot,
      sessionId,
      graceActive: !!this._graceTimers[rejoinSlot],
      reset: !!data.reset,
    });

    if (!this._graceTimers[rejoinSlot]) {
      // No grace period active — connection restored before server saw disconnect.
      // Update connection ID so stale onClose won't match this slot.
      if (this.players[rejoinSlot]) {
        this.players[rejoinSlot].id = connection.id;
      }
      connection.send(JSON.stringify({ type: 'rejoin_ack', state: this.roomState }));
      return;
    }

    clearTimeout(this._graceTimers[rejoinSlot]);
    this._graceTimers[rejoinSlot] = null;
    this.players[rejoinSlot].id = connection.id;

    if (data.reset) {
      // Page refresh: client lost fight state, reset room to selecting
      this._sendToOther(rejoinSlot, { type: 'return_to_select' });
      this._broadcastToSpectators({ type: 'return_to_select' });
      this.roomState = RoomState.SELECTING;
      this._stateBeforeGrace = null;
      this.fightInfo = null;
      for (let i = 0; i < 2; i++) {
        if (this.players[i]) {
          this.players[i].ready = false;
          this.players[i].fighterId = null;
        }
      }
      connection.send(JSON.stringify({ type: 'assign', player: rejoinSlot }));
      if (this.spectators.size > 0) {
        connection.send(JSON.stringify({ type: 'spectator_count', count: this.spectators.size }));
      }
      this._broadcast({ type: 'opponent_joined' });
    } else {
      // WiFi drop: resume to state before grace
      const prevState = this._stateBeforeGrace || RoomState.FIGHTING;
      this._stateBeforeGrace = null;
      if (prevState === RoomState.FIGHTING) {
        this._transition('rejoin_fighting');
      } else if (prevState === RoomState.CREATING_FIGHT) {
        this._transition('rejoin_creating_fight');
      } else if (prevState === RoomState.STAGE_SELECT) {
        this._transition('rejoin_stage_select');
      } else if (prevState === RoomState.READY_CHECK) {
        this._transition('rejoin_ready_check');
      } else {
        this._transition('rejoin_selecting');
      }
      this._sendToOther(rejoinSlot, { type: 'opponent_reconnected' });
      this._broadcastToSpectators({ type: 'opponent_reconnected' });
    }
    connection.send(JSON.stringify({ type: 'rejoin_ack', state: this.roomState }));
  }

  _handleSpectatorMessage(data, connection) {
    switch (data.type) {
      case 'shout': {
        const now = Date.now();
        const last = this._shoutCooldowns.get(connection.id) || 0;
        if (now - last < 2000) {
          this._log({
            type: 'rate_limit',
            msgType: 'shout',
            connId: connection.id,
            cooldownRemaining: 2000 - (now - last),
          });
          return;
        }
        this._shoutCooldowns.set(connection.id, now);
        this._broadcast({ type: 'shout', text: String(data.text).slice(0, 20) });
        break;
      }
      case 'potion': {
        const now = Date.now();
        const last = this._potionCooldowns.get(connection.id) || 0;
        if (now - last < 15000) {
          this._log({
            type: 'rate_limit',
            msgType: 'potion',
            connId: connection.id,
            cooldownRemaining: 15000 - (now - last),
          });
          return;
        }
        this._potionCooldowns.set(connection.id, now);
        const target = data.target === 0 ? 0 : 1;
        const potionType = data.potionType === 'special' ? 'special' : 'hp';
        this._sendToHost({ type: 'potion', target, potionType });
        this._broadcast({ type: 'potion_applied', target, potionType });
        break;
      }
    }
  }

  onClose(connection) {
    if (this._isSpectator(connection.id)) {
      this.spectators.delete(connection.id);
      this._shoutCooldowns.delete(connection.id);
      this._potionCooldowns.delete(connection.id);
      this._broadcast({ type: 'spectator_count', count: this.spectators.size });
      return;
    }

    const slot = this._slotOf(connection.id);
    if (slot === -1) return;

    const sessionId = this._sessionIds.get(connection.id) || null;
    this._log({ type: 'disconnect', slot, sessionId, roomState: this.roomState });
    this._sessionIds.delete(connection.id);

    this._stateBeforeGrace = this.roomState;
    this._transition('ws_close');
    this._sendToOther(slot, { type: 'opponent_reconnecting' });
    this._broadcastToSpectators({ type: 'opponent_reconnecting' });

    this._graceTimers[slot] = setTimeout(() => {
      this._graceTimers[slot] = null;
      this._finalizeDisconnect(slot);
    }, GRACE_PERIOD_MS);
  }

  _finalizeDisconnect(slot) {
    this._log({ type: 'grace_expired', slot, stateBeforeGrace: this._stateBeforeGrace });
    const wasFighting =
      this._stateBeforeGrace === RoomState.FIGHTING ||
      this._stateBeforeGrace === RoomState.CREATING_FIGHT;
    this.players[slot] = null;

    if (wasFighting) {
      this._sendToOther(slot, { type: 'return_to_select' });
      this._broadcastToSpectators({ type: 'return_to_select' });
    } else {
      this._sendToOther(slot, { type: 'disconnect' });
      this._broadcastToSpectators({ type: 'disconnect' });
    }

    this._stateBeforeGrace = null;
    this._transition('grace_expired');
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

  _cleanupStaleSlots() {
    const liveIds = new Set();
    for (const conn of this.party.getConnections()) {
      liveIds.add(conn.id);
    }
    for (let i = 0; i < 2; i++) {
      if (this.players[i] && !liveIds.has(this.players[i].id) && !this._graceTimers[i]) {
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

  _getDiagnostics() {
    return {
      roomId: this.party.id,
      roomState: this.roomState,
      players: this.players.map((p, i) => {
        if (!p) return null;
        return {
          slot: i,
          ready: p.ready,
          fighterId: p.fighterId,
          sessionId: this._sessionIds.get(p.id) || null,
        };
      }),
      spectatorCount: this.spectators.size,
      graceTimers: [!!this._graceTimers[0], !!this._graceTimers[1]],
      fightInfo: this.fightInfo,
      stateBeforeGrace: this._stateBeforeGrace,
      eventLog: this._eventLog.slice(),
    };
  }
}
