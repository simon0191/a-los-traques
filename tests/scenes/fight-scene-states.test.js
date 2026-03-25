import { describe, expect, it } from 'vitest';
import { MatchEvent, MatchState, MatchStateMachine } from '../../src/systems/MatchStateMachine.js';

/**
 * Tests validating the MatchStateMachine transition sequences used by FightScene.
 * These are pure SM tests (no Phaser) — they verify that FightScene's event-firing
 * patterns produce correct state sequences for every game mode.
 */
describe('FightScene state machine transitions', () => {
  describe('local match full lifecycle', () => {
    it('transitions through 2 rounds ending in match over', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_INTRO);

      // Round 1 start
      sm.transition(MatchEvent.INTRO_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);

      // Round 1 end (KO)
      sm.transition(MatchEvent.ROUND_OVER);
      expect(sm.state).toBe(MatchState.ROUND_END);

      // Next round transition
      sm.transition(MatchEvent.TRANSITION_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_INTRO);

      // Round 2 start
      sm.transition(MatchEvent.INTRO_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);

      // Round 2 end → match over
      sm.transition(MatchEvent.ROUND_OVER);
      expect(sm.state).toBe(MatchState.ROUND_END);

      sm.transition(MatchEvent.MATCH_OVER);
      expect(sm.state).toBe(MatchState.MATCH_END);
    });
  });

  describe('pause flow', () => {
    it('pauses and resumes during ROUND_ACTIVE', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);

      sm.transition(MatchEvent.PAUSE);
      expect(sm.state).toBe(MatchState.PAUSED);

      sm.transition(MatchEvent.RESUME);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });

    it('quits from pause to MAIN_MENU', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);

      sm.transition(MatchEvent.PAUSE);
      expect(sm.state).toBe(MatchState.PAUSED);

      sm.transition(MatchEvent.QUIT);
      expect(sm.state).toBe(MatchState.MAIN_MENU);
    });
  });

  describe('online reconnection', () => {
    it('reconnects successfully from ROUND_ACTIVE', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);

      sm.transition(MatchEvent.CONNECTION_LOST);
      expect(sm.state).toBe(MatchState.RECONNECTING);

      sm.transition(MatchEvent.OPPONENT_RECONNECTED);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });

    it('disconnects after grace period expires', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);

      sm.transition(MatchEvent.CONNECTION_LOST);
      expect(sm.state).toBe(MatchState.RECONNECTING);

      sm.transition(MatchEvent.GRACE_EXPIRED);
      expect(sm.state).toBe(MatchState.DISCONNECTED);
    });

    it('recovers from DISCONNECTED to CHARACTER_SELECT', () => {
      const sm = new MatchStateMachine(MatchState.DISCONNECTED);

      sm.transition(MatchEvent.RETURN_TO_SELECT);
      expect(sm.state).toBe(MatchState.CHARACTER_SELECT);
    });

    it('reconnects from ROUND_END (connection lost during transition)', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_END);

      sm.transition(MatchEvent.CONNECTION_LOST);
      expect(sm.state).toBe(MatchState.RECONNECTING);

      // Always resumes to ROUND_ACTIVE regardless of previous state
      sm.transition(MatchEvent.OPPONENT_RECONNECTED);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });
  });

  describe('canTransition guards', () => {
    it('cannot reconnect while paused', () => {
      const sm = new MatchStateMachine(MatchState.PAUSED);
      expect(sm.canTransition(MatchEvent.CONNECTION_LOST)).toBe(false);
    });

    it('cannot pause while reconnecting', () => {
      const sm = new MatchStateMachine(MatchState.RECONNECTING);
      expect(sm.canTransition(MatchEvent.PAUSE)).toBe(false);
    });

    it('cannot fire ROUND_OVER from MATCH_END', () => {
      const sm = new MatchStateMachine(MatchState.MATCH_END);
      expect(sm.canTransition(MatchEvent.ROUND_OVER)).toBe(false);
    });
  });

  describe('rapid sequential transitions', () => {
    it('handles ROUND_OVER + MATCH_OVER in same frame', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_ACTIVE);

      // Both transitions fire during same simulation tick
      sm.transition(MatchEvent.ROUND_OVER);
      expect(sm.state).toBe(MatchState.ROUND_END);

      sm.transition(MatchEvent.MATCH_OVER);
      expect(sm.state).toBe(MatchState.MATCH_END);
    });

    it('handles TRANSITION_COMPLETE + INTRO_COMPLETE in same frame (online round reset)', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_END);

      sm.transition(MatchEvent.TRANSITION_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_INTRO);

      sm.transition(MatchEvent.INTRO_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);
    });
  });

  describe('replay mode uses same states as local', () => {
    it('follows identical lifecycle as local match', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_INTRO);

      // Replay starts at ROUND_INTRO, immediately goes to ROUND_ACTIVE
      sm.transition(MatchEvent.INTRO_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);

      // Round ends
      sm.transition(MatchEvent.ROUND_OVER);
      expect(sm.state).toBe(MatchState.ROUND_END);

      // After cooldown, next round
      sm.transition(MatchEvent.TRANSITION_COMPLETE);
      sm.transition(MatchEvent.INTRO_COMPLETE);
      expect(sm.state).toBe(MatchState.ROUND_ACTIVE);

      // Final round ends
      sm.transition(MatchEvent.ROUND_OVER);
      sm.transition(MatchEvent.MATCH_OVER);
      expect(sm.state).toBe(MatchState.MATCH_END);
    });
  });

  describe('onTransition callback', () => {
    it('fires with correct arguments during FightScene lifecycle', () => {
      const sm = new MatchStateMachine(MatchState.ROUND_INTRO);
      const transitions = [];
      sm.onTransition((from, to, event) => transitions.push({ from, to, event }));

      sm.transition(MatchEvent.INTRO_COMPLETE);
      sm.transition(MatchEvent.ROUND_OVER);

      expect(transitions).toEqual([
        { from: MatchState.ROUND_INTRO, to: MatchState.ROUND_ACTIVE, event: MatchEvent.INTRO_COMPLETE },
        { from: MatchState.ROUND_ACTIVE, to: MatchState.ROUND_END, event: MatchEvent.ROUND_OVER },
      ]);
    });
  });
});
