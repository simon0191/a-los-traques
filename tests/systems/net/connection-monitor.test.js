import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionMonitor } from '../../../apps/game-vite/src/systems/net/ConnectionMonitor.js';

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

describe('ConnectionMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers pong handler on signaling client', () => {
    const signaling = makeSignaling();
    new ConnectionMonitor(signaling);
    expect(signaling._handlers.has('pong')).toBe(true);
  });

  it('updates RTT on pong', () => {
    const signaling = makeSignaling();
    const cm = new ConnectionMonitor(signaling);

    const now = Date.now();
    signaling._emit('pong', { t: now - 50 });

    expect(cm.rtt).toBeGreaterThanOrEqual(50);
    expect(cm.latency).toBeGreaterThanOrEqual(50);
  });

  it('sends pings periodically after start()', () => {
    const signaling = makeSignaling();
    const cm = new ConnectionMonitor(signaling);

    cm.start();

    vi.advanceTimersByTime(3000);
    expect(signaling.send).toHaveBeenCalledTimes(1);
    expect(signaling.send.mock.calls[0][0].type).toBe('ping');

    vi.advanceTimersByTime(3000);
    expect(signaling.send).toHaveBeenCalledTimes(2);

    cm.destroy();
  });

  it('fires timeout callback when no pong received within 6s', () => {
    const signaling = makeSignaling();
    const cm = new ConnectionMonitor(signaling);
    const timeoutCalls = [];
    cm.onTimeout(() => timeoutCalls.push(true));

    cm.start();

    // Interval fires at 3s, 6s, 9s. Timeout check is Date.now() - _lastPongTime > 6000.
    // At 3s: 3000 > 6000 = false. At 6s: 6000 > 6000 = false. At 9s: 9000 > 6000 = true.
    vi.advanceTimersByTime(9000);

    expect(timeoutCalls.length).toBe(1);
  });

  it('does not fire timeout if pong arrives in time', () => {
    const signaling = makeSignaling();
    const cm = new ConnectionMonitor(signaling);
    const timeoutCalls = [];
    cm.onTimeout(() => timeoutCalls.push(true));

    cm.start();

    vi.advanceTimersByTime(3000); // first ping
    signaling._emit('pong', { t: Date.now() - 50 }); // pong arrives

    vi.advanceTimersByTime(3500); // second tick, but pong was recent
    expect(timeoutCalls.length).toBe(0);

    cm.destroy();
  });

  it('stop() clears ping interval', () => {
    const signaling = makeSignaling();
    const cm = new ConnectionMonitor(signaling);

    cm.start();
    cm.stop();

    vi.advanceTimersByTime(10000);
    expect(signaling.send).not.toHaveBeenCalled();
  });

  it('sendPing() sends a ping message', () => {
    const signaling = makeSignaling();
    const cm = new ConnectionMonitor(signaling);

    cm.sendPing();

    expect(signaling.send).toHaveBeenCalledTimes(1);
    expect(signaling.send.mock.calls[0][0].type).toBe('ping');
  });

  it('destroy() cleans up', () => {
    const signaling = makeSignaling();
    const cm = new ConnectionMonitor(signaling);

    cm.start();
    cm.destroy();

    expect(signaling._handlers.has('pong')).toBe(false);
    expect(cm._pingInterval).toBeNull();
    expect(cm._onTimeout).toBeNull();
  });
});
