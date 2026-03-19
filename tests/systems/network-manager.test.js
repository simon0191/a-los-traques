import { describe, expect, it, vi } from 'vitest';
import { encodeInput } from '../../src/systems/InputBuffer.js';

// Mock WebRTCTransport before importing NetworkManager
vi.mock('../../src/systems/WebRTCTransport.js', () => {
  class MockWebRTCTransport {
    constructor(opts) {
      this._opts = opts;
      this._sent = [];
      this.state = 'idle';
    }
    async startOffer() {
      this.state = 'signaling';
    }
    async handleSignal(_msg) {}
    send(data) {
      this._sent.push(data);
      return true;
    }
    isOpen() {
      return this.state === 'open';
    }
    destroy() {
      this.state = 'closed';
    }
    // Test helper: simulate open
    _simulateOpen() {
      this.state = 'open';
      if (this._opts.onOpen) this._opts.onOpen();
    }
    _simulateClose() {
      this.state = 'closed';
      if (this._opts.onClose) this._opts.onClose();
    }
    _simulateFailed() {
      this.state = 'failed';
      if (this._opts.onFailed) this._opts.onFailed();
    }
    _simulateMessage(data) {
      if (this._opts.onMessage) this._opts.onMessage(data);
    }
  }
  return { WebRTCTransport: MockWebRTCTransport };
});

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
      this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
    }
    send(_data) {}
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
      expect(socket._listeners.message.length).toBe(1);
      expect(socket._listeners.open.length).toBe(1);
      expect(socket._listeners.close.length).toBe(1);
      expect(socket._listeners.error.length).toBe(1);

      nm.destroy();

      // All listeners should be removed
      expect(socket._listeners.message.length).toBe(0);
      expect(socket._listeners.open.length).toBe(0);
      expect(socket._listeners.close.length).toBe(0);
      expect(socket._listeners.error.length).toBe(0);
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
        '_onAssign',
        '_onOpponentJoined',
        '_onOpponentReady',
        '_onStart',
        '_onRemoteInput',
        '_onDisconnect',
        '_onRematch',
        '_onFull',
        '_onError',
        '_onSync',
        '_onRoundEvent',
        '_onLeave',
        '_onAssignSpectator',
        '_onSpectatorCount',
        '_onShout',
        '_onFightState',
        '_onPotionApplied',
        '_onPotion',
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
        left: false,
        right: true,
        up: false,
        down: false,
        lp: true,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };
      // Frame 2: heavy kick (lp is false here)
      nm.remoteInputBuffer[2] = {
        left: false,
        right: true,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: true,
        sp: false,
      };
      // Frame 3: no attacks, just movement
      nm.remoteInputBuffer[3] = {
        left: true,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
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
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: true,
        lk: false,
        hk: false,
        sp: false,
      };
      nm.remoteInputBufferP1[2] = {
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: true,
      };

      const result = nm.getRemoteInputForSlot(0);

      // Both hp (frame 1) and sp (frame 2) should be merged
      expect(result.hp).toBe(true);
      expect(result.sp).toBe(true);
    });

    it('strips attacks from lastRemoteInput after consume', () => {
      const nm = makeManager();
      nm.remoteInputBuffer[1] = {
        left: false,
        right: true,
        up: false,
        down: false,
        lp: true,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
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
      const sent = sendSpy.mock.calls.map((c) => JSON.parse(c[0]));
      expect(sent[0]).toMatchObject({ type: 'ready', fighterId: 'simon' });
      expect(sent[1]).toMatchObject({ type: 'shout', text: 'hola' });
    });
  });

  // ---- return_to_select message ----

  describe('return_to_select message handling', () => {
    it('fires onReturnToSelect callback when message received', () => {
      const nm = makeManager();
      const received = [];
      nm.onReturnToSelect(() => received.push(true));

      nm._handleMessage({ type: 'return_to_select' });

      expect(received.length).toBe(1);
    });

    it('does not throw when no callback is registered', () => {
      const nm = makeManager();
      expect(() => nm._handleMessage({ type: 'return_to_select' })).not.toThrow();
    });

    it('clears callback on resetForReselect', () => {
      const nm = makeManager();
      nm.onReturnToSelect(() => {});
      expect(nm._onReturnToSelect).not.toBeNull();

      nm.resetForReselect();
      expect(nm._onReturnToSelect).toBeNull();
    });

    it('clears callback on destroy', () => {
      const nm = makeManager();
      nm.onReturnToSelect(() => {});

      nm.destroy();
      expect(nm._onReturnToSelect).toBeNull();
    });
  });

  // ---- Checksum callback ----

  describe('checksum message handling', () => {
    it('fires onChecksum callback with frame and hash', () => {
      const nm = makeManager();
      const received = [];
      nm.onChecksum((frame, hash) => received.push({ frame, hash }));

      nm._handleMessage({ type: 'checksum', frame: 30, hash: 12345 });

      expect(received).toEqual([{ frame: 30, hash: 12345 }]);
    });

    it('does not throw when no checksum callback is registered', () => {
      const nm = makeManager();
      expect(() => nm._handleMessage({ type: 'checksum', frame: 30, hash: 12345 })).not.toThrow();
    });

    it('clears checksum callback on destroy', () => {
      const nm = makeManager();
      nm.onChecksum(() => {});
      expect(nm._onChecksum).not.toBeNull();

      nm.destroy();
      expect(nm._onChecksum).toBeNull();
    });

    it('clears checksum callback on resetForReselect', () => {
      const nm = makeManager();
      nm.onChecksum(() => {});
      expect(nm._onChecksum).not.toBeNull();

      nm.resetForReselect();
      expect(nm._onChecksum).toBeNull();
    });
  });

  // ---- Resync message handling ----

  describe('resync message handling', () => {
    it('fires onResyncRequest callback', () => {
      const nm = makeManager();
      const received = [];
      nm.onResyncRequest((msg) => received.push(msg));

      nm._handleMessage({ type: 'resync_request', frame: 30 });

      expect(received).toEqual([{ type: 'resync_request', frame: 30 }]);
    });

    it('fires onResync callback with snapshot', () => {
      const nm = makeManager();
      const received = [];
      nm.onResync((msg) => received.push(msg));

      const snapshot = { frame: 30, p1: { hp: 100 }, p2: { hp: 80 }, combat: { timer: 55 } };
      nm._handleMessage({ type: 'resync', snapshot });

      expect(received.length).toBe(1);
      expect(received[0].snapshot.frame).toBe(30);
    });

    it('does not throw without callbacks registered', () => {
      const nm = makeManager();
      expect(() => nm._handleMessage({ type: 'resync_request', frame: 30 })).not.toThrow();
      expect(() => nm._handleMessage({ type: 'resync', snapshot: {} })).not.toThrow();
    });

    it('clears resync callbacks on destroy', () => {
      const nm = makeManager();
      nm.onResyncRequest(() => {});
      nm.onResync(() => {});

      nm.destroy();

      expect(nm._onResyncRequest).toBeNull();
      expect(nm._onResync).toBeNull();
    });

    it('clears resync callbacks on resetForReselect', () => {
      const nm = makeManager();
      nm.onResyncRequest(() => {});
      nm.onResync(() => {});

      nm.resetForReselect();

      expect(nm._onResyncRequest).toBeNull();
      expect(nm._onResync).toBeNull();
    });

    it('sendResyncRequest sends correct message', () => {
      const nm = makeManager();
      nm.connected = true;
      const sendSpy = vi.spyOn(nm.socket, 'send');

      nm.sendResyncRequest(42);

      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent).toEqual({ type: 'resync_request', frame: 42 });
    });

    it('sendResync sends snapshot message', () => {
      const nm = makeManager();
      nm.connected = true;
      const sendSpy = vi.spyOn(nm.socket, 'send');

      const snapshot = { frame: 30, p1: {}, p2: {}, combat: {} };
      nm.sendResync(snapshot);

      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent.type).toBe('resync');
      expect(sent.snapshot.frame).toBe(30);
    });
  });

  // ---- Input redundancy (receive side) ----

  describe('input history processing', () => {
    it('fills gaps in remoteInputBuffer from history entries (encoded integers)', () => {
      const nm = makeManager();

      // History arrives as encoded integers (from RollbackManager.localInputHistory)
      const hist1 = encodeInput({
        left: false,
        right: true,
        up: false,
        down: false,
        lp: true,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      });
      const hist2 = encodeInput({
        left: false,
        right: false,
        up: true,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      });

      // Simulate receiving frame 3 with encoded history for frames 1 and 2
      nm._handleMessage({
        type: 'input',
        frame: 3,
        state: {
          left: true,
          right: false,
          up: false,
          down: false,
          lp: false,
          hp: false,
          lk: false,
          hk: false,
          sp: false,
        },
        history: [
          [1, hist1],
          [2, hist2],
        ],
      });

      // Primary input stored as object
      expect(nm.remoteInputBuffer[3]).toBeDefined();
      expect(nm.remoteInputBuffer[3].left).toBe(true);

      // History entries decoded from integers to objects
      expect(nm.remoteInputBuffer[1]).toBeDefined();
      expect(typeof nm.remoteInputBuffer[1]).toBe('object');
      expect(nm.remoteInputBuffer[1].right).toBe(true);
      expect(nm.remoteInputBuffer[1].lp).toBe(true);
      expect(nm.remoteInputBuffer[2]).toBeDefined();
      expect(typeof nm.remoteInputBuffer[2]).toBe('object');
      expect(nm.remoteInputBuffer[2].up).toBe(true);
    });

    it('does not overwrite existing confirmed inputs with history', () => {
      const nm = makeManager();

      // Frame 2 already confirmed
      nm.remoteInputBuffer[2] = {
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: true,
        lk: false,
        hk: false,
        sp: false,
      };

      // Receive frame 3 with encoded history that includes frame 2 with different data
      const hist2 = encodeInput({
        left: true,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      });
      nm._handleMessage({
        type: 'input',
        frame: 3,
        state: {
          left: false,
          right: false,
          up: false,
          down: false,
          lp: false,
          hp: false,
          lk: false,
          hk: false,
          sp: false,
        },
        history: [[2, hist2]],
      });

      // Frame 2 should retain its original data (hp: true), not be overwritten
      expect(nm.remoteInputBuffer[2].hp).toBe(true);
      expect(nm.remoteInputBuffer[2].left).toBe(false);
    });

    it('works when history is absent (backwards compatible)', () => {
      const nm = makeManager();

      nm._handleMessage({
        type: 'input',
        frame: 5,
        state: {
          left: false,
          right: false,
          up: false,
          down: false,
          lp: true,
          hp: false,
          lk: false,
          hk: false,
          sp: false,
        },
      });

      expect(nm.remoteInputBuffer[5]).toBeDefined();
      expect(nm.remoteInputBuffer[5].lp).toBe(true);
      // No other frames should exist
      expect(Object.keys(nm.remoteInputBuffer)).toEqual(['5']);
    });

    it('does not process history for spectator inputs', () => {
      const nm = makeManager();
      nm.isSpectator = true;

      const hist1 = encodeInput({
        left: false,
        right: true,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      });
      nm._handleMessage({
        type: 'input',
        frame: 3,
        slot: 0,
        state: {
          left: true,
          right: false,
          up: false,
          down: false,
          lp: false,
          hp: false,
          lk: false,
          hk: false,
          sp: false,
        },
        history: [[1, hist1]],
      });

      // Spectator buffer gets the primary input
      expect(nm.remoteInputBufferP1[3]).toBeDefined();
      // History should NOT be processed for spectators
      expect(nm.remoteInputBuffer[1]).toBeUndefined();
      expect(nm.remoteInputBufferP1[1]).toBeUndefined();
    });
  });

  // ---- sendChecksum ----

  describe('sendChecksum', () => {
    it('sends checksum message with frame and hash', () => {
      const nm = makeManager();
      nm.connected = true;
      const sendSpy = vi.spyOn(nm.socket, 'send');

      nm.sendChecksum(30, 12345);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent).toEqual({ type: 'checksum', frame: 30, hash: 12345 });
    });
  });

  // ---- sendInput with history ----

  describe('sendInput with history', () => {
    it('includes history in message when provided', () => {
      const nm = makeManager();
      nm.connected = true;
      const sendSpy = vi.spyOn(nm.socket, 'send');

      const input = {
        left: true,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };
      const history = [
        [1, 5],
        [2, 3],
      ];

      nm.sendInput(3, input, history);

      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent.type).toBe('input');
      expect(sent.frame).toBe(3);
      expect(sent.history).toEqual([
        [1, 5],
        [2, 3],
      ]);
    });

    it('omits history key when history is empty', () => {
      const nm = makeManager();
      nm.connected = true;
      const sendSpy = vi.spyOn(nm.socket, 'send');

      const input = {
        left: false,
        right: false,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      };

      nm.sendInput(1, input, []);

      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent.history).toBeUndefined();
    });
  });

  // ---- WebRTC integration ----

  describe('WebRTC P2P transport', () => {
    it('inits WebRTC on opponent_joined (P1 as offerer)', () => {
      const nm = makeManager();
      nm.playerSlot = 0;
      // Ensure RTCPeerConnection is available
      globalThis.RTCPeerConnection = class {};

      nm._handleMessage({ type: 'opponent_joined' });
      expect(nm._webrtc).not.toBeNull();
    });

    it('does not init WebRTC for spectators', () => {
      const nm = makeManager();
      nm.isSpectator = true;
      globalThis.RTCPeerConnection = class {};

      nm._handleMessage({ type: 'opponent_joined' });
      expect(nm._webrtc).toBeNull();
    });

    it('P1 (slot 0) calls startOffer, P2 does not', () => {
      globalThis.RTCPeerConnection = class {};

      const nm1 = makeManager();
      nm1.playerSlot = 0;
      nm1._handleMessage({ type: 'opponent_joined' });
      expect(nm1._webrtc.state).toBe('signaling'); // mock startOffer sets signaling

      const nm2 = makeManager();
      nm2.playerSlot = 1;
      nm2._handleMessage({ type: 'opponent_joined' });
      expect(nm2._webrtc.state).toBe('idle'); // waiting for offer
    });

    it('sets _webrtcReady on open, sends inputs via WebRTC', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;
      nm.connected = true;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();

      expect(nm._webrtcReady).toBe(true);
      expect(nm._transportMode).toBe('webrtc');

      const sendSpy = vi.spyOn(nm.socket, 'send');
      nm.sendInput(5, { left: true });

      // WebRTC should have received the input
      expect(nm._webrtc._sent.length).toBe(1);
      const p2pMsg = JSON.parse(nm._webrtc._sent[0]);
      expect(p2pMsg).toMatchObject({ type: 'input', frame: 5, state: { left: true } });

      // WebSocket should also have received input with spectatorOnly flag
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const wsMsg = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(wsMsg.spectatorOnly).toBe(true);
    });

    it('falls back to WebSocket when WebRTC not ready', () => {
      const nm = makeManager();
      nm.connected = true;

      const sendSpy = vi.spyOn(nm.socket, 'send');
      nm.sendInput(5, { left: true });

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const wsMsg = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(wsMsg.spectatorOnly).toBeUndefined();
    });

    it('ignores WS input messages when WebRTC is active (non-spectator)', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();

      // WS input should be ignored
      nm._handleMessage({ type: 'input', frame: 1, state: { left: true } });
      expect(Object.keys(nm.remoteInputBuffer).length).toBe(0);
    });

    it('still processes WS input when spectator even with WebRTC active', () => {
      const nm = makeManager();
      nm.isSpectator = true;
      nm._webrtcReady = true; // hypothetical edge case

      nm._handleMessage({ type: 'input', frame: 1, state: { left: true }, slot: 0 });
      expect(nm.remoteInputBufferP1[1]).toMatchObject({ left: true });
    });

    it('falls back to WS on DataChannel close', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();
      expect(nm._webrtcReady).toBe(true);

      nm._webrtc._simulateClose();
      expect(nm._webrtcReady).toBe(false);
      expect(nm._transportMode).toBe('websocket');
    });

    it('stays on WS when WebRTC fails silently', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateFailed();

      expect(nm._webrtcReady).toBe(false);
      expect(nm._webrtc).toBeNull();
    });

    it('forwards signaling messages to WebRTC transport', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 1;

      nm._handleMessage({ type: 'opponent_joined' });
      const handleSpy = vi.spyOn(nm._webrtc, 'handleSignal');

      nm._handleMessage({ type: 'webrtc_offer', sdp: 'test-sdp' });
      expect(handleSpy).toHaveBeenCalledWith({ type: 'webrtc_offer', sdp: 'test-sdp' });

      nm._handleMessage({ type: 'webrtc_ice', candidate: { candidate: 'test' } });
      expect(handleSpy).toHaveBeenCalledTimes(2);
    });

    it('ignores signaling messages when no WebRTC transport', () => {
      const nm = makeManager();
      // No WebRTC initialized
      expect(() => {
        nm._handleMessage({ type: 'webrtc_offer', sdp: 'test' });
        nm._handleMessage({ type: 'webrtc_answer', sdp: 'test' });
        nm._handleMessage({ type: 'webrtc_ice', candidate: {} });
      }).not.toThrow();
    });

    it('receives P2P input messages via DataChannel', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;
      const received = [];
      nm.onRemoteInput((frame, state) => received.push({ frame, state }));

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();

      // Simulate P2P message
      nm._webrtc._simulateMessage(
        JSON.stringify({ type: 'input', frame: 10, state: { right: true } }),
      );

      expect(nm.remoteInputBuffer[10]).toMatchObject({ right: true });
      expect(nm.lastRemoteInput).toMatchObject({ right: true });
      expect(received.length).toBe(1);
    });

    it('processes input history from P2P messages to fill gaps', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();

      const hist1 = encodeInput({
        left: false,
        right: true,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      });

      // Simulate P2P message with history (frame 1 was lost, arrives as history in frame 3)
      nm._webrtc._simulateMessage(
        JSON.stringify({
          type: 'input',
          frame: 3,
          state: { left: true },
          history: [[1, hist1]],
        }),
      );

      // Primary input stored
      expect(nm.remoteInputBuffer[3]).toMatchObject({ left: true });
      // History entry decoded and filled gap
      expect(nm.remoteInputBuffer[1]).toBeDefined();
      expect(nm.remoteInputBuffer[1].right).toBe(true);
    });

    it('P2P history does not overwrite existing confirmed inputs', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();

      // Frame 1 already confirmed
      nm.remoteInputBuffer[1] = { left: true, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };

      const hist1 = encodeInput({
        left: false,
        right: true,
        up: false,
        down: false,
        lp: false,
        hp: false,
        lk: false,
        hk: false,
        sp: false,
      });

      nm._webrtc._simulateMessage(
        JSON.stringify({
          type: 'input',
          frame: 3,
          state: { down: true },
          history: [[1, hist1]],
        }),
      );

      // Frame 1 should retain original data, not be overwritten by history
      expect(nm.remoteInputBuffer[1].left).toBe(true);
      expect(nm.remoteInputBuffer[1].right).toBe(false);
    });

    it('resetForReselect preserves WebRTC connection', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();

      nm.resetForReselect();
      // WebRTC should survive reselect — it persists across scene transitions
      expect(nm._webrtc).not.toBeNull();
      expect(nm._webrtcReady).toBe(true);
      expect(nm._transportMode).toBe('webrtc');
    });

    it('destroy() cleans up WebRTC', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      const webrtc = nm._webrtc;
      const destroySpy = vi.spyOn(webrtc, 'destroy');

      nm.destroy();
      expect(destroySpy).toHaveBeenCalled();
      expect(nm._webrtc).toBeNull();
    });

    it('re-inits WebRTC on opponent_reconnected', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      const firstWebrtc = nm._webrtc;

      nm._handleMessage({ type: 'opponent_reconnected' });
      // Should have destroyed old and created new
      expect(firstWebrtc.state).toBe('closed');
      expect(nm._webrtc).not.toBe(firstWebrtc);
    });

    it('handles malformed P2P messages gracefully', () => {
      globalThis.RTCPeerConnection = class {};
      const nm = makeManager();
      nm.playerSlot = 0;

      nm._handleMessage({ type: 'opponent_joined' });
      nm._webrtc._simulateOpen();

      expect(() => {
        nm._webrtc._simulateMessage('not json{{{');
      }).not.toThrow();
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
