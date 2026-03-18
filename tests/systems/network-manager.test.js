import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock PartySocket before importing NetworkManager
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
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    }
    send(data) {}
    close() {}
    // Test helper: emit an event
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

// Import after mock is set up
const { NetworkManager } = await import('../../src/systems/NetworkManager.js');

// --- Helpers ---

function makeManager() {
  return new NetworkManager('test-room', 'localhost:1999');
}

// --- Tests ---

describe('NetworkManager', () => {
  // ---- B1: Malformed JSON ----

  describe('B1: malformed message handling', () => {
    it('does not throw on malformed JSON', () => {
      const nm = makeManager();
      expect(() => {
        nm.socket._emit('message', { data: 'not valid json{{{' });
      }).not.toThrow();
    });

    it('does not throw on empty message data', () => {
      const nm = makeManager();
      expect(() => {
        nm.socket._emit('message', { data: '' });
      }).not.toThrow();
    });
  });

  // ---- B2: destroy() cleanup ----

  describe('B2: destroy() removes listeners and nulls callbacks', () => {
    it('removes all socket event listeners on destroy', () => {
      const nm = makeManager();
      const socket = nm.socket;

      // Verify listeners are registered
      expect(socket._listeners['message'].length).toBe(1);
      expect(socket._listeners['open'].length).toBe(1);
      expect(socket._listeners['close'].length).toBe(1);
      expect(socket._listeners['error'].length).toBe(1);

      nm.destroy();

      // All listeners should be removed
      expect(socket._listeners['message'].length).toBe(0);
      expect(socket._listeners['open'].length).toBe(0);
      expect(socket._listeners['close'].length).toBe(0);
      expect(socket._listeners['error'].length).toBe(0);
    });

    it('nulls out all callback properties on destroy', () => {
      const nm = makeManager();

      // Set some callbacks
      nm.onAssign(() => {});
      nm.onSync(() => {});
      nm.onStart(() => {});
      nm.onRoundEvent(() => {});
      nm.onDisconnect(() => {});
      nm.onRematch(() => {});
      nm.onShout(() => {});
      nm.onPotion(() => {});

      nm.destroy();

      // All callback properties should be null
      const callbackNames = [
        '_onAssign', '_onOpponentJoined', '_onOpponentReady', '_onStart',
        '_onRemoteInput', '_onDisconnect', '_onRematch', '_onFull',
        '_onError', '_onSync', '_onRoundEvent', '_onLeave',
        '_onAssignSpectator', '_onSpectatorCount', '_onShout',
        '_onFightState', '_onPotionApplied', '_onPotion',
      ];
      for (const name of callbackNames) {
        expect(nm[name]).toBeNull();
      }
    });

    it('nulls out socket reference on destroy', () => {
      const nm = makeManager();
      nm.destroy();
      expect(nm.socket).toBeNull();
    });
  });

  // ---- B3: Attack merging ----

  describe('B3: getRemoteInput() merges attacks from multiple buffered frames', () => {
    it('OR-merges attack flags across all buffered frames', () => {
      const nm = makeManager();

      // Frame 1: light punch
      nm.remoteInputBuffer[1] = {
        left: false, right: true, up: false, down: false,
        lp: true, hp: false, lk: false, hk: false, sp: false,
      };
      // Frame 2: heavy kick (lp is false here)
      nm.remoteInputBuffer[2] = {
        left: false, right: true, up: false, down: false,
        lp: false, hp: false, lk: false, hk: true, sp: false,
      };
      // Frame 3: no attacks, just movement
      nm.remoteInputBuffer[3] = {
        left: true, right: false, up: false, down: false,
        lp: false, hp: false, lk: false, hk: false, sp: false,
      };

      const result = nm.getRemoteInput();

      // Movement should come from latest frame (3)
      expect(result.left).toBe(true);
      expect(result.right).toBe(false);
      // Attacks should be OR-merged: lp from frame 1, hk from frame 2
      expect(result.lp).toBe(true);
      expect(result.hk).toBe(true);
      // Others should remain false
      expect(result.hp).toBe(false);
      expect(result.lk).toBe(false);
      expect(result.sp).toBe(false);
    });

    it('OR-merges attacks in getRemoteInputForSlot()', () => {
      const nm = makeManager();

      nm.remoteInputBufferP1[1] = {
        left: false, right: false, up: false, down: false,
        lp: false, hp: true, lk: false, hk: false, sp: false,
      };
      nm.remoteInputBufferP1[2] = {
        left: false, right: false, up: false, down: false,
        lp: false, hp: false, lk: false, hk: false, sp: true,
      };

      const result = nm.getRemoteInputForSlot(0);

      // Both hp (frame 1) and sp (frame 2) should be merged
      expect(result.hp).toBe(true);
      expect(result.sp).toBe(true);
    });

    it('strips attacks from lastRemoteInput after consume', () => {
      const nm = makeManager();
      nm.remoteInputBuffer[1] = {
        left: false, right: true, up: false, down: false,
        lp: true, hp: false, lk: false, hk: false, sp: false,
      };

      nm.getRemoteInput();

      // Next call should not have attacks
      const repeat = nm.getRemoteInput();
      expect(repeat.lp).toBe(false);
      expect(repeat.right).toBe(true);
    });
  });

  // ---- B4: Message queuing when disconnected ----

  describe('B4: _send() queues when disconnected, flushes on open', () => {
    it('queues messages when not connected', () => {
      const nm = makeManager();
      nm.connected = false;
      const sendSpy = vi.spyOn(nm.socket, 'send');

      nm.sendReady('simon');
      nm.sendInput(1, { left: true });

      // Nothing should be sent yet
      expect(sendSpy).not.toHaveBeenCalled();
      // Messages should be queued
      expect(nm._pendingMessages.length).toBe(2);
    });

    it('flushes queued messages on reconnect', () => {
      const nm = makeManager();
      nm.connected = false;

      nm.sendReady('simon');
      nm.sendShout('hola');

      expect(nm._pendingMessages.length).toBe(2);

      const sendSpy = vi.spyOn(nm.socket, 'send');

      // Simulate reconnect
      nm.socket._emit('open', {});

      expect(nm.connected).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(nm._pendingMessages.length).toBe(0);

      // Verify message contents
      const sent = sendSpy.mock.calls.map(c => JSON.parse(c[0]));
      expect(sent[0]).toMatchObject({ type: 'ready', fighterId: 'simon' });
      expect(sent[1]).toMatchObject({ type: 'shout', text: 'hola' });
    });
  });

  // ---- B5: Callback buffering ----

  describe('B5: buffers messages for unregistered callbacks', () => {
    it('buffers sync messages and replays when callback is set', () => {
      const nm = makeManager();
      const syncMsg = { type: 'sync', frame: 10, hp1: 100, hp2: 80 };

      // Receive sync before callback is set
      nm._handleMessage(syncMsg);

      const received = [];
      nm.onSync((msg) => received.push(msg));

      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({ frame: 10, hp1: 100 });
    });

    it('buffers start messages and replays when callback is set', () => {
      const nm = makeManager();
      const startMsg = { type: 'start', p1Id: 'simon', p2Id: 'jeka', stageId: 'dojo' };

      nm._handleMessage(startMsg);

      const received = [];
      nm.onStart((msg) => received.push(msg));

      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({ p1Id: 'simon', p2Id: 'jeka' });
    });

    it('does not buffer when callback is already set', () => {
      const nm = makeManager();
      const received = [];
      nm.onSync((msg) => received.push(msg));

      nm._handleMessage({ type: 'sync', frame: 1 });
      nm._handleMessage({ type: 'sync', frame: 2 });

      expect(received.length).toBe(2);
      expect(nm._pendingCallbackMessages.sync.length).toBe(0);
    });
  });
});
