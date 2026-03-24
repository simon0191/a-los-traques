/**
 * Formal game state machine for match lifecycle.
 * Pure module — no Phaser dependency.
 *
 * Single enum value answers "what state is the match in?"
 * All transitions are validated — invalid transitions throw.
 */

export const MatchState = {
  MAIN_MENU: 'MAIN_MENU',
  LOBBY: 'LOBBY',
  WAITING_FOR_OPPONENT: 'WAITING_FOR_OPPONENT',
  CHARACTER_SELECT: 'CHARACTER_SELECT',
  LOCAL_SELECT: 'LOCAL_SELECT',
  LOADING: 'LOADING',
  SYNCHRONIZING: 'SYNCHRONIZING',
  ROUND_INTRO: 'ROUND_INTRO',
  ROUND_ACTIVE: 'ROUND_ACTIVE',
  ROUND_END: 'ROUND_END',
  MATCH_END: 'MATCH_END',
  RESULTS: 'RESULTS',
  PAUSED: 'PAUSED',
  RECONNECTING: 'RECONNECTING',
  DISCONNECTED: 'DISCONNECTED',
};

export const MatchEvent = {
  CREATE_ROOM: 'CREATE_ROOM',
  JOIN_ROOM: 'JOIN_ROOM',
  PLAY_LOCAL: 'PLAY_LOCAL',
  ASSIGNED_SLOT: 'ASSIGNED_SLOT',
  OPPONENT_JOINED: 'OPPONENT_JOINED',
  CANCEL: 'CANCEL',
  TIMEOUT: 'TIMEOUT',
  LEAVE: 'LEAVE',
  BOTH_READY: 'BOTH_READY',
  BOTH_FIGHTERS_CHOSEN: 'BOTH_FIGHTERS_CHOSEN',
  OPPONENT_DISCONNECTED: 'OPPONENT_DISCONNECTED',
  ASSETS_LOADED_ONLINE: 'ASSETS_LOADED_ONLINE',
  ASSETS_LOADED_LOCAL: 'ASSETS_LOADED_LOCAL',
  SYNC_CONFIRMED: 'SYNC_CONFIRMED',
  SYNC_TIMEOUT: 'SYNC_TIMEOUT',
  INTRO_COMPLETE: 'INTRO_COMPLETE',
  ROUND_OVER: 'ROUND_OVER',
  CONNECTION_LOST: 'CONNECTION_LOST',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  QUIT: 'QUIT',
  TRANSITION_COMPLETE: 'TRANSITION_COMPLETE',
  MATCH_OVER: 'MATCH_OVER',
  REMATCH: 'REMATCH',
  OPPONENT_RECONNECTED: 'OPPONENT_RECONNECTED',
  GRACE_EXPIRED: 'GRACE_EXPIRED',
  RETURN_TO_SELECT: 'RETURN_TO_SELECT',
  FULL_DISCONNECT: 'FULL_DISCONNECT',
};

/**
 * Transition table: { [currentState]: { [event]: nextState } }
 */
