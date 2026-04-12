import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import { TournamentManager } from '../services/TournamentManager.js';
import { createButton } from '../services/UIService.js';

const COLS = 5;
const ROWS = 4;
const CELL_W = 44;
const CELL_H = 44;
const GRID_GAP = 5;
const GRID_START_X = 20;
const GRID_START_Y = 48;

const VIEW_TOP = 35;
const VIEW_BOTTOM = 235;
const VIEW_WIDTH = 285;

export class SelectScene extends Phaser.Scene {
  constructor() {
    super('SelectScene');
    this.portraitDOMs = [];
    this.nameDOMs = [];
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

    if (!this.textures.exists('dom_random_q')) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#333333';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 80px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 64, 64);
      this.textures.addCanvas('dom_random_q', canvas);
    }

    this.p1Index = 0;
    this.p2Index = 0;
    this.p1Confirmed = false;
    this.p2SelectionMode = false;
    this.p2Confirmed = false;
    this.pendingUnready = false;
    this.transitioning = false;
    this.opponentFighterId = null;
    this.opponentReady = false;
    this.p1StatValues = null;
    this.p2StatValues = null;

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.headerText = this.add
      .text(GAME_WIDTH / 2, 16, 'ELIGE TU LUCHADOR: JUGADOR 1', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '18px',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.gridContainer = this.add.container(0, 0);
    this.gridCells = [];
    this.portraitDOMs = [];
    this.nameDOMs = [];

    for (let i = 0; i < this.fighters.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cellX = GRID_START_X + col * (CELL_W + GRID_GAP);
      const cellY = GRID_START_Y + row * (CELL_H + GRID_GAP);
      const fighter = this.fighters[i];
      const color = parseInt(fighter.color, 16);

      const pDOM = this.add.dom(cellX + 2, cellY + 2, 'img').setOrigin(0, 0);
      pDOM.node.style.width = '40px';
      pDOM.node.style.height = '34px';
      pDOM.node.style.objectFit = 'cover';
      pDOM.node.style.borderRadius = '2px';
      pDOM.node.style.border = '1px solid #444466';

      if (fighter.id !== 'random') {
        pDOM.node.src = `assets/portraits/${fighter.id}.png`;
      } else {
        pDOM.node.src = this.textures.get('dom_random_q').getSourceImage().toDataURL();
      }

      const nDOM = this.add
        .dom(
          cellX + CELL_W / 2,
          cellY + 40,
          'div',
          {
            'font-family': "'Courier New', Courier, monospace",
            'font-size': '8px',
            'font-weight': 'bold',
            color: '#ffffff',
            'text-align': 'center',
            width: '44px',
            'pointer-events': 'none',
            'text-shadow': '1px 1px 2px #000000, 0px 0px 1px #000000',
          },
          fighter.name,
        )
        .setOrigin(0.5, 0.5);

      const rect = this.add.rectangle(cellX + 2, cellY + 2, 40, 34, color, 0.2).setOrigin(0, 0);
      rect.setInteractive();
      rect.on('pointerdown', () => {
        if (this.transitioning) return;
        if (!this.p1Confirmed) {
          this.p1Index = i;
          this.updateP1Display();
          this._scrollToFit(i);
          this.game.audioManager.play('ui_navigate');
        } else if (this.p2SelectionMode && !this.p2Confirmed) {
          this.p2Index = i;
          this.updateP2Display();
          this._scrollToFit(i);
          this.game.audioManager.play('ui_navigate');
        }
      });

      this.gridContainer.add(rect);
      this.gridCells.push({ x: cellX + 2, y: cellY + 2, pDOM, nDOM });
      this.portraitDOMs.push(pDOM);
      this.nameDOMs.push(nDOM);
    }

    this.p1Cursor = this.add
      .rectangle(0, 0, CELL_W, CELL_H, 0x000000, 0)
      .setStrokeStyle(2, 0x3366ff)
      .setOrigin(0, 0);
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
      .setVisible(false)
      .setOrigin(0, 0);
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

    this.gridContainer.add([this.p1Cursor, this.p1CursorLabel, this.p2Cursor, this.p2CursorLabel]);

    const maskGfx = this.make.graphics();
    maskGfx.fillStyle(0xffffff);
    maskGfx.fillRect(0, VIEW_TOP, VIEW_WIDTH, VIEW_BOTTOM - VIEW_TOP);
    this.gridContainer.setMask(maskGfx.createGeometryMask());

    const listoBtn = this.add.rectangle(110, 252, 60, 22, 0x3366ff).setInteractive();
    this.add
      .text(listoBtn.x, listoBtn.y, 'LISTO', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '10px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    listoBtn.on('pointerdown', () => {
      if (this.transitioning) return;
      if (!this.p1Confirmed) this.confirmP1();
      else if (this.p2SelectionMode && !this.p2Confirmed) this.confirmP2();
    });

