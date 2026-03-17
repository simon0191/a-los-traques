import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';

const COLS = 6;
const ROWS = 3;
const CELL_W = 40;
const CELL_H = 40;
const GRID_GAP = 4;
const GRID_START_X = 30;
const GRID_START_Y = 50;

export class SelectScene extends Phaser.Scene {
  constructor() {
    super('SelectScene');
  }

  init(data) {
    this.gameMode = (data && data.gameMode) || 'local';
    this.networkManager = (data && data.networkManager) || null;
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.createMuteButton(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    this.fighters = fightersData;
    this.p1Index = 0;
    this.p2Index = -1; // not yet selected
    this.p1Confirmed = false;
    this.transitioning = false;
    this.opponentFighterId = null;
    this.opponentReady = false;

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    // Header
    this.add.text(GAME_WIDTH / 2, 16, 'ELIGE TU LUCHADOR', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '18px',
      color: '#ffcc00',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    // Player labels (only show keyboard hint on non-touch devices)
    if (!this.sys.game.device.input.touch) {
      this.add.text(GRID_START_X, 34, 'P1: Flechas + Z', {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#6688ff'
      });
    }

    // Draw fighter grid
    this.gridCells = [];
    for (let i = 0; i < this.fighters.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = GRID_START_X + col * (CELL_W + GRID_GAP) + CELL_W / 2;
      const y = GRID_START_Y + row * (CELL_H + GRID_GAP) + CELL_H / 2;

      const fighter = this.fighters[i];
      const color = parseInt(fighter.color, 16);

      // Fighter cell: use portrait if available, else colored rectangle
      let rect;
      if (this.textures.exists(`portrait_${fighter.id}`)) {
        rect = this.add.image(x, y, `portrait_${fighter.id}`)
          .setDisplaySize(CELL_W - 4, CELL_H - 10);
      } else {
        rect = this.add.rectangle(x, y, CELL_W - 4, CELL_H - 10, color);
      }

      // Fighter name below rectangle
      const nameText = this.add.text(x, y + CELL_H / 2 - 6, fighter.name, {
        fontFamily: 'Arial',
        fontSize: '7px',
        color: '#ffffff'
      }).setOrigin(0.5);

      // Make cell tappable for touch selection
      rect.setInteractive();
      rect.on('pointerdown', () => {
        if (this.transitioning || this.p1Confirmed) return;
        this.p1Index = i;
        this.updateP1Display();
        this.game.audioManager.play('ui_navigate');
      });

      this.gridCells.push({ rect, nameText, x, y });
    }

    // "LISTO" confirm button for touch devices
    const listoY = GRID_START_Y + ROWS * (CELL_H + GRID_GAP) + 10;
    const listoBtn = this.add.rectangle(
      GRID_START_X + (COLS * (CELL_W + GRID_GAP)) / 2 - GRID_GAP / 2,
      listoY, 80, 22, 0x3366ff
    ).setInteractive();
    this.add.text(listoBtn.x, listoBtn.y, 'LISTO', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '11px',
      color: '#ffffff'
    }).setOrigin(0.5);
    listoBtn.on('pointerdown', () => {
      if (this.transitioning || this.p1Confirmed) return;
      this.confirmP1();
    });

    // P1 cursor (blue border)
    this.p1Cursor = this.add.rectangle(0, 0, CELL_W, CELL_H, 0x000000, 0)
      .setStrokeStyle(2, 0x3366ff);

    // P2 cursor (red border) - hidden until P2 selected
    this.p2Cursor = this.add.rectangle(0, 0, CELL_W, CELL_H, 0x000000, 0)
      .setStrokeStyle(2, 0xff3333)
      .setVisible(false);

    // Info panel - right side
    const panelX = 310;

    // P1 info
    this.add.text(panelX, 50, 'JUGADOR 1', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '10px',
      color: '#3366ff'
    });

    this.p1NameText = this.add.text(panelX, 65, '', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '14px',
      color: '#ffffff'
    });

    this.p1SubtitleText = this.add.text(panelX, 82, '', {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#aaaacc',
      fontStyle: 'italic'
    });

    // P1 Portrait (image or rectangle placeholder)
    this.p1PortraitImg = this.add.image(panelX + 130, 70, '__DEFAULT').setDisplaySize(45, 45).setVisible(false);
    this.p1Portrait = this.add.rectangle(panelX + 130, 70, 45, 45, 0x333333);

