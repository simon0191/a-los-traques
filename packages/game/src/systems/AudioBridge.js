/**
 * Maps simulation events to audio playback.
 * Pure consumer — no simulation state mutation.
 */
export class AudioBridge {
  constructor(audioManager) {
    this.audio = audioManager;
  }

  /**
   * Process a batch of simulation events from one tick.
   * @param {Array<object>} events
   */
  processEvents(events) {
    for (const evt of events) {
      switch (evt.type) {
        case 'hit':
          if (evt.intensity === 'special') this.audio.play('hit_special');
          else if (evt.intensity === 'heavy') this.audio.play('hit_heavy');
          else this.audio.play('hit_light');
          break;
        case 'hit_blocked':
          this.audio.play('hit_block');
          break;
        case 'whiff':
          this.audio.play('whiff');
          break;
        case 'jump':
          this.audio.play('jump');
          break;
        case 'special_charge':
          this.audio.play('special_charge');
          break;
        case 'round_ko':
          this.audio.play('ko');
          break;
        case 'round_timeup':
          this.audio.play('announce_timeup');
          break;
      }
    }
  }
}
