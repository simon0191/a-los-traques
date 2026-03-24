import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectionManager } from '../../src/systems/ReconnectionManager.js';

describe('ReconnectionManager', () => {
  let clock;
  let rm;

  beforeEach(() => {
    clock = { value: 1000 };
    rm = new ReconnectionManager({
      gracePeriodMs: 5000,
      now: () => clock.value,
    });
  });

  describe('initial state', () => {
    it('starts in connected state', () => {
      expect(rm.state).toBe('connected');
      expect(rm.isReconnecting()).toBe(false);
      expect(rm.elapsed()).toBe(0);
    });
  });

  describe('handleConnectionLost', () => {
    it('transitions to reconnecting and fires onPause', () => {
      const onPause = vi.fn();
      rm.onPause(onPause);

      rm.handleConnectionLost();

      expect(rm.state).toBe('reconnecting');
      expect(rm.isReconnecting()).toBe(true);
      expect(onPause).toHaveBeenCalledOnce();
    });

    it('resets timer when already reconnecting without re-firing onPause', () => {
      const onPause = vi.fn();
      rm.onPause(onPause);

      rm.handleConnectionLost();
      clock.value = 3000; // 2000ms elapsed
      rm.handleConnectionLost(); // re-entrant: resets timer

      expect(onPause).toHaveBeenCalledOnce();
      expect(rm.elapsed()).toBe(0); // timer reset to current time
    });

    it('re-entrant timer reset extends grace period from latest event', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleConnectionLost(); // t=1000
      clock.value = 4000; // 3000ms elapsed
      rm.handleConnectionLost(); // reset timer to t=4000

      clock.value = 8999; // 4999ms since reset (< 5000)
      rm.tick();
      expect(rm.state).toBe('reconnecting');

      clock.value = 9000; // 5000ms since reset (= gracePeriodMs)
      rm.tick();
      expect(rm.state).toBe('disconnected');
      expect(onDisconnect).toHaveBeenCalledOnce();
    });
  });

  describe('handleOpponentReconnecting', () => {
    it('transitions to reconnecting and fires onPause', () => {
      const onPause = vi.fn();
      rm.onPause(onPause);

      rm.handleOpponentReconnecting();

      expect(rm.state).toBe('reconnecting');
      expect(onPause).toHaveBeenCalledOnce();
    });

    it('resets timer when already reconnecting without re-firing onPause', () => {
      const onPause = vi.fn();
      rm.onPause(onPause);

      rm.handleOpponentReconnecting();
      clock.value = 3000;
      rm.handleOpponentReconnecting();

      expect(onPause).toHaveBeenCalledOnce();
      expect(rm.elapsed()).toBe(0);
    });

    it('simultaneous disconnect: grace period runs from latest event', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleConnectionLost(); // t=1000
      clock.value = 3000;
      rm.handleOpponentReconnecting(); // reset timer to t=3000

      clock.value = 7999; // 4999ms since reset
      rm.tick();
      expect(rm.state).toBe('reconnecting');

      clock.value = 8000; // 5000ms since reset
      rm.tick();
      expect(rm.state).toBe('disconnected');
    });
  });

  describe('elapsed', () => {
    it('returns ms since reconnect started', () => {
      rm.handleConnectionLost();
      clock.value = 2500;
      expect(rm.elapsed()).toBe(1500);
    });

    it('returns 0 when connected', () => {
      expect(rm.elapsed()).toBe(0);
    });
  });

  describe('grace period timeout', () => {
    it('tick before timeout stays reconnecting', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleConnectionLost();
      clock.value = 5999; // 4999ms elapsed (< 5000)
      rm.tick();

      expect(rm.state).toBe('reconnecting');
      expect(onDisconnect).not.toHaveBeenCalled();
    });

    it('tick at exactly gracePeriodMs transitions to disconnected', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleConnectionLost();
      clock.value = 6000; // 5000ms elapsed (= gracePeriodMs)
      rm.tick();

      expect(rm.state).toBe('disconnected');
      expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it('tick after gracePeriodMs transitions to disconnected', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleConnectionLost();
      clock.value = 7000;
      rm.tick();

      expect(rm.state).toBe('disconnected');
      expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it('tick is no-op when connected', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      clock.value = 999999;
      rm.tick();

      expect(rm.state).toBe('connected');
      expect(onDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('successful reconnection', () => {
    it('handleConnectionRestored + handleOpponentReconnected → connected, fires onResume', () => {
      const onResume = vi.fn();
      rm.onResume(onResume);

      rm.handleConnectionLost();
      expect(rm.state).toBe('reconnecting');

      rm.handleConnectionRestored();
      expect(rm.state).toBe('reconnecting');
      expect(onResume).not.toHaveBeenCalled();

      rm.handleOpponentReconnected();
      expect(rm.state).toBe('connected');
      expect(onResume).toHaveBeenCalledOnce();
    });

    it('handleConnectionRestored alone does NOT fire onResume', () => {
      const onResume = vi.fn();
      rm.onResume(onResume);

      rm.handleConnectionLost();
      rm.handleConnectionRestored();

      expect(rm.state).toBe('reconnecting');
      expect(onResume).not.toHaveBeenCalled();
    });

    it('handleOpponentReconnected without handleConnectionRestored still resumes', () => {
      // Opponent dropped and came back; our connection was fine
      const onResume = vi.fn();
      rm.onResume(onResume);

      rm.handleOpponentReconnecting();
      expect(rm.state).toBe('reconnecting');

      rm.handleOpponentReconnected();
      expect(rm.state).toBe('connected');
      expect(onResume).toHaveBeenCalledOnce();
    });
  });

  describe('handleOpponentDisconnected', () => {
    it('transitions to disconnected from reconnecting', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleOpponentReconnecting();
      rm.handleOpponentDisconnected();

      expect(rm.state).toBe('disconnected');
      expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it('transitions to disconnected from connected', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleOpponentDisconnected();

      expect(rm.state).toBe('disconnected');
      expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it('is idempotent when already disconnected', () => {
      const onDisconnect = vi.fn();
      rm.onDisconnect(onDisconnect);

      rm.handleOpponentDisconnected();
      rm.handleOpponentDisconnected();

      expect(onDisconnect).toHaveBeenCalledOnce();
    });
  });

  describe('multiple reconnection cycles', () => {
    it('grace period resets on each new reconnection', () => {
      const onPause = vi.fn();
      const onResume = vi.fn();
      const onDisconnect = vi.fn();
      rm.onPause(onPause);
      rm.onResume(onResume);
      rm.onDisconnect(onDisconnect);

      // First cycle
      rm.handleConnectionLost();
      clock.value = 3000;
      rm.tick();
      expect(rm.state).toBe('reconnecting');

      rm.handleConnectionRestored();
      rm.handleOpponentReconnected();
      expect(rm.state).toBe('connected');

      // Second cycle — grace timer should start fresh
      clock.value = 10000;
      rm.handleConnectionLost();
      expect(rm.state).toBe('reconnecting');

      clock.value = 14999; // 4999ms elapsed (< 5000)
      rm.tick();
      expect(rm.state).toBe('reconnecting');

      clock.value = 15000; // 5000ms elapsed (= gracePeriodMs)
      rm.tick();
      expect(rm.state).toBe('disconnected');

      expect(onPause).toHaveBeenCalledTimes(2);
      expect(onResume).toHaveBeenCalledOnce();
      expect(onDisconnect).toHaveBeenCalledOnce();
    });
  });

  describe('destroy', () => {
    it('clears callbacks and makes tick a no-op', () => {
      const onPause = vi.fn();
      const onDisconnect = vi.fn();
      rm.onPause(onPause);
      rm.onDisconnect(onDisconnect);

      rm.handleConnectionLost();
      rm.destroy();

      clock.value = 999999;
      rm.tick();

      // Should not fire disconnect after destroy
      expect(onDisconnect).not.toHaveBeenCalled();
      // onPause was called before destroy
      expect(onPause).toHaveBeenCalledOnce();
    });

    it('ignores all events after destroy', () => {
      const onPause = vi.fn();
      rm.onPause(onPause);

      rm.destroy();
      rm.handleConnectionLost();
      rm.handleOpponentReconnecting();
      rm.handleConnectionRestored();
      rm.handleOpponentReconnected();
      rm.handleOpponentDisconnected();

      expect(rm.state).toBe('connected');
      expect(onPause).not.toHaveBeenCalled();
    });
  });

  describe('no-op in wrong states', () => {
    it('handleConnectionRestored is no-op when connected', () => {
      rm.handleConnectionRestored();
      expect(rm.state).toBe('connected');
    });

    it('handleOpponentReconnected is no-op when connected', () => {
      const onResume = vi.fn();
      rm.onResume(onResume);

      rm.handleOpponentReconnected();
      expect(rm.state).toBe('connected');
      expect(onResume).not.toHaveBeenCalled();
    });

    it('handleConnectionLost is no-op when disconnected', () => {
      const onPause = vi.fn();
      rm.onPause(onPause);

      rm.handleOpponentDisconnected();
      expect(rm.state).toBe('disconnected');

      rm.handleConnectionLost();
      expect(rm.state).toBe('disconnected');
      expect(onPause).not.toHaveBeenCalled();
    });
  });
});
