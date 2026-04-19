import Phaser from 'phaser';
import QRCode from 'qrcode';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import { TournamentLobbyService } from '../services/TournamentLobbyService.js';
import { createButton } from '../services/UIService.js';
import { DevConsole } from '../systems/DevConsole.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('TournamentSetupScene');

const SLOT_WIDTH = 100;
const SLOT_HEIGHT = 40;
const GRID_COLS = 4;
const GRID_GAP = 10;
const GRID_START_X = (GAME_WIDTH - (SLOT_WIDTH * GRID_COLS + GRID_GAP * (GRID_COLS - 1))) / 2;
const GRID_START_Y = 60;

export class TournamentSetupScene extends Phaser.Scene {
  constructor() {
    super('TournamentSetupScene');
  }

  async create() {
    this.lobby = new TournamentLobbyService();
    await this.lobby.initHost();

    this.devConsole = new DevConsole(this);

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add
      .text(GAME_WIDTH / 2, 25, 'CONFIGURAR TORNEO', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.slotContainers = [];
    this.currentPage = 0;
    this._createGrid(); // Create fixed 8 slots once

    // QR Code Area
    const qrX = GAME_WIDTH / 2;
    const qrY = 175;
    this.qrSprite = this.add.image(qrX, qrY, '__DEFAULT').setDisplaySize(40, 40);

    this.qrLabel = this.add
      .text(qrX, qrY + 30, 'SCAN PARA UNIRTE', {
        fontFamily: 'Arial',
        fontSize: '8px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    this.codeLabel = this.add
      .text(qrX, qrY + 40, `CÓDIGO: ${this.lobby.roomId.toUpperCase()}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this._generateQR();

    // Controls
    this._sizeBtn = createButton(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 35,
      `TAMAÑO: ${this.lobby.state.size}`,
      () => this._toggleSize(),
      { width: 100, height: 25, fontSize: '10px' },
    );

    // Arrows moved below the grid (Slot 4 and 8 area)
    const arrowY = 165;
    this._prevBtn = createButton(this, GRID_START_X - 15, arrowY, '<', () => this._changePage(-1), {
      width: 20,
      height: 20,
      fontSize: '12px',
    });
    this._prevBtn.bg.setVisible(false);
    this._prevBtn.text.setVisible(false);

    this._nextBtn = createButton(
      this,
      GAME_WIDTH - GRID_START_X + 15,
      arrowY,
      '>',
      () => this._changePage(1),
      { width: 20, height: 20, fontSize: '12px' },
    );
    this._nextBtn.bg.setVisible(false);
    this._nextBtn.text.setVisible(false);

    this._startBtn = createButton(this, GAME_WIDTH - 60, GAME_HEIGHT - 35, 'EMPEZAR', () =>
      this.startTournament(),
    );

    this._volverBtn = createButton(this, 60, GAME_HEIGHT - 35, 'VOLVER', () => {
      this.lobby.destroy();
      this.scene.start('MultiplayerMenuScene');
    });

    this.lobby.onUpdate((state) => this._updateUI(state));
  }

  async _generateQR() {
    const url = this.lobby.getJoinUrl();
    try {
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, scale: 2 });
      if (this.textures.exists('lobby_qr')) {
        this.textures.remove('lobby_qr');
      }
      this.textures.addBase64('lobby_qr', dataUrl);

      this.textures.once('addtexture', () => {
        if (this.qrSprite) {
          this.qrSprite.setTexture('lobby_qr').setDisplaySize(40, 40);
        }
      });
    } catch (err) {
      log.warn('QR Generate Error', err);
    }
  }

  _toggleSize() {
    const newSize = this.lobby.state.size === 8 ? 16 : 8;
    this.lobby.updateSize(newSize);
    this._sizeBtn.text.setText(`TAMAÑO: ${newSize}`);
    this.currentPage = 0;
    // UI will update via onUpdate callback
  }

  _changePage(delta) {
    this.currentPage += delta;
    this._updateUI(this.lobby.state);
  }

  _createGrid() {
    const slotsPerPage = 8;
    for (let i = 0; i < slotsPerPage; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = GRID_START_X + col * (SLOT_WIDTH + GRID_GAP);
      const y = GRID_START_Y + row * (SLOT_HEIGHT + GRID_GAP);

      const container = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, SLOT_WIDTH, SLOT_HEIGHT, 0x1a1a3a).setOrigin(0);
      bg.setStrokeStyle(1, 0x333366);

      const title = this.add.text(5, 5, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#444466',
      });

      const nameText = this.add
        .text(SLOT_WIDTH / 2, SLOT_HEIGHT / 2, 'VACÍO', {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#555555',
        })
        .setOrigin(0.5);

      const guestBtn = this.add
        .text(5, SLOT_HEIGHT - 12, '[+INV]', { fontSize: '8px', color: '#66bb66' })
        .setInteractive({ useHandCursor: true });

      const botBtn = this.add
        .text(SLOT_WIDTH - 35, SLOT_HEIGHT - 12, '[+BOT]', { fontSize: '8px', color: '#6666bb' })
        .setInteractive({ useHandCursor: true });

      const removeBtn = this.add
        .text(SLOT_WIDTH - 15, 5, 'X', { fontSize: '10px', color: '#ff4444' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      container.add([bg, title, nameText, guestBtn, botBtn, removeBtn]);

      this.slotContainers.push({
        container,
        bg,
        title,
        nameText,
        guestBtn,
        botBtn,
        removeBtn,
      });
    }
  }

  _updateUI(state) {
    const size = state.size;
    const slotsPerPage = 8;
    const startIndex = this.currentPage * slotsPerPage;

    // Update Pagination Buttons
    const hasPrev = this.currentPage > 0;
    const hasNext = size > slotsPerPage && startIndex + slotsPerPage < size;

    if (this._prevBtn) {
      this._prevBtn.bg.setVisible(hasPrev);
      this._prevBtn.text.setVisible(hasPrev);
    }
    if (this._nextBtn) {
      this._nextBtn.bg.setVisible(hasNext);
      this._nextBtn.text.setVisible(hasNext);
    }

    this.slotContainers.forEach((ui, i) => {
      const globalIdx = startIndex + i;
      const slot = state.slots[globalIdx];

      ui.title.setText(`SLOT ${globalIdx + 1}`);

      // Update click handlers for the current page indices
      ui.guestBtn.off('pointerdown').on('pointerdown', () => this.lobby.addGuest(globalIdx));
      ui.botBtn.off('pointerdown').on('pointerdown', () => {
        if (state.slots[globalIdx]?.type === 'bot') {
          this.lobby.cycleBot(globalIdx);
        } else {
          this.lobby.addBot(globalIdx);
        }
      });
      ui.removeBtn.off('pointerdown').on('pointerdown', () => this.lobby.removeSlot(globalIdx));

      if (slot) {
        const isVerified = slot.type === 'human' && slot.handshake;
        ui.nameText.setText(slot.name.toUpperCase()).setColor(isVerified ? '#44ff88' : '#ffffff');

        if (isVerified) {
          ui.title.setText(`SLOT ${globalIdx + 1} 🏆`).setColor('#44ff88');
        } else {
          ui.title.setText(`SLOT ${globalIdx + 1}`).setColor('#444466');
        }

        ui.botBtn.setVisible(slot.type === 'bot').setText('[NIV]');
        ui.guestBtn.setVisible(false);
        ui.removeBtn.setVisible(globalIdx > 0);
        ui.bg.setFillStyle(slot.type === 'bot' ? 0x2a1a3a : 0x1a2a3a);
      } else {
        ui.nameText.setText('VACÍO').setColor('#555555');
        ui.guestBtn.setVisible(true);
        ui.botBtn.setVisible(true).setText('[+BOT]');
        ui.removeBtn.setVisible(false);
        ui.bg.setFillStyle(0x1a1a3a);
      }
    });
  }

  startTournament() {
    const players = this.lobby.state.slots.filter((s) => s !== null);
    if (players.length < 2) {
      return;
    }

    const size = this.lobby.state.size;
    const seed = Math.floor(Math.random() * 1000000);

    // Notify server and cleanup socket
    this.lobby.startTournament();
    this.lobby.destroy();

    this.scene.start('SelectScene', {
      gameMode: 'local',
      matchContext: {
        type: 'tournament',
        lobbyPlayers: players,
        tournamentState: {
          size,
          seed,
          tourneyId: this.lobby.state.tourneyId,
        },
      },
    });
  }
}
