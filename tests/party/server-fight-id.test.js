import { beforeEach, describe, expect, it, vi } from 'vitest';
import FightRoom from '../../party/server.js';

// --- Helpers ---

function makeParty(connections = []) {
  return {
    id: 'test-room',
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

function readyBothPlayers(room, conn1, conn2) {
  room.onConnect(conn1, makeCtx());
  room.onConnect(conn2, makeCtx());
  room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
  room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'paula' }), conn2);
}

/** Ready both players and complete the fight creation handshake → fighting state. */
function startFight(room, conn1, conn2) {
  readyBothPlayers(room, conn1, conn2);
  room.onMessage(JSON.stringify({ type: 'fight_created' }), conn1);
}

// --- Tests ---

describe('FightRoom - fightId generation', () => {
  let room, conn1, conn2, party;

  beforeEach(() => {
    conn1 = makeConnection('c1');
    conn2 = makeConnection('c2');
    party = makeParty([conn1, conn2]);
    room = new FightRoom(party);
  });

  it('generates a fightId when both players ready', () => {
    readyBothPlayers(room, conn1, conn2);
    expect(room.fightInfo).not.toBeNull();
    expect(room.fightInfo.fightId).toBeDefined();
    expect(typeof room.fightInfo.fightId).toBe('string');
  });

  it('generates a valid UUID format fightId', () => {
    readyBothPlayers(room, conn1, conn2);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(room.fightInfo.fightId).toMatch(uuidRegex);
  });

  it('includes fightId in the start broadcast message to both peers', () => {
    startFight(room, conn1, conn2);

    const c1Messages = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
    const c2Messages = conn2.send.mock.calls.map((c) => JSON.parse(c[0]));

    const c1Start = c1Messages.find((m) => m.type === 'start');
    const c2Start = c2Messages.find((m) => m.type === 'start');

    expect(c1Start).toBeDefined();
    expect(c2Start).toBeDefined();
    expect(c1Start.fightId).toBe(room.fightInfo.fightId);
    expect(c2Start.fightId).toBe(room.fightInfo.fightId);
  });

  it('includes fighter IDs and stage in start message alongside fightId', () => {
    startFight(room, conn1, conn2);

    const c1Messages = conn1.send.mock.calls.map((c) => JSON.parse(c[0]));
    const startMsg = c1Messages.find((m) => m.type === 'start');

    expect(startMsg.p1Id).toBe('simon');
    expect(startMsg.p2Id).toBe('paula');
    expect(startMsg.stageId).toBeDefined();
    expect(startMsg.fightId).toBeDefined();
  });

  it('stores fightId in fightInfo', () => {
    readyBothPlayers(room, conn1, conn2);
    expect(room.fightInfo.fightId).toBeDefined();
    expect(room.fightInfo.p1Id).toBe('simon');
    expect(room.fightInfo.p2Id).toBe('paula');
  });

  it('clears fightId when a player leaves', () => {
    readyBothPlayers(room, conn1, conn2);
    expect(room.fightInfo).not.toBeNull();

    room.onMessage(JSON.stringify({ type: 'leave' }), conn1);
    expect(room.fightInfo).toBeNull();
  });

  it('generates a new fightId for each fight', () => {
    readyBothPlayers(room, conn1, conn2);
    const firstFightId = room.fightInfo.fightId;

    // Leave and start a new fight
    room.onMessage(JSON.stringify({ type: 'leave' }), conn1);
    room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'simon' }), conn1);
    room.onMessage(JSON.stringify({ type: 'ready', fighterId: 'paula' }), conn2);
    const secondFightId = room.fightInfo.fightId;

    expect(secondFightId).not.toBe(firstFightId);
  });
});
