import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { createButton } from '../services/UIService.js';

export class TournamentSetupScene extends Phaser.Scene {
  constructor() {
    super('TournamentSetupScene');
  }

  create() {
    this.playerCount = 1;
    this._maxPlayers = 8;

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add
      .text(GAME_WIDTH / 2, 40, 'CONFIGURAR TORNEO', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Player count selector
    this.add
      .text(GAME_WIDTH / 2 - 60, 80, 'JUGADORES:', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#cccccc',
      })
      .setOrigin(0, 0.5);

    this._playerCountText = this.add
      .text(GAME_WIDTH / 2 + 20, 80, '1', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    createButton(this, GAME_WIDTH / 2 + 50, 80, '−', () => this._changePlayerCount(-1), {
      width: 24,
      height: 20,
      fontSize: '14px',
    });

    createButton(this, GAME_WIDTH / 2 + 80, 80, '+', () => this._changePlayerCount(1), {
      width: 24,
      height: 20,
      fontSize: '14px',
    });

    this._btn8 = createButton(
      this,
      GAME_WIDTH / 2,
      120,
      'TORNEO CORTO (8)',
      () => {
        if (this.playerCount <= 8) this.startTournament(8);
      },
      { width: 180, height: 30, fontSize: '14px' },
    );

    createButton(this, GAME_WIDTH / 2, 160, 'TORNEO LARGO (16)', () => this.startTournament(16), {
      width: 180,
      height: 30,
      fontSize: '14px',
    });

    createButton(
      this,
      GAME_WIDTH / 2,
      220,
      'VOLVER',
      () => {
        this.scene.start('MultiplayerMenuScene');
      },
      { width: 180, height: 30, fontSize: '14px' },
    );
  }

  _changePlayerCount(delta) {
    const newCount = this.playerCount + delta;
    if (newCount >= 1 && newCount <= this._maxPlayers) {
      this.playerCount = newCount;
      this._playerCountText.setText(String(this.playerCount));
      this._updateSizeButtons();
    }
  }

  _updateSizeButtons() {
    const disabled = this.playerCount > 8;
    this._btn8.bg.setAlpha(disabled ? 0.3 : 1);
    this._btn8.text.setAlpha(disabled ? 0.3 : 1);
    if (disabled) {
      this._btn8.bg.disableInteractive();
    } else {
      this._btn8.bg.setInteractive();
    }
  }

  startTournament(size) {
    // Cap player count to tournament size
    const localPlayers = Math.min(this.playerCount, size);
    const seed = Math.floor(Math.random() * 1000000);
    this.scene.start('SelectScene', {
      gameMode: 'local',
      matchContext: {
        type: 'tournament',
        localPlayers,
        tournamentState: {
          size,
          seed,
        },
      },
    });
  }
}