const TRANSITIONS = {
  [MatchState.MAIN_MENU]: {
    [MatchEvent.CREATE_ROOM]: MatchState.LOBBY,
    [MatchEvent.JOIN_ROOM]: MatchState.LOBBY,
    [MatchEvent.PLAY_LOCAL]: MatchState.LOCAL_SELECT,
  },

  [MatchState.LOBBY]: {
    [MatchEvent.ASSIGNED_SLOT]: MatchState.WAITING_FOR_OPPONENT,
  },

  [MatchState.WAITING_FOR_OPPONENT]: {
    [MatchEvent.OPPONENT_JOINED]: MatchState.CHARACTER_SELECT,
    [MatchEvent.CANCEL]: MatchState.MAIN_MENU,
    [MatchEvent.TIMEOUT]: MatchState.MAIN_MENU,
  },

  [MatchState.CHARACTER_SELECT]: {
    [MatchEvent.BOTH_READY]: MatchState.LOADING,
    [MatchEvent.OPPONENT_DISCONNECTED]: MatchState.WAITING_FOR_OPPONENT,
    [MatchEvent.LEAVE]: MatchState.MAIN_MENU,
  },

  [MatchState.LOCAL_SELECT]: {
    [MatchEvent.BOTH_FIGHTERS_CHOSEN]: MatchState.LOADING,
    [MatchEvent.LEAVE]: MatchState.MAIN_MENU,
  },

  [MatchState.LOADING]: {
    [MatchEvent.ASSETS_LOADED_ONLINE]: MatchState.SYNCHRONIZING,
    [MatchEvent.ASSETS_LOADED_LOCAL]: MatchState.ROUND_INTRO,
  },

  [MatchState.SYNCHRONIZING]: {
    [MatchEvent.SYNC_CONFIRMED]: MatchState.ROUND_INTRO,
    [MatchEvent.SYNC_TIMEOUT]: MatchState.DISCONNECTED,
  },

  [MatchState.ROUND_INTRO]: {
    [MatchEvent.INTRO_COMPLETE]: MatchState.ROUND_ACTIVE,
  },

  [MatchState.ROUND_ACTIVE]: {
    [MatchEvent.ROUND_OVER]: MatchState.ROUND_END,
    [MatchEvent.CONNECTION_LOST]: MatchState.RECONNECTING,
    [MatchEvent.PAUSE]: MatchState.PAUSED,
  },

  [MatchState.PAUSED]: {
    [MatchEvent.RESUME]: MatchState.ROUND_ACTIVE,
    [MatchEvent.QUIT]: MatchState.MAIN_MENU,
  },

  [MatchState.ROUND_END]: {
    [MatchEvent.TRANSITION_COMPLETE]: MatchState.ROUND_INTRO,
    [MatchEvent.MATCH_OVER]: MatchState.MATCH_END,
    [MatchEvent.CONNECTION_LOST]: MatchState.RECONNECTING,
  },

  [MatchState.MATCH_END]: {
    [MatchEvent.TRANSITION_COMPLETE]: MatchState.RESULTS,
  },

  [MatchState.RESULTS]: {
    [MatchEvent.REMATCH]: MatchState.CHARACTER_SELECT,
    [MatchEvent.LEAVE]: MatchState.MAIN_MENU,
  },

  [MatchState.RECONNECTING]: {
    [MatchEvent.OPPONENT_RECONNECTED]: MatchState.ROUND_ACTIVE,
    [MatchEvent.GRACE_EXPIRED]: MatchState.DISCONNECTED,
  },

  [MatchState.DISCONNECTED]: {
    [MatchEvent.RETURN_TO_SELECT]: MatchState.CHARACTER_SELECT,
    [MatchEvent.FULL_DISCONNECT]: MatchState.MAIN_MENU,
  },
};

export class MatchStateMachine {
  /**
   * @param {string} [initialState] - Starting state (defaults to MAIN_MENU)
   */
  constructor(initialState = MatchState.MAIN_MENU) {
    this._state = initialState;
    this._listeners = [];
  }

  get state() {
    return this._state;
  }

  /**
   * Attempt a state transition. Returns the new state.
   * Throws if the transition is invalid for the current state.
   * @param {string} event - A MatchEvent value
   * @returns {string} The new MatchState value
   */
  transition(event) {
    const stateTransitions = TRANSITIONS[this._state];
    if (!stateTransitions) {
      throw new Error(`No transitions defined for state '${this._state}'`);
    }

    const nextState = stateTransitions[event];
    if (!nextState) {
      throw new Error(
        `Invalid transition: event '${event}' is not valid in state '${this._state}'. ` +
          `Valid events: [${Object.keys(stateTransitions).join(', ')}]`,
      );
    }

    const prevState = this._state;
    this._state = nextState;

    for (const cb of this._listeners) {
      cb(prevState, nextState, event);
    }

    return nextState;
  }

  /**
   * Check if a transition is valid without executing it.
   * @param {string} event
   * @returns {boolean}
   */
  canTransition(event) {
    const stateTransitions = TRANSITIONS[this._state];
    return !!(stateTransitions && stateTransitions[event]);
  }

  /**
   * Register a callback for state transitions.
   * @param {(from: string, to: string, event: string) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onTransition(callback) {
    this._listeners.push(callback);
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Force state without validation (for restoring from snapshot).
   * @param {string} state
   */
  forceState(state) {
    this._state = state;
  }
}
