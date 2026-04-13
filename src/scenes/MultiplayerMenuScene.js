import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { createButton } from '../services/UIService.js';

export class MultiplayerMenuScene extends Phaser.Scene {
  constructor() {
    super('MultiplayerMenuScene');
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.createMuteButton(this);

    this.events.on('shutdown', () => this._hideJoinOverlay());
    this.cameras.main.fadeIn(300, 0, 0, 0);

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add
      .text(GAME_WIDTH / 2, 40, 'MULTIJUGADOR', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const btnGap = 28;
    const startY = 90;
    this.transitioning = false;

    createButton(
      this,
      GAME_WIDTH / 2,
      startY,
      'VS EN LINEA',
      () => this._goTo('LobbyScene', { roomId: null }),
      { width: 180, height: 30, fontSize: '14px' },
    );

    createButton(this, GAME_WIDTH / 2, startY + btnGap, 'UNIRSE', () => this._showJoinOverlay(), {
      width: 180,
      height: 30,
      fontSize: '14px',
    });

    createButton(
      this,
      GAME_WIDTH / 2,
      startY + btnGap * 2,
      'VS LOCAL',
      () =>
        this._goTo('SelectScene', {
          gameMode: 'local',
          matchContext: { type: 'versus' },
        }),
      { width: 180, height: 30, fontSize: '14px' },
    );

    createButton(
      this,
      GAME_WIDTH / 2,
      startY + btnGap * 3,
      'TORNEO LOCAL',
      () => this._goTo('TournamentSetupScene'),
      { width: 180, height: 30, fontSize: '14px' },
    );

    createButton(
      this,
      GAME_WIDTH / 2,
      startY + btnGap * 4,
      'VOLVER',
      () => this._goTo('TitleScene'),
      { width: 180, height: 30, fontSize: '14px' },
    );
  }

  getNavMenu() {
    // Return main buttons or overlay buttons if visible
    if (this._joinOverlay) {
      // Find buttons inside container
      const buttons = this._joinOverlay.list
        .filter((child) => child.type === 'Rectangle' && child.input?.enabled)
        .sort((a, b) => a.y - b.y);
      return { items: buttons };
    }

    const buttons = this.children.list
      .filter((child) => child.type === 'Rectangle' && child.input?.enabled)
      .sort((a, b) => a.y - b.y);
    return { items: buttons };
  }

  handleBack() {
    if (this._joinOverlay) {
      this._hideJoinOverlay();
      this.game.events.emit('ui_refresh_nav'); // Not implemented yet, but good to have
      return;
    }
    this._goTo('TitleScene');
  }

  _goTo(scene, data) {
    if (this.transitioning) return;
    this.transitioning = true;
    if (scene === 'SelectScene' || scene === 'LobbyScene') {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start(scene, data);
    });
  }

  _showJoinOverlay() {
    if (this._joinOverlay) return;
    const VALID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    this._joinOverlay = this.add.container(0, 0).setDepth(50);

    const bg = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.85,
    );
    bg.setInteractive();
    this._joinOverlay.add(bg);

    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, 'CODIGO DE SALA', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '16px',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this._joinOverlay.add(title);

    this._joinCodeText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 15, '_ _ _ _', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this._joinOverlay.add(this._joinCodeText);

    // Hidden HTML input to trigger iOS keyboard
    this._joinInput = document.createElement('input');
    this._joinInput.type = 'text';
    this._joinInput.maxLength = 4;
    this._joinInput.autocapitalize = 'characters';
    this._joinInput.inputMode = 'text';
    this._joinInput.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);opacity:0.01;font-size:16px;width:80px;z-index:1000;';
    document.body.appendChild(this._joinInput);
    window._suppressFixHeight = true;
    this._joinInput.focus();

    this._stopKeydown = (e) => e.stopPropagation();
    this._stopKeyup = (e) => e.stopPropagation();
    this._joinInput.addEventListener('keydown', this._stopKeydown);
    this._joinInput.addEventListener('keyup', this._stopKeyup);

    this._joinInput.addEventListener('input', () => {
      let val = this._joinInput.value.toUpperCase();
      val = val
        .split('')
        .filter((c) => VALID_CHARS.includes(c))
        .join('');
      if (val.length > 4) val = val.slice(0, 4);
      this._joinInput.value = val;
      const display = val.padEnd(4, '_').split('').join(' ');
      this._joinCodeText.setText(display);
    });

    // ENTRAR button
    const entrarBtn = createButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, 'ENTRAR', () => {
      const code = this._joinInput.value
        .toUpperCase()
        .split('')
        .filter((c) => VALID_CHARS.includes(c))
        .join('');
      if (code.length !== 4) return;
      this._hideJoinOverlay();
      this._goTo('LobbyScene', { roomId: code });
    });
    this._joinOverlay.add([entrarBtn.bg, entrarBtn.text]);

    // CANCELAR button
    const cancelBtn = createButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 48, 'CANCELAR', () => {
      this.game.audioManager.play('ui_cancel');
      this._hideJoinOverlay();
    });
    this._joinOverlay.add([cancelBtn.bg, cancelBtn.text]);
  }

  _hideJoinOverlay() {
    if (this._joinInput) {
      this._joinInput.removeEventListener('keydown', this._stopKeydown);
      this._joinInput.removeEventListener('keyup', this._stopKeyup);
      this._joinInput.blur();
      this._joinInput.remove();
      this._joinInput = null;
      this._stopKeydown = null;
      this._stopKeyup = null;
      setTimeout(() => {
        window._suppressFixHeight = false;
        if (typeof window.fixHeight === 'function') window.fixHeight();
      }, 500);
    }
    if (this._joinOverlay) {
      this._joinOverlay.destroy();
      this._joinOverlay = null;
    }
    this._joinCodeText = null;
  }
}
