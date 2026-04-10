import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FightRoom from '../../party/server.js';

// --- Helpers ---

function makeParty(connections = []) {
  return {
    getConnections() {
      return connections;
    },
  };
}

function makeConnection(id) {
  return { id, send: vi.fn(), close: vi.fn() };
}

function makeCtx(params = {}) {
  const url = new URL('http://localhost/party/room');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { request: { url: url.toString() } };
}

/**
 * Helper: ready both players, select stage, and complete fight creation handshake.
 * After this, room.roomState === 'fighting' and start has been broadcast.
 */
function startFight(room, c1, c2) {
  room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), c1);
  room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'jeka' }), c2);
  room.onMessage(
    JSON.stringify({ type: 'select_stage', stageId: 'beach', isRandomStage: false }),
    c1,
  );
  room.onMessage(JSON.stringify({ type: 'fight_created' }), c1);
}

// --- Tests ---

describe('FightRoom', () => {
  let room, conn1, conn2, conn3, party;

  beforeEach(() => {
    conn1 = makeConnection('c1');
    conn2 = makeConnection('c2');
    conn3 = makeConnection('c3');
    party = makeParty([conn1, conn2, conn3]);
    room = new FightRoom(party);
  });

  // ---- Slot assignment ----

  describe('slot assignment', () => {
    it('assigns first player to slot 0', () => {
      room.onConnect(conn1, makeCtx());
      expect(room.players[0]).toEqual({ id: 'c1', fighterId: null, ready: false });
      expect(JSON.parse(conn1.send.mock.calls[0][0])).toMatchObject({ type: 'assign', player: 0 });
    });

    it('assigns second player to slot 1', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      expect(room.players[1]).toEqual({ id: 'c2', fighterId: null, ready: false });
      expect(JSON.parse(conn2.send.mock.calls[0][0])).toMatchObject({ type: 'assign', player: 1 });
    });

    it('sends opponent_joined when both connected', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      // Both should receive opponent_joined broadcast
      const c1Messages = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      const c2Messages = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Messages.some((m) => m.type === 'opponent_joined')).toBe(true);
      expect(c2Messages.some((m) => m.type === 'opponent_joined')).toBe(true);
    });
  });

  // ---- Room state machine ----

  describe('room state machine', () => {
    it('starts in empty state', () => {
      expect(room.roomState).toBe('empty');
    });

    it('transitions empty → waiting on first connect', () => {
      room.onConnect(conn1, makeCtx());
      expect(room.roomState).toBe('waiting');
    });

    it('transitions waiting → selecting on second connect', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      expect(room.roomState).toBe('selecting');
    });

    it('transitions selecting → ready_check on first ready', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      expect(room.roomState).toBe('ready_check');
    });

    it('transitions ready_check → selecting when player unreadies', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      expect(room.roomState).toBe('ready_check');

      room.onMessage(JSON.stringify({ type: 'unready' }), conn1);
      expect(room.roomState).toBe('selecting');
      expect(room.players[0].ready).toBe(false);
      expect(room.players[0].fighterId).toBeNull();

      // Should notify opponent
      const c2Messages = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Messages.some((m) => m.type === 'opponent_unready')).toBe(true);

      // Should notify requester
      const c1Messages = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Messages.some((m) => m.type === 'unready_confirmed')).toBe(true);
    });

    it('rejects unready if already in stage_select', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'paula' }), conn2);
      expect(room.roomState).toBe('stage_select');

      room.onMessage(JSON.stringify({ type: 'unready' }), conn1);
      // State should NOT change back to selecting
      expect(room.roomState).toBe('stage_select');
    });

    it('transitions ready_check → stage_select when both ready', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'paula' }), conn2);
      expect(room.roomState).toBe('stage_select');
    });

    it('transitions stage_select → creating_fight when host selects stage', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'paula' }), conn2);
      expect(room.roomState).toBe('stage_select');

      room.onMessage(
        JSON.stringify({ type: 'select_stage', stageId: 'metro', isRandomStage: false }),
        conn1,
      );
      expect(room.roomState).toBe('creating_fight');
    });

    it('transitions creating_fight → fighting when P1 sends fight_created', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'paula' }), conn2);
      room.onMessage(
        JSON.stringify({ type: 'select_stage', stageId: 'metro', isRandomStage: false }),
        conn1,
      );
      room.onMessage(JSON.stringify({ type: 'fight_created' }), conn1);
      expect(room.roomState).toBe('fighting');
    });

    it('rejects select_stage from non-host (Player 2)', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'paula' }), conn2);

      room.onMessage(
        JSON.stringify({ type: 'select_stage', stageId: 'metro', isRandomStage: false }),
        conn2,
      );
      expect(room.roomState).toBe('stage_select');
    });

    it('rejects select_stage outside stage_select state', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      // Still in 'selecting' state
      room.onMessage(
        JSON.stringify({ type: 'select_stage', stageId: 'metro', isRandomStage: false }),
        conn1,
      );
      expect(room.roomState).toBe('selecting');
    });

    it('rejects ready message outside selecting/ready_check states', () => {
      room.onConnect(conn1, makeCtx());
      // Only one player connected — state is 'waiting'
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      expect(room.roomState).toBe('waiting');
      expect(room.players[0].ready).toBe(false);
    });
  });

  // ---- Room full ----

  describe('room full', () => {
    it('sends full message and closes connection when room is full', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onConnect(conn3, makeCtx());
      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'full')).toBe(true);
      expect(conn3.close).toHaveBeenCalled();
    });
  });

  // ---- Spectators ----

  describe('spectators', () => {
    it('adds spectator connection to spectators set', () => {
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      expect(room.spectators.has('c3')).toBe(true);
      expect(room.players[0]).toBeNull();
      expect(room.players[1]).toBeNull();
    });

    it('sends assign_spectator message', () => {
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      const msg = JSON.parse(conn3.send.mock.calls[0][0]);
      expect(msg.type).toBe('assign_spectator');
      expect(msg.spectatorCount).toBe(1);
    });
  });

  // ---- _slotOf / _isSpectator ----

  describe('lookups', () => {
    it('_slotOf returns correct slot', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      expect(room._slotOf('c1')).toBe(0);
      expect(room._slotOf('c2')).toBe(1);
      expect(room._slotOf('unknown')).toBe(-1);
    });

    it('_isSpectator returns true for spectators', () => {
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      expect(room._isSpectator('c3')).toBe(true);
      expect(room._isSpectator('c1')).toBe(false);
    });
  });

  // ---- Ready flow ----

  describe('ready flow', () => {
    it('transitions to stage_select and then triggers start with stage when host selects', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());

      conn1.send.mockClear();
      conn2.send.mockClear();

      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'jeka' }), conn2);

      expect(room.roomState).toBe('stage_select');

      // Both players should get go_to_stage_select message
      const allReadyMessages = [
        ...conn1.send.mock.calls.map((c) => JSON.parse(c[0])),
        ...conn2.send.mock.calls.map((c) => JSON.parse(c[0])),
      ];
      expect(allReadyMessages.some((m) => m.type === 'go_to_stage_select')).toBe(true);

      conn1.send.mockClear();
      conn2.send.mockClear();

      // Host selects stage → creating_fight
      room.onMessage(
        JSON.stringify({ type: 'select_stage', stageId: 'metro', isRandomStage: false }),
        conn1,
      );
      expect(room.roomState).toBe('creating_fight');

      conn1.send.mockClear();
      conn2.send.mockClear();

      // P1 confirms fight creation → fighting + start broadcast
      room.onMessage(JSON.stringify({ type: 'fight_created' }), conn1);
      expect(room.roomState).toBe('fighting');

      // Both players should get start message
      const allStartMessages = [
        ...conn1.send.mock.calls.map((c) => JSON.parse(c[0])),
        ...conn2.send.mock.calls.map((c) => JSON.parse(c[0])),
      ];
      const startMsg = allStartMessages.find((m) => m.type === 'start');
      expect(startMsg).toBeDefined();
      expect(startMsg.p1Id).toBe('simon');
      expect(startMsg.p2Id).toBe('jeka');
      expect(startMsg.stageId).toBe('metro');
      expect(startMsg.isRandomStage).toBe(false);
    });
  });

  // ---- Rate limiting ----

  describe('rate limiting', () => {
    beforeEach(() => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
    });

    it('blocks shout within 2s cooldown', () => {
      const now = 10000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      room.onMessage(JSON.stringify({ type: 'shout', text: 'hello' }), conn3);
      conn1.send.mockClear();
      conn2.send.mockClear();
      conn3.send.mockClear();

      // Second shout within 2s should be blocked
      Date.now.mockReturnValue(now + 1999);
      room.onMessage(JSON.stringify({ type: 'shout', text: 'again' }), conn3);

      const broadcasts = [
        ...conn1.send.mock.calls,
        ...conn2.send.mock.calls,
        ...conn3.send.mock.calls,
      ];
      expect(broadcasts.length).toBe(0);

      vi.restoreAllMocks();
    });

    it('allows shout after cooldown expires', () => {
      const now = 10000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      room.onMessage(JSON.stringify({ type: 'shout', text: 'hello' }), conn3);
      conn1.send.mockClear();
      conn2.send.mockClear();
      conn3.send.mockClear();

      Date.now.mockReturnValue(now + 2001);
      room.onMessage(JSON.stringify({ type: 'shout', text: 'again' }), conn3);

      const allSends = [
        ...conn1.send.mock.calls.map((c) => JSON.parse(c[0])),
        ...conn2.send.mock.calls.map((c) => JSON.parse(c[0])),
        ...conn3.send.mock.calls.map((c) => JSON.parse(c[0])),
      ];
      expect(allSends.some((m) => m.type === 'shout' && m.text === 'again')).toBe(true);

      vi.restoreAllMocks();
    });

    it('blocks potion within 15s cooldown', () => {
      const now = 100000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      room.onMessage(JSON.stringify({ type: 'potion', target: 0, potionType: 'hp' }), conn3);

      // Clear all sends after first (allowed) potion
      conn1.send.mockClear();
      conn2.send.mockClear();
      conn3.send.mockClear();

      // Second potion within 15s should be blocked entirely (no broadcast)
      Date.now.mockReturnValue(now + 14999);
      room.onMessage(JSON.stringify({ type: 'potion', target: 0, potionType: 'hp' }), conn3);

      const allSends = [
        ...conn1.send.mock.calls.map((c) => JSON.parse(c[0])),
        ...conn2.send.mock.calls.map((c) => JSON.parse(c[0])),
        ...conn3.send.mock.calls.map((c) => JSON.parse(c[0])),
      ];
      expect(
        allSends.filter((m) => m.type === 'potion_applied' || m.type === 'potion').length,
      ).toBe(0);

      vi.restoreAllMocks();
    });

    it('allows potion after cooldown expires', () => {
      const now = 100000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      room.onMessage(JSON.stringify({ type: 'potion', target: 0, potionType: 'hp' }), conn3);
      conn1.send.mockClear();

      Date.now.mockReturnValue(now + 15001);
      room.onMessage(JSON.stringify({ type: 'potion', target: 1, potionType: 'special' }), conn3);

      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'potion' || m.type === 'potion_applied')).toBe(true);

      vi.restoreAllMocks();
    });
  });

  // ---- Disconnect ----

  describe('disconnect', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears player slot and notifies opponent after grace period expires', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      conn2.send.mockClear();

      room.onClose(conn1);
      // Slot preserved during grace period
      expect(room.players[0]).not.toBeNull();

      vi.advanceTimersByTime(20000);
      expect(room.players[0]).toBeNull();

      const msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(msgs.some((m) => m.type === 'disconnect')).toBe(true);
    });

    it('sends return_to_select (not disconnect) when grace expires during fight', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      startFight(room, conn1, conn2);
      expect(room.roomState).toBe('fighting');

      conn2.send.mockClear();
      room.onClose(conn1);
      vi.advanceTimersByTime(20000);

      // Room should be reset to pre-match state
      expect(room.roomState).toBe('waiting');
      expect(room.fightInfo).toBeNull();
      expect(room.players[0]).toBeNull();
      expect(room.players[1].ready).toBe(false);
      expect(room.players[1].fighterId).toBeNull();

      // Should receive return_to_select, NOT disconnect
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'return_to_select')).toBe(true);
      expect(c2Msgs.some((m) => m.type === 'disconnect')).toBe(false);
    });

    it('resets started and fightInfo when both players grace periods expire', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      startFight(room, conn1, conn2);
      expect(room.roomState).toBe('fighting');

      room.onClose(conn1);
      room.onClose(conn2);
      vi.advanceTimersByTime(20000);

      expect(room.roomState).toBe('waiting');
      expect(room.fightInfo).toBeNull();
    });
  });

  // ---- Leave ----

  describe('leave', () => {
    it('resets both players ready state', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'jeka' }), conn2);

      room.onMessage(JSON.stringify({ type: 'leave' }), conn1);

      expect(room.players[0].ready).toBe(false);
      expect(room.players[0].fighterId).toBeNull();
      expect(room.players[1].ready).toBe(false);
      expect(room.players[1].fighterId).toBeNull();
      expect(room.roomState).toBe('selecting');
      expect(room.fightInfo).toBeNull();
    });
  });

  // ---- Stale slot cleanup ----

  describe('stale slot cleanup', () => {
    it('removes disconnected players from slots', () => {
      room.onConnect(conn1, makeCtx());
      expect(room.players[0]).not.toBeNull();

      // Simulate conn1 disappearing from live connections
      party.getConnections = () => [conn2, conn3];

      // New connection triggers cleanup
      room.onConnect(conn2, makeCtx());
      // conn1 was stale, should be cleaned up, conn2 takes slot 0
      expect(room.players[0].id).toBe('c2');
    });
  });

  // ---- Spectator count broadcast ----

  describe('spectator count', () => {
    it('broadcasts spectator count on connect and disconnect', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn3, makeCtx({ spectate: '1' }));

      // All connections get spectator_count broadcast
      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'spectator_count' && m.count === 1)).toBe(true);

      conn1.send.mockClear();
      room.onClose(conn3);

      const c1MsgsAfter = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1MsgsAfter.some((m) => m.type === 'spectator_count' && m.count === 0)).toBe(true);
    });
  });

  // ---- Grace period ----

  describe('grace period', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      conn1.send.mockClear();
      conn2.send.mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends opponent_reconnecting on player disconnect (not disconnect)', () => {
      room.onClose(conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'opponent_reconnecting')).toBe(true);
      expect(c2Msgs.some((m) => m.type === 'disconnect')).toBe(false);
    });

    it('preserves slot during grace period', () => {
      room.onClose(conn1);
      expect(room.players[0]).not.toBeNull();
      expect(room.players[0].id).toBe('c1');
    });

    it('sends disconnect and clears slot when grace timer expires', () => {
      room.onClose(conn1);
      conn2.send.mockClear();

      vi.advanceTimersByTime(20000);

      expect(room.players[0]).toBeNull();
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'disconnect')).toBe(true);
    });

    it('rejoin during grace period cancels timer and sends opponent_reconnected', () => {
      room.onClose(conn1);
      conn2.send.mockClear();

      // conn1 reconnects with new connection
      const conn1b = makeConnection('c1b');
      party.getConnections = () => [conn1b, conn2, conn3];

      // Send rejoin from new connection
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);

      // Slot should be reassigned to new connection
      expect(room.players[0].id).toBe('c1b');

      // Opponent should get opponent_reconnected
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'opponent_reconnected')).toBe(true);

      // Timer should be cancelled — advancing time should NOT send disconnect
      conn2.send.mockClear();
      vi.advanceTimersByTime(20000);
      const c2MsgsAfter = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2MsgsAfter.some((m) => m.type === 'disconnect')).toBe(false);
    });

    it('rejoin with wrong slot is ignored', () => {
      room.onClose(conn1);
      conn2.send.mockClear();

      const conn1b = makeConnection('c1b');
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 1 }), conn1b);

      // Should not have sent opponent_reconnected
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'opponent_reconnected')).toBe(false);
    });

    it('rejoin with no active timer sends rejoin_ack with current state', () => {
      // No disconnect happened
      const conn1b = makeConnection('c1b');
      conn2.send.mockClear();

      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);

      // Should not notify opponent
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'opponent_reconnected')).toBe(false);

      // Should send rejoin_ack to the rejoining connection
      const c1bMsgs = conn1b.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1bMsgs.some((m) => m.type === 'rejoin_ack' && m.state === room.roomState)).toBe(true);
    });

    it('no-grace rejoin updates connection ID so stale onClose is ignored', () => {
      const conn1b = makeConnection('c1b');
      party.getConnections = () => [conn1b, conn2, conn3];

      // Rejoin before server saw disconnect (no grace timer)
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);
      expect(room.players[0].id).toBe('c1b');

      // Stale onClose for OLD connection — should NOT start grace
      conn2.send.mockClear();
      room.onClose(conn1);
      expect(room.roomState).not.toBe('reconnecting');
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'opponent_reconnecting')).toBe(false);
    });

    it('new connection during grace period receives rejoin_available', () => {
      room.onClose(conn1);

      // conn tries to take a player slot during grace
      const connNew = makeConnection('c_new');
      party.getConnections = () => [connNew, conn2, conn3];
      room.onConnect(connNew, makeCtx());

      // Should NOT get 'full' or be closed
      const newMsgs = connNew.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(newMsgs.some((m) => m.type === 'full')).toBe(false);
      expect(connNew.close).not.toHaveBeenCalled();

      // Should receive rejoin_available with the grace slot
      expect(newMsgs.some((m) => m.type === 'rejoin_available' && m.slot === 0)).toBe(true);
    });

    it('reconnecting player during grace period can rejoin', () => {
      // Start a fight
      startFight(room, conn1, conn2);
      expect(room.roomState).toBe('fighting');

      // P2 disconnects — grace timer starts
      room.onClose(conn2);
      expect(room.roomState).toBe('reconnecting');
      conn1.send.mockClear();

      // P2 reconnects with new connection
      const conn2b = makeConnection('c2b');
      party.getConnections = () => [conn1, conn2b, conn3];
      room.onConnect(conn2b, makeCtx());

      // Should NOT be rejected
      const c2bMsgs = conn2b.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2bMsgs.some((m) => m.type === 'full')).toBe(false);
      expect(conn2b.close).not.toHaveBeenCalled();

      // P2 sends rejoin
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 1 }), conn2b);

      // Slot updated, room restored
      expect(room.players[1].id).toBe('c2b');
      expect(room.roomState).toBe('fighting');

      // P1 notified
      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'opponent_reconnected')).toBe(true);
    });

    it('third player during grace period gets rejoin_available, not rejected', () => {
      room.onClose(conn1);

      // Random third player connects (not the disconnected player)
      const connRandom = makeConnection('c_random');
      party.getConnections = () => [connRandom, conn2, conn3];
      room.onConnect(connRandom, makeCtx());

      // Should not be rejected
      const msgs = connRandom.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(msgs.some((m) => m.type === 'full')).toBe(false);
      expect(connRandom.close).not.toHaveBeenCalled();
      expect(msgs.some((m) => m.type === 'rejoin_available' && m.slot === 0)).toBe(true);

      // They don't send rejoin, so grace expires normally
      vi.advanceTimersByTime(20000);
      expect(room.players[0]).toBeNull();
    });

    it('leave message cancels grace period and disconnects immediately', () => {
      room.onClose(conn1);
      conn2.send.mockClear();

      // conn1 reconnects and sends leave (intentional quit)
      const conn1b = makeConnection('c1b');
      party.getConnections = () => [conn1b, conn2, conn3];

      // First rejoin to reclaim slot, then leave
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);
      conn2.send.mockClear();
      room.onMessage(JSON.stringify({ type: 'leave' }), conn1b);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'leave')).toBe(true);
    });

    it('spectator disconnect is immediate, no grace period', () => {
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      conn1.send.mockClear();
      conn2.send.mockClear();

      room.onClose(conn3);

      // Should get spectator_count, not opponent_reconnecting
      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'spectator_count')).toBe(true);
      expect(c1Msgs.some((m) => m.type === 'opponent_reconnecting')).toBe(false);
    });

    it('successful rejoin during grace sends rejoin_ack to rejoiner', () => {
      room.onClose(conn1);

      const conn1b = makeConnection('c1b');
      party.getConnections = () => [conn1b, conn2, conn3];
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);

      const c1bMsgs = conn1b.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1bMsgs.some((m) => m.type === 'rejoin_ack')).toBe(true);
    });

    it('duplicate rejoin messages are idempotent', () => {
      room.onClose(conn1);

      const conn1b = makeConnection('c1b');
      party.getConnections = () => [conn1b, conn2, conn3];

      // First rejoin clears grace timer
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);
      conn1b.send.mockClear();
      conn2.send.mockClear();

      // Second rejoin — no grace timer, gets rejoin_ack
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);

      const c1bMsgs = conn1b.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1bMsgs.some((m) => m.type === 'rejoin_ack')).toBe(true);

      // Should not send opponent_reconnected again
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'opponent_reconnected')).toBe(false);
    });

    it('both players disconnect simultaneously: independent grace timers', () => {
      room.onClose(conn1);
      room.onClose(conn2);

      // Both slots preserved
      expect(room.players[0]).not.toBeNull();
      expect(room.players[1]).not.toBeNull();

      // Both reconnect
      const conn1b = makeConnection('c1b');
      const conn2b = makeConnection('c2b');
      party.getConnections = () => [conn1b, conn2b, conn3];

      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 1 }), conn2b);

      expect(room.players[0].id).toBe('c1b');
      expect(room.players[1].id).toBe('c2b');

      // Advancing time should not trigger disconnects
      vi.advanceTimersByTime(20000);
      expect(room.players[0]).not.toBeNull();
      expect(room.players[1]).not.toBeNull();
    });

    it('sends opponent_reconnecting to spectators', () => {
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      conn3.send.mockClear();

      room.onClose(conn1);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'opponent_reconnecting')).toBe(true);
    });

    it('sends opponent_reconnected to spectators on rejoin', () => {
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      room.onClose(conn1);
      conn3.send.mockClear();

      const conn1b = makeConnection('c1b');
      party.getConnections = () => [conn1b, conn2, conn3];
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'opponent_reconnected')).toBe(true);
    });

    it('broadcasts return_to_select to spectators when grace expires during fight', () => {
      startFight(room, conn1, conn2);
      expect(room.roomState).toBe('fighting');

      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      conn3.send.mockClear();

      room.onClose(conn1);
      vi.advanceTimersByTime(20000);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'return_to_select')).toBe(true);
      expect(c3Msgs.some((m) => m.type === 'disconnect')).toBe(false);
    });

    it('rejoin with reset resets room to selecting and notifies opponent', () => {
      // Start a fight
      startFight(room, conn1, conn2);
      expect(room.roomState).toBe('fighting');

      // P2 disconnects (page refresh scenario)
      room.onClose(conn2);
      expect(room.roomState).toBe('reconnecting');
      conn1.send.mockClear();

      // P2 reconnects with new connection
      const conn2b = makeConnection('c2b');
      party.getConnections = () => [conn1, conn2b, conn3];
      room.onConnect(conn2b, makeCtx());

      // P2 sends rejoin with reset (page refresh — no fight state)
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 1, reset: true }), conn2b);

      // Room should be reset to selecting
      expect(room.roomState).toBe('selecting');
      expect(room.fightInfo).toBeNull();
      expect(room.players[0].ready).toBe(false);
      expect(room.players[1].ready).toBe(false);
      expect(room.players[1].id).toBe('c2b');

      // P2 gets assign
      const c2bMsgs = conn2b.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2bMsgs.some((m) => m.type === 'assign' && m.player === 1)).toBe(true);

      // P1 gets return_to_select + opponent_joined
      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'return_to_select')).toBe(true);
      expect(c1Msgs.some((m) => m.type === 'opponent_joined')).toBe(true);
    });

    it('sends disconnect (not return_to_select) when grace expires during selecting', () => {
      // Both connected but NOT ready — still in selecting state
      conn2.send.mockClear();
      room.onClose(conn1);

      vi.advanceTimersByTime(20000);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'disconnect')).toBe(true);
      expect(c2Msgs.some((m) => m.type === 'return_to_select')).toBe(false);
    });

    it('roomState transitions through full lifecycle', () => {
      expect(room.roomState).toBe('selecting');

      // Both ready → fighting
      startFight(room, conn1, conn2);
      expect(room.roomState).toBe('fighting');

      // Disconnect → reconnecting
      room.onClose(conn1);
      expect(room.roomState).toBe('reconnecting');

      // Rejoin → back to fighting
      const conn1b = makeConnection('c1b');
      party.getConnections = () => [conn1b, conn2, conn3];
      room.onMessage(JSON.stringify({ type: 'rejoin', slot: 0 }), conn1b);
      expect(room.roomState).toBe('fighting');

      // Leave → selecting
      room.onMessage(JSON.stringify({ type: 'leave' }), conn1b);
      expect(room.roomState).toBe('selecting');
    });
  });

  // ---- Malformed input ----

  describe('malformed input', () => {
    it('does not crash or relay on non-JSON input', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      conn1.send.mockClear();
      conn2.send.mockClear();

      expect(() => room.onMessage('not json!!!', conn1)).not.toThrow();
      expect(conn2.send).not.toHaveBeenCalled();
    });
  });

  // ---- Double-ready prevention ----

  describe('double-ready prevention', () => {
    beforeEach(() => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      conn1.send.mockClear();
      conn2.send.mockClear();
    });

    it('ignores second ready from same player', () => {
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      expect(room.players[0].fighterId).toBe('simon');

      conn2.send.mockClear();
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'changed' }), conn1);
      // fighterId should not change
      expect(room.players[0].fighterId).toBe('simon');
      // No second opponent_ready sent
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.filter((m) => m.type === 'opponent_ready').length).toBe(0);
    });

    it('ignores ready after game has started', () => {
      startFight(room, conn1, conn2);
      expect(room.roomState).toBe('fighting');

      // Reset ready flags but keep roomState as 'fighting' via direct manipulation
      room.players[0].ready = false;
      room.players[0].fighterId = null;
      // roomState is still 'fighting'

      conn2.send.mockClear();
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'hacked' }), conn1);
      // Should be ignored because roomState is 'fighting'
      expect(room.players[0].fighterId).toBeNull();
      expect(conn2.send).not.toHaveBeenCalled();
    });
  });

  // ---- Host-only sync/round_event ----

  describe('host-only authoritative messages', () => {
    beforeEach(() => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      conn1.send.mockClear();
      conn2.send.mockClear();
    });

    it('drops sync from non-host (slot 1)', () => {
      room.onMessage(JSON.stringify({ type: 'sync', frame: 1, hp: [100, 80] }), conn2);
      expect(conn1.send).not.toHaveBeenCalled();
    });

    it('drops round_event from non-host (slot 1)', () => {
      room.onMessage(JSON.stringify({ type: 'round_event', event: 'ko' }), conn2);
      expect(conn1.send).not.toHaveBeenCalled();
    });

    it('allows sync from host (slot 0)', () => {
      room.onMessage(JSON.stringify({ type: 'sync', frame: 1 }), conn1);
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'sync')).toBe(true);
    });

    it('allows round_event from host (slot 0)', () => {
      room.onMessage(JSON.stringify({ type: 'round_event', event: 'ko' }), conn1);
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'round_event')).toBe(true);
    });
  });

  // ---- Ping/pong ----

  describe('ping/pong', () => {
    it('echoes pong with same timestamp back to sender', () => {
      room.onConnect(conn1, makeCtx());
      conn1.send.mockClear();

      room.onMessage(JSON.stringify({ type: 'ping', t: 1234567890 }), conn1);

      const msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(msgs).toEqual([{ type: 'pong', t: 1234567890 }]);
    });

    it('does not relay ping to other players', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      conn2.send.mockClear();

      room.onMessage(JSON.stringify({ type: 'ping', t: 999 }), conn1);

      expect(conn2.send).not.toHaveBeenCalled();
    });
  });

  // ---- Message routing ----

  describe('message routing', () => {
    beforeEach(() => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onConnect(conn3, makeCtx({ spectate: '1' }));
      conn1.send.mockClear();
      conn2.send.mockClear();
      conn3.send.mockClear();
    });

    it('input relayed to opponent and spectators', () => {
      room.onMessage(JSON.stringify({ type: 'input', keys: 'left' }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'input')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'input')).toBe(true);
    });

    it('sync relayed to opponent and spectators', () => {
      room.onMessage(JSON.stringify({ type: 'sync', frame: 1 }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'sync')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'sync')).toBe(true);
    });

    it('frame_sync relayed to opponent from both slots (no spectators)', () => {
      room.onMessage(JSON.stringify({ type: 'frame_sync', hash: 123 }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'frame_sync')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'frame_sync')).toBe(false);

      conn2.send.mockClear();
      conn3.send.mockClear();

      // P2 (slot 1) can also send frame_sync
      room.onMessage(JSON.stringify({ type: 'frame_sync', hash: 456 }), conn2);

      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'frame_sync')).toBe(true);
    });

    it('round_event relayed to opponent and spectators', () => {
      room.onMessage(JSON.stringify({ type: 'round_event', event: 'ko' }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'round_event')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'round_event')).toBe(true);
    });

    it('webrtc_offer relayed to opponent only', () => {
      room.onMessage(JSON.stringify({ type: 'webrtc_offer', sdp: 'offer-sdp' }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'webrtc_offer' && m.sdp === 'offer-sdp')).toBe(true);

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('webrtc_answer relayed to opponent only', () => {
      room.onMessage(JSON.stringify({ type: 'webrtc_answer', sdp: 'answer-sdp' }), conn2);

      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'webrtc_answer' && m.sdp === 'answer-sdp')).toBe(true);

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('webrtc_ice relayed to opponent only', () => {
      room.onMessage(
        JSON.stringify({ type: 'webrtc_ice', candidate: { candidate: 'test' } }),
        conn1,
      );

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'webrtc_ice')).toBe(true);

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('input with spectatorOnly NOT relayed to opponent, IS broadcast to spectators', () => {
      room.onMessage(
        JSON.stringify({ type: 'input', frame: 1, state: 7, spectatorOnly: true }),
        conn1,
      );

      // Opponent should NOT receive it
      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'input')).toBe(false);

      // Spectator SHOULD receive it (with slot added)
      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'input' && m.slot === 0)).toBe(true);
    });

    it('input without spectatorOnly relayed to opponent AND spectators (fallback)', () => {
      room.onMessage(JSON.stringify({ type: 'input', frame: 1, state: 7 }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'input')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c3Msgs.some((m) => m.type === 'input')).toBe(true);
    });

    it('rematch relayed only to opponent, not spectators', () => {
      room.onMessage(JSON.stringify({ type: 'rematch' }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'rematch')).toBe(true);

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('checksum relayed to opponent only, not spectators', () => {
      room.onMessage(JSON.stringify({ type: 'checksum', frame: 30, hash: 12345 }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'checksum' && m.frame === 30 && m.hash === 12345)).toBe(
        true,
      );

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('checksum from slot 1 relayed to slot 0', () => {
      room.onMessage(JSON.stringify({ type: 'checksum', frame: 60, hash: 99999 }), conn2);

      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'checksum' && m.frame === 60 && m.hash === 99999)).toBe(
        true,
      );

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('resync_request relayed to other player', () => {
      room.onMessage(JSON.stringify({ type: 'resync_request', frame: 30 }), conn2);

      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'resync_request' && m.frame === 30)).toBe(true);

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('resync from slot 0 (P1) relayed to slot 1', () => {
      const snapshot = { frame: 30, p1: {}, p2: {}, combat: {} };
      room.onMessage(JSON.stringify({ type: 'resync', snapshot }), conn1);

      const c2Msgs = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c2Msgs.some((m) => m.type === 'resync')).toBe(true);

      expect(conn3.send).not.toHaveBeenCalled();
    });

    it('resync from slot 1 (P2) relayed to slot 0 for reverse resync', () => {
      const snapshot = { frame: 30, p1: {}, p2: {}, combat: {} };
      room.onMessage(JSON.stringify({ type: 'resync', snapshot }), conn2);

      const c1Msgs = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
      expect(c1Msgs.some((m) => m.type === 'resync')).toBe(true);

      // Spectators should not receive resync
      expect(conn3.send).not.toHaveBeenCalled();
    });
  });

  // ---- TURN credential endpoint ----

  describe('onRequest — TURN credentials', () => {
    it('returns 404 for non-turn-creds paths', async () => {
      const response = await room.onRequest(
        new Request('http://localhost/parties/main/room/unknown', { method: 'GET' }),
      );
      expect(response.status).toBe(404);
    });

    it('returns default STUN servers when TURN env vars not configured', async () => {
      const response = await room.onRequest(
        new Request('http://localhost/parties/main/room/turn-creds', { method: 'GET' }),
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.iceServers).toEqual([
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]);
    });

    it('returns default STUN servers when env has partial config', async () => {
      party.env = { CLOUDFLARE_TURN_KEY_ID: 'key-id' }; // missing API token
      const room2 = new FightRoom(party);
      const response = await room2.onRequest(
        new Request('http://localhost/parties/main/room/turn-creds', { method: 'GET' }),
      );
      const data = await response.json();
      expect(data.iceServers.length).toBe(2);
      expect(data.iceServers[0].urls).toContain('stun');
    });

    it('calls Cloudflare TURN API and returns iceServers when configured', async () => {
      party.env = {
        CLOUDFLARE_TURN_KEY_ID: 'test-key-id',
        CLOUDFLARE_TURN_API_TOKEN: 'test-api-token',
      };
      const room2 = new FightRoom(party);

      // Cloudflare TURN API returns iceServers as a single object, not an array
      const mockIceServers = {
        urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'],
        username: 'user',
        credential: 'pass',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ iceServers: mockIceServers }),
      });

      const response = await room2.onRequest(
        new Request('http://localhost/parties/main/room/turn-creds', { method: 'GET' }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      // Server should wrap the single object in an array
      expect(Array.isArray(data.iceServers)).toBe(true);
      expect(data.iceServers).toEqual([mockIceServers]);

      // Verify Cloudflare API was called correctly
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://rtc.live.cloudflare.com/v1/turn/keys/test-key-id/credentials/generate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-token',
          }),
        }),
      );
    });

    it('falls back to STUN when Cloudflare API returns error', async () => {
      party.env = {
        CLOUDFLARE_TURN_KEY_ID: 'test-key-id',
        CLOUDFLARE_TURN_API_TOKEN: 'test-api-token',
      };
      const room2 = new FightRoom(party);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const response = await room2.onRequest(
        new Request('http://localhost/parties/main/room/turn-creds', { method: 'GET' }),
      );
      const data = await response.json();
      expect(data.iceServers.length).toBe(2);
      expect(data.iceServers[0].urls).toContain('stun');
    });

    it('falls back to STUN when fetch throws', async () => {
      party.env = {
        CLOUDFLARE_TURN_KEY_ID: 'test-key-id',
        CLOUDFLARE_TURN_API_TOKEN: 'test-api-token',
      };
      const room2 = new FightRoom(party);

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      const response = await room2.onRequest(
        new Request('http://localhost/parties/main/room/turn-creds', { method: 'GET' }),
      );
      const data = await response.json();
      expect(data.iceServers.length).toBe(2);
    });
  });
});
