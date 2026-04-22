import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock WebRTC browser APIs ---

class MockRTCSessionDescription {
  constructor({ type, sdp }) {
    this.type = type;
    this.sdp = sdp;
  }
}

class MockRTCIceCandidate {
  constructor(candidate) {
    Object.assign(this, candidate);
  }
  toJSON() {
    return { candidate: this.candidate, sdpMid: this.sdpMid };
  }
}

class MockDataChannel {
  constructor(label, opts) {
    this.label = label;
    this.ordered = opts?.ordered ?? true;
    this.maxRetransmits = opts?.maxRetransmits;
    this.readyState = 'connecting';
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this._sent = [];
  }
  send(data) {
    this._sent.push(data);
  }
  close() {
    this.readyState = 'closed';
  }
  // Test helper: simulate open
  _open() {
    this.readyState = 'open';
    if (this.onopen) this.onopen();
  }
  _close() {
    this.readyState = 'closed';
    if (this.onclose) this.onclose();
  }
  _receiveMessage(data) {
    if (this.onmessage) this.onmessage({ data });
  }
}

class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this._dc = null;
  }
  createDataChannel(label, opts) {
    this._dc = new MockDataChannel(label, opts);
    return this._dc;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }
  async setLocalDescription(desc) {
    this.localDescription = desc;
  }
  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }
  async addIceCandidate(_candidate) {}
  close() {
    this.connectionState = 'closed';
  }
  // Test helper: simulate ICE candidate
  _emitIceCandidate(candidate) {
    if (this.onicecandidate) {
      this.onicecandidate({
        candidate: candidate
          ? { candidate: candidate.candidate, sdpMid: candidate.sdpMid, toJSON: () => candidate }
          : null,
      });
    }
  }
  // Test helper: simulate connection state change
  _setConnectionState(state) {
    this.connectionState = state;
    if (this.onconnectionstatechange) this.onconnectionstatechange();
  }
}

// Install globals
globalThis.RTCPeerConnection = MockRTCPeerConnection;
globalThis.RTCSessionDescription = MockRTCSessionDescription;
globalThis.RTCIceCandidate = MockRTCIceCandidate;

const { WebRTCTransport } = await import('../../packages/game/src/systems/WebRTCTransport.js');

