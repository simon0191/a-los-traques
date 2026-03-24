import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';

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

    this._createButton(GAME_WIDTH / 2, 100, 'TORNEO CORTO (8)', () => {
      this.startTournament(8);
    });

    this._createButton(GAME_WIDTH / 2, 140, 'TORNEO LARGO (16)', () => {
      this.startTournament(16);
    });

    this._createButton(GAME_WIDTH / 2, 220, 'VOLVER', () => {
      this.scene.start('TitleScene');
    });
  }

  startTournament(size) {
    this.scene.start('SelectScene', { gameMode: 'tournament', tournamentSize: size });
  }

  _createButton(x, y, label, callback) {
    const bg = this.add
      .rectangle(x, y, 180, 30, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });

    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    bg.on('pointerover', () => {
      bg.setFillStyle(0x333366);
      text.setColor('#ffcc00');
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(0x222244);
      text.setColor('#ffffff');
    });
    bg.on('pointerdown', () => {
      this.game.audioManager.play('ui_confirm');
      callback();
    });
  }
}
