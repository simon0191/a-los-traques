import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { createButton } from '../services/UIService.js';

export class TournamentSetupScene extends Phaser.Scene {
  constructor() {
    super('TournamentSetupScene');
  }

  create() {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add
      .text(GAME_WIDTH / 2, 40, 'CONFIGURAR TORNEO', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    createButton(
      this,
      GAME_WIDTH / 2,
      100,
      'TORNEO CORTO (8)',
      () => {
        this.startTournament(8);
      },
      { width: 180, height: 30, fontSize: '14px' },
    );

    createButton(
      this,
      GAME_WIDTH / 2,
      140,
      'TORNEO LARGO (16)',
      () => {
        this.startTournament(16);
      },
      { width: 180, height: 30, fontSize: '14px' },
    );

    createButton(
      this,
      GAME_WIDTH / 2,
      220,
      'VOLVER',
      () => {
        this.scene.start('TitleScene');
      },
      { width: 180, height: 30, fontSize: '14px' },
    );
  }

  startTournament(size) {
    const seed = Math.floor(Math.random() * 1000000);
    this.scene.start('SelectScene', {
      gameMode: 'local',
      matchContext: {
        type: 'tournament',
        tournamentState: {
          size,
          seed,
        },
      },
    });
  }
}
