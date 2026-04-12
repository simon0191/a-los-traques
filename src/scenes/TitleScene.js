import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { getProfile } from '../services/api.js';
import { logOut } from '../services/supabase.js';
import { createButton } from '../services/UIService.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('TitleScene');

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);

    audio.playMusic('bgm_menu');

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
        0.3,
      );
      rect.speedX = Phaser.Math.FloatBetween(-0.3, 0.3);
      rect.speedY = Phaser.Math.FloatBetween(-0.2, 0.2);
      this.bgRects.push(rect);
    }

    // Dark overlay for readability
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.4);

    // Layout anchor — shifted up to fit all buttons on screen
    const cy = GAME_HEIGHT / 2 - 50;

    // Game title
    this.add
      .text(GAME_WIDTH / 2, cy - 40, 'A LOS TRAQUES', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '32px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
        shadow: { offsetX: 3, offsetY: 3, color: '#333333', blur: 5, fill: true },
      })
      .setOrigin(0.5);

    // Subtitle
    this.add
      .text(GAME_WIDTH / 2, cy - 10, 'Pelea de Amigos', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: '#ccccff',
        fontStyle: 'italic',
      })
      .setOrigin(0.5);

    // Decorative line
    this.add.rectangle(GAME_WIDTH / 2, cy + 5, 200, 2, 0xccccff, 0.6);

    // User greeting & Logout (Top Left)
    const user = this.game.registry.get('user');
    const userName = user?.user_metadata?.nickname || (user ? user.email : 'Invitado');

    const greeting = this.add
      .text(5, 5, `Hola, ${userName}`, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#aaaacc',
      })
      .setOrigin(0, 0);

    if (user) {
      const statsText = this.add
        .text(5, 17, 'Cargando estadísticas...', {
          fontFamily: 'Arial',
          fontSize: '8px',
          color: '#888899',
        })
        .setOrigin(0, 0);

      const logoutBtn = this.add
        .text(5, 29, 'CERRAR SESIÓN', {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: '#ff4444',
          backgroundColor: '#221111',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });

      logoutBtn.on('pointerdown', async () => {
        try {
          await logOut();
          this.scene.start('LoginScene');
        } catch (e) {
          log.warn('Logout failed', { err: e.message });
        }
      });

      // Fetch real stats
      getProfile()
        .then((profile) => {
          if (profile) {
            greeting.setText(`Hola, ${profile.nickname || userName}`);
            statsText.setText(`W: ${profile.wins} | L: ${profile.losses}`);
            statsText.setColor('#44cc88');
          }
        })
        .catch((e) => {
          log.warn('Profile fetch failed', { err: e.message });
          statsText.setText('Estadísticas no disponibles');
        });
    } else {
      const loginBtn = this.add
        .text(5, 17, 'INICIAR SESIÓN', {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: '#ffcc00',
          backgroundColor: '#222244',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });

      loginBtn.on('pointerdown', () => {
        this.scene.start('LoginScene');
      });
    }

    // Mode buttons
    const btnGap = 22;
    this.buttons = [];
    this.selectedIndex = 0;

    this.buttons.push({
      action: () => this.goToSelect(),
      ui: createButton(this, GAME_WIDTH / 2, cy + 30, 'VS MAQUINA', () => this.goToSelect()),
    });

    this.buttons.push({
      action: () => this.goToTournamentSetup(),
      ui: createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap, 'TORNEO', () =>
        this.goToTournamentSetup(),
      ),
    });

    this.buttons.push({
      action: () => this.goToLobby(),
      ui: createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 2, 'EN LINEA', () =>
        this.goToLobby(),
      ),
    });

    this.buttons.push({
      action: () => this._showJoinOverlay(),
      ui: createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 3, 'UNIRSE', () =>
        this._showJoinOverlay(),
      ),
    });

    this.buttons.push({
      action: () => this.goToLearning(),
      ui: createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 4, 'COMO JUGAR', () =>
        this.goToLearning(),
      ),
    });

    this.buttons.push({
      action: () => this.goToInspector(),
      ui: createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 5, 'INSPECTOR', () =>
        this.goToInspector(),
      ),
    });

    this.buttons.push({
      action: () => this.goToMusic(),
      ui: createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 6, 'MUSICA', () =>
        this.goToMusic(),
      ),
    });

    this.transitioning = false;

    // Register with centralized controller
    this.time.delayedCall(100, () => {
      const controller = this.scene.get('ControllerScene');
      if (controller) {
        const buttons = this.children.list
          .filter((child) => child.input && child.input.enabled && child.type === 'Rectangle')
          .sort((a, b) => a.y - b.y);
        controller.setNavMenu(buttons);
      }
    });
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

  goToTournamentSetup() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('TournamentSetupScene');
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

  goToLearning() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('LearningScene');
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
      this.game.audioManager.play('ui_confirm');
      this._hideJoinOverlay();
      if (this.transitioning) return;
      this.transitioning = true;
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('LobbyScene', { roomId: code });
      });
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
      // iOS keyboard dismissal is animated — keep fixHeight suppressed
      // so intermediate visualViewport resize events don't shrink the container.
      // Re-enable after the keyboard animation completes and force a refresh.
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
