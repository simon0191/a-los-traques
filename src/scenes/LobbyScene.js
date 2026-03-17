import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import { NetworkManager } from '../systems/NetworkManager.js';

// PartyKit host - auto-detect localhost for dev, override via ?partyHost=
function getPartyHost() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('partyHost')) return params.get('partyHost');
  // In local dev (vite on localhost/127.0.0.1), default to PartyKit local server
  const loc = window.location.hostname;
  if (loc === 'localhost' || loc === '127.0.0.1') {
    return 'localhost:1999';
  }
  return 'a-los-traques.simon0191.partykit.dev';
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super('LobbyScene');
  }

  init(data) {
    // data.roomId set if joining via URL, null if creating
    this.roomId = data.roomId || null;
    this.isCreator = !this.roomId;
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.createMuteButton(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    // Header
    this.add.text(GAME_WIDTH / 2, 30, 'EN LINEA', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '24px',
      color: '#ffcc00',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    this.statusText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, '', {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#ccccee',
      align: 'center',
      wordWrap: { width: 400 }
    }).setOrigin(0.5);

    this.linkText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#88ccff',
      align: 'center',
      wordWrap: { width: 400 }
    }).setOrigin(0.5);

    this.subText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 35, '', {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#888899'
    }).setOrigin(0.5);

    // Back button
    this._createButton(60, GAME_HEIGHT - 20, 'VOLVER', () => {
      if (this.network) this.network.destroy();
      this.scene.start('TitleScene');
    });

    // Start connection
    if (this.isCreator) {
      this.roomId = generateRoomId();
    }

    const host = getPartyHost();
    this.statusText.setText('Conectando...');
    this.subText.setText(host);

    this.network = new NetworkManager(this.roomId, host);

    this.network.onError(() => {
      this.statusText.setText('Error de conexion');
      this.subText.setText('Asegura que el servidor este corriendo\nnpm run party:dev');
    });

    this.network.onAssign((slot) => {
      if (this.isCreator) {
        const link = `${window.location.origin}${window.location.pathname}?room=${this.roomId}`;
        this.statusText.setText('Esperando oponente...');
        this.linkText.setText(link);
        this.subText.setText('Comparte el enlace con tu amigo');

        // Copy to clipboard
        navigator.clipboard.writeText(link).catch(() => {});

        // Add copy button
        this._createButton(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 55, 'COPIAR ENLACE', () => {
          navigator.clipboard.writeText(link).catch(() => {});
          this.subText.setText('Enlace copiado!');
        });
      } else {
        this.statusText.setText('Conectado! Esperando...');
      }
    });

    this.network.onOpponentJoined(() => {
      this.statusText.setText('Oponente conectado!');
      this.subText.setText('');
      this.linkText.setText('');

      // Short delay then go to select
      this.time.delayedCall(800, () => {
        this._goToSelect();
      });
    });

    this.network.onFull(() => {
      this.statusText.setText('Sala llena! Intenta otra.');
      this.subText.setText('');
    });
  }

  _goToSelect() {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('SelectScene', {
        gameMode: 'online',
        networkManager: this.network
      });
    });
  }

  _createButton(x, y, label, callback) {
    const bg = this.add.rectangle(x, y, 110, 20, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });

    const text = this.add.text(x, y, label, {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#ffffff'
    }).setOrigin(0.5);

    bg.on('pointerover', () => { bg.setFillStyle(0x333366); text.setColor('#ffcc00'); });
    bg.on('pointerout', () => { bg.setFillStyle(0x222244); text.setColor('#ffffff'); });
    bg.on('pointerdown', () => {
      this.game.audioManager.play('ui_confirm');
      callback();
    });

    return { bg, text };
  }
}
