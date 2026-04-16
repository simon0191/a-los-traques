import { PARTYKIT_HOST } from '../config.js';
import { Logger } from '../systems/Logger.js';
import { BaseSignalingClient } from '../systems/net/BaseSignalingClient.js';
import { getProfile } from './api.js';

const log = Logger.create('Lobby');

export class TournamentLobbyService extends BaseSignalingClient {
  constructor(roomId) {
    const id = (roomId || Math.random().toString(36).substring(2, 9)).toLowerCase();
    super(id, PARTYKIT_HOST);

    this.state = {
      size: 8,
      slots: [],
      nextGuestNum: 1,
    };

    this._onUpdateCallbacks = [];
    this._initialized = false;
  }

  async initHost() {
    if (this._initialized) return;
    this._initialized = true;

    let profile = {
      nickname: 'Anfitrión Local',
      id: `host-${Math.random().toString(36).substring(2, 5)}`,
    };

    try {
      const p = await getProfile();
      if (p?.nickname) {
        profile = p;
        // Reconnect with real user ID as sessionId for server-side authority
        this.socket.query = { ...this.socket.query, sessionId: profile.id };
        this.socket.reconnect();
      }
    } catch (_e) {
      log.info('Using Guest Host');
    }

    this.state.slots = new Array(this.state.size).fill(null);
    this.state.slots[0] = {
      type: 'human',
      id: profile.id,
      name: profile.nickname,
      status: 'ready',
    };

    // Use init_tournament to switch server state and store lobbyState
    this.send({
      type: 'init_tournament',
      lobbyState: this.state,
    });

    this._notify();
  }

  _handleMessageInternal(data) {
    if (data.type === 'lobby_update' || data.type === 'init_tournament') {
      if (data.lobbyState) {
        this.state = data.lobbyState;
        this._notify();
      }
    }
  }

  onUpdate(callback) {
    this._onUpdateCallbacks.push(callback);
    // Notify immediately with current state if available
    if (this.state.slots.length > 0) callback(this.state);
  }

  _notify() {
    for (const cb of this._onUpdateCallbacks) cb(this.state);
  }

  updateSize(newSize) {
    this.send({
      type: 'lobby_action',
      action: 'UPDATE_SIZE',
      payload: { newSize },
    });
  }

  addGuest(slotIndex) {
    this.send({
      type: 'lobby_action',
      action: 'ADD_GUEST',
      payload: { index: slotIndex },
    });
  }

  addBot(slotIndex, level = 3) {
    this.send({
      type: 'lobby_action',
      action: 'UPDATE_BOT',
      payload: { index: slotIndex, level },
    });
  }

  cycleBot(slotIndex) {
    this.send({
      type: 'lobby_action',
      action: 'CYCLE_BOT',
      payload: { index: slotIndex },
    });
  }

  removeSlot(slotIndex) {
    if (slotIndex === 0) return; // Cannot remove host
    this.send({
      type: 'lobby_action',
      action: 'REMOVE_SLOT',
      payload: { index: slotIndex },
    });
  }

  getJoinUrl() {
    const base = window.location.origin;
    return `${base}/join.html?room=${this.roomId}`;
  }

  destroy() {
    super.destroy();
    this._onUpdateCallbacks = [];
  }
}
