import PartySocket from 'partysocket';
import { PARTYKIT_HOST } from '../config.js';
import { Logger } from '../systems/Logger.js';
import { getProfile } from './api.js';

const log = Logger.create('Lobby');

export class TournamentLobbyService {
  constructor(roomId) {
    this.roomId = (roomId || Math.random().toString(36).substring(2, 9)).toLowerCase();
    this.socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: this.roomId,
    });

    this.state = {
      size: 8,
      slots: [],
    };

    this._onUpdateCallbacks = [];
    this.socket.onmessage = (event) => this._handleMessage(event);
  }

  async initHost() {
    let profile = {
      nickname: 'Anfitrión Local',
      id: `host-${Math.random().toString(36).substring(2, 5)}`,
    };
    try {
      const p = await getProfile();
      if (p?.nickname) profile = p;
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

    // Retry sending until we get an update back or timeout
    const sendInit = () => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({
            type: 'init_tournament',
            lobbyState: this.state,
          }),
        );
      }
    };

    if (this.socket.readyState === WebSocket.OPEN) {
      sendInit();
    } else {
      this.socket.addEventListener('open', sendInit, { once: true });
    }

    this._notify();
  }

  _handleMessage(event) {
    const data = JSON.parse(event.data);
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
    const oldSize = this.state.size;
    this.state.size = newSize;
    if (newSize > oldSize) {
      this.state.slots = this.state.slots.concat(new Array(newSize - oldSize).fill(null));
    } else {
      this.state.slots = this.state.slots.slice(0, newSize);
    }
    this._broadcast();
  }

  addGuest(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.state.size) return;
    const guestNum = this.state.slots.filter((s) => s?.type === 'guest').length + 1;
    this.state.slots[slotIndex] = {
      type: 'guest',
      name: `Invitado ${guestNum}`,
      status: 'ready',
    };
    this._broadcast();
  }

  addBot(slotIndex, level = 3) {
    if (slotIndex < 0 || slotIndex >= this.state.size) return;

    let targetLevel = level;
    // Cycle level if already a bot
    if (this.state.slots[slotIndex]?.type === 'bot') {
      targetLevel = (this.state.slots[slotIndex].level % 5) + 1;
    }

    this.state.slots[slotIndex] = {
      type: 'bot',
      name: `Bot Nivel ${targetLevel}`,
      level: targetLevel,
      status: 'ready',
    };
    this._broadcast();
  }

  removeSlot(slotIndex) {
    if (slotIndex === 0) return; // Cannot remove host
    this.state.slots[slotIndex] = null;
    this._broadcast();
  }

  _broadcast() {
    this.socket.send(
      JSON.stringify({
        type: 'lobby_update',
        lobbyState: this.state,
      }),
    );
    this._notify();
  }

  getJoinUrl() {
    const base = window.location.origin;
    return `${base}/join.html?room=${this.roomId}`;
  }

  destroy() {
    this.socket.close();
    this._onUpdateCallbacks = [];
  }
}