    createButton(this, 45, 252, 'VOLVER', () => this.handleBack(), {
      width: 60,
      height: 22,
      fontSize: '9px',
    });

    this.confirmedText = this.add
      .text(150, GAME_HEIGHT - 12, '', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#ffcc00',
      })
      .setOrigin(0.5);

    const panelX = 295;
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
    this.p1PreviewSprite = this.add
      .sprite(panelX + 110, 100, '__DEFAULT')
      .setScale(0.8)
      .setVisible(false);
    this.p1Portrait = this.add.rectangle(panelX + 110, 70, 45, 45, 0x333333).setOrigin(0.5, 0.5);
    this.p1RandomText = this.add
      .text(panelX + 110, 70, '?', {
        fontFamily: 'Arial Black',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.p1StatBars = [];
    const statLabels = ['VEL', 'POD', 'DEF', 'ESP'];
    const statNames = ['speed', 'power', 'defense', 'special'];
    statNames.forEach((_, i) => {
      const sy = 100 + i * 14;
      this.add.text(panelX, sy, statLabels[i], {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#888899',
      });
      this.add.rectangle(panelX + 30, sy + 4, 60, 6, 0x222233).setOrigin(0, 0.5);
      const bar = this.add
        .rectangle(panelX + 30, sy + 4, 60, 6, 0x44cc88)
        .setOrigin(0, 0.5)
        .setScale(0, 1);
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
    this.p2PreviewSprite = this.add
      .sprite(panelX + 110, 208, '__DEFAULT')
      .setScale(0.8)
      .setVisible(false);
    this.p2Portrait = this.add.rectangle(panelX + 110, 178, 45, 45, 0x333333).setOrigin(0.5, 0.5);
    this.p2RandomText = this.add
      .text(panelX + 110, 178, '?', {
        fontFamily: 'Arial Black',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.p2StatBars = [];
    statNames.forEach((_, i) => {
      const sy = 208 + i * 14;
      this.add.text(panelX, sy, statLabels[i], {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#888899',
      });
      this.add.rectangle(panelX + 30, sy + 4, 60, 6, 0x222233).setOrigin(0, 0.5);
      const bar = this.add
        .rectangle(panelX + 30, sy + 4, 60, 6, 0xcc4444)
        .setOrigin(0, 0.5)
        .setScale(0, 1);
      this.p2StatBars.push(bar);
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown', (event) => {
      if (this.transitioning) return;
      if (event.code === 'Escape' || event.code === 'Backspace') this.handleBack();
      if (event.code === 'KeyZ' || event.code === 'Enter' || event.code === 'Space') {
        if (!this.p1Confirmed) this.confirmP1();
        else if (this.p2SelectionMode && !this.p2Confirmed) this.confirmP2();
      }
    });

    this.updateP1Display();
    this.updateP2Display();

    if (this.gameMode === 'online' && this.networkManager) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT - 8, `SALA: ${this.networkManager.roomId}`, {
          fontSize: '7px',
          fontFamily: 'monospace',
          color: '#aaaacc',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(10);
      this._connectionText = this.add
        .text(GAME_WIDTH - 4, GAME_HEIGHT - 8, '', {
          fontSize: '6px',
          fontFamily: 'monospace',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(1, 1)
        .setDepth(10);
      this._updateConnectionStatus();
      this.time.addEvent({
        delay: 2000,
        loop: true,
        callback: () => this._updateConnectionStatus(),
      });
      this.networkManager.resetForReselect();
      this.networkManager.onOpponentReady((id) => {
        this.opponentFighterId = id;
        this.opponentReady = true;
        if (this.p1Confirmed) this._showOpponentSelection(id);
      });
      this.networkManager.onOpponentUnready(() => {
        this.opponentReady = false;
        this.opponentFighterId = null;
        this.p2Cursor.setVisible(false);
        this.p2CursorLabel.setVisible(false);
        this.p2PreviewSprite.setVisible(false);
        this.p2Portrait.setVisible(true).setFillStyle(0x333333);
        this.p2NameText.setText('Aleatorio');
        this.p2SubtitleText.setText('');
        this.p2StatBars.forEach((bar) => {
          bar.setScale(0, 1);
        });
        if (this.p2StatValues) {
          this.p2StatValues.forEach((txt) => {
            txt.setText('???');
          });
        }
      });
      this.networkManager.onGoToStageSelect((data) => {
        this._startData = data;
        this.confirmedText.setText('Listo! Elige el escenario...');
        this.time.delayedCall(800, () => this.goToStageSelect());
      });
      this.networkManager.onUnreadyConfirmed(() => {
        if (this.pendingUnready) {
          this.pendingUnready = false;
          this._resetP1Confirmation();
        }
      });
      if (this.game.autoplay?.enabled) {
        const autoId = this.game.autoplay.fighterId;
        const idx = autoId ? this.fighters.findIndex((f) => f.id === autoId) : -1;
        this.p1Index = idx >= 0 ? idx : Phaser.Math.Between(0, this.fighters.length - 2);
        this.updateP1Display();
        this.confirmP1();
      }
      this.networkManager.onDisconnect(() => {
        this.transitioning = true;
        this.add
          .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Oponente desconectado', {
            fontSize: '14px',
            fontFamily: 'monospace',
            color: '#ff4444',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5)
          .setDepth(50);
        this.time.delayedCall(1500, () => {
          this.networkManager?.destroy();
          this.cameras.main.fadeOut(300, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('TitleScene');
          });
        });
      });
    }

    if (this.gameMode === 'local' && this.game.autoplay?.enabled) {
      const autoId = this.game.autoplay.fighterId;
      const idx = autoId ? this.fighters.findIndex((f) => f.id === autoId) : -1;
      this.p1Index = idx >= 0 ? idx : Phaser.Math.Between(0, this.fighters.length - 2);
      this.updateP1Display();
      this.confirmP1();
    }

    this.input.on('wheel', (_pointer, _gameObjects, _dx, dy) => {
      if (this.transitioning) return;
      this.gridContainer.y -= dy * 0.5;
      this._clampScroll();
      this._syncDOMPortraits();
    });

    this._isDragging = false;
    this.input.on('pointerdown', (p) => {
      if (p.x < VIEW_WIDTH && p.y > VIEW_TOP && p.y < VIEW_BOTTOM) {
        this._isDragging = true;
        this._startY = p.y;
        this._startGridY = this.gridContainer.y;
      }
    });
    this.input.on('pointermove', (p) => {
      if (!this._isDragging || this.transitioning) return;
      this.gridContainer.y = this._startGridY + (p.y - this._startY);
      this._clampScroll();
      this._syncDOMPortraits();
    });
    this.input.on('pointerup', () => {
      this._isDragging = false;
    });

    this.navTimers = { up: 0, down: 0, left: 0, right: 0 };
    this.NAV_DELAY = 500;
    this.NAV_FREQ = 200;

    // Global navigation bindings
    this.events.on('wake', this._bindNavEvents, this);
    this.events.on('sleep', this._unbindNavEvents, this);
    this.events.on('shutdown', () => {
      this._unbindNavEvents();
      for (const dom of this.portraitDOMs) {
        dom.destroy();
      }
      for (const dom of this.nameDOMs) {
        dom.destroy();
      }
      this.portraitDOMs = [];
      this.nameDOMs = [];
    });
    this._bindNavEvents();

    this._syncDOMPortraits();
  }

  _bindNavEvents() {
    this._unbindNavEvents();
    const e = this.game.events;
    e.on('ui_up', this._navUp, this);
    e.on('ui_down', this._navDown, this);
    e.on('ui_left', this._navLeft, this);
    e.on('ui_right', this._navRight, this);
    e.on('ui_confirm', this._navConfirm, this);
    e.on('ui_cancel', this.handleBack, this);
  }

  _unbindNavEvents() {
    const e = this.game.events;
    e.off('ui_up', this._navUp, this);
    e.off('ui_down', this._navDown, this);
    e.off('ui_left', this._navLeft, this);
    e.off('ui_right', this._navRight, this);
    e.off('ui_confirm', this._navConfirm, this);
    e.off('ui_cancel', this.handleBack, this);
  }

  _navUp() {
    this._handleAxisKey(0, -1);
  }

  _navDown() {
    this._handleAxisKey(0, 1);
  }

  _navLeft() {
    this._handleAxisKey(-1, 0);
  }

  _navRight() {
    this._handleAxisKey(1, 0);
  }

  _navConfirm() {
    if (this.transitioning) return;
    if (!this.p1Confirmed) this.confirmP1();
    else if (this.p2SelectionMode && !this.p2Confirmed) this.confirmP2();
  }

  _handleAxisKey(dx, dy) {
    if (this.transitioning) return;
    const isP1 = !this.p1Confirmed;
    const isP2 = this.p2SelectionMode && !this.p2Confirmed;
    if (isP1 || isP2) {
      this._moveSelection(dx, dy);
    }
  }

  update(_time, delta) {
    if (this.transitioning) return;
    const isP1 = !this.p1Confirmed;
    const isP2 = this.p2SelectionMode && !this.p2Confirmed;
    if (isP1 || isP2) {
      this._handleNavKey(this.cursors.left, -1, 0, delta);
      this._handleNavKey(this.cursors.right, 1, 0, delta);
      this._handleNavKey(this.cursors.up, 0, -1, delta);
      this._handleNavKey(this.cursors.down, 0, 1, delta);
    }
  }

  _handleNavKey(key, dx, dy, delta) {
    const dir = dx !== 0 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    if (key.isDown) {
      if (this.navTimers[dir] === 0) {
        this._moveSelection(dx, dy);
        this.navTimers[dir] = this.NAV_DELAY;
      } else {
        this.navTimers[dir] -= delta;
        if (this.navTimers[dir] <= 0) {
          this._moveSelection(dx, dy);
          this.navTimers[dir] = this.NAV_FREQ;
        }
      }
    } else {
      this.navTimers[dir] = 0;
    }
  }

  _moveSelection(dx, dy) {
    if (!this.p1Confirmed) this.moveP1Cursor(dx, dy);
    else if (this.p2SelectionMode && !this.p2Confirmed) this.moveP2Cursor(dx, dy);
  }

  _clampScroll() {
    const rows = Math.ceil(this.fighters.length / COLS);
    const gridHeight = rows * (CELL_H + GRID_GAP);
    const minY = Math.min(0, VIEW_BOTTOM - VIEW_TOP + 15 - (gridHeight + GRID_START_Y));
    if (this.gridContainer.y < minY) this.gridContainer.y = minY;
    if (this.gridContainer.y > 0) this.gridContainer.y = 0;
  }

  _scrollToFit(idx) {
    const row = Math.floor(idx / COLS);
    const cellY = GRID_START_Y + row * (CELL_H + GRID_GAP);
    let tY = this.gridContainer.y;
    if (cellY + this.gridContainer.y < VIEW_TOP) tY = VIEW_TOP - cellY;
    else if (cellY + CELL_H + this.gridContainer.y > VIEW_BOTTOM)
      tY = VIEW_BOTTOM - (cellY + CELL_H);
    this.tweens.add({
      targets: this.gridContainer,
      y: tY,
      duration: 150,
      ease: 'Power2',
      onUpdate: () => this._syncDOMPortraits(),
    });
  }

  _syncDOMPortraits() {
    for (const cell of this.gridCells) {
      if (!cell.pDOM) continue;
      const wX = cell.x + this.gridContainer.x;
      const wY = cell.y + this.gridContainer.y;
      cell.pDOM.x = wX;
      cell.pDOM.y = wY;
      cell.nDOM.x = wX + 20;
      cell.nDOM.y = wY + 38;
      const isVisible = wY > VIEW_TOP - 30 && wY < VIEW_BOTTOM;
      cell.pDOM.setVisible(isVisible);
      cell.nDOM.setVisible(isVisible);
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
      this._scrollToFit(newIdx);
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
      this._scrollToFit(newIdx);
      this.game.audioManager.play('ui_navigate');
    }
  }

  updateP1Display() {
    const col = this.p1Index % COLS;
    const row = Math.floor(this.p1Index / COLS);
    const cellX = GRID_START_X + col * (CELL_W + GRID_GAP);
    const cellY = GRID_START_Y + row * (CELL_H + GRID_GAP);
    this.p1Cursor.setPosition(cellX, cellY);
    this.p1CursorLabel.setPosition(cellX + CELL_W / 2, cellY - 2);
    const fighter = this.fighters[this.p1Index];
    this.p1NameText.setText(fighter.name);
    this.p1SubtitleText.setText(fighter.subtitle);
    const isRandom = fighter.id === 'random';
    if (!isRandom && this.anims.exists(`${fighter.id}_idle`)) {
      this.p1PreviewSprite.play(`${fighter.id}_idle`);
      this.p1PreviewSprite.setVisible(true);
      this.p1Portrait.setVisible(false);
      this.p1RandomText.setVisible(false);
    } else {
      this.p1PreviewSprite.setVisible(false);
      this.p1Portrait.setVisible(true).setFillStyle(parseInt(fighter.color, 16));
      this.p1RandomText.setVisible(isRandom);
    }
    const statNames = ['speed', 'power', 'defense', 'special'];
    statNames.forEach((stat, i) => {
      const val = isRandom ? 0 : fighter.stats[stat];
      this.p1StatBars[i].scaleX = val / 5;
      if (!this.p1StatValues) this.p1StatValues = [];
      if (!this.p1StatValues[i]) {
        this.p1StatValues[i] = this.add
          .text(295 + 95, 100 + i * 14, '', {
            fontFamily: 'Arial',
            fontSize: '8px',
            color: '#ffffff',
          })
          .setOrigin(0.5);
      }
      this.p1StatValues[i].setText(isRandom ? '???' : val.toString());
    });
  }

  updateP2Display() {
    this._showP2Selection(this.p2Index);
  }

  handleBack() {
    if (this.transitioning) return;
    if (this.p2SelectionMode && !this.p2Confirmed) {
      this.p2SelectionMode = false;
      this.p1Confirmed = false;
      this.p2Cursor.setVisible(false);
      this.p2CursorLabel.setVisible(false);
      this.headerText.setText('ELIGE TU LUCHADOR: JUGADOR 1');
      this.p1Cursor.setAlpha(1);
      this.p1CursorLabel.setAlpha(1);
      this.p1Cursor.setStrokeStyle(2, 0x3366ff);
      this.confirmedText.setText('');
      this.game.audioManager.play('ui_cancel');
      return;
    }
    if (this.p1Confirmed) {
      if (this.gameMode === 'online' && this.networkManager) {
        if (this.pendingUnready) return; // Already waiting
        this.pendingUnready = true;
        this.networkManager.sendUnready();
        this.confirmedText.setText('Cancelando...');
        this.p1Cursor.setStrokeStyle(2, 0x666666); // Dimmed
        this.game.audioManager.play('ui_cancel');

        // Timeout fallback: if no ack in 1s, clear anyway
        this.time.delayedCall(1000, () => {
          if (this.pendingUnready) {
            this.pendingUnready = false;
            this._resetP1Confirmation();
          }
        });
        return;
      }
      this._resetP1Confirmation();
      this.game.audioManager.play('ui_cancel');
      return;
    }
    this.game.audioManager.play('ui_cancel');
    if (this.gameMode === 'online' && this.networkManager) {
      this.networkManager.destroy();
    }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('TitleScene');
    });
  }

  _resetP1Confirmation() {
    this.p1Confirmed = false;
    this.p1Cursor.setStrokeStyle(2, 0x3366ff);
    this.confirmedText.setText('');
  }

  confirmP1() {
    this.game.audioManager.play('ui_confirm');
    this.p1Confirmed = true;
    if (this.fighters[this.p1Index].id === 'random') {
      this.p1Index = Phaser.Math.Between(0, this.fighters.length - 2);
      this.updateP1Display();
    }
    this.p1Cursor.setStrokeStyle(3, 0x00ccff);
    if (this.matchContext?.type === 'tournament') {
      this.confirmedText.setText('Generando torneo...');
      this.time.delayedCall(800, () => {
        const fighterIds = this.fighters.map((f) => f.id);
        const { size, seed } = this.matchContext.tournamentState;
        const playerFighterId = this.fighters[this.p1Index].id;
        const tournamentManager = TournamentManager.generate(
          fighterIds,
          size,
          playerFighterId,
          seed,
        );
        this.matchContext.tournamentState = tournamentManager.serialize();
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('BracketScene', {
            gameMode: this.gameMode,
            matchContext: this.matchContext,
          });
        });
      });
      return;
    }
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
      if (this.game.autoplay?.enabled) {
        let p2Idx;
        do {
          p2Idx = Phaser.Math.Between(0, this.fighters.length - 2);
        } while (p2Idx === this.p1Index);
        this.p2Index = p2Idx;
        this.updateP2Display();
        this.confirmP2();
      }
    }
  }

  confirmP2() {
    this.game.audioManager.play('ui_confirm');
    this.p2Confirmed = true;
    this.p2Cursor.setStrokeStyle(3, 0xff8800);
    if (this.fighters[this.p2Index].id === 'random') {
      let idx;
      do {
        idx = Phaser.Math.Between(0, this.fighters.length - 2);
      } while (idx === this.p1Index);
      this.p2Index = idx;
      this.updateP2Display();
    }
    this.confirmedText.setText('Listo! Preparando combate...');
    const delay = this.game.autoplay?.enabled ? 100 : 1000;
    this.time.delayedCall(delay, () => this.goToStageSelect());
  }

  _showOpponentSelection(id) {
    const idx = this.fighters.findIndex((f) => f.id === id);
    if (idx !== -1) {
      this.p2Index = idx;
      this._showP2Selection(idx);
    }
  }

  _showP2Selection(idx) {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cellX = GRID_START_X + col * (CELL_W + GRID_GAP);
    const cellY = GRID_START_Y + row * (CELL_H + GRID_GAP);
    this.p2Cursor.setPosition(cellX, cellY).setVisible(true);
    this.p2CursorLabel.setPosition(cellX + CELL_W / 2, cellY - 2).setVisible(true);
    const fighter = this.fighters[idx];
    this.p2NameText.setText(fighter.name);
    this.p2SubtitleText.setText(fighter.subtitle);
    const isRandom = fighter.id === 'random';
    if (!isRandom && this.anims.exists(`${fighter.id}_idle`)) {
      this.p2PreviewSprite.play(`${fighter.id}_idle`);
      this.p2PreviewSprite.setVisible(true);
      this.p2Portrait.setVisible(false);
      this.p2RandomText.setVisible(false);
    } else {
      this.p2PreviewSprite.setVisible(false);
      this.p2Portrait.setVisible(true).setFillStyle(parseInt(fighter.color, 16));
      this.p2RandomText.setVisible(isRandom);
    }
    const statNames = ['speed', 'power', 'defense', 'special'];
    statNames.forEach((stat, i) => {
      const val = isRandom ? 0 : fighter.stats[stat];
      this.p2StatBars[i].scaleX = val / 5;
      if (!this.p2StatValues) this.p2StatValues = [];
      if (!this.p2StatValues[i]) {
        this.p2StatValues[i] = this.add
          .text(295 + 95, 208 + i * 14, '', {
            fontFamily: 'Arial',
            fontSize: '8px',
            color: '#ffffff',
          })
          .setOrigin(0.5);
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
      this.scene.start('StageSelectScene', {
        p1Id,
        p2Id,
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }

  _updateConnectionStatus() {
    if (!this._connectionText || !this.networkManager) return;
    const nm = this.networkManager;
    if (nm._webrtcReady) this._connectionText.setText('P2P').setColor('#44ff44');
    else if (nm.connected) this._connectionText.setText('Relay').setColor('#ffcc44');
    else this._connectionText.setText('...').setColor('#ff4444');
  }
}
