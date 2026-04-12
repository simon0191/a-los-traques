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
    const cy = GAME_HEIGHT / 2 - 65;

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
    createButton(this, GAME_WIDTH / 2, cy + 30, 'VS MAQUINA', () => {
      this.goToSelect();
    });

    createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap, 'MULTIJUGADOR', () => {
      this.goToMultiplayer();
    });

    createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 2, 'COMO JUGAR', () => {
      this.goToLearning();
    });

    createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 3, 'INSPECTOR', () => {
      this.goToInspector();
    });

    createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 4, 'MUSICA', () => {
      this.goToMusic();
    });

    createButton(this, GAME_WIDTH / 2, cy + 30 + btnGap * 5, 'LEADERBOARD', () => {
      this.goToLeaderboard();
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

  goToMultiplayer() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('MultiplayerMenuScene');
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

  goToLeaderboard() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('LeaderboardScene');
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
