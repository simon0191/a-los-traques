import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentLobbyService } from '../../packages/game/src/services/TournamentLobbyService.js';

// Mock dependency modules
vi.mock('../../packages/game/src/services/api.js', () => ({
  getProfile: vi.fn(),
}));

vi.mock('partysocket', () => ({
  default: vi.fn().mockImplementation(function () {
    this.send = vi.fn();
    this.close = vi.fn();
    this.addEventListener = vi.fn();
    this.removeEventListener = vi.fn();
    return this;
  }),
}));

// Mock WebSocket ready state
global.WebSocket = { OPEN: 1, CLOSED: 3 };

describe('TournamentLobbyService', () => {
  const roomId = 'lobby-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default state', () => {
    const service = new TournamentLobbyService(roomId);
    expect(service.state.size).toBe(8);
    expect(service.state.slots).toEqual([]);
    expect(service.roomId).toBe(roomId);
  });

  it('initHost handles profile fetch and initial broadcast', async () => {
    const { getProfile } = await import('../../packages/game/src/services/api.js');
    getProfile.mockResolvedValue({ id: 'real-uid', nickname: 'KillerTraque' });

    const service = new TournamentLobbyService(roomId);
    service.connected = true; // Sim base connection

    await service.initHost();

    expect(service.state.slots[0]).toEqual({
      type: 'human',
      id: 'real-uid',
      name: 'KillerTraque',
      status: 'ready',
      handshake: true,
    });

    expect(service.socket.send).toHaveBeenCalled();
    const sent = JSON.parse(service.socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('init_tournament');
    expect(sent.lobbyState.slots[0].name).toBe('KillerTraque');
  });

  it('updates state and notifies on lobby_update message', () => {
    const service = new TournamentLobbyService(roomId);
    const callback = vi.fn();
    service.onUpdate(callback);

    const newState = { size: 16, slots: [{ name: 'Test' }] };
    service._handleMessageInternal({ type: 'lobby_update', lobbyState: newState });

    expect(service.state).toEqual(newState);
    expect(callback).toHaveBeenCalledWith(newState);
  });

  it('sends specific lobby actions (Authoritative Sync)', () => {
    const service = new TournamentLobbyService(roomId);
    service.connected = true;

    // Test Guest add
    service.addGuest(2);
    let sent = JSON.parse(service.socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('lobby_action');
    expect(sent.action).toBe('ADD_GUEST');
    expect(sent.payload.index).toBe(2);

    // Test Bot add
    service.addBot(3, 5);
    sent = JSON.parse(service.socket.send.mock.calls[1][0]);
    expect(sent.action).toBe('UPDATE_BOT');
    expect(sent.payload.level).toBe(5);

    // Test Size update
    service.updateSize(16);
    sent = JSON.parse(service.socket.send.mock.calls[2][0]);
    expect(sent.action).toBe('UPDATE_SIZE');
    expect(sent.payload.newSize).toBe(16);
  });

  it('generates correct join URL', () => {
    global.window = { location: { origin: 'http://localhost:5173' } };
    const service = new TournamentLobbyService('test-room');
    const url = service.getJoinUrl();
    expect(url).toContain('/join.html?room=test-room');
    delete global.window;
  });
});
