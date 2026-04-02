import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchTelemetry } from '../../src/systems/MatchTelemetry.js';

describe('MatchTelemetry', () => {
  let telemetry;

  beforeEach(() => {
    vi.useFakeTimers();
    telemetry = new MatchTelemetry('test-room');
  });

  afterEach(() => {
    telemetry.destroy();
    vi.useRealTimers();
  });

  it('initializes with default values', () => {
    const data = telemetry.toJSON();
    expect(data.matchId).toBe('test-room');
    expect(data.rollbackCount).toBe(0);
    expect(data.maxRollbackDepth).toBe(0);
    expect(data.desyncCount).toBe(0);
    expect(data.transportMode).toBe('websocket');
  });

  it('tracks rollbacks', () => {
    telemetry.recordRollback(100, 3);
    telemetry.recordRollback(105, 5);
    telemetry.recordRollback(110, 2);

    const data = telemetry.toJSON();
    expect(data.rollbackCount).toBe(3);
    expect(data.maxRollbackDepth).toBe(5);
  });

  it('tracks desyncs and resyncs', () => {
    telemetry.recordDesync();
    telemetry.recordDesync();
    telemetry.recordResync();

    const data = telemetry.toJSON();
    expect(data.desyncCount).toBe(2);
    expect(data.resyncCount).toBe(1);
  });

  it('tracks transport changes', () => {
    telemetry.recordTransportChange('webrtc');
    telemetry.recordTransportChange('webrtc'); // duplicate, no change
    telemetry.recordTransportChange('websocket');

    const data = telemetry.toJSON();
    expect(data.transportMode).toBe('websocket');
    expect(data.transportChanges).toBe(2);
  });

  it('samples RTT from connection monitor', () => {
    const mockMonitor = { rtt: 50 };
    telemetry.wireConnectionMonitor(mockMonitor);

    vi.advanceTimersByTime(3000);
    expect(telemetry.rttSamples).toHaveLength(1);
    expect(telemetry.rttSamples[0]).toBe(50);

    mockMonitor.rtt = 100;
    vi.advanceTimersByTime(3000);

    const data = telemetry.toJSON();
    expect(data.rttSamples).toHaveLength(2);
    expect(data.rttMin).toBe(50);
    expect(data.rttMax).toBe(100);
    expect(data.rttAvg).toBe(75);
  });

  it('caps RTT samples at 60', () => {
    const mockMonitor = { rtt: 42 };
    telemetry.wireConnectionMonitor(mockMonitor);

    for (let i = 0; i < 65; i++) {
      vi.advanceTimersByTime(3000);
    }

    expect(telemetry.rttSamples).toHaveLength(60);
  });

  it('skips RTT sample when rtt is 0', () => {
    const mockMonitor = { rtt: 0 };
    telemetry.wireConnectionMonitor(mockMonitor);

    vi.advanceTimersByTime(3000);
    expect(telemetry.rttSamples).toHaveLength(0);
  });

  it('tracks disconnections and reconnections', () => {
    telemetry.recordDisconnection();
    telemetry.recordReconnection();
    telemetry.recordDisconnection();

    const data = telemetry.toJSON();
    expect(data.disconnectionCount).toBe(2);
    expect(data.reconnectionCount).toBe(1);
  });

  it('computes matchDurationMs', () => {
    vi.advanceTimersByTime(5000);
    const data = telemetry.toJSON();
    expect(data.matchDurationMs).toBeGreaterThanOrEqual(5000);
  });

  it('returns 0 for rttMin when no samples', () => {
    const data = telemetry.toJSON();
    expect(data.rttMin).toBe(0);
    expect(data.rttAvg).toBe(0);
  });
});
