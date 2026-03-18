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
    this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 33, 'VS MAQUINA', () => {
      this.goToSelect();
    });

    this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 57, 'EN LINEA', () => {
      this.goToLobby();
    });

    this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 81, 'UNIRSE', () => {
      this._showJoinOverlay();
    });

    this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 105, 'INSPECTOR', () => {
      this.goToInspector();
    });

    this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 129, 'MUSICA', () => {
      this.goToMusic();
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

  goToInspector() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('InspectorScene');
    });
  }

  goToMusic() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('MusicScene');
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

  _showJoinOverlay() {
    if (this._joinOverlay) return;
    const VALID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    this._joinOverlay = this.add.container(0, 0).setDepth(50);

    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.85);
    this._joinOverlay.add(bg);

    const title = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, 'CODIGO DE SALA', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '16px',
      color: '#ffcc00',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    this._joinOverlay.add(title);

    this._joinCodeText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 15, '_ _ _ _', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    this._joinOverlay.add(this._joinCodeText);

    // Hidden HTML input to trigger iOS keyboard
    this._joinInput = document.createElement('input');
    this._joinInput.type = 'text';
    this._joinInput.maxLength = 4;
    this._joinInput.autocapitalize = 'characters';
    this._joinInput.inputMode = 'text';
    this._joinInput.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);opacity:0.01;font-size:16px;width:80px;z-index:1000;';
    document.body.appendChild(this._joinInput);
    this._joinInput.focus();

    this._joinInput.addEventListener('input', () => {
      let val = this._joinInput.value.toUpperCase();
      val = val.split('').filter(c => VALID_CHARS.includes(c)).join('');
      if (val.length > 4) val = val.slice(0, 4);
      this._joinInput.value = val;
      const display = val.padEnd(4, '_').split('').join(' ');
      this._joinCodeText.setText(display);
    });

    // ENTRAR button
    const entrarBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, 140, 24, 0x222244)
      .setStrokeStyle(1, 0x4444aa).setInteractive({ useHandCursor: true });
    const entrarText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, 'ENTRAR', {
      fontFamily: 'Arial', fontSize: '12px', color: '#ffffff'
    }).setOrigin(0.5);
    entrarBg.on('pointerover', () => { entrarBg.setFillStyle(0x333366); entrarText.setColor('#ffcc00'); });
    entrarBg.on('pointerout', () => { entrarBg.setFillStyle(0x222244); entrarText.setColor('#ffffff'); });
    entrarBg.on('pointerdown', () => {
      const code = this._joinInput.value.toUpperCase().split('').filter(c => VALID_CHARS.includes(c)).join('');
      if (code.length !== 4) return;
      this.game.audioManager.play('ui_confirm');
      this._hideJoinOverlay();
      if (this.transitioning) return;
      this.transitioning = true;
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('LobbyScene', { roomId: code });
      });
    });
    this._joinOverlay.add([entrarBg, entrarText]);

    // CANCELAR button
    const cancelBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 48, 140, 24, 0x222244)
      .setStrokeStyle(1, 0x4444aa).setInteractive({ useHandCursor: true });
    const cancelText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 48, 'CANCELAR', {
      fontFamily: 'Arial', fontSize: '12px', color: '#ffffff'
    }).setOrigin(0.5);
    cancelBg.on('pointerover', () => { cancelBg.setFillStyle(0x333366); cancelText.setColor('#ffcc00'); });
    cancelBg.on('pointerout', () => { cancelBg.setFillStyle(0x222244); cancelText.setColor('#ffffff'); });
    cancelBg.on('pointerdown', () => {
      this.game.audioManager.play('ui_cancel');
      this._hideJoinOverlay();
    });
    this._joinOverlay.add([cancelBg, cancelText]);
  }

  _hideJoinOverlay() {
    if (this._joinInput) {
      this._joinInput.remove();
      this._joinInput = null;
    }
    if (this._joinOverlay) {
      this._joinOverlay.destroy();
      this._joinOverlay = null;
    }
    this._joinCodeText = null;
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
