import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';

export class PreFightScene extends Phaser.Scene {
  constructor() {
    super('PreFightScene');
  }

  init(data) {
    this.p1Id = data.p1Id;
    this.p2Id = data.p2Id;
    this.stageId = data.stageId;
  }

  create() {
    this.cameras.main.fadeIn(300, 0, 0, 0);

    const p1 = fightersData.find(f => f.id === this.p1Id);
    const p2 = fightersData.find(f => f.id === this.p2Id);
    const stage = stagesData.find(s => s.id === this.stageId);

    this.transitioning = false;

    // Background - dark with diagonal split
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1a);

    // Left side tint (P1 color, low alpha)
    const p1Color = parseInt(p1.color, 16);
    const p2Color = parseInt(p2.color, 16);
    this.add.rectangle(GAME_WIDTH / 4, GAME_HEIGHT / 2, GAME_WIDTH / 2, GAME_HEIGHT, p1Color, 0.15);

    // Right side tint (P2 color, low alpha)
    this.add.rectangle(GAME_WIDTH * 3 / 4, GAME_HEIGHT / 2, GAME_WIDTH / 2, GAME_HEIGHT, p2Color, 0.15);

    // Center divider line
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 3, GAME_HEIGHT, 0xffffff, 0.3);

    // P1 portrait (left side)
    this.add.rectangle(GAME_WIDTH / 4, GAME_HEIGHT / 2 - 15, 90, 100, p1Color);
    this.add.rectangle(GAME_WIDTH / 4, GAME_HEIGHT / 2 - 15, 90, 100, 0x000000, 0)
      .setStrokeStyle(2, 0x3366ff);

    // P1 name and subtitle
    this.add.text(GAME_WIDTH / 4, GAME_HEIGHT / 2 + 45, p1.name, {
      fontFamily: 'Arial Black, Arial',
      fontSize: '16px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 4, GAME_HEIGHT / 2 + 62, p1.subtitle, {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#aaaacc',
      fontStyle: 'italic'
    }).setOrigin(0.5);

    // P1 intro dialog
    this.add.text(GAME_WIDTH / 4, GAME_HEIGHT - 35, `"${p1.dialogs.intro}"`, {
      fontFamily: 'Arial',
      fontSize: '7px',
      color: '#ccccee',
      fontStyle: 'italic',
      wordWrap: { width: 120 },
      align: 'center'
    }).setOrigin(0.5);

    // P2 portrait (right side)
    this.add.rectangle(GAME_WIDTH * 3 / 4, GAME_HEIGHT / 2 - 15, 90, 100, p2Color);
    this.add.rectangle(GAME_WIDTH * 3 / 4, GAME_HEIGHT / 2 - 15, 90, 100, 0x000000, 0)
      .setStrokeStyle(2, 0xff3333);

    // P2 name and subtitle
    this.add.text(GAME_WIDTH * 3 / 4, GAME_HEIGHT / 2 + 45, p2.name, {
      fontFamily: 'Arial Black, Arial',
      fontSize: '16px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH * 3 / 4, GAME_HEIGHT / 2 + 62, p2.subtitle, {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#aaaacc',
      fontStyle: 'italic'
    }).setOrigin(0.5);

    // P2 intro dialog
    this.add.text(GAME_WIDTH * 3 / 4, GAME_HEIGHT - 35, `"${p2.dialogs.intro}"`, {
      fontFamily: 'Arial',
      fontSize: '7px',
      color: '#ccccee',
      fontStyle: 'italic',
      wordWrap: { width: 120 },
      align: 'center'
    }).setOrigin(0.5);

    // VS text in center
    const vsText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 15, 'VS', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '40px',
      color: '#ffcc00',
      stroke: '#000000',
      strokeThickness: 6,
      shadow: { offsetX: 2, offsetY: 2, color: '#663300', blur: 8, fill: true }
    }).setOrigin(0.5);

    // Animate VS text
    this.tweens.add({
      targets: vsText,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Stage name at bottom
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 10, GAME_WIDTH, 20, 0x000000, 0.6);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 10, stage ? stage.name : 'Arena', {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#ffffff'
    }).setOrigin(0.5);

    // Auto-transition after 3 seconds
    this.autoTimer = this.time.delayedCall(3000, () => {
      this.goToFight();
    });

    // Tap to skip
    this.input.on('pointerdown', () => {
      this.goToFight();
    });

    this.input.keyboard.on('keydown', () => {
      this.goToFight();
    });
  }

  goToFight() {
    if (this.transitioning) return;
    this.transitioning = true;

    if (this.autoTimer) {
      this.autoTimer.remove();
    }

    this.cameras.main.fadeOut(400, 255, 255, 255);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('FightScene', {
        p1Id: this.p1Id,
        p2Id: this.p2Id,
        stageId: this.stageId
      });
    });
  }
}
