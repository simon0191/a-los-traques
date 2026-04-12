import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { getLeaderboard } from '../services/api.js';
import { createButton } from '../services/UIService.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('LeaderboardScene');

export class LeaderboardScene extends Phaser.Scene {
  constructor() {
    super('LeaderboardScene');
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.createMuteButton(this);

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a1a2e);

    // Title
    this.add
      .text(GAME_WIDTH / 2, 25, 'LEADERBOARD', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '24px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    // Decorative line
    this.add.rectangle(GAME_WIDTH / 2, 45, 200, 2, 0xccccff, 0.6);

    // Column headers
    this.add
      .text(GAME_WIDTH / 2, 65, '#   JUGADOR              V     D      %', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#aaaaff',
      })
      .setOrigin(0.5);

    // Status text (loading / empty / error)
    this.statusText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Cargando...', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: '#ccccff',
      })
      .setOrigin(0.5);

    // VOLVER button
    createButton(this, 60, GAME_HEIGHT - 20, 'VOLVER', () => this._goBack(), { width: 100 });

    this.transitioning = false;
    this.rowObjects = [];

    // Fetch leaderboard data
    getLeaderboard()
      .then((rows) => {
        if (this.scene.isActive()) this._renderRows(rows);
      })
      .catch((err) => {
        if (!this.scene.isActive()) return;
        log.warn('Leaderboard fetch failed', { err: err.message });
        this.statusText.setText('Error al cargar. Intentá de nuevo.');
        this.statusText.setColor('#ff6666');
      });
  }

  _renderRows(rows) {
    if (!rows || rows.length === 0) {
      this.statusText.setText('Sin datos todavía');
      return;
    }

    this.statusText.destroy();
    this.statusText = null;

    const user = this.game.registry.get('user');
    const currentNickname = user?.user_metadata?.nickname;

    const startY = 85;
    const rowHeight = 16;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const y = startY + i * rowHeight;

      // Alternating row shading
      const bgColor = i % 2 === 0 ? 0x16213e : 0x0f1a30;
      const bg = this.add.rectangle(GAME_WIDTH / 2, y, 380, rowHeight, bgColor);

      const rank = String(i + 1).padEnd(4, ' ');
      const name = String(row.nickname).slice(0, 16).padEnd(18, ' ');
      const wins = String(row.wins).padStart(4, ' ');
      const losses = String(row.losses).padStart(6, ' ');
      const winRate = `${row.win_rate}%`.padStart(8, ' ');
      const line = `${rank}${name}${wins}${losses}${winRate}`;

      const isCurrentUser = currentNickname && row.nickname === currentNickname;

      const text = this.add
        .text(GAME_WIDTH / 2, y, line, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: isCurrentUser ? '#ffcc00' : '#ffffff',
        })
        .setOrigin(0.5);

      this.rowObjects.push({ bg, text });
    }
  }

  _goBack() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('TitleScene');
    });
  }
}
