import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';
import { NetworkManager } from '../systems/NetworkManager.js';

function getPartyHost() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('partyHost')) return params.get('partyHost');
  const loc = window.location.hostname;
  if (loc === 'localhost' || loc === '127.0.0.1') {
    return 'localhost:1999';
  }
  return 'a-los-traques.simon0191.partykit.dev';
}

export class SpectatorLobbyScene extends Phaser.Scene {
  constructor() {
    super('SpectatorLobbyScene');
  }

  init(data) {
    this.roomId = data.roomId;
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.createMuteButton(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add.text(GAME_WIDTH / 2, 30, 'ESPECTADOR', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '24px',
      color: '#88ccff',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    this.statusText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, 'Conectando...', {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#ccccee',
      align: 'center',
      wordWrap: { width: 400 }
    }).setOrigin(0.5);

    this.subText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 15, '', {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#888899'
    }).setOrigin(0.5);

    // Back button
    const bg = this.add.rectangle(60, GAME_HEIGHT - 20, 110, 20, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });
    const text = this.add.text(60, GAME_HEIGHT - 20, 'VOLVER', {
      fontFamily: 'Arial', fontSize: '9px', color: '#ffffff'
    }).setOrigin(0.5);
    bg.on('pointerover', () => { bg.setFillStyle(0x333366); text.setColor('#ffcc00'); });
    bg.on('pointerout', () => { bg.setFillStyle(0x222244); text.setColor('#ffffff'); });
    bg.on('pointerdown', () => {
      this.game.audioManager.play('ui_confirm');
      if (this.network) this.network.destroy();
      this.scene.start('TitleScene');
    });

    // Connect as spectator
    const host = getPartyHost();
    this.subText.setText(host);
    this.network = new NetworkManager(this.roomId, host, { spectator: true });

    this.network.onError(() => {
      this.statusText.setText('Error de conexion');
      this.subText.setText('Asegura que el servidor este corriendo');
    });

    this.network.onAssignSpectator((count) => {
      this.statusText.setText('Conectado como espectador');
      this.subText.setText(`${count} espectador${count !== 1 ? 'es' : ''} conectado${count !== 1 ? 's' : ''}`);
    });

    this.network.onSpectatorCount((count) => {
      this.subText.setText(`${count} espectador${count !== 1 ? 'es' : ''} conectado${count !== 1 ? 's' : ''}`);
    });

    this.network.onFightState((msg) => {
      if (msg.started) {
        this._goToFight(msg.p1Id, msg.p2Id, msg.stageId);
      } else {
        this.statusText.setText('Esperando que empiece la pelea...');
      }
    });

    this.network.onStart((msg) => {
      this._goToFight(msg.p1Id, msg.p2Id, msg.stageId);
    });
  }

  _goToFight(p1Id, p2Id, stageId) {
    this.statusText.setText('Pelea iniciada!');
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('FightScene', {
        p1Id,
        p2Id,
        stageId,
        gameMode: 'spectator',
        networkManager: this.network
      });
    });
  }
}
