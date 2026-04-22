import { describe, expect, it } from 'vitest';
import {
  MatchEvent,
  MatchState,
  MatchStateMachine,
} from '../../apps/game-vite/src/systems/MatchStateMachine.js';

describe('MatchStateMachine', () => {
  describe('initial state', () => {
    it('defaults to MAIN_MENU', () => {
      const sm = new MatchStateMachine();
      expect(sm.state).toBe(MatchState.MAIN_MENU);
    });

    it('accepts custom initial state', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });
  });

  describe('online match flow', () => {
    it('transitions through full online match lifecycle', () => {
      const sm = new MatchStateMachine();

      sm.transition(MatchEvent.CREATE_ROOM);
      expect(sm.state).toBe(MatchState.LOBBY);

      sm.transition(MatchEvent.ASSIGNED_SLOT);
      expect(sm.state).toBe(MatchState.WAITING_FOR_OPPONENT);

      sm.transition(MatchEvent.OPPONENT_JOINED);
      expect(sm.state).toBe(MatchState.CHARACTER_SELECT);

      sm.transition(MatchEvent.BOTH_READY);
      expect(sm.state).toBe(MatchState.LOADING);

      sm.transition(MatchEvent.ASSETS_LOADED_ONLINE);
      expect(sm.state).toBe(MatchState.SYNCHRONIZING);

      sm.transition(MatchEvent.SYNC_CONFIRMED);
      expect(sm.state).toBe(MatchState.ROUND_INTRO);

      sm.transition(MatchEvent.INTRO_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);

      sm.transition(MatchEvent.ROUND_OVER);
      expect(sm.state).toBe(MatchState.ROUND_END);

      sm.transition(MatchEvent.MATCH_OVER);
      expect(sm.state).toBe(MatchState.MATCH_END);

      sm.transition(MatchEvent.TRANSITION_COMPLETE);
      expect(sm.state).toBe(MatchState.RESULTS);

      sm.transition(MatchEvent.LEAVE);
      expect(sm.state).toBe(MatchState.MAIN_MENU);
    });
  });

  describe('local match flow', () => {
    it('transitions through local match lifecycle', () => {
      const sm = new MatchStateMachine();

      sm.transition(MatchEvent.PLAY_LOCAL);
      expect(sm.state).toBe(MatchState.LOCAL_SELECT);

      sm.transition(MatchEvent.BOTH_FIGHTERS_CHOSEN);
      expect(sm.state).toBe(MatchState.LOADING);

      sm.transition(MatchEvent.ASSETS_LOADED_LOCAL);
      expect(sm.state).toBe(MatchState.ROUND_INTRO);

      sm.transition(MatchEvent.INTRO_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });
  });

  describe('reconnection flow', () => {
    it('ROUND_ACTIVE → RECONNECTING → ROUND_ACTIVE', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);

      sm.transition(MatchEvent.CONNECTION_LOST);
      expect(sm.state).toBe(MatchState.RECONNECTING);

      sm.transition(MatchEvent.OPPONENT_RECONNECTED);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });

    it('RECONNECTING → DISCONNECTED → CHARACTER_SELECT', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);

      sm.transition(MatchEvent.CONNECTION_LOST);
      sm.transition(MatchEvent.GRACE_EXPIRED);
      expect(sm.state).toBe(MatchState.DISCONNECTED);

      sm.transition(MatchEvent.RETURN_TO_SELECT);
      expect(sm.state).toBe(MatchState.CHARACTER_SELECT);
    });

    it('DISCONNECTED → MAIN_MENU via full disconnect', () => {
      const sm = new MatchStateMachine(MatchState.DISCONNECTED);
      sm.transition(MatchEvent.FULL_DISCONNECT);
      expect(sm.state).toBe(MatchState.MAIN_MENU);
    });
  });

  describe('pause flow (local only)', () => {
    it('ROUND_ACTIVE → PAUSED → ROUND_ACTIVE', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);
      sm.transition(MatchEvent.PAUSE);
      expect(sm.state).toBe(MatchState.PAUSED);

      sm.transition(MatchEvent.RESUME);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });

    it('PAUSED → MAIN_MENU via quit', () => {
      const sm = new MatchStateMachine(MatchState.PAUSED);
      sm.transition(MatchEvent.QUIT);
      expect(sm.state).toBe(MatchState.MAIN_MENU);
    });
  });

  describe('round transitions', () => {
    it('ROUND_END → ROUND_INTRO for next round', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_END);
      sm.transition(MatchEvent.TRANSITION_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_INTRO);
    });

    it('ROUND_END → MATCH_END when match over', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_END);
      sm.transition(MatchEvent.MATCH_OVER);
      expect(sm.state).toBe(MatchState.MATCH_END);
    });

    it('RESULTS → CHARACTER_SELECT on rematch', () => {
      const sm = new MatchStateMachine(MatchState.RESULTS);
      sm.transition(MatchEvent.REMATCH);
      expect(sm.state).toBe(MatchState.CHARACTER_SELECT);
    });
  });

  describe('opponent disconnect during select', () => {
    it('CHARACTER_SELECT → WAITING_FOR_OPPONENT', () => {
      const sm = new MatchStateMachine(MatchState.CHARACTER_SELECT);
      sm.transition(MatchEvent.OPPONENT_DISCONNECTED);
      expect(sm.state).toBe(MatchState.WAITING_FOR_OPPONENT);
    });
  });

  describe('sync timeout', () => {
    it('SYNCHRONIZING → DISCONNECTED on timeout', () => {
      const sm = new MatchStateMachine(MatchState.SYNCHRONIZING);
      sm.transition(MatchEvent.SYNC_TIMEOUT);
      expect(sm.state).toBe(MatchState.DISCONNECTED);
    });
  });

  describe('invalid transitions', () => {
    it('throws on invalid event for current state', () => {
      const sm = new MatchStateMachine();
      expect(() => sm.transition(MatchEvent.ROUND_OVER)).toThrow('Invalid transition');
    });

    it('error message includes current state and valid events', () => {
      const sm = new MatchStateMachine();
      expect(() => sm.transition(MatchEvent.ROUND_OVER)).toThrow('MAIN_MENU');
    });
  });

  describe('canTransition', () => {
    it('returns true for valid transition', () => {
      const sm = new MatchStateMachine();
      expect(sm.canTransition(MatchEvent.PLAY_LOCAL)).toBe(true);
    });

    it('returns false for invalid transition', () => {
      const sm = new MatchStateMachine();
      expect(sm.canTransition(MatchEvent.ROUND_OVER)).toBe(false);
    });
  });

  describe('onTransition callback', () => {
    it('fires on every transition with from, to, event', () => {
      const sm = new MatchStateMachine();
      const calls = [];
      sm.onTransition((from, to, event) => calls.push({ from, to, event }));

      sm.transition(MatchEvent.PLAY_LOCAL);
      sm.transition(MatchEvent.BOTH_FIGHTERS_CHOSEN);

      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({
        from: MatchState.MAIN_MENU,
        to: MatchState.LOCAL_SELECT,
        event: MatchEvent.PLAY_LOCAL,
      });
      expect(calls[1]).toEqual({
        from: MatchState.LOCAL_SELECT,
        to: MatchState.LOADING,
        event: MatchEvent.BOTH_FIGHTERS_CHOSEN,
      });
    });

    it('unsubscribe stops callbacks', () => {
      const sm = new MatchStateMachine();
      const calls = [];
      const unsub = sm.onTransition(() => calls.push(1));

      sm.transition(MatchEvent.PLAY_LOCAL);
      expect(calls).toHaveLength(1);

      unsub();
      sm.transition(MatchEvent.BOTH_FIGHTERS_CHOSEN);
      expect(calls).toHaveLength(1); // no new call
    });
  });

  describe('forceState', () => {
    it('sets state without validation', () => {
      const sm = new MatchStateMachine();
      sm.forceState(MatchState.ROUND_ACTIVE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });
  });
});
