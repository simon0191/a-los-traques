import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal PartySocket mock
vi.mock('partysocket', () => {
  class MockPartySocket {
    constructor() {
      this._listeners = {};
    }
    addEventListener(event, cb) {
      this._listeners[event] = cb;
    }
    removeEventListener() {}
    send() {}
    close() {}

    // Test helper: fire an event
    _fire(event, data) {
      if (this._listeners[event]) this._listeners[event](data);
    }
  }
  return { default: MockPartySocket };
});

const { NetworkManager } = await import('../../apps/game-vite/src/systems/NetworkManager.js');

describe('NetworkManager pong timeout', () => {
  let nm;

  beforeEach(() => {
    vi.useFakeTimers();
    nm = new NetworkManager('test-room', 'localhost:1999');
  });

  afterEach(() => {
    vi.useRealTimers();
    nm.destroy();
  });

  function simulateOpen() {
    nm.socket._fire('open');
  }

  function simulatePong(t) {
    nm.socket._fire('message', { data: JSON.stringify({ type: 'pong', t }) });
  }

  it('triggers _onSocketClose when pongs stop for >6s', () => {
    const closeCb = vi.fn();
    nm._onSocketClose = closeCb;

    simulateOpen();
    expect(closeCb).not.toHaveBeenCalled();

    // Advance past 2 ping intervals (6s) + one more tick (9s total)
    vi.advanceTimersByTime(9000);

    expect(closeCb).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger when pongs arrive on time', () => {
    const closeCb = vi.fn();
    nm._onSocketClose = closeCb;

    simulateOpen();

    // Pong arrives within each interval
    vi.advanceTimersByTime(3000);
    simulatePong(Date.now());
    vi.advanceTimersByTime(3000);
    simulatePong(Date.now());
    vi.advanceTimersByTime(3000);
    simulatePong(Date.now());
    vi.advanceTimersByTime(3000);

    expect(closeCb).not.toHaveBeenCalled();
  });

  it('clears ping interval after timeout fires', () => {
    simulateOpen();
    expect(nm._pingInterval).not.toBeNull();

    vi.advanceTimersByTime(9000);

    expect(nm._pingInterval).toBeNull();
  });

  it('does not double-trigger (pong timeout + socket close)', () => {
    const closeCb = vi.fn();

    // Wire through ReconnectionManager-like guard
    let state = 'connected';
    nm._onSocketClose = () => {
      if (state !== 'connected') return;
      state = 'reconnecting';
      closeCb();
    };

    simulateOpen();

    // Pong timeout fires first
    vi.advanceTimersByTime(9000);
    expect(closeCb).toHaveBeenCalledTimes(1);

    // WebSocket close fires later
    nm.socket._fire('close');
    expect(closeCb).toHaveBeenCalledTimes(1); // still 1
  });

  it('resets state on reconnect (_boundOnOpen)', () => {
    simulateOpen();

    // Trigger pong timeout
    vi.advanceTimersByTime(9000);
    expect(nm._pongTimeoutFired).toBe(true);
    expect(nm._pingInterval).toBeNull();

    // Simulate reconnection
    simulateOpen();
    expect(nm._pongTimeoutFired).toBe(false);
    expect(nm._lastPongTime).toBeGreaterThan(0);
    expect(nm._pingInterval).not.toBeNull();
  });
});
