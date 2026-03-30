import { describe, expect, it, vi } from 'vitest';

// Mock PartySocket before importing SignalingClient
vi.mock('partysocket', () => {
  class MockPartySocket {
    constructor() {
      this._listeners = {};
    }
    addEventListener(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    }
    removeEventListener(event, handler) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
    }
    send(_data) {}
    close() {}
    _emit(event, data) {
      if (this._listeners[event]) {
        for (const h of this._listeners[event]) {
          h(data);
        }
      }
    }
  }
  return { default: MockPartySocket };
});

const { SignalingClient } = await import('../../../src/systems/net/SignalingClient.js');

function makeClient() {
  return new SignalingClient('test-room', 'localhost:1999');
}

describe('SignalingClient', () => {
  describe('construction', () => {
    it('creates with default state', () => {
      const sc = makeClient();
      expect(sc.roomId).toBe('test-room');
      expect(sc.playerSlot).toBe(-1);
      expect(sc.connected).toBe(false);
      expect(sc.isSpectator).toBe(false);
    });

    it('registers socket event listeners', () => {
      const sc = makeClient();
      expect(sc.socket._listeners.message.length).toBe(1);
      expect(sc.socket._listeners.open.length).toBe(1);
      expect(sc.socket._listeners.close.length).toBe(1);
      expect(sc.socket._listeners.error.length).toBe(1);
    });
  });

  describe('message dispatch', () => {
    it('dispatches messages to registered handlers', () => {
      const sc = makeClient();
      const received = [];
      sc.on('opponent_joined', (msg) => received.push(msg));

      sc._handleMessage({ type: 'opponent_joined' });

      expect(received.length).toBe(1);
    });

    it('does not throw when no handler registered for non-bufferable type', () => {
      const sc = makeClient();
      expect(() => sc._handleMessage({ type: 'opponent_joined' })).not.toThrow();
    });

    it('sets playerSlot on assign message', () => {
      const sc = makeClient();
      const received = [];
      sc.on('assign', (msg) => received.push(msg));

      sc._handleMessage({ type: 'assign', player: 1 });

      expect(sc.playerSlot).toBe(1);
      expect(received.length).toBe(1);
    });

    it('sets isSpectator on assign_spectator message', () => {
      const sc = makeClient();
      sc.on('assign_spectator', () => {});

      sc._handleMessage({ type: 'assign_spectator', spectatorCount: 3 });

      expect(sc.isSpectator).toBe(true);
    });
  });

  describe('malformed messages', () => {
    it('does not throw on malformed JSON', () => {
      const sc = makeClient();
      expect(() => {
        sc.socket._emit('message', { data: 'not valid json{{{' });
      }).not.toThrow();
    });

    it('does not throw on empty message data', () => {
      const sc = makeClient();
      expect(() => {
        sc.socket._emit('message', { data: '' });
      }).not.toThrow();
    });
  });

  describe('B4: pending message queue', () => {
    it('queues messages when not connected', () => {
      const sc = makeClient();
      sc.connected = false;
      const sendSpy = vi.spyOn(sc.socket, 'send');

      sc.send({ type: 'ready', fighterId: 'simon' });
      sc.send({ type: 'shout', text: 'hola' });

      expect(sendSpy).not.toHaveBeenCalled();
      expect(sc._pendingMessages.length).toBe(2);
    });

    it('flushes queued messages on reconnect', () => {
      const sc = makeClient();
      sc.connected = false;

      sc.send({ type: 'ready', fighterId: 'simon' });
      sc.send({ type: 'shout', text: 'hola' });

      const sendSpy = vi.spyOn(sc.socket, 'send');
      sc.socket._emit('open', {});

      expect(sc.connected).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sc._pendingMessages.length).toBe(0);

      const sent = sendSpy.mock.calls.map((c) => JSON.parse(c[0]));
      expect(sent[0]).toMatchObject({ type: 'ready', fighterId: 'simon' });
      expect(sent[1]).toMatchObject({ type: 'shout', text: 'hola' });
    });
  });

  describe('B5: callback buffering', () => {
    it('buffers sync messages and replays when handler is set', () => {
      const sc = makeClient();
      const syncMsg = { type: 'sync', frame: 10, hp1: 100, hp2: 80 };

      sc._handleMessage(syncMsg);

      const received = [];
      sc.on('sync', (msg) => received.push(msg));

      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({ frame: 10, hp1: 100 });
    });

    it('buffers start messages and replays when handler is set', () => {
      const sc = makeClient();
      const startMsg = { type: 'start', p1Id: 'simon', p2Id: 'jeka', stageId: 'dojo', isRandomStage: false };

      sc._handleMessage(startMsg);

      const received = [];
      sc.on('start', (msg) => received.push(msg));

      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({ p1Id: 'simon', p2Id: 'jeka', isRandomStage: false });
    });

    it('buffers round_event messages and replays when handler is set', () => {
      const sc = makeClient();
      sc._handleMessage({ type: 'round_event', winnerIndex: 0 });

      const received = [];
      sc.on('round_event', (msg) => received.push(msg));

      expect(received.length).toBe(1);
      expect(received[0].winnerIndex).toBe(0);
    });

    it('does not buffer when handler is already set', () => {
      const sc = makeClient();
      const received = [];
      sc.on('sync', (msg) => received.push(msg));

      sc._handleMessage({ type: 'sync', frame: 1 });
      sc._handleMessage({ type: 'sync', frame: 2 });

      expect(received.length).toBe(2);
      expect(sc._pendingCallbackMessages.get('sync').length).toBe(0);
    });

    it('does not buffer non-bufferable types', () => {
      const sc = makeClient();

      sc._handleMessage({ type: 'opponent_joined' });

      // Now register handler — should NOT receive the message
      const received = [];
      sc.on('opponent_joined', (msg) => received.push(msg));
      expect(received.length).toBe(0);
    });
  });

  describe('send', () => {
    it('sends JSON through socket when connected', () => {
      const sc = makeClient();
      sc.connected = true;
      const sendSpy = vi.spyOn(sc.socket, 'send');

      sc.send({ type: 'ready', fighterId: 'simon' });

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent).toMatchObject({ type: 'ready', fighterId: 'simon' });
    });
  });

  describe('socket lifecycle callbacks', () => {
    it('fires onSocketOpen on socket open', () => {
      const sc = makeClient();
      const calls = [];
      sc.onSocketOpen(() => calls.push('open'));

      sc.socket._emit('open', {});

      expect(calls).toEqual(['open']);
    });

    it('fires onSocketClose on socket close', () => {
      const sc = makeClient();
      const calls = [];
      sc.onSocketClose(() => calls.push('close'));

      sc.socket._emit('close', {});

      expect(calls).toEqual(['close']);
      expect(sc.connected).toBe(false);
    });

    it('fires onSocketError on socket error', () => {
      const sc = makeClient();
      const calls = [];
      sc.onSocketError(() => calls.push('error'));

      sc.socket._emit('error', {});

      expect(calls).toEqual(['error']);
    });
  });

  describe('off', () => {
    it('unregisters handler for a message type', () => {
      const sc = makeClient();
      const received = [];
      sc.on('disconnect', (msg) => received.push(msg));

      sc._handleMessage({ type: 'disconnect' });
      expect(received.length).toBe(1);

      sc.off('disconnect');
      sc._handleMessage({ type: 'disconnect' });
      expect(received.length).toBe(1);
    });
  });

  describe('resetHandlers', () => {
    it('clears specified handler types', () => {
      const sc = makeClient();
      sc.on('opponent_ready', () => {});
      sc.on('start', () => {});
      sc.on('disconnect', () => {});

      sc.resetHandlers(['opponent_ready', 'start']);

      expect(sc._handlers.has('opponent_ready')).toBe(false);
      expect(sc._handlers.has('start')).toBe(false);
      expect(sc._handlers.has('disconnect')).toBe(true);
    });
  });

  describe('destroy', () => {
    it('removes all socket event listeners', () => {
      const sc = makeClient();
      const socket = sc.socket;

      sc.destroy();

      expect(socket._listeners.message.length).toBe(0);
      expect(socket._listeners.open.length).toBe(0);
      expect(socket._listeners.close.length).toBe(0);
      expect(socket._listeners.error.length).toBe(0);
    });

    it('nulls out socket reference', () => {
      const sc = makeClient();
      sc.destroy();
      expect(sc.socket).toBeNull();
    });

    it('clears all handlers', () => {
      const sc = makeClient();
      sc.on('assign', () => {});
      sc.on('sync', () => {});

      sc.destroy();

      expect(sc._handlers.size).toBe(0);
    });

    it('clears lifecycle callbacks', () => {
      const sc = makeClient();
      sc.onSocketOpen(() => {});
      sc.onSocketClose(() => {});
      sc.onSocketError(() => {});

      sc.destroy();

      expect(sc._onSocketOpen).toBeNull();
      expect(sc._onSocketClose).toBeNull();
      expect(sc._onSocketError).toBeNull();
    });
  });
});
