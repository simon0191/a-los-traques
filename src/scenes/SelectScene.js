import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import { TournamentManager } from '../services/TournamentManager.js';
import { createButton } from '../services/UIService.js';

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
    this.gameMode = data?.gameMode || 'local';
    this.networkManager = data?.networkManager || null;
    this.matchContext = data?.matchContext || null;
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.createMuteButton(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    this.fighters = [
      ...fightersData,
      {
        id: 'random',
        name: 'ALEATORIO',
        subtitle: '???',
        color: '0x555555',
        stats: { speed: 0, power: 0, defense: 0, special: 0 },
      },
    ];

    // Ensure all portrait textures use Linear filtering for better downscaling
    this.fighters.forEach(f => {
      const key = `portrait_${f.id}`;
      if (this.textures.exists(key)) {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
    });

    this.p1Index = 0;
    this.p2Index = 0;
    this.p1Confirmed = false;
    this.p2SelectionMode = false;
    this.p2Confirmed = false;
    this.transitioning = false;
    this.opponentFighterId = null;
    this.opponentReady = false;
    this.p1StatValues = null;
    this.p2StatValues = null;

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    // Header
    this.headerText = this.add
      .text(GAME_WIDTH / 2, 16, 'ELIGE TU LUCHADOR: JUGADOR 1', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '18px',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    // Player labels
    if (!this.sys.game.device.input.touch) {
      this.add.text(GRID_START_X, 34, 'Flechas + Z', {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#6688ff',
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

      let rect;
      if (fighter.id !== 'random' && this.textures.exists(`portrait_${fighter.id}`)) {
        rect = this.add
          .image(x, y, `portrait_${fighter.id}`)
          .setDisplaySize(CELL_W - 4, CELL_H - 10);
      } else {
        rect = this.add.rectangle(x, y, CELL_W - 4, CELL_H - 10, color);
        if (fighter.id === 'random') {
          this.add
            .text(x, y - 5, '?', { fontSize: '16px', color: '#ffffff', fontFamily: 'Arial Black' })
            .setOrigin(0.5);
        }
      }

      const nameText = this.add
        .text(x, y + CELL_H / 2 - 6, fighter.name, {
          fontFamily: 'Arial',
          fontSize: '7px',
          color: '#ffffff',
        })
        .setOrigin(0.5);

      rect.setInteractive();
      rect.on('pointerdown', () => {
        if (this.transitioning) return;
        if (!this.p1Confirmed) {
          this.p1Index = i;
          this.updateP1Display();
          this.game.audioManager.play('ui_navigate');
        } else if (this.p2SelectionMode && !this.p2Confirmed) {
          this.p2Index = i;
          this.updateP2Display();
          this.game.audioManager.play('ui_navigate');
        }
      });

      this.gridCells.push({ rect, nameText, x, y });
    }

    // LISTO Button
    const listoY = GRID_START_Y + ROWS * (CELL_H + GRID_GAP) + 10;
    const listoBtn = this.add
      .rectangle(
        GRID_START_X + (COLS * (CELL_W + GRID_GAP)) / 2 - GRID_GAP / 2,
        listoY,
        80,
        22,
        0x3366ff,
      )
      .setInteractive();
    this.add
      .text(listoBtn.x, listoBtn.y, 'LISTO', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '11px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    listoBtn.on('pointerdown', () => {
      if (this.transitioning) return;
      if (!this.p1Confirmed) {
        this.confirmP1();
      } else if (this.p2SelectionMode && !this.p2Confirmed) {
        this.confirmP2();
      }
    });

    this.p1Cursor = this.add
      .rectangle(0, 0, CELL_W, CELL_H, 0x000000, 0)
      .setStrokeStyle(2, 0x3366ff);

    this.p1CursorLabel = this.add
      .text(0, 0, 'P1', {
        fontFamily: 'Arial Black',
        fontSize: '10px',
        color: '#3366ff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1);

    this.p2Cursor = this.add
      .rectangle(0, 0, CELL_W, CELL_H, 0x000000, 0)
      .setStrokeStyle(2, 0xff3333)
      .setVisible(false);

    this.p2CursorLabel = this.add
      .text(0, 0, 'P2', {
        fontFamily: 'Arial Black',
        fontSize: '10px',
        color: '#ff3333',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setVisible(false);

    const panelX = 310;
    this.add.text(panelX, 50, 'JUGADOR 1', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '10px',
      color: '#3366ff',
    });

    this.p1NameText = this.add.text(panelX, 65, '', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '14px',
      color: '#ffffff',
    });

    this.p1SubtitleText = this.add.text(panelX, 82, '', {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#aaaacc',
      fontStyle: 'italic',
    });

    this.p1PortraitImg = this.add
      .image(panelX + 130, 70, '__DEFAULT')
      .setDisplaySize(45, 45)
      .setVisible(false);
    this.p1Portrait = this.add.rectangle(panelX + 130, 70, 45, 45, 0x333333);
    this.p1RandomText = this.add
      .text(panelX + 130, 70, '?', {
        fontFamily: 'Arial Black',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.p1StatLabels = [];
    this.p1StatBars = [];
    this.p1StatBarBgs = [];
    const statNames = ['speed', 'power', 'defense', 'special'];
    const statLabels = ['VEL', 'POD', 'DEF', 'ESP'];

    statNames.forEach((_stat, i) => {
      const sy = 100 + i * 14;
      this.add.text(panelX, sy, statLabels[i], {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#888899',
      });
      const barBg = this.add.rectangle(panelX + 30, sy + 4, 60, 6, 0x222233).setOrigin(0, 0.5);
      const bar = this.add
        .rectangle(panelX + 30, sy + 4, 60, 6, 0x44cc88)
        .setOrigin(0, 0.5)
        .setScale(0, 1);
      this.p1StatBarBgs.push(barBg);
      this.p1StatBars.push(bar);
    });

    this.add.rectangle(panelX + 75, 150, 150, 1, 0x333355);

    this.add.text(panelX, 158, 'JUGADOR 2', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '10px',
      color: '#ff3333',
    });

    this.p2NameText = this.add.text(panelX, 173, 'Aleatorio', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '14px',
      color: '#888888',
    });

    this.p2SubtitleText = this.add.text(panelX, 190, '', {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#aaaacc',
      fontStyle: 'italic',
    });

    this.p2PortraitImg = this.add
      .image(panelX + 130, 178, '__DEFAULT')
      .setDisplaySize(45, 45)
      .setVisible(false);
    this.p2Portrait = this.add.rectangle(panelX + 130, 178, 45, 45, 0x333333);
    this.p2RandomText = this.add
      .text(panelX + 130, 178, '?', {
        fontFamily: 'Arial Black',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.p2StatBars = [];
    this.p2StatBarBgs = [];
    statNames.forEach((_stat, i) => {
      const sy = 208 + i * 14;
      this.add.text(panelX, sy, statLabels[i], {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#888899',
      });
      const barBg = this.add.rectangle(panelX + 30, sy + 4, 60, 6, 0x222233).setOrigin(0, 0.5);
      const bar = this.add
        .rectangle(panelX + 30, sy + 4, 60, 6, 0xcc4444)
        .setOrigin(0, 0.5)
        .setScale(0, 1);
      this.p2StatBarBgs.push(barBg);
      this.p2StatBars.push(bar);
    });

    createButton(this, 60, GAME_HEIGHT - 20, 'VOLVER', () => this.handleBack(), { width: 110, height: 20, fontSize: '9px' });

    this.confirmedText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 12, '', {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#ffcc00',
    }).setOrigin(0.5);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyZ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

    this.input.keyboard.on('keydown', (event) => {
      if (this.transitioning) return;
      if (event.code === 'Escape' || event.code === 'Backspace') {
        this.handleBack();
        return;
      }
      if (!this.p1Confirmed) {
        switch (event.code) {
          case 'ArrowLeft': this.moveP1Cursor(-1, 0); break;
          case 'ArrowRight': this.moveP1Cursor(1, 0); break;
          case 'ArrowUp': this.moveP1Cursor(0, -1); break;
          case 'ArrowDown': this.moveP1Cursor(0, 1); break;
          case 'KeyZ': this.confirmP1(); break;
        }
      } else if (this.p2SelectionMode && !this.p2Confirmed) {
        switch (event.code) {
          case 'ArrowLeft': this.moveP2Cursor(-1, 0); break;
          case 'ArrowRight': this.moveP2Cursor(1, 0); break;
          case 'ArrowUp': this.moveP2Cursor(0, -1); break;
          case 'ArrowDown': this.moveP2Cursor(0, 1); break;
          case 'KeyZ': this.confirmP2(); break;
        }
      }
    });

    this.updateP1Display();
    this.updateP2Display();

    if (this.gameMode === 'online' && this.networkManager) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 8, `SALA: ${this.networkManager.roomId}`, {
        fontSize: '7px', fontFamily: 'monospace', color: '#aaaacc', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 1).setDepth(10);

      this._connectionText = this.add.text(GAME_WIDTH - 4, GAME_HEIGHT - 8, '', {
        fontSize: '6px', fontFamily: 'monospace', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(1, 1).setDepth(10);

      this._updateConnectionStatus();
      this.time.addEvent({ delay: 2000, loop: true, callback: () => this._updateConnectionStatus() });

      this.networkManager.resetForReselect();
      this.networkManager.onOpponentReady((id) => {
        this.opponentFighterId = id;
        this.opponentReady = true;
        if (this.p1Confirmed) this._showOpponentSelection(id);
      });
      this.networkManager.onGoToStageSelect((data) => {
        this._startData = data;
        this.confirmedText.setText('Listo! Elige el escenario...');
        this.time.delayedCall(800, () => this.goToStageSelect());
      });

      this.networkManager.onDisconnect(() => {
        this.transitioning = true;
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Oponente desconectado', {
          fontSize: '14px', fontFamily: 'monospace', color: '#ff4444', stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(50);
        this.time.delayedCall(1500, () => {
          this.networkManager?.destroy();
          this.scene.start('TitleScene');
        });
      });
    }
  }

  moveP1Cursor(dx, dy) {
    let col = this.p1Index % COLS;
    let row = Math.floor(this.p1Index / COLS);
    col = Phaser.Math.Clamp(col + dx, 0, COLS - 1);
    row = Phaser.Math.Clamp(row + dy, 0, ROWS - 1);
    const newIdx = row * COLS + col;
    if (newIdx < this.fighters.length) {
      this.p1Index = newIdx;
      this.updateP1Display();
      this.game.audioManager.play('ui_navigate');
    }
  }

  moveP2Cursor(dx, dy) {
    let col = this.p2Index % COLS;
    let row = Math.floor(this.p2Index / COLS);
    col = Phaser.Math.Clamp(col + dx, 0, COLS - 1);
    row = Phaser.Math.Clamp(row + dy, 0, ROWS - 1);
    const newIdx = row * COLS + col;
    if (newIdx < this.fighters.length) {
      this.p2Index = newIdx;
      this.updateP2Display();
      this.game.audioManager.play('ui_navigate');
    }
  }

  updateP1Display() {
    const cell = this.gridCells[this.p1Index];
    this.p1Cursor.setPosition(cell.x, cell.y);
    this.p1CursorLabel.setPosition(cell.x, cell.y - CELL_H / 2 - 2);

    const fighter = this.fighters[this.p1Index];
    this.p1NameText.setText(fighter.name);
    this.p1SubtitleText.setText(fighter.subtitle);
    const isRandom = fighter.id === 'random';

    if (!isRandom && this.textures.exists(`portrait_${fighter.id}`)) {
      this.p1PortraitImg.setTexture(`portrait_${fighter.id}`).setVisible(true);
      this.p1Portrait.setVisible(false);
      this.p1RandomText.setVisible(false);
    } else {
      this.p1PortraitImg.setVisible(false);
      this.p1Portrait.setVisible(true).setFillStyle(parseInt(fighter.color, 16));
      this.p1RandomText.setVisible(isRandom);
    }

    const panelX = 310;
    statNames.forEach((stat, i) => {
      const val = isRandom ? 0 : fighter.stats[stat];
      this.p1StatBars[i].scaleX = val / 5;
      if (!this.p1StatValues) this.p1StatValues = [];
      if (!this.p1StatValues[i]) {
        this.p1StatValues[i] = this.add.text(panelX + 95, 100 + i * 14, '', { fontFamily: 'Arial', fontSize: '8px', color: '#ffffff' }).setOrigin(0.5);
      }
      this.p1StatValues[i].setText(isRandom ? '???' : val.toString());
    });
  }

  updateP2Display() {
    this._showP2Selection(this.p2Index);
  }

  handleBack() {
    if (this.transitioning) return;
    this.game.audioManager.play('ui_cancel');
    if (this.gameMode === 'online' && this.networkManager) {
      if (this.p1Confirmed) this.networkManager.sendLeave();
      this.networkManager.destroy();
    }
    this.scene.start('TitleScene');
  }

  confirmP1() {
    this.game.audioManager.play('ui_confirm');
    this.p1Confirmed = true;
    if (this.fighters[this.p1Index].id === 'random') {
      this.p1Index = Phaser.Math.Between(0, this.fighters.length - 2);
      this.updateP1Display();
    }
    this.p1Cursor.setStrokeStyle(3, 0x00ccff);

    if (this.gameMode === 'online') {
      this.networkManager.sendReady(this.fighters[this.p1Index].id);
      this.confirmedText.setText('Esperando al oponente...');
      if (this.opponentReady) this._showOpponentSelection(this.opponentFighterId);
    } else {
      this.p2SelectionMode = true;
      this.headerText.setText('ELIGE TU OPONENTE: JUGADOR 2');
      this.p1Cursor.setAlpha(0.5);
      this.p1CursorLabel.setAlpha(0.5);
      this.p2Cursor.setVisible(true);
      this.p2CursorLabel.setVisible(true);
      this.p2Index = this.fighters.length - 1;
      this.updateP2Display();
      this.confirmedText.setText('Jugador 1 Listo. Esperando Jugador 2...');
    }
  }

  confirmP2() {
    this.game.audioManager.play('ui_confirm');
    this.p2Confirmed = true;
    this.p2Cursor.setStrokeStyle(3, 0xff8800);
    if (this.fighters[this.p2Index].id === 'random') {
      let idx;
      do { idx = Phaser.Math.Between(0, this.fighters.length - 2); } while (idx === this.p1Index);
      this.p2Index = idx;
      this.updateP2Display();
    }
    this.confirmedText.setText('Listo! Preparando combate...');
    this.time.delayedCall(1000, () => this.goToStageSelect());
  }

  _showOpponentSelection(id) {
    const idx = this.fighters.findIndex(f => f.id === id);
    if (idx !== -1) {
      this.p2Index = idx;
      this._showP2Selection(idx);
    }
  }

  _showP2Selection(idx) {
    const cell = this.gridCells[idx];
    this.p2Cursor.setPosition(cell.x, cell.y).setVisible(true);
    this.p2CursorLabel.setPosition(cell.x, cell.y - CELL_H / 2 - 2).setVisible(true);

    const f = this.fighters[idx];
    this.p2NameText.setText(f.name);
    this.p2SubtitleText.setText(f.subtitle);
    const isRandom = f.id === 'random';

    if (!isRandom && this.textures.exists(`portrait_${f.id}`)) {
      this.p2PortraitImg.setTexture(`portrait_${f.id}`).setVisible(true);
      this.p2Portrait.setVisible(false);
      this.p2RandomText.setVisible(false);
    } else {
      this.p2PortraitImg.setVisible(false);
      this.p2Portrait.setVisible(true).setFillStyle(parseInt(f.color, 16));
      this.p2RandomText.setVisible(isRandom);
    }

    const panelX = 310;
    statNames.forEach((stat, i) => {
      const val = isRandom ? 0 : f.stats[stat];
      this.p2StatBars[i].scaleX = val / 5;
      if (!this.p2StatValues) this.p2StatValues = [];
      if (!this.p2StatValues[i]) {
        this.p2StatValues[i] = this.add.text(panelX + 95, 208 + i * 14, '', { fontFamily: 'Arial', fontSize: '8px', color: '#ffffff' }).setOrigin(0.5);
      }
      this.p2StatValues[i].setText(isRandom ? '???' : val.toString());
    });
  }

  goToStageSelect() {
    if (this.transitioning) return;
    this.transitioning = true;
    let p1Id = this.fighters[this.p1Index].id;
    let p2Id = this.fighters[this.p2Index].id;
    if (this.gameMode === 'online' && this._startData) {
      p1Id = this._startData.p1Id;
      p2Id = this._startData.p2Id;
    }
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('StageSelectScene', { p1Id, p2Id, gameMode: this.gameMode, networkManager: this.networkManager, matchContext: this.matchContext });
    });
  }

  _updateConnectionStatus() {
    if (!this._connectionText || !this.networkManager) return;
    const nm = this.networkManager;
    if (nm._webrtcReady) {
      this._connectionText.setText('P2P').setColor('#44ff44');
    } else if (nm.connected) {
      this._connectionText.setText('Relay').setColor('#ffcc44');
    } else {
      this._connectionText.setText('...').setColor('#ff4444');
    }
  }
}

const statNames = ['speed', 'power', 'defense', 'special'];