    // P1 Stats
    this.p1StatLabels = [];
    this.p1StatBars = [];
    this.p1StatBarBgs = [];
    const statNames = ['speed', 'power', 'defense', 'special'];
    const statLabels = ['VEL', 'POD', 'DEF', 'ESP'];

    statNames.forEach((stat, i) => {
      const sy = 100 + i * 14;
      const label = this.add.text(panelX, sy, statLabels[i], {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#888899'
      });
      const barBg = this.add.rectangle(panelX + 30, sy + 4, 60, 6, 0x222233).setOrigin(0, 0.5);
      const bar = this.add.rectangle(panelX + 30, sy + 4, 0, 6, 0x44cc88).setOrigin(0, 0.5);

      this.p1StatLabels.push(label);
      this.p1StatBarBgs.push(barBg);
      this.p1StatBars.push(bar);
    });

    // Divider
    this.add.rectangle(panelX + 75, 170, 150, 1, 0x333355);

    // P2 info
    this.add.text(panelX, 178, 'JUGADOR 2', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '10px',
      color: '#ff3333'
    });

    this.p2NameText = this.add.text(panelX, 193, 'Aleatorio', {
      fontFamily: 'Arial',
      fontSize: '14px',
      color: '#888888'
    });

    this.p2SubtitleText = this.add.text(panelX, 210, '', {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#aaaacc',
      fontStyle: 'italic'
    });

    // P2 Portrait (image or rectangle placeholder)
    this.p2PortraitImg = this.add.image(panelX + 130, 198, '__DEFAULT').setDisplaySize(45, 45).setVisible(false);
    this.p2Portrait = this.add.rectangle(panelX + 130, 198, 45, 45, 0x333333);

    // P2 Stats
    this.p2StatBars = [];
    this.p2StatBarBgs = [];
    statNames.forEach((stat, i) => {
      const sy = 228 + i * 14;
      this.add.text(panelX, sy, statLabels[i], {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#888899'
      });
      const barBg = this.add.rectangle(panelX + 30, sy + 4, 60, 6, 0x222233).setOrigin(0, 0.5);
      const bar = this.add.rectangle(panelX + 30, sy + 4, 0, 6, 0xcc4444).setOrigin(0, 0.5);

      this.p2StatBarBgs.push(barBg);
      this.p2StatBars.push(bar);
    });

    // Confirmed overlay text
    this.confirmedText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 12, '', {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#ffcc00'
    }).setOrigin(0.5);

    // Keyboard input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyZ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

    this.input.keyboard.on('keydown', (event) => {
      if (this.transitioning) return;

      if (!this.p1Confirmed) {
        switch (event.code) {
          case 'ArrowLeft':
            this.moveP1Cursor(-1, 0);
            break;
          case 'ArrowRight':
            this.moveP1Cursor(1, 0);
            break;
          case 'ArrowUp':
            this.moveP1Cursor(0, -1);
            break;
          case 'ArrowDown':
            this.moveP1Cursor(0, 1);
            break;
          case 'KeyZ':
            this.confirmP1();
            break;
        }
      }
    });

    // Update display
    this.updateP1Display();

    // In online mode, reset stale state and listen for opponent ready early
    if (this.gameMode === 'online' && this.networkManager) {
      this.networkManager.resetForReselect();
      this.networkManager.onOpponentReady((fighterId) => {
        this.opponentFighterId = fighterId;
        this.opponentReady = true;
        if (this.p1Confirmed) {
          this._showOpponentSelection(fighterId);
        }
      });
    }
  }

  moveP1Cursor(dx, dy) {
    let col = this.p1Index % COLS;
    let row = Math.floor(this.p1Index / COLS);

    col = Phaser.Math.Clamp(col + dx, 0, COLS - 1);
    row = Phaser.Math.Clamp(row + dy, 0, ROWS - 1);

    const newIndex = row * COLS + col;
    if (newIndex < this.fighters.length) {
      this.p1Index = newIndex;
      this.updateP1Display();
      this.game.audioManager.play('ui_navigate');
    }
  }

  updateP1Display() {
    const cell = this.gridCells[this.p1Index];
    this.p1Cursor.setPosition(cell.x, cell.y);

    const fighter = this.fighters[this.p1Index];
    this.p1NameText.setText(fighter.name);
    this.p1SubtitleText.setText(fighter.subtitle);
    if (this.textures.exists(`portrait_${fighter.id}`)) {
      this.p1PortraitImg.setTexture(`portrait_${fighter.id}`).setDisplaySize(45, 45).setVisible(true);
      this.p1Portrait.setVisible(false);
    } else {
      this.p1PortraitImg.setVisible(false);
      this.p1Portrait.setVisible(true);
      this.p1Portrait.setFillStyle(parseInt(fighter.color, 16));
    }

    const statNames = ['speed', 'power', 'defense', 'special'];
    statNames.forEach((stat, i) => {
      const val = fighter.stats[stat];
      this.p1StatBars[i].width = (val / 5) * 60;
    });
  }

  confirmP1() {
    this.game.audioManager.play('ui_confirm');
    this.p1Confirmed = true;

    // Highlight confirmed cell
    const cell = this.gridCells[this.p1Index];
    this.p1Cursor.setStrokeStyle(3, 0x00ccff);

    if (this.gameMode === 'online') {
      // Send ready with our fighter selection
      const myFighter = this.fighters[this.p1Index];
      this.networkManager.sendReady(myFighter.id);
      this.confirmedText.setText('Esperando al oponente...');

      // Listen for opponent ready
      this.networkManager.onOpponentReady((fighterId) => {
        this.opponentFighterId = fighterId;
        this.opponentReady = true;
        this._showOpponentSelection(fighterId);
      });

      // Listen for start signal
      this.networkManager.onStart((data) => {
        // Server decided stage + confirmed both fighters
        this._startData = data;
        this.confirmedText.setText('Listo! Preparando combate...');
        this.time.delayedCall(800, () => {
          this.goToPreFight();
        });
      });

      // If opponent was already ready before us
      if (this.opponentReady) {
        this._showOpponentSelection(this.opponentFighterId);
      }
    } else {
      // Local mode: auto-select P2 as random different fighter
      let p2Idx;
      do {
        p2Idx = Phaser.Math.Between(0, this.fighters.length - 1);
      } while (p2Idx === this.p1Index);
      this.p2Index = p2Idx;

      this._showP2Selection(p2Idx);
      this.confirmedText.setText('Listo! Preparando combate...');

      // Transition after short delay
      this.time.delayedCall(1000, () => {
        this.goToPreFight();
      });
    }
  }

  _showOpponentSelection(fighterId) {
    const idx = this.fighters.findIndex(f => f.id === fighterId);
    if (idx === -1) return;
    this.p2Index = idx;
    this._showP2Selection(idx);
  }

  _showP2Selection(idx) {
    // Show P2 cursor
    const p2Cell = this.gridCells[idx];
    this.p2Cursor.setPosition(p2Cell.x, p2Cell.y).setVisible(true);

    // Update P2 display
    const p2Fighter = this.fighters[idx];
    this.p2NameText.setText(p2Fighter.name);
    this.p2SubtitleText.setText(p2Fighter.subtitle);
    if (this.textures.exists(`portrait_${p2Fighter.id}`)) {
      this.p2PortraitImg.setTexture(`portrait_${p2Fighter.id}`).setDisplaySize(45, 45).setVisible(true);
      this.p2Portrait.setVisible(false);
    } else {
      this.p2PortraitImg.setVisible(false);
      this.p2Portrait.setVisible(true);
      this.p2Portrait.setFillStyle(parseInt(p2Fighter.color, 16));
    }

    const statNames = ['speed', 'power', 'defense', 'special'];
    statNames.forEach((stat, i) => {
      const val = p2Fighter.stats[stat];
      this.p2StatBars[i].width = (val / 5) * 60;
    });
  }

  goToPreFight() {
    if (this.transitioning) return;
    this.transitioning = true;

    let p1Id, p2Id, stageId;

    if (this.gameMode === 'online' && this._startData) {
      p1Id = this._startData.p1Id;
      p2Id = this._startData.p2Id;
      stageId = this._startData.stageId;
    } else {
      p1Id = this.fighters[this.p1Index].id;
      p2Id = this.fighters[this.p2Index].id;
      const stageIndex = Phaser.Math.Between(0, stagesData.length - 1);
      stageId = stagesData[stageIndex].id;
    }

    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('PreFightScene', {
        p1Id,
        p2Id,
        stageId,
        gameMode: this.gameMode,
        networkManager: this.networkManager
      });
    });
  }
}
