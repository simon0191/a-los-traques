import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseSignalingClient } from '../../../packages/game/src/systems/net/BaseSignalingClient.js';

// Mock PartySocket
vi.mock('partysocket', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      this.send = vi.fn();
      this.close = vi.fn();
      this.addEventListener = vi.fn();
      this.removeEventListener = vi.fn();
      return this;
    }),
  };
});

// Mock WebSocket ready state
global.WebSocket = {
  OPEN: 1,
  CLOSED: 3,
};

describe('BaseSignalingClient', () => {
  const roomId = 'test-room';
  const host = 'localhost:1999';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with a sessionId', () => {
    const client = new BaseSignalingClient(roomId, host);
    expect(client.sessionId).toBeDefined();
    expect(client.sessionId.length).toBeGreaterThan(0);
  });

  it('queues messages when not connected (B4)', () => {
    const client = new BaseSignalingClient(roomId, host);
    const msg = { type: 'test' };
    client.send(msg);

    expect(client._pendingMessages).toContain(msg);
    expect(client.socket.send).not.toHaveBeenCalled();
  });

  it('sends messages immediately when connected', () => {
    const client = new BaseSignalingClient(roomId, host);
    client.connected = true;
    client.socket.readyState = WebSocket.OPEN;

    const msg = { type: 'test' };
    client.send(msg);

    expect(client.socket.send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it('flushes pending messages on socket open (B4)', () => {
    const client = new BaseSignalingClient(roomId, host);
    const msg = { type: 'queued' };
    client.send(msg);

    // Find the 'open' listener and call it
    const openHandler = client.socket.addEventListener.mock.calls.find(
      (args) => args[0] === 'open',
    )[1];

    // Simulate connection
    client.socket.readyState = WebSocket.OPEN;
    openHandler();

    expect(client.connected).toBe(true);
    expect(client.socket.send).toHaveBeenCalledWith(JSON.stringify(msg));
    expect(client._pendingMessages.length).toBe(0);
  });

  it('parses incoming JSON and calls _handleMessageInternal', () => {
    const client = new BaseSignalingClient(roomId, host);
    const mockInternal = vi.spyOn(client, '_handleMessageInternal');

    const messageHandler = client.socket.addEventListener.mock.calls.find(
      (args) => args[0] === 'message',
    )[1];
    const mockMsg = { type: 'incoming', data: 'val' };

    messageHandler({ data: JSON.stringify(mockMsg) });

    expect(mockInternal).toHaveBeenCalledWith(mockMsg);
  });

  it('handles socket lifecycle callbacks', () => {
    const client = new BaseSignalingClient(roomId, host);
    const openCb = vi.fn();
    const closeCb = vi.fn();

    client.onSocketOpen(openCb);
    client.onSocketClose(closeCb);

    const openHandler = client.socket.addEventListener.mock.calls.find(
      (args) => args[0] === 'open',
    )[1];
    const closeHandler = client.socket.addEventListener.mock.calls.find(
      (args) => args[0] === 'close',
    )[1];

    openHandler();
    expect(openCb).toHaveBeenCalled();

    closeHandler();
    expect(closeCb).toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });

  it('cleans up on destroy', () => {
    const client = new BaseSignalingClient(roomId, host);
    client.destroy();

    expect(client.socket).toBeNull();
    expect(client._pendingMessages.length).toBe(0);
  });
});
