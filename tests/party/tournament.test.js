import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FightRoom from '../../party/server.js';

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

function makeCtx() {
  return { request: { url: 'http://localhost/party/room' } };
}

describe('Tournament Lobby Actions', () => {
  let room, hostConn, playerConn, party;

  beforeEach(() => {
    vi.useFakeTimers();
    hostConn = makeConnection('host');
    playerConn = makeConnection('player');
    party = makeParty([hostConn, playerConn]);
    room = new FightRoom(party);

    // 1. Connect host -> state is WAITING
    room.onConnect(hostConn, makeCtx());

    // 2. Initialize tournament lobby -> state is TOURNAMENT_LOBBY
    const lobbyState = {
      size: 8,
      slots: new Array(8).fill(null),
      tourneyId: '123456',
    };
    lobbyState.slots[0] = { id: 'host-uuid', name: 'Host', type: 'human', status: 'ready' };

    room.onMessage(JSON.stringify({ type: 'init_tournament', lobbyState }), hostConn);
    expect(room.roomState).toBe('tournament_lobby');

    // 3. Connect player
    room.onConnect(playerConn, makeCtx());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('propogates handshake flag in JOIN_SLOT', () => {
    const payload = { name: 'Player', id: 'player-uuid', type: 'human', handshake: true };
    room.onMessage(
      JSON.stringify({ type: 'lobby_action', action: 'JOIN_SLOT', payload }),
      playerConn,
    );

    expect(room.lobbyState.slots[1]).toMatchObject({
      id: 'player-uuid',
      handshake: true,
    });
  });

  it('allows upgrading handshake via VERIFY_HANDSHAKE', () => {
    // 1. Join without handshake
    const joinPayload = { name: 'Player', id: 'player-uuid', type: 'human', handshake: false };
    room.onMessage(
      JSON.stringify({ type: 'lobby_action', action: 'JOIN_SLOT', payload: joinPayload }),
      playerConn,
    );

    expect(room.lobbyState.slots[1].handshake).toBe(false);

    // Bypassing rate limit
    vi.advanceTimersByTime(101);

    // 2. Perform handshake upgrade
    const verifyPayload = { id: 'player-uuid' };
    room.onMessage(
      JSON.stringify({ type: 'lobby_action', action: 'VERIFY_HANDSHAKE', payload: verifyPayload }),
      playerConn,
    );

    expect(room.lobbyState.slots[1].handshake).toBe(true);

    // 3. Verify host was notified of the change
    const hostMessages = hostConn.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(
      hostMessages.some(
        (m) => m.type === 'lobby_update' && m.lobbyState.slots[1]?.handshake === true,
      ),
    ).toBe(true);
  });

  it('rejects VERIFY_HANDSHAKE for non-existent IDs', () => {
    const verifyPayload = { id: 'non-existent-uuid' };
    room.onMessage(
      JSON.stringify({ type: 'lobby_action', action: 'VERIFY_HANDSHAKE', payload: verifyPayload }),
      playerConn,
    );

    // No slots should have changed to verified
    expect(room.lobbyState.slots.every((s) => s === null || s.id !== 'non-existent-uuid')).toBe(
      true,
    );
  });
});
