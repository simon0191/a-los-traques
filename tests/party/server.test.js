import { describe, it, expect, beforeEach, vi } from 'vitest';
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
      const c1Messages = conn1.send.mock.calls.map(c => JSON.parse(c[0]));
      const c2Messages = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c1Messages.some(m => m.type === 'opponent_joined')).toBe(true);
      expect(c2Messages.some(m => m.type === 'opponent_joined')).toBe(true);
    });
  });

  // ---- Room full ----

  describe('room full', () => {
    it('sends full message and closes connection when room is full', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onConnect(conn3, makeCtx());
      const c3Msgs = conn3.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c3Msgs.some(m => m.type === 'full')).toBe(true);
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
    it('triggers start with both fighter IDs and a stage when both ready', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());

      conn1.send.mockClear();
      conn2.send.mockClear();

      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'jeka' }), conn2);

      expect(room.started).toBe(true);

      // Both players should get start message
      const allMessages = [
        ...conn1.send.mock.calls.map(c => JSON.parse(c[0])),
        ...conn2.send.mock.calls.map(c => JSON.parse(c[0])),
      ];
      const startMsg = allMessages.find(m => m.type === 'start');
      expect(startMsg).toBeDefined();
      expect(startMsg.p1Id).toBe('simon');
      expect(startMsg.p2Id).toBe('jeka');
      expect(['dojo', 'rooftop', 'beach', 'arcade', 'park']).toContain(startMsg.stageId);
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
        ...conn1.send.mock.calls.map(c => JSON.parse(c[0])),
        ...conn2.send.mock.calls.map(c => JSON.parse(c[0])),
        ...conn3.send.mock.calls.map(c => JSON.parse(c[0])),
      ];
      expect(allSends.some(m => m.type === 'shout' && m.text === 'again')).toBe(true);

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
        ...conn1.send.mock.calls.map(c => JSON.parse(c[0])),
        ...conn2.send.mock.calls.map(c => JSON.parse(c[0])),
        ...conn3.send.mock.calls.map(c => JSON.parse(c[0])),
      ];
      expect(allSends.filter(m => m.type === 'potion_applied' || m.type === 'potion').length).toBe(0);

      vi.restoreAllMocks();
    });

    it('allows potion after cooldown expires', () => {
      const now = 100000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      room.onMessage(JSON.stringify({ type: 'potion', target: 0, potionType: 'hp' }), conn3);
      conn1.send.mockClear();

      Date.now.mockReturnValue(now + 15001);
      room.onMessage(JSON.stringify({ type: 'potion', target: 1, potionType: 'special' }), conn3);

      const c1Msgs = conn1.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c1Msgs.some(m => m.type === 'potion' || m.type === 'potion_applied')).toBe(true);

      vi.restoreAllMocks();
    });
  });

  // ---- Disconnect ----

  describe('disconnect', () => {
    it('clears player slot and notifies opponent', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      conn2.send.mockClear();

      room.onClose(conn1);
      expect(room.players[0]).toBeNull();

      const msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(msgs.some(m => m.type === 'disconnect')).toBe(true);
    });

    it('resets room state when one player disconnects after match started', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'jeka' }), conn2);
      expect(room.started).toBe(true);

      room.onClose(conn1);

      // Room should be reset to pre-match state
      expect(room.started).toBe(false);
      expect(room.fightInfo).toBeNull();
      expect(room.players[0]).toBeNull();
      // Remaining player's ready and fighterId should be reset
      expect(room.players[1].ready).toBe(false);
      expect(room.players[1].fighterId).toBeNull();
    });

    it('resets started and fightInfo when both players gone', () => {
      room.onConnect(conn1, makeCtx());
      room.onConnect(conn2, makeCtx());
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'jeka' }), conn2);
      expect(room.started).toBe(true);

      room.onClose(conn1);
      room.onClose(conn2);
      expect(room.started).toBe(false);
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
      expect(room.started).toBe(false);
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
      const c1Msgs = conn1.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c1Msgs.some(m => m.type === 'spectator_count' && m.count === 1)).toBe(true);

      conn1.send.mockClear();
      room.onClose(conn3);

      const c1MsgsAfter = conn1.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c1MsgsAfter.some(m => m.type === 'spectator_count' && m.count === 0)).toBe(true);
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
      const c2Msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c2Msgs.filter(m => m.type === 'opponent_ready').length).toBe(0);
    });

    it('ignores ready after game has started', () => {
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'jeka' }), conn2);
      expect(room.started).toBe(true);

      // Use leave to reset ready flags but keep started via direct manipulation
      room.players[0].ready = false;
      room.players[0].fighterId = null;
      // started is still true

      conn2.send.mockClear();
      room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'hacked' }), conn1);
      // Should be ignored because started is true
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
      const c2Msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c2Msgs.some(m => m.type === 'sync')).toBe(true);
    });

    it('allows round_event from host (slot 0)', () => {
      room.onMessage(JSON.stringify({ type: 'round_event', event: 'ko' }), conn1);
      const c2Msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c2Msgs.some(m => m.type === 'round_event')).toBe(true);
    });
  });

  // ---- Ping/pong ----

  describe('ping/pong', () => {
    it('echoes pong with same timestamp back to sender', () => {
      room.onConnect(conn1, makeCtx());
      conn1.send.mockClear();

      room.onMessage(JSON.stringify({ type: 'ping', t: 1234567890 }), conn1);

      const msgs = conn1.send.mock.calls.map(c => JSON.parse(c[0]));
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

      const c2Msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c2Msgs.some(m => m.type === 'input')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c3Msgs.some(m => m.type === 'input')).toBe(true);
    });

    it('sync relayed to opponent and spectators', () => {
      room.onMessage(JSON.stringify({ type: 'sync', frame: 1 }), conn1);

      const c2Msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c2Msgs.some(m => m.type === 'sync')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c3Msgs.some(m => m.type === 'sync')).toBe(true);
    });

    it('round_event relayed to opponent and spectators', () => {
      room.onMessage(JSON.stringify({ type: 'round_event', event: 'ko' }), conn1);

      const c2Msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c2Msgs.some(m => m.type === 'round_event')).toBe(true);

      const c3Msgs = conn3.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c3Msgs.some(m => m.type === 'round_event')).toBe(true);
    });

    it('rematch relayed only to opponent, not spectators', () => {
      room.onMessage(JSON.stringify({ type: 'rematch' }), conn1);

      const c2Msgs = conn2.send.mock.calls.map(c => JSON.parse(c[0]));
      expect(c2Msgs.some(m => m.type === 'rematch')).toBe(true);

      expect(conn3.send).not.toHaveBeenCalled();
    });
  });
});
