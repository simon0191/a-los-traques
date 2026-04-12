import { describe, expect, it, vi } from 'vitest';
import { encodeInput } from '../../../src/systems/InputBuffer.js';

// Mock WebRTCTransport
vi.mock('../../../src/systems/WebRTCTransport.js', () => {
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

// Mock PartySocket
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

const { NetworkFacade } = await import('../../../src/systems/net/NetworkFacade.js');

function makeFacade() {
  return new NetworkFacade('test-room', 'localhost:1999');
}

function emitMsg(nf, msg) {
  nf.signaling.socket._emit('message', { data: JSON.stringify(msg) });
}

/** Emit opponent_joined and wait for async TURN fetch + WebRTC init */
async function emitOpponentJoined(nf) {
  emitMsg(nf, { type: 'opponent_joined' });
  // _fetchTurnThenInitWebRTC is async — flush the microtask queue
  await vi.waitFor(() => {
    if (nf.transport._webrtc === null && !nf.signaling.isSpectator) {
      throw new Error('WebRTC not yet initialized');
    }
  });
}

describe('NetworkFacade', () => {
  describe('API surface matches NetworkManager', () => {
    it('has all callback registration methods', () => {
      const nf = makeFacade();
      const callbackMethods = [
        'onAssign',
        'onOpponentJoined',
        'onOpponentReady',
        'onStart',
        'onRemoteInput',
        'onDisconnect',
        'onRematch',
        'onFull',
        'onError',
        'onSync',
        'onRoundEvent',
        'onLeave',
        'onAssignSpectator',
        'onSpectatorCount',
        'onShout',
        'onFightState',
        'onPotionApplied',
        'onPotion',
        'onOpponentReconnecting',
        'onOpponentReconnected',
        'onReturnToSelect',
        'onRejoinAvailable',
        'onChecksum',
        'onResyncRequest',
        'onResync',
      ];
      for (const method of callbackMethods) {
        expect(typeof nf[method]).toBe('function');
      }
    });

    it('has all send methods', () => {
      const nf = makeFacade();
      const sendMethods = [
        'sendReady',
        'sendInput',
        'sendChecksum',
        'sendResyncRequest',
        'sendResync',
        'sendRematch',
        'sendLeave',
        'sendSync',
        'sendRoundEvent',
        'sendShout',
        'sendPotion',
        'sendRejoin',
        'sendPing',
      ];
      for (const method of sendMethods) {
        expect(typeof nf[method]).toBe('function');
      }
    });

    it('has all query methods', () => {
      const nf = makeFacade();
      expect(typeof nf.getRemoteInput).toBe('function');
      expect(typeof nf.getRemoteInputForSlot).toBe('function');
      expect(typeof nf.drainConfirmedInputs).toBe('function');
      expect(typeof nf.getPlayerSlot).toBe('function');
      expect(typeof nf.getRTT).toBe('function');
      expect(typeof nf.resetForReselect).toBe('function');
      expect(typeof nf.destroy).toBe('function');
    });

    it('has expected properties', () => {
      const nf = makeFacade();
      expect(nf.playerSlot).toBe(-1);
      expect(nf.connected).toBe(false);
      expect(nf.isSpectator).toBe(false);
      expect(nf.rtt).toBe(0);
      expect(nf.latency).toBe(0);
    });
  });

  describe('message routing', () => {
    it('routes assign message and sets playerSlot', () => {
      const nf = makeFacade();
      const received = [];
      nf.onAssign((slot) => received.push(slot));

      emitMsg(nf, { type: 'assign', player: 1 });

      expect(received).toEqual([1]);
      expect(nf.playerSlot).toBe(1);
    });

    it('routes opponent_joined', () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();
      const received = [];
      nf.onOpponentJoined(() => received.push(true));

      emitMsg(nf, { type: 'assign', player: 0 });
      emitMsg(nf, { type: 'opponent_joined' });

      expect(received.length).toBe(1);
    });

    it('routes opponent_ready with fighterId', () => {
      const nf = makeFacade();
      const received = [];
      nf.onOpponentReady((fighterId) => received.push(fighterId));

      emitMsg(nf, { type: 'opponent_ready', fighterId: 'jeka' });

      expect(received).toEqual(['jeka']);
    });

    it('routes start with B5 buffering', () => {
      const nf = makeFacade();

      // Message arrives before callback registered
      emitMsg(nf, {
        type: 'start',
        p1Id: 'simon',
        p2Id: 'jeka',
        stageId: 'dojo',
        isRandomStage: false,
      });

      const received = [];
      nf.onStart((msg) => received.push(msg));

      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({ p1Id: 'simon', p2Id: 'jeka', isRandomStage: false });
    });

    it('routes disconnect', () => {
      const nf = makeFacade();
      const received = [];
      nf.onDisconnect(() => received.push(true));

      emitMsg(nf, { type: 'disconnect' });

      expect(received.length).toBe(1);
    });

    it('routes return_to_select', () => {
      const nf = makeFacade();
      const received = [];
      nf.onReturnToSelect(() => received.push(true));

      emitMsg(nf, { type: 'return_to_select' });

      expect(received.length).toBe(1);
    });
  });

  describe('input handling', () => {
    it('buffers WS inputs and returns via getRemoteInput()', () => {
      const nf = makeFacade();

      emitMsg(nf, {
        type: 'input',
        frame: 1,
        state: {
          left: true,
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

      const input = nf.getRemoteInput();
      expect(input.left).toBe(true);
      expect(input.lp).toBe(true);
    });

    it('processes input history from WS messages', () => {
      const nf = makeFacade();

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

      emitMsg(nf, {
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
        history: [[1, hist1]],
      });

      expect(nf.remoteInputBuffer[3]).toBeDefined();
      expect(nf.remoteInputBuffer[1]).toBeDefined();
      expect(nf.remoteInputBuffer[1].right).toBe(true);
    });

    it('drainConfirmedInputs returns entries and clears', () => {
      const nf = makeFacade();

      emitMsg(nf, {
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

      const entries = nf.drainConfirmedInputs();
      expect(entries.length).toBe(1);
      expect(entries[0][0]).toBe(5);
      expect(entries[0][1].lp).toBe(true);
    });
  });

  describe('send methods', () => {
    it('sendReady sends via signaling', () => {
      const nf = makeFacade();
      nf.signaling.connected = true;
      const sendSpy = vi.spyOn(nf.signaling.socket, 'send');

      nf.sendReady('simon');

      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent).toMatchObject({ type: 'ready', fighterId: 'simon' });
    });

    it('sendChecksum sends via signaling', () => {
      const nf = makeFacade();
      nf.signaling.connected = true;
      const sendSpy = vi.spyOn(nf.signaling.socket, 'send');

      nf.sendChecksum(30, 12345);

      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent).toEqual({ type: 'checksum', frame: 30, hash: 12345 });
    });

    it('sendRejoin sends with slot and optional reset', () => {
      const nf = makeFacade();
      nf.signaling.connected = true;
      const sendSpy = vi.spyOn(nf.signaling.socket, 'send');

      nf.sendRejoin(1, true);

      const sent = JSON.parse(sendSpy.mock.calls[0][0]);
      expect(sent).toMatchObject({ type: 'rejoin', slot: 1, reset: true });
    });
  });

  describe('WebRTC integration', () => {
    it('inits WebRTC on opponent_joined', async () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();

      emitMsg(nf, { type: 'assign', player: 0 });
      await emitOpponentJoined(nf);

      expect(nf.transport._webrtc).not.toBeNull();
    });

    it('re-inits WebRTC on opponent_reconnected', async () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();

      emitMsg(nf, { type: 'assign', player: 0 });
      await emitOpponentJoined(nf);
      const first = nf.transport._webrtc;

      emitMsg(nf, { type: 'opponent_reconnected' });
      expect(first.state).toBe('closed');
      expect(nf.transport._webrtc).not.toBe(first);
    });

    it('does not init WebRTC for spectators', () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();

      emitMsg(nf, { type: 'assign_spectator', spectatorCount: 1 });
      emitMsg(nf, { type: 'opponent_joined' });

      expect(nf.transport._webrtc).toBeNull();
    });

    it('sends inputs via WebRTC when available, plus WS spectator relay', async () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();
      nf.signaling.connected = true;
      const wsSpy = vi.spyOn(nf.signaling.socket, 'send');

      emitMsg(nf, { type: 'assign', player: 0 });
      await emitOpponentJoined(nf);
      nf.transport._webrtc._simulateOpen();

      nf.sendInput(5, { left: true });

      // P2P path
      expect(nf.transport._webrtc._sent.length).toBe(1);
      // WS spectator relay
      const wsMsgs = wsSpy.mock.calls.map((c) => JSON.parse(c[0]));
      const spectatorMsg = wsMsgs.find((m) => m.type === 'input');
      expect(spectatorMsg.spectatorOnly).toBe(true);
    });

    it('receives P2P inputs via DataChannel', async () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();
      const received = [];
      nf.onRemoteInput((frame, state) => received.push({ frame, state }));

      emitMsg(nf, { type: 'assign', player: 0 });
      await emitOpponentJoined(nf);
      nf.transport._webrtc._simulateOpen();
      nf.transport._webrtc._simulateMessage(
        JSON.stringify({
          type: 'input',
          frame: 10,
          state: { right: true },
        }),
      );

      expect(nf.remoteInputBuffer[10]).toMatchObject({ right: true });
      expect(received.length).toBe(1);
    });
  });

  describe('rejoin_ack flushes pending WebRTC init', () => {
    it('rejoin_ack flushes pending WebRTC init', () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();
      emitMsg(nf, { type: 'assign', player: 0 });

      nf.queueWebRTCInit();
      expect(nf.transport._webrtc).toBeNull();

      emitMsg(nf, { type: 'rejoin_ack', state: 'fighting' });
      expect(nf.transport._webrtc).not.toBeNull();
    });

    it('rejoin_ack fires onOpponentReconnected callback', () => {
      const nf = makeFacade();
      const reconnected = vi.fn();
      nf.onOpponentReconnected(reconnected);

      emitMsg(nf, { type: 'rejoin_ack', state: 'fighting' });

      expect(reconnected).toHaveBeenCalledOnce();
    });

    it('rejoin_ack without pending init is no-op', () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();
      emitMsg(nf, { type: 'assign', player: 0 });

      emitMsg(nf, { type: 'rejoin_ack', state: 'fighting' });
      expect(nf.transport._webrtc).toBeNull();
    });
  });

  describe('B4: message queuing', () => {
    it('queues messages when disconnected, flushes on reconnect', () => {
      const nf = makeFacade();
      const sendSpy = vi.spyOn(nf.signaling.socket, 'send');

      nf.sendReady('simon');
      nf.sendShout('hola');

      expect(sendSpy).not.toHaveBeenCalled();

      nf.signaling.socket._emit('open', {});

      expect(sendSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('B5: callback buffering', () => {
    it('buffers sync messages and replays when callback is set', () => {
      const nf = makeFacade();

      emitMsg(nf, { type: 'sync', frame: 10, hp1: 100 });

      const received = [];
      nf.onSync((msg) => received.push(msg));

      expect(received.length).toBe(1);
      expect(received[0].frame).toBe(10);
    });
  });

  describe('resetForReselect', () => {
    it('clears input buffers and scene-specific callbacks', async () => {
      globalThis.RTCPeerConnection = class {};
      const nf = makeFacade();

      nf.onOpponentReady(() => {});
      nf.onRematch(() => {});
      nf.onLeave(() => {});

      emitMsg(nf, { type: 'assign', player: 0 });
      await emitOpponentJoined(nf);
      nf.transport._webrtc._simulateOpen();

      nf.resetForReselect();

      expect(nf.signaling._handlers.has('opponent_ready')).toBe(false);
      expect(nf.signaling._handlers.has('rematch')).toBe(false);
      expect(nf.signaling._handlers.has('leave')).toBe(false);
      // WebRTC preserved
      expect(nf.transport._webrtc).not.toBeNull();
      expect(nf.transport.isWebRTCReady()).toBe(true);
    });
  });

  describe('ConnectionMonitor integration', () => {
    it('starts monitor when socket opens', () => {
      const nf = makeFacade();
      const startSpy = vi.spyOn(nf.monitor, 'start');

      nf.signaling.socket._emit('open', {});

      expect(startSpy).toHaveBeenCalledOnce();
    });

    it('starts monitor AND fires onSocketOpen callback together', () => {
      const nf = makeFacade();
      const startSpy = vi.spyOn(nf.monitor, 'start');
      const openCb = vi.fn();
      nf.onSocketOpen(openCb);

      nf.signaling.socket._emit('open', {});

      expect(startSpy).toHaveBeenCalledOnce();
      expect(openCb).toHaveBeenCalledOnce();
    });
  });

  describe('destroy', () => {
    it('destroys all sub-modules', () => {
      const nf = makeFacade();
      const socket = nf.signaling.socket;

      nf.destroy();

      expect(nf.signaling.socket).toBeNull();
      expect(socket._listeners.message.length).toBe(0);
      expect(nf._onOpponentJoined).toBeNull();
    });
  });
});