describe('WebRTCTransport', () => {
  let signals, messages, events;

  function makeCallbacks(overrides = {}) {
    signals = [];
    messages = [];
    events = { open: 0, close: 0, failed: 0 };
    return {
      onSignal: (msg) => signals.push(msg),
      onMessage: (data) => messages.push(data),
      onOpen: () => events.open++,
      onClose: () => events.close++,
      onFailed: () => events.failed++,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- State transitions ---

  describe('offerer flow (P1)', () => {
    it('transitions idle → connecting on startOffer', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      expect(transport.state).toBe('idle');

      await transport.startOffer();
      // State goes through signaling → connecting (DC setup happens immediately)
      expect(transport.state).toBe('connecting');
    });

    it('sends webrtc_offer signal on startOffer', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      expect(signals.length).toBeGreaterThanOrEqual(1);
      const offer = signals.find((s) => s.type === 'webrtc_offer');
      expect(offer).toBeDefined();
      expect(offer.sdp).toBe('mock-offer-sdp');
    });

    it('creates DataChannel with unreliable/unordered config', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      const dc = transport._dc;
      expect(dc.label).toBe('inputs');
      expect(dc.ordered).toBe(false);
      expect(dc.maxRetransmits).toBe(0);
    });

    it('transitions to connecting then open when DataChannel opens', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      expect(transport.state).toBe('connecting');

      transport._dc._open();
      expect(transport.state).toBe('open');
      expect(events.open).toBe(1);
    });
  });

  describe('answerer flow (P2)', () => {
    it('handles offer and sends answer', async () => {
      const transport = new WebRTCTransport({ isOfferer: false, ...makeCallbacks() });
      expect(transport.state).toBe('idle');

      await transport.handleSignal({ type: 'webrtc_offer', sdp: 'remote-offer-sdp' });

      expect(transport.state).toBe('signaling');
      const answer = signals.find((s) => s.type === 'webrtc_answer');
      expect(answer).toBeDefined();
      expect(answer.sdp).toBe('mock-answer-sdp');
    });

    it('receives DataChannel via ondatachannel event', async () => {
      const transport = new WebRTCTransport({ isOfferer: false, ...makeCallbacks() });
      await transport.handleSignal({ type: 'webrtc_offer', sdp: 'remote-offer-sdp' });

      // Simulate remote DataChannel creation
      const remoteDC = new MockDataChannel('inputs', { ordered: false, maxRetransmits: 0 });
      transport._pc.ondatachannel({ channel: remoteDC });

      expect(transport._dc).toBe(remoteDC);
      expect(transport.state).toBe('connecting');

      remoteDC._open();
      expect(transport.state).toBe('open');
      expect(events.open).toBe(1);
    });
  });

  // --- ICE candidates ---

  describe('ICE candidate exchange', () => {
    it('emits webrtc_ice signal on local ICE candidate', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      transport._pc._emitIceCandidate({ candidate: 'candidate:1', sdpMid: '0' });

      const ice = signals.find((s) => s.type === 'webrtc_ice');
      expect(ice).toBeDefined();
      expect(ice.candidate).toEqual({ candidate: 'candidate:1', sdpMid: '0' });
    });

    it('adds remote ICE candidate', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      const addSpy = vi.spyOn(transport._pc, 'addIceCandidate');
      await transport.handleSignal({ type: 'webrtc_ice', candidate: { candidate: 'remote:1' } });

      expect(addSpy).toHaveBeenCalled();
    });
  });

  // --- Sending / receiving data ---

  describe('data transfer', () => {
    it('send() returns false when not open', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      expect(transport.send('test')).toBe(false);

      await transport.startOffer();
      expect(transport.send('test')).toBe(false); // DC exists but not open
    });

    it('send() returns true and sends when open', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();
      transport._dc._open();

      expect(transport.send('hello')).toBe(true);
      expect(transport._dc._sent).toEqual(['hello']);
    });

    it('receives messages via onMessage callback', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();
      transport._dc._open();

      transport._dc._receiveMessage('{"frame":1}');
      expect(messages).toEqual(['{"frame":1}']);
    });
  });

  // --- isOpen ---

  describe('isOpen()', () => {
    it('returns false when no DataChannel', () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      expect(transport.isOpen()).toBe(false);
    });

    it('returns true when DataChannel is open', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();
      transport._dc._open();
      expect(transport.isOpen()).toBe(true);
    });
  });

  // --- Timeout ---

  describe('timeout', () => {
    it('fires onFailed after timeout if not open', async () => {
      const transport = new WebRTCTransport({
        isOfferer: true,
        ...makeCallbacks(),
        timeoutMs: 5000,
      });
      await transport.startOffer();

      vi.advanceTimersByTime(5000);

      expect(events.failed).toBe(1);
      expect(transport.state).toBe('failed');
    });

    it('does not fire onFailed if opened before timeout', async () => {
      const transport = new WebRTCTransport({
        isOfferer: true,
        ...makeCallbacks(),
        timeoutMs: 5000,
      });
      await transport.startOffer();
      transport._dc._open();

      vi.advanceTimersByTime(10000);
      expect(events.failed).toBe(0);
      expect(transport.state).toBe('open');
    });

    it('uses default 5s timeout', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      vi.advanceTimersByTime(4999);
      expect(events.failed).toBe(0);

      vi.advanceTimersByTime(1);
      expect(events.failed).toBe(1);
    });
  });

  // --- Connection state changes ---

  describe('connection state changes', () => {
    it('fires onClose when connection fails while open', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();
      transport._dc._open();

      transport._pc._setConnectionState('failed');
      expect(events.close).toBe(1);
      expect(transport.state).toBe('closed');
    });

    it('fires onFailed when connection fails during setup', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      transport._pc._setConnectionState('failed');
      expect(events.failed).toBe(1);
      expect(transport.state).toBe('failed');
    });
  });

  // --- DataChannel close ---

  describe('DataChannel close', () => {
    it('fires onClose when DataChannel closes while open', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();
      transport._dc._open();

      transport._dc._close();
      expect(events.close).toBe(1);
      expect(transport.state).toBe('closed');
    });

    it('does not fire onClose when DataChannel closes before open', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      transport._dc._close();
      expect(events.close).toBe(0);
    });
  });

  // --- destroy ---

  describe('destroy()', () => {
    it('closes PC and DC, clears timeout', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      const pc = transport._pc;
      const dc = transport._dc;
      const closePCSpy = vi.spyOn(pc, 'close');
      const closeDCSpy = vi.spyOn(dc, 'close');

      transport.destroy();

      expect(closePCSpy).toHaveBeenCalled();
      expect(closeDCSpy).toHaveBeenCalled();
      expect(transport._pc).toBeNull();
      expect(transport._dc).toBeNull();
      expect(transport.state).toBe('closed');
    });

    it('is safe to call multiple times', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      transport.destroy();
      expect(() => transport.destroy()).not.toThrow();
    });

    it('does not fire timeout after destroy', async () => {
      const transport = new WebRTCTransport({
        isOfferer: true,
        ...makeCallbacks(),
        timeoutMs: 5000,
      });
      await transport.startOffer();
      transport.destroy();

      vi.advanceTimersByTime(10000);
      expect(events.failed).toBe(0);
    });
  });

  // --- Guards ---

  describe('signal guards', () => {
    it('offerer ignores incoming offer', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();

      const signalCount = signals.length;
      await transport.handleSignal({ type: 'webrtc_offer', sdp: 'rogue-offer' });
      // No new signals should have been generated
      expect(signals.length).toBe(signalCount);
    });

    it('answerer ignores incoming answer', async () => {
      const transport = new WebRTCTransport({ isOfferer: false, ...makeCallbacks() });
      await transport.handleSignal({ type: 'webrtc_offer', sdp: 'offer-sdp' });

      const signalCount = signals.length;
      await transport.handleSignal({ type: 'webrtc_answer', sdp: 'rogue-answer' });
      expect(signals.length).toBe(signalCount);
    });

    it('startOffer is no-op if not idle', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      await transport.startOffer();
      const signalCount = signals.length;

      await transport.startOffer(); // second call
      expect(signals.length).toBe(signalCount);
    });

    it('handleSignal(offer) is no-op if answerer not idle', async () => {
      const transport = new WebRTCTransport({ isOfferer: false, ...makeCallbacks() });
      await transport.handleSignal({ type: 'webrtc_offer', sdp: 'first-offer' });
      const signalCount = signals.length;

      await transport.handleSignal({ type: 'webrtc_offer', sdp: 'second-offer' });
      expect(signals.length).toBe(signalCount);
    });

    it('ICE candidate ignored when no PC exists', async () => {
      const transport = new WebRTCTransport({ isOfferer: true, ...makeCallbacks() });
      // No startOffer called, _pc is null
      await expect(
        transport.handleSignal({ type: 'webrtc_ice', candidate: { candidate: 'test' } }),
      ).resolves.not.toThrow();
    });
  });
});
