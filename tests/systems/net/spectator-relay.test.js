import { describe, expect, it, vi } from 'vitest';
import { SpectatorRelay } from '../../../src/systems/net/SpectatorRelay.js';

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

describe('SpectatorRelay', () => {
  describe('send methods', () => {
    it('sendSync sends sync message with spread state', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);

      sr.sendSync({ frame: 10, hp1: 100, hp2: 80 });

      expect(signaling.send).toHaveBeenCalledWith({
        type: 'sync',
        frame: 10,
        hp1: 100,
        hp2: 80,
      });
    });

    it('sendRoundEvent sends round_event message', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);

      sr.sendRoundEvent({ roundType: 'ko', winnerIndex: 0 });

      expect(signaling.send).toHaveBeenCalledWith({
        type: 'round_event',
        roundType: 'ko',
        winnerIndex: 0,
      });
    });

    it('sendShout sends shout message', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);

      sr.sendShout('vamos!');

      expect(signaling.send).toHaveBeenCalledWith({ type: 'shout', text: 'vamos!' });
    });

    it('sendPotion sends potion message', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);

      sr.sendPotion(0, 'hp');

      expect(signaling.send).toHaveBeenCalledWith({
        type: 'potion',
        target: 0,
        potionType: 'hp',
      });
    });
  });

  describe('receive callbacks', () => {
    it('fires onSync callback', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onSync((msg) => received.push(msg));

      signaling._emit('sync', { type: 'sync', frame: 10, hp1: 100 });

      expect(received.length).toBe(1);
      expect(received[0].frame).toBe(10);
    });

    it('fires onRoundEvent callback', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onRoundEvent((msg) => received.push(msg));

      signaling._emit('round_event', { type: 'round_event', winnerIndex: 1 });

      expect(received.length).toBe(1);
      expect(received[0].winnerIndex).toBe(1);
    });

    it('fires onAssignSpectator with count', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onAssignSpectator((count) => received.push(count));

      signaling._emit('assign_spectator', { type: 'assign_spectator', spectatorCount: 3 });

      expect(received).toEqual([3]);
    });

    it('fires onSpectatorCount', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onSpectatorCount((count) => received.push(count));

      signaling._emit('spectator_count', { type: 'spectator_count', count: 5 });

      expect(received).toEqual([5]);
    });

    it('fires onShout with text', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onShout((text) => received.push(text));

      signaling._emit('shout', { type: 'shout', text: 'dale!' });

      expect(received).toEqual(['dale!']);
    });

    it('fires onFightState', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onFightState((msg) => received.push(msg));

      signaling._emit('fight_state', { type: 'fight_state', p1Id: 'simon', p2Id: 'jeka' });

      expect(received.length).toBe(1);
      expect(received[0].p1Id).toBe('simon');
    });

    it('fires onPotionApplied with target and type', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onPotionApplied((target, potionType) => received.push({ target, potionType }));

      signaling._emit('potion_applied', {
        type: 'potion_applied',
        target: 1,
        potionType: 'special',
      });

      expect(received).toEqual([{ target: 1, potionType: 'special' }]);
    });

    it('fires onPotion with target and type', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);
      const received = [];
      sr.onPotion((target, potionType) => received.push({ target, potionType }));

      signaling._emit('potion', { type: 'potion', target: 0, potionType: 'hp' });

      expect(received).toEqual([{ target: 0, potionType: 'hp' }]);
    });

    it('does not throw when no callback registered', () => {
      const signaling = makeSignaling();
      new SpectatorRelay(signaling);

      expect(() => signaling._emit('sync', { type: 'sync' })).not.toThrow();
      expect(() => signaling._emit('shout', { type: 'shout', text: 'x' })).not.toThrow();
    });
  });

  describe('reset', () => {
    it('clears scene-specific callbacks but keeps spectator identity callbacks', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);

      sr.onSync(() => {});
      sr.onRoundEvent(() => {});
      sr.onShout(() => {});
      sr.onAssignSpectator(() => {});
      sr.onSpectatorCount(() => {});

      sr.reset();

      expect(sr._onSync).toBeNull();
      expect(sr._onRoundEvent).toBeNull();
      expect(sr._onShout).toBeNull();
      // These persist across scene transitions
      expect(sr._onAssignSpectator).not.toBeNull();
      expect(sr._onSpectatorCount).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('unregisters all handlers from signaling', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);

      sr.destroy();

      expect(signaling._handlers.has('sync')).toBe(false);
      expect(signaling._handlers.has('round_event')).toBe(false);
      expect(signaling._handlers.has('shout')).toBe(false);
      expect(signaling._handlers.has('potion')).toBe(false);
    });

    it('nulls all callbacks', () => {
      const signaling = makeSignaling();
      const sr = new SpectatorRelay(signaling);

      sr.onSync(() => {});
      sr.onAssignSpectator(() => {});

      sr.destroy();

      expect(sr._onSync).toBeNull();
      expect(sr._onAssignSpectator).toBeNull();
    });
  });
});
