import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('PreFightScene');

export class PreFightScene extends Phaser.Scene {
  constructor() {
    super('PreFightScene');
  }

  init(data) {
    this.p1Id = data.p1Id;
    this.p2Id = data.p2Id;
    this.stageId = data.stageId;
    this.fightId = data.fightId || null;
    this.isRandomStage = data.isRandomStage || false;
    this.gameMode = data.gameMode || 'local';
    this.networkManager = data.networkManager || null;
    this.matchContext = data.matchContext || null;

    // If no stage is provided, pick one randomly
    if (!this.stageId) {
      const randomIndex = Phaser.Math.Between(0, stagesData.length - 1);
      this.stageId = stagesData[randomIndex].id;
      this.isRandomStage = true; // Implicitly random if not provided
    }
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.fadeOutMusic(1500);
    audio.createMuteButton(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    const p1 = fightersData.find((f) => f.id === this.p1Id);
    const p2 = fightersData.find((f) => f.id === this.p2Id);
    let selectedStage = stagesData.find((s) => s.id === this.stageId);
    if (!selectedStage) {
      log.warn(`Stage ${this.stageId} not found, falling back to first stage`);
      selectedStage = stagesData[0];
    }

    this.transitioning = false;

    // Background - dark with diagonal split
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1a);

    // Left side tint (P1 color, low alpha)
    const p1Color = parseInt(p1.color, 16);
    const p2Color = parseInt(p2.color, 16);
    this.add.rectangle(GAME_WIDTH / 4, GAME_HEIGHT / 2, GAME_WIDTH / 2, GAME_HEIGHT, p1Color, 0.15);

    // Right side tint (P2 color, low alpha)
    this.add.rectangle(
      (GAME_WIDTH * 3) / 4,
      GAME_HEIGHT / 2,
      GAME_WIDTH / 2,
      GAME_HEIGHT,
      p2Color,
      0.15,
    );

    // Center divider line
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 3, GAME_HEIGHT, 0xffffff, 0.3);

    // --- Stage Selection Box (Animated only if Random) ---
    const boxW = 140;
    const boxH = 80;
    const boxX = GAME_WIDTH / 2;
    const boxY = GAME_HEIGHT / 2 + 30;

    // Box background/border
    this.add.rectangle(boxX, boxY, boxW + 4, boxH + 4, 0xffffff, 0.3);
    this.add.rectangle(boxX, boxY, boxW, boxH, 0x000000);

    // Stage preview (use sprite so it can display both static and animated stage textures)
    this.stagePreview = this.add.sprite(
      boxX,
      boxY,
      selectedStage.texture,
      selectedStage.animated ? 0 : undefined,
    );
    this.stagePreview.setDisplaySize(boxW, boxH);

    // Stage info text (Name + Description)
    this.stageNameText = this.add
      .text(boxX, boxY + boxH / 2 + 12, selectedStage.name.toUpperCase(), {
        fontFamily: 'Arial Black, Arial',
        fontSize: '11px',
        color: this.isRandomStage ? '#ffffff' : '#ffcc00',
      })
      .setOrigin(0.5);

