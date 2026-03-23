import { describe, expect, it, vi } from 'vitest';

// Mock WebRTCTransport before importing TransportManager
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

const { TransportManager } = await import('../../../src/systems/net/TransportManager.js');

function makeSignaling() {
  const handlers = new Map();
  return {
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

describe('TransportManager', () => {
  describe('WebRTC lifecycle', () => {
    it('inits WebRTC with P1 as offerer', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);

      expect(tm._webrtc).not.toBeNull();
      expect(tm._webrtc.state).toBe('signaling'); // startOffer called
    });

    it('inits WebRTC with P2 as answerer (does not call startOffer)', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(1);

      expect(tm._webrtc).not.toBeNull();
      expect(tm._webrtc.state).toBe('idle'); // waiting for offer
    });

    it('does not init when RTCPeerConnection unavailable', () => {
      delete globalThis.RTCPeerConnection;
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);

      expect(tm._webrtc).toBeNull();
    });

    it('sets webrtcReady on open', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      tm._webrtc._simulateOpen();

      expect(tm.isWebRTCReady()).toBe(true);
      expect(tm._transportMode).toBe('webrtc');
    });

    it('falls back to WS on DataChannel close', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      tm._webrtc._simulateOpen();
      expect(tm.isWebRTCReady()).toBe(true);

      tm._webrtc._simulateClose();
      expect(tm.isWebRTCReady()).toBe(false);
      expect(tm._transportMode).toBe('websocket');
    });

    it('stays on WS when WebRTC fails silently', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      tm._webrtc._simulateFailed();

      expect(tm.isWebRTCReady()).toBe(false);
      expect(tm._webrtc).toBeNull();
    });

    it('destroys old WebRTC on re-init', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      const first = tm._webrtc;

      tm.initWebRTC(0);
      expect(first.state).toBe('closed');
      expect(tm._webrtc).not.toBe(first);
    });
  });

  describe('signaling relay', () => {
    it('forwards signaling messages to WebRTC transport', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(1);
      const handleSpy = vi.spyOn(tm._webrtc, 'handleSignal');

      signaling._emit('webrtc_offer', { type: 'webrtc_offer', sdp: 'test-sdp' });
      expect(handleSpy).toHaveBeenCalledWith({ type: 'webrtc_offer', sdp: 'test-sdp' });

      signaling._emit('webrtc_ice', { type: 'webrtc_ice', candidate: { candidate: 'test' } });
      expect(handleSpy).toHaveBeenCalledTimes(2);
    });

    it('ignores signaling messages when no WebRTC transport', () => {
      const signaling = makeSignaling();
      new TransportManager(signaling);

      expect(() => {
        signaling._emit('webrtc_offer', { type: 'webrtc_offer', sdp: 'test' });
        signaling._emit('webrtc_answer', { type: 'webrtc_answer', sdp: 'test' });
        signaling._emit('webrtc_ice', { type: 'webrtc_ice', candidate: {} });
      }).not.toThrow();
    });

    it('sends WebRTC signaling via signaling client', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      // The WebRTCTransport's onSignal callback sends via signaling
      tm._webrtc._opts.onSignal({ type: 'webrtc_offer', sdp: 'test' });

      expect(signaling.send).toHaveBeenCalledWith({ type: 'webrtc_offer', sdp: 'test' });
    });
  });

  describe('P2P messaging', () => {
    it('sendP2P sends on DataChannel when ready', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      tm._webrtc._simulateOpen();

      const result = tm.sendP2P({ type: 'input', frame: 5 });

      expect(result).toBe(true);
      expect(tm._webrtc._sent.length).toBe(1);
    });

    it('sendP2P returns false when not ready', () => {
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      const result = tm.sendP2P({ type: 'input', frame: 5 });
      expect(result).toBe(false);
    });

    it('fires onP2PMessage callback for DataChannel messages', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const received = [];
      const tm = new TransportManager(signaling, {
        onP2PMessage: (msg) => received.push(msg),
      });

      tm.initWebRTC(0);
      tm._webrtc._simulateOpen();
      tm._webrtc._simulateMessage(JSON.stringify({ type: 'input', frame: 10 }));

      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({ type: 'input', frame: 10 });
    });

    it('handles malformed P2P messages gracefully', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      tm._webrtc._simulateOpen();

      expect(() => {
        tm._webrtc._simulateMessage('not json{{{');
      }).not.toThrow();
    });
  });

  describe('TURN credentials', () => {
    it('uses fetched ICE servers for WebRTC', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      // Manually set credentials (simulating successful fetch)
      tm._iceServers = [
        { urls: 'stun:stun.example.com' },
        { urls: 'turn:turn.example.com', username: 'user', credential: 'pass' },
      ];

      tm.initWebRTC(0);

      // The WebRTCTransport should have received the TURN servers
      expect(tm._webrtc._opts.iceServers).toEqual([
        { urls: 'stun:stun.example.com' },
        { urls: 'turn:turn.example.com', username: 'user', credential: 'pass' },
      ]);
    });

    it('falls back to default STUN when no TURN credentials', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);

      expect(tm._webrtc._opts.iceServers).toEqual([
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]);
    });
  });

  describe('getConnectionInfo', () => {
    it('returns current transport state', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      expect(tm.getConnectionInfo()).toEqual({ type: 'websocket', webrtcReady: false });

      tm.initWebRTC(0);
      tm._webrtc._simulateOpen();

      expect(tm.getConnectionInfo()).toEqual({ type: 'webrtc', webrtcReady: true });
    });
  });

  describe('destroy', () => {
    it('destroys WebRTC and unregisters signaling handlers', () => {
      globalThis.RTCPeerConnection = class {};
      const signaling = makeSignaling();
      const tm = new TransportManager(signaling);

      tm.initWebRTC(0);
      const webrtc = tm._webrtc;
      const destroySpy = vi.spyOn(webrtc, 'destroy');

      tm.destroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(tm._webrtc).toBeNull();
      expect(signaling._handlers.has('webrtc_offer')).toBe(false);
      expect(signaling._handlers.has('webrtc_answer')).toBe(false);
      expect(signaling._handlers.has('webrtc_ice')).toBe(false);
    });
  });
});
