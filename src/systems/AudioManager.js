export class AudioManager {
  constructor(game) {
    this.game = game;
    this.scene = null;
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.muted = localStorage.getItem('alt_muted') === 'true';
    game.audioManager = this;
  }

  setScene(scene) {
    this.scene = scene;
    if (this.muted) {
      scene.sound.mute = true;
    }
  }

  play(key) {
    if (!this.scene || !this.scene.cache.audio.exists(key)) return;
    this.scene.sound.play(key);
  }

  playMusic(key, config = {}) {
    if (!this.scene || !this.scene.cache.audio.exists(key)) return;
    if (this.currentMusicKey === key && this.currentMusic && this.currentMusic.isPlaying) return;

    this.stopMusic();
    const loop = config.loop !== undefined ? config.loop : true;
    this.currentMusic = this.scene.sound.add(key, { loop, volume: config.volume || 0.4 });
    this.currentMusic.play();
    this.currentMusicKey = key;
  }

  stopMusic() {
    if (this.currentMusic) {
      this.currentMusic.stop();
      this.currentMusic.destroy();
      this.currentMusic = null;
      this.currentMusicKey = null;
    }
  }

  fadeOutMusic(duration = 500) {
    if (!this.currentMusic || !this.scene) return;
    const music = this.currentMusic;
    this.scene.tweens.add({
      targets: music,
      volume: 0,
      duration,
      onComplete: () => {
        music.stop();
        music.destroy();
      }
    });
    this.currentMusic = null;
    this.currentMusicKey = null;
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('alt_muted', this.muted);
    if (this.scene) {
      this.scene.sound.mute = this.muted;
    }
    return this.muted;
  }

  createMuteButton(scene) {
    const x = 470;
    const y = 10;
    const btn = scene.add.text(x, y, this.muted ? 'MUTE' : 'SND', {
      fontFamily: 'Arial',
      fontSize: '8px',
      color: this.muted ? '#ff4444' : '#88ff88',
      backgroundColor: '#00000088',
      padding: { x: 3, y: 2 }
    }).setOrigin(1, 0).setDepth(100).setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => {
      const muted = this.toggleMute();
      btn.setText(muted ? 'MUTE' : 'SND');
      btn.setColor(muted ? '#ff4444' : '#88ff88');
    });

    return btn;
  }
}
