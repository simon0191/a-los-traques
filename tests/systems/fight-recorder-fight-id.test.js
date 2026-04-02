import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FightRecorder } from '../../src/systems/FightRecorder.js';

describe('FightRecorder - fightId', () => {
  let originalFightLog;

  beforeEach(() => {
    originalFightLog = globalThis.window?.__FIGHT_LOG;
    globalThis.window = globalThis.window || {};
  });

  afterEach(() => {
    if (originalFightLog !== undefined) {
      globalThis.window.__FIGHT_LOG = originalFightLog;
    } else {
      delete globalThis.window?.__FIGHT_LOG;
    }
  });

  it('stores fightId in the log', () => {
    const recorder = new FightRecorder({
      fightId: 'test-fight-uuid',
      roomId: 'ABCD',
      playerSlot: 0,
      fighterId: 'simon',
      opponentId: 'paula',
      stageId: 'beach',
    });
    expect(recorder.log.fightId).toBe('test-fight-uuid');
  });

  it('exposes fightId via window.__FIGHT_LOG', () => {
    new FightRecorder({
      fightId: 'test-fight-uuid',
      roomId: 'ABCD',
      playerSlot: 0,
      fighterId: 'simon',
      opponentId: 'paula',
      stageId: 'beach',
    });
    expect(window.__FIGHT_LOG.fightId).toBe('test-fight-uuid');
  });

  it('is backward-compatible when fightId is not provided', () => {
    const recorder = new FightRecorder({
      roomId: 'ABCD',
      playerSlot: 0,
      fighterId: 'simon',
      opponentId: 'paula',
      stageId: 'beach',
    });
    expect(recorder.log.fightId).toBeUndefined();
    // Other fields still work
    expect(recorder.log.roomId).toBe('ABCD');
    expect(recorder.log.playerSlot).toBe(0);
  });
});
