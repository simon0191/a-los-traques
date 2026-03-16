import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import fightersData from '../data/fighters.json';

export class VictoryScene extends Phaser.Scene {
  constructor() {
    super('VictoryScene');
  }

  init(data) {
    this.winnerId = data.winnerId;
    this.loserId = data.loserId;
    this.p1Id = data.p1Id;
    this.p2Id = data.p2Id;
    this.stageId = data.stageId;
  }

  create() {
    this.cameras.main.fadeIn(500, 255, 255, 255);

    const winner = fightersData.find(f => f.id === this.winnerId);
    const loser = fightersData.find(f => f.id === this.loserId);

    const winnerColor = parseInt(winner.color, 16);
    const loserColor = parseInt(loser.color, 16);

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1a);

    // Background glow behind winner
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, GAME_WIDTH, 160, winnerColor, 0.12);

    // VICTORIA header
    const headerText = this.add.text(GAME_WIDTH / 2, 25, 'VICTORIA!', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '28px',
      color: '#ffcc00',
      stroke: '#000000',
      strokeThickness: 5,
      shadow: { offsetX: 2, offsetY: 2, color: '#664400', blur: 6, fill: true }
    }).setOrigin(0.5);

    // Animate header
    this.tweens.add({
      targets: headerText,
      scaleX: 1.05,
      scaleY: 1.05,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Winner portrait (large, centered)
    this.add.rectangle(GAME_WIDTH / 2, 100, 80, 80, winnerColor);
    this.add.rectangle(GAME_WIDTH / 2, 100, 80, 80, 0x000000, 0)
      .setStrokeStyle(3, 0xffcc00);

    // Winner name
    this.add.text(GAME_WIDTH / 2, 150, winner.name, {
      fontFamily: 'Arial Black, Arial',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    // Winner subtitle
    this.add.text(GAME_WIDTH / 2, 168, winner.subtitle, {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#ccccee',
      fontStyle: 'italic'
    }).setOrigin(0.5);

    // Winner victory dialog
    this.add.text(GAME_WIDTH / 2, 188, `"${winner.dialogs.victory}"`, {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#ffeeaa',
      fontStyle: 'italic',
      wordWrap: { width: 300 },
      align: 'center'
    }).setOrigin(0.5);

    // Loser defeat dialog (smaller, below)
    this.add.rectangle(GAME_WIDTH / 2, 215, 280, 1, 0x333355);

    this.add.text(GAME_WIDTH / 2, 225, `${loser.name}: "${loser.dialogs.defeat}"`, {
      fontFamily: 'Arial',
      fontSize: '7px',
      color: '#888899',
      fontStyle: 'italic',
      wordWrap: { width: 260 },
      align: 'center'
    }).setOrigin(0.5);

    // Buttons
    this.createButton(GAME_WIDTH / 2 - 70, 252, 'REVANCHA', () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('FightScene', {
          p1Id: this.p1Id,
          p2Id: this.p2Id,
          stageId: this.stageId
        });
      });
    });

    this.createButton(GAME_WIDTH / 2 + 70, 252, 'ELEGIR OTRO', () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('SelectScene');
      });
    });
  }

  createButton(x, y, label, callback) {
    const bg = this.add.rectangle(x, y, 110, 22, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });

    const text = this.add.text(x, y, label, {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#ffffff'
    }).setOrigin(0.5);

    bg.on('pointerover', () => {
      bg.setFillStyle(0x333366);
      text.setColor('#ffcc00');
    });

    bg.on('pointerout', () => {
      bg.setFillStyle(0x222244);
      text.setColor('#ffffff');
    });

    bg.on('pointerdown', callback);

    return { bg, text };
  }
}
