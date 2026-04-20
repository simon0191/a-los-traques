import { PARTYKIT_HOST } from '../config.js';
import { Logger } from '../systems/Logger.js';
import { BaseSignalingClient } from '../systems/net/BaseSignalingClient.js';
import { createTournament, getProfile } from './api.js';

const log = Logger.create('Lobby');

export class TournamentLobbyService extends BaseSignalingClient {
  constructor(roomId) {
    const id = (roomId || Math.random().toString(36).substring(2, 9)).toLowerCase();
    super(id, PARTYKIT_HOST);

    this.state = {
      size: 8,
      slots: [],
      nextGuestNum: 1,
      tourneyId: null, // Initialized by host
    };

    this._onUpdateCallbacks = [];
    this._initialized = false;
  }

  async initHost() {
    if (this._initialized) return;
    this._initialized = true;

    const profile = {
      nickname: 'Anfitrión Local',
      id: `host-${crypto.randomUUID().substring(0, 8)}`,
    };

    try {
      const p = await getProfile();
      if (p?.nickname) {
        profile.nickname = p.nickname;
        if (p.id) profile.id = p.id; // Ensure we use the real UUID
      }
    } catch (_e) {
      log.info('Using Guest Host');
    }

    // Phase 3: Create tournament session on the Vercel backend
    try {
      const { tourneyId } = await createTournament(this.state.size);
      this.state.tourneyId = tourneyId;
      log.info('Tournament session created', { tourneyId });
    } catch (e) {
      log.warn('Failed to create tournament session (persistence disabled)', { err: e.message });
    }

    this.state.slots = new Array(this.state.size).fill(null);
    this.state.slots[0] = {
      type: 'human',
      id: profile.id,
      name: profile.nickname,
      status: 'ready',
      handshake: true, // Host is always verified
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

  async updateSize(newSize) {
    this.state.size = newSize;
    // Update backend session size
    try {
      await createTournament(newSize, true); // true for allowUpdate
      log.info('Tournament session size updated', { newSize });
    } catch (e) {
      log.warn('Failed to update tournament session size', { err: e.message });
    }

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
    let url = `${base}/join.html?room=${this.roomId}`;
    if (this.state.tourneyId) {
      url += `&tourney=${this.state.tourneyId}`;
    }
    return url;
  }

  startTournament() {
    this.send({ type: 'start_tournament' });
  }

  destroy() {
    super.destroy();
    this._onUpdateCallbacks = [];
  }
}
