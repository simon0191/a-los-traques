import { encodeInput } from '@alostraques/sim';
import { describe, expect, it, vi } from 'vitest';
import { InputSync } from '../../../apps/game-vite/src/systems/net/InputSync.js';

function makeSignaling({ isSpectator = false } = {}) {
  const handlers = new Map();
  return {
    isSpectator,
    on(type, cb) {
      handlers.set(type, cb);
    },
    off(type) {
      handlers.delete(type);
    },
    send: vi.fn(),
    _emit(type, msg) {
      const handler = handlers.get(type);
      if (handler) handler(msg);
    },
    _handlers: handlers,
  };
}

function makeTransport({ webrtcReady = false } = {}) {
  return {
    isWebRTCReady: () => webrtcReady,
    sendP2P: vi.fn(),
  };
}

function fullInput(overrides = {}) {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    lp: false,
    hp: false,
    lk: false,
    hk: false,
    sp: false,
    ...overrides,
  };
}

describe('InputSync', () => {
  describe('B3: getRemoteInput() merges attacks from multiple buffered frames', () => {
    it('OR-merges attack flags across all buffered frames', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.remoteInputBuffer[1] = fullInput({ right: true, lp: true });
      is.remoteInputBuffer[2] = fullInput({ right: true, hk: true });
      is.remoteInputBuffer[3] = fullInput({ left: true });

      const result = is.getRemoteInput();

      expect(result.left).toBe(true);
      expect(result.right).toBe(false); // movement from latest frame (3)
      expect(result.lp).toBe(true);
      expect(result.hk).toBe(true);
      expect(result.hp).toBe(false);
    });

    it('OR-merges attacks in getRemoteInputForSlot()', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.remoteInputBufferP1[1] = fullInput({ hp: true });
      is.remoteInputBufferP1[2] = fullInput({ sp: true });

      const result = is.getRemoteInputForSlot(0);

      expect(result.hp).toBe(true);
      expect(result.sp).toBe(true);
    });

    it('strips attacks from lastRemoteInput after consume', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.remoteInputBuffer[1] = fullInput({ right: true, lp: true });
      is.getRemoteInput();

      const repeat = is.getRemoteInput();
      expect(repeat.lp).toBe(false);
      expect(repeat.right).toBe(true);
    });
  });

  describe('input history processing', () => {
    it('fills gaps in buffer from history entries (encoded integers)', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      const hist1 = encodeInput(fullInput({ right: true, lp: true }));
      const hist2 = encodeInput(fullInput({ up: true }));

      signaling._emit('input', {
        type: 'input',
        frame: 3,
        state: fullInput({ left: true }),
        history: [
          [1, hist1],
          [2, hist2],
        ],
      });

      expect(is.remoteInputBuffer[3].left).toBe(true);
      expect(is.remoteInputBuffer[1].right).toBe(true);
      expect(is.remoteInputBuffer[1].lp).toBe(true);
      expect(is.remoteInputBuffer[2].up).toBe(true);
    });

    it('does not overwrite existing confirmed inputs with history', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.remoteInputBuffer[2] = fullInput({ hp: true });

      const hist2 = encodeInput(fullInput({ left: true }));
      signaling._emit('input', {
        type: 'input',
        frame: 3,
        state: fullInput(),
        history: [[2, hist2]],
      });

      expect(is.remoteInputBuffer[2].hp).toBe(true);
      expect(is.remoteInputBuffer[2].left).toBe(false);
    });

    it('works when history is absent (backwards compatible)', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      signaling._emit('input', {
        type: 'input',
        frame: 5,
        state: fullInput({ lp: true }),
      });

      expect(is.remoteInputBuffer[5].lp).toBe(true);
      expect(Object.keys(is.remoteInputBuffer)).toEqual(['5']);
    });

    it('does not process history for spectator inputs', () => {
      const signaling = makeSignaling({ isSpectator: true });
      const is = new InputSync(signaling);

      const hist1 = encodeInput(fullInput({ right: true }));
      signaling._emit('input', {
        type: 'input',
        frame: 3,
        slot: 0,
        state: fullInput({ left: true }),
        history: [[1, hist1]],
      });

      expect(is.remoteInputBufferP1[3]).toBeDefined();
      expect(is.remoteInputBuffer[1]).toBeUndefined();
      expect(is.remoteInputBufferP1[1]).toBeUndefined();
    });
  });

  describe('P2P input handling', () => {
    it('buffers P2P input messages via handleP2PInput', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.handleP2PInput({ type: 'input', frame: 10, state: fullInput({ right: true }) });

      expect(is.remoteInputBuffer[10]).toMatchObject({ right: true });
      expect(is.lastRemoteInput).toMatchObject({ right: true });
    });

    it('processes input history from P2P messages', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      const hist1 = encodeInput(fullInput({ right: true }));
      is.handleP2PInput({
        type: 'input',
        frame: 3,
        state: fullInput({ left: true }),
        history: [[1, hist1]],
      });

      expect(is.remoteInputBuffer[3].left).toBe(true);
      expect(is.remoteInputBuffer[1].right).toBe(true);
    });
  });

  describe('sendInput with dual transport', () => {
    it('sends via WebRTC when available, plus WS spectator relay', () => {
      const signaling = makeSignaling();
      const transport = makeTransport({ webrtcReady: true });
      const is = new InputSync(signaling, transport);

      is.sendInput(5, fullInput({ left: true }), [
        [3, 1],
        [4, 2],
      ]);

      expect(transport.sendP2P).toHaveBeenCalledTimes(1);
      const p2pMsg = transport.sendP2P.mock.calls[0][0];
      expect(p2pMsg).toMatchObject({ type: 'input', frame: 5, state: { left: true } });
      expect(p2pMsg.history).toEqual([
        [3, 1],
        [4, 2],
      ]);

      // WS also receives with spectatorOnly flag
      expect(signaling.send).toHaveBeenCalledTimes(1);
      expect(signaling.send.mock.calls[0][0].spectatorOnly).toBe(true);
    });

    it('falls back to WS only when WebRTC not ready', () => {
      const signaling = makeSignaling();
      const transport = makeTransport({ webrtcReady: false });
      const is = new InputSync(signaling, transport);

      is.sendInput(5, fullInput({ left: true }));

      expect(signaling.send).toHaveBeenCalledTimes(1);
      expect(signaling.send.mock.calls[0][0].spectatorOnly).toBeUndefined();
      expect(transport.sendP2P).not.toHaveBeenCalled();
    });

    it('falls back to WS when no transport provided', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.sendInput(5, fullInput({ left: true }));

      expect(signaling.send).toHaveBeenCalledTimes(1);
    });

    it('omits history key when history is empty', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.sendInput(1, fullInput(), []);

      const sent = signaling.send.mock.calls[0][0];
      expect(sent.history).toBeUndefined();
    });
  });

  describe('sendChecksum / sendResync', () => {
    it('sendChecksum sends correct message', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.sendChecksum(30, 12345);

      expect(signaling.send).toHaveBeenCalledWith({ type: 'checksum', frame: 30, hash: 12345 });
    });

    it('sendResyncRequest sends correct message', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.sendResyncRequest(42);

      expect(signaling.send).toHaveBeenCalledWith({ type: 'resync_request', frame: 42 });
    });

    it('sendResync sends snapshot message', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      const snapshot = { frame: 30, p1: {}, p2: {}, combat: {} };
      is.sendResync(snapshot);

      expect(signaling.send).toHaveBeenCalledWith({ type: 'resync', snapshot });
    });
  });

  describe('checksum/resync callbacks', () => {
    it('fires onChecksum callback', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);
      const received = [];
      is.onChecksum((frame, hash) => received.push({ frame, hash }));

      signaling._emit('checksum', { type: 'checksum', frame: 30, hash: 12345 });

      expect(received).toEqual([{ frame: 30, hash: 12345 }]);
    });

    it('fires onResyncRequest callback', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);
      const received = [];
      is.onResyncRequest((msg) => received.push(msg));

      signaling._emit('resync_request', { type: 'resync_request', frame: 30 });

      expect(received.length).toBe(1);
    });

    it('fires onResync callback', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);
      const received = [];
      is.onResync((msg) => received.push(msg));

      signaling._emit('resync', { type: 'resync', snapshot: { frame: 30 } });

      expect(received.length).toBe(1);
    });
  });

  describe('drainConfirmedInputs', () => {
    it('returns entries and clears buffer', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.remoteInputBuffer[1] = fullInput({ left: true });
      is.remoteInputBuffer[3] = fullInput({ right: true });

      const entries = is.drainConfirmedInputs();

      expect(entries.length).toBe(2);
      expect(entries.find(([f]) => f === 1)[1].left).toBe(true);
      expect(entries.find(([f]) => f === 3)[1].right).toBe(true);
      expect(Object.keys(is.remoteInputBuffer).length).toBe(0);
    });
  });

  describe('onRemoteInput callback', () => {
    it('fires on WS input', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);
      const received = [];
      is.onRemoteInput((frame, state) => received.push({ frame, state }));

      signaling._emit('input', { type: 'input', frame: 10, state: fullInput({ right: true }) });

      expect(received.length).toBe(1);
      expect(received[0].frame).toBe(10);
    });

    it('fires on P2P input', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);
      const received = [];
      is.onRemoteInput((frame, state) => received.push({ frame, state }));

      is.handleP2PInput({ type: 'input', frame: 10, state: fullInput({ right: true }) });

      expect(received.length).toBe(1);
    });
  });

  describe('reset', () => {
    it('clears all buffers and callbacks', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.remoteInputBuffer[1] = fullInput();
      is.lastRemoteInput = fullInput();
      is.remoteInputBufferP1[1] = fullInput();
      is.onRemoteInput(() => {});
      is.onChecksum(() => {});

      is.reset();

      expect(Object.keys(is.remoteInputBuffer).length).toBe(0);
      expect(is.lastRemoteInput).toBeNull();
      expect(Object.keys(is.remoteInputBufferP1).length).toBe(0);
      expect(is._onRemoteInput).toBeNull();
      expect(is._onChecksum).toBeNull();
    });
  });

  describe('destroy', () => {
    it('unregisters handlers from signaling', () => {
      const signaling = makeSignaling();
      const is = new InputSync(signaling);

      is.destroy();

      expect(signaling._handlers.has('input')).toBe(false);
      expect(signaling._handlers.has('checksum')).toBe(false);
      expect(signaling._handlers.has('resync_request')).toBe(false);
      expect(signaling._handlers.has('resync')).toBe(false);
    });
  });
});