    // Stage description at the bottom
    this.stageDescBg = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT - 10,
      GAME_WIDTH,
      20,
      0x000000,
      0.6,
    );
    this.stageDescText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 10, selectedStage.description, {
        fontFamily: 'Arial',
        fontSize: '9px',
        color: '#ffffff',
        fontStyle: 'italic',
      })
      .setOrigin(0.5);

    if (this.isRandomStage) {
      // Animation logic for Random selection
      let currentIdx = 0;
      const animDuration = 2000; // 2 seconds total
      const startInterval = 60; // Start fast
      let currentInterval = startInterval;

      const cycleStage = () => {
        currentIdx = (currentIdx + 1) % stagesData.length;
        const stage = stagesData[currentIdx];
        this.stagePreview.setTexture(stage.texture, stage.animated ? 0 : undefined);
        this.stagePreview.setDisplaySize(boxW, boxH);
        this.stageNameText.setText(stage.name.toUpperCase());
        this.stageDescText.setText(stage.description);

        // Decelerate: increase interval for the next call
        currentInterval += 10;
        this.cycleTimer.reset({
          delay: currentInterval,
          callback: cycleStage,
          loop: true,
        });
      };

      // Run the fast cycling
      this.cycleTimer = this.time.addEvent({
        delay: currentInterval,
        callback: cycleStage,
        loop: true,
      });

      // Slow down and settle on the final selected stage
      this.settleTimer = this.time.delayedCall(animDuration - 400, () => {
        if (this.cycleTimer) {
          this.cycleTimer.remove();
          this.cycleTimer = null;
        }
        // Final selection
        const stage = selectedStage || stagesData[0];
        this.stagePreview.setTexture(stage.texture, stage.animated ? 0 : undefined);
        this.stagePreview.setDisplaySize(boxW, boxH);
        this.stageNameText.setText(stage.name.toUpperCase()).setColor('#ffcc00');
        this.stageDescText.setText(stage.description);

        // Flash effect on settle
        this.tweens.add({
          targets: this.stagePreview,
          alpha: { from: 0.5, to: 1 },
          duration: 200,
        });
      });
    } else {
      // If not random, just a subtle entrance for the stage box
      this.stagePreview.setAlpha(0);
      this.tweens.add({
        targets: this.stagePreview,
        alpha: 1,
        duration: 500,
        ease: 'Power2',
      });
    }

    // P1 portrait (left side)
    if (this.textures.exists(`portrait_${this.p1Id}`)) {
      this.add
        .image(GAME_WIDTH / 4, GAME_HEIGHT / 2 - 15, `portrait_${this.p1Id}`)
        .setDisplaySize(90, 100);
    } else {
      this.add.rectangle(GAME_WIDTH / 4, GAME_HEIGHT / 2 - 15, 90, 100, p1Color);
    }
    this.add
      .rectangle(GAME_WIDTH / 4, GAME_HEIGHT / 2 - 15, 90, 100, 0x000000, 0)
      .setStrokeStyle(2, 0x3366ff);

    // P1 name and subtitle
    this.add
      .text(GAME_WIDTH / 4, GAME_HEIGHT / 2 + 45, p1.name, {
        fontFamily: 'Arial Black, Arial',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 4, GAME_HEIGHT / 2 + 62, p1.subtitle, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#aaaacc',
        fontStyle: 'italic',
      })
      .setOrigin(0.5);

    // P1 intro dialog
    this.add
      .text(GAME_WIDTH / 4, GAME_HEIGHT - 35, `"${p1.dialogs.intro}"`, {
        fontFamily: 'Arial',
        fontSize: '7px',
        color: '#ccccee',
        fontStyle: 'italic',
        wordWrap: { width: 120 },
        align: 'center',
      })
      .setOrigin(0.5);

    // P2 portrait (right side)
    if (this.textures.exists(`portrait_${this.p2Id}`)) {
      this.add
        .image((GAME_WIDTH * 3) / 4, GAME_HEIGHT / 2 - 15, `portrait_${this.p2Id}`)
        .setDisplaySize(90, 100);
    } else {
      this.add.rectangle((GAME_WIDTH * 3) / 4, GAME_HEIGHT / 2 - 15, 90, 100, p2Color);
    }
    this.add
      .rectangle((GAME_WIDTH * 3) / 4, GAME_HEIGHT / 2 - 15, 90, 100, 0x000000, 0)
      .setStrokeStyle(2, 0xff3333);

    // P2 name and subtitle
    this.add
      .text((GAME_WIDTH * 3) / 4, GAME_HEIGHT / 2 + 45, p2.name, {
        fontFamily: 'Arial Black, Arial',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.add
      .text((GAME_WIDTH * 3) / 4, GAME_HEIGHT / 2 + 62, p2.subtitle, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#aaaacc',
        fontStyle: 'italic',
      })
      .setOrigin(0.5);

    // P2 intro dialog
    this.add
      .text((GAME_WIDTH * 3) / 4, GAME_HEIGHT - 35, `"${p2.dialogs.intro}"`, {
        fontFamily: 'Arial',
        fontSize: '7px',
        color: '#ccccee',
        fontStyle: 'italic',
        wordWrap: { width: 120 },
        align: 'center',
      })
      .setOrigin(0.5);

    // VS text in center
    const vsText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 15, 'VS', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '40px',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 6,
        shadow: { offsetX: 2, offsetY: 2, color: '#663300', blur: 8, fill: true },
      })
      .setOrigin(0.5);

    // Animate VS text
    this.tweens.add({
      targets: vsText,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Auto-transition after 4 seconds (longer to allow for stage animation)
    this.autoTimer = this.time.delayedCall(4000, () => {
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
    if (this.cycleTimer) {
      this.cycleTimer.remove();
    }
    if (this.settleTimer) {
      this.settleTimer.remove();
    }

    this.cameras.main.fadeOut(400, 255, 255, 255);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('FightScene', {
        p1Id: this.p1Id,
        p2Id: this.p2Id,
        stageId: this.stageId,
        fightId: this.fightId,
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }
}
