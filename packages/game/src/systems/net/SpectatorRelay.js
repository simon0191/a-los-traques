import { Logger } from '../Logger.js';

const log = Logger.create('SpectatorRelay');

/** Message types that SpectatorRelay buffers (B5 — handler may not be registered yet) */
const BUFFERABLE_TYPES = new Set(['sync', 'round_event']);

/**
 * Handles spectator-specific messaging: sync state broadcast,
 * round events, shouts, potions, spectator count, and fight state.
 *
 * Implements B5-style buffering for sync and round_event: if no
 * callback is set when the message arrives, it's queued and flushed
 * when the callback is registered.
 */
export class SpectatorRelay {
  /**
   * @param {import('./SignalingClient.js').SignalingClient} signaling
   */
  constructor(signaling) {
    this.signaling = signaling;

    this._onSync = null;
    this._onRoundEvent = null;
    this._onAssignSpectator = null;
    this._onSpectatorCount = null;
    this._onShout = null;
    this._onFightState = null;
    this._onPotionApplied = null;
    this._onPotion = null;

    /** @type {Map<string, object[]>} B5: buffered messages for types with no callback yet */
    this._pendingMessages = new Map();
    for (const type of BUFFERABLE_TYPES) {
      this._pendingMessages.set(type, []);
    }

    // Register handlers on signaling
    signaling.on('sync', (msg) => {
      if (this._onSync) {
        this._onSync(msg);
      } else {
        this._pendingMessages.get('sync').push(msg);
      }
    });
    signaling.on('round_event', (msg) => {
      if (this._onRoundEvent) {
        this._onRoundEvent(msg);
      } else {
        this._pendingMessages.get('round_event').push(msg);
      }
    });
    signaling.on('assign_spectator', (msg) => {
      if (this._onAssignSpectator) this._onAssignSpectator(msg.spectatorCount);
    });
    signaling.on('spectator_count', (msg) => {
      if (this._onSpectatorCount) this._onSpectatorCount(msg.count);
    });
    signaling.on('shout', (msg) => {
      if (this._onShout) this._onShout(msg.text);
    });
    signaling.on('fight_state', (msg) => {
      if (this._onFightState) this._onFightState(msg);
    });
    signaling.on('potion_applied', (msg) => {
      if (this._onPotionApplied) this._onPotionApplied(msg.target, msg.potionType);
    });
    signaling.on('potion', (msg) => {
      if (this._onPotion) this._onPotion(msg.target, msg.potionType);
    });
  }

  // --- Send methods ---

  sendSync(state) {
    this.signaling.send({ type: 'sync', ...state });
  }

  sendRoundEvent(event) {
    this.signaling.send({ type: 'round_event', ...event });
  }

  sendShout(text) {
    this.signaling.send({ type: 'shout', text });
  }

  sendPotion(target, potionType) {
    this.signaling.send({ type: 'potion', target, potionType });
  }

  // --- Callback registration ---

  onSync(cb) {
    this._onSync = cb;
    this._flushPending('sync', cb);
  }

  onRoundEvent(cb) {
    this._onRoundEvent = cb;
    this._flushPending('round_event', cb);
  }

  onAssignSpectator(cb) {
    this._onAssignSpectator = cb;
  }

  onSpectatorCount(cb) {
    this._onSpectatorCount = cb;
  }

  onShout(cb) {
    this._onShout = cb;
  }

  onFightState(cb) {
    this._onFightState = cb;
  }

  onPotionApplied(cb) {
    this._onPotionApplied = cb;
  }

  onPotion(cb) {
    this._onPotion = cb;
  }

  reset() {
    this._onSync = null;
    this._onRoundEvent = null;
    this._onShout = null;
    this._onFightState = null;
    this._onPotionApplied = null;
    this._onPotion = null;
    // Keep _onAssignSpectator, _onSpectatorCount across scene transitions
    // Clear pending buffers
    for (const [, queue] of this._pendingMessages) {
      queue.length = 0;
    }
  }

  /** Flush buffered messages for a type when callback is set (B5) */
  _flushPending(type, cb) {
    if (!cb) return;
    const pending = this._pendingMessages.get(type);
    if (pending && pending.length > 0) {
      const messages = pending.splice(0);
      log.debug('Callback buffer flush (B5)', { type, count: messages.length });
      for (const msg of messages) {
        cb(msg);
      }
    }
  }

  destroy() {
    const types = [
      'sync',
      'round_event',
      'assign_spectator',
      'spectator_count',
      'shout',
      'fight_state',
      'potion_applied',
      'potion',
    ];
    for (const type of types) {
      this.signaling.off(type);
    }
    this._onSync = null;
    this._onRoundEvent = null;
    this._onAssignSpectator = null;
    this._onSpectatorCount = null;
    this._onShout = null;
    this._onFightState = null;
    this._onPotionApplied = null;
    this._onPotion = null;
  }
}
