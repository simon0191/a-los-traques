import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);

    // Safari AudioContext unlock
    const startMusic = () => audio.playMusic('bgm_menu');
    if (this.sound.locked) {
      this.sound.once('unlocked', startMusic);
    } else {
      startMusic();
    }

    audio.createMuteButton(this);

    // Animated background rectangles
    this.bgRects = [];
    const colors = [0x1a1a2e, 0x16213e, 0x0f3460, 0x533483, 0x2c2c54];
    for (let i = 0; i < 8; i++) {
      const rect = this.add.rectangle(
        Phaser.Math.Between(0, GAME_WIDTH),
        Phaser.Math.Between(0, GAME_HEIGHT),
        Phaser.Math.Between(60, 160),
        Phaser.Math.Between(40, 100),
        colors[i % colors.length],
        0.3
      );
      rect.speedX = Phaser.Math.FloatBetween(-0.3, 0.3);
      rect.speedY = Phaser.Math.FloatBetween(-0.2, 0.2);
      this.bgRects.push(rect);
    }

    // Dark overlay for readability
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.4);

    // Game title
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, 'A LOS TRAQUES', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '36px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 6,
      shadow: { offsetX: 3, offsetY: 3, color: '#333333', blur: 5, fill: true }
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 15, 'Pelea de Amigos', {
      fontFamily: 'Arial',
      fontSize: '16px',
      color: '#ccccff',
      fontStyle: 'italic'
    }).setOrigin(0.5);

    // Decorative line
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 5, 200, 2, 0xccccff, 0.6);

    // Mode buttons
    this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'VS MAQUINA', () => {
      this.goToSelect();
    });

    this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 68, 'EN LINEA', () => {
      this.goToLobby();
    });

    this.transitioning = false;
  }

  goToSelect() {
    if (this.transitioning) return;
    this.transitioning = true;

    // Request fullscreen for better mobile experience
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('SelectScene', { gameMode: 'local' });
    });
  }

  goToLobby() {
    if (this.transitioning) return;
    this.transitioning = true;

    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('LobbyScene', { roomId: null });
    });
  }

  _createButton(x, y, label, callback) {
    const bg = this.add.rectangle(x, y, 140, 24, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });

    const text = this.add.text(x, y, label, {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#ffffff'
    }).setOrigin(0.5);

    bg.on('pointerover', () => { bg.setFillStyle(0x333366); text.setColor('#ffcc00'); });
    bg.on('pointerout', () => { bg.setFillStyle(0x222244); text.setColor('#ffffff'); });
    bg.on('pointerdown', () => {
      this.game.audioManager.play('ui_confirm');
      callback();
    });
  }

  update() {
    // Animate background rectangles
    for (const rect of this.bgRects) {
      rect.x += rect.speedX;
      rect.y += rect.speedY;

      if (rect.x < -80) rect.x = GAME_WIDTH + 80;
      if (rect.x > GAME_WIDTH + 80) rect.x = -80;
      if (rect.y < -60) rect.y = GAME_HEIGHT + 60;
      if (rect.y > GAME_HEIGHT + 60) rect.y = -60;
    }
  }
}
