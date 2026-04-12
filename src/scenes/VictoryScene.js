import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import { updateStats } from '../services/api.js';
import { TournamentManager } from '../services/TournamentManager.js';
import { createButton } from '../services/UIService.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('VictoryScene');

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
    this.gameMode = data.gameMode || 'local';
    this.networkManager = data.networkManager || null;
    this.matchContext = data.matchContext || null;
  }

  create() {
    // If tournament mode, update the match winner via TournamentManager
    if (this.matchContext?.type === 'tournament' && this.matchContext.tournamentState) {
      const manager = new TournamentManager(this.matchContext.tournamentState);
      manager.advance(this.winnerId);
      this.matchContext.tournamentState = manager.serialize();
    }

    // Signal match completion for E2E test orchestration
    if ((this.game.autoplay?.enabled || this.game.debugMode) && window.__FIGHT_LOG) {
      window.__FIGHT_LOG.matchComplete = true;
      window.__FIGHT_LOG.completedAt = Date.now();
      window.__FIGHT_LOG.result = { winnerId: this.winnerId, loserId: this.loserId };
    }

    // Save result if logged in
    this._saveResult();

    const audio = this.game.audioManager;
    audio.setScene(this);
    audio.playMusic('bgm_victory', { loop: false, volume: 0.5 });
    audio.play('announce_victory');
    audio.createMuteButton(this);

    this.cameras.main.fadeIn(500, 255, 255, 255);

    const winner = fightersData.find((f) => f.id === this.winnerId);
    const loser = fightersData.find((f) => f.id === this.loserId);

    const winnerColor = parseInt(winner.color, 16);

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1a);

    // Background glow behind winner
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, GAME_WIDTH, 160, winnerColor, 0.12);

    // VICTORIA header
    const headerText = this.add
      .text(GAME_WIDTH / 2, 25, 'VICTORIA!', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '28px',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 5,
        shadow: { offsetX: 2, offsetY: 2, color: '#664400', blur: 6, fill: true },
      })
      .setOrigin(0.5);

    // Animate header
    this.tweens.add({
      targets: headerText,
      scaleX: 1.05,
      scaleY: 1.05,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Winner portrait (large, centered)
    if (this.textures.exists(`portrait_${this.winnerId}`)) {
      this.add.image(GAME_WIDTH / 2, 100, `portrait_${this.winnerId}`).setDisplaySize(80, 80);
    } else {
      this.add.rectangle(GAME_WIDTH / 2, 100, 80, 80, winnerColor);
    }
    this.add.rectangle(GAME_WIDTH / 2, 100, 80, 80, 0x000000, 0).setStrokeStyle(3, 0xffcc00);

    // Winner name
    this.add
      .text(GAME_WIDTH / 2, 150, winner.name, {
        fontFamily: 'Arial Black, Arial',
        fontSize: '18px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    // Winner subtitle
    this.add
      .text(GAME_WIDTH / 2, 168, winner.subtitle, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#ccccee',
        fontStyle: 'italic',
      })
      .setOrigin(0.5);

    // Winner victory dialog
    this.add
      .text(GAME_WIDTH / 2, 188, `"${winner.dialogs.victory}"`, {
        fontFamily: 'Arial',
        fontSize: '9px',
        color: '#ffeeaa',
        fontStyle: 'italic',
        wordWrap: { width: 300 },
        align: 'center',
      })
      .setOrigin(0.5);

    // Loser defeat dialog (smaller, below)
    this.add.rectangle(GAME_WIDTH / 2, 215, 280, 1, 0x333355);

    this.add
      .text(GAME_WIDTH / 2, 225, `${loser.name}: "${loser.dialogs.defeat}"`, {
        fontFamily: 'Arial',
        fontSize: '7px',
        color: '#888899',
        fontStyle: 'italic',
        wordWrap: { width: 260 },
        align: 'center',
      })
      .setOrigin(0.5);

    // Buttons
    this.buttons = [];
    this.selectedIndex = 0;

    if (this.matchContext?.type === 'tournament') {
      this.buttons.push({
        action: () => {
          this.cameras.main.fadeOut(300, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('BracketScene', {
              gameMode: this.gameMode,
              matchContext: this.matchContext,
              fromMatch: true,
              winnerId: this.winnerId,
            });
          });
        },
        ui: createButton(this, GAME_WIDTH / 2 - 60, 252, 'CONTINUAR TORNEO', () => {}, {
          width: 100,
          height: 22,
          fontSize: '10px',
        }),
      });

      this.buttons.push({
        action: () => {
          this.cameras.main.fadeOut(300, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('TitleScene');
          });
        },
        ui: createButton(this, GAME_WIDTH / 2 + 60, 252, 'SALIR AL MENÚ', () => {}, {
          width: 100,
          height: 22,
          fontSize: '10px',
        }),
      });
    } else {
      this.buttons.push({
        action: () => {
          if (this.gameMode === 'online' && this.networkManager) {
            this.networkManager.sendRematch();
            this._waitingRematch = true;
            this._rematchText = this.add
              .text(GAME_WIDTH / 2, 235, 'Esperando oponente...', {
                fontFamily: 'Arial',
                fontSize: '8px',
                color: '#ffcc00',
              })
              .setOrigin(0.5);

            if (this._rematchReceived) {
              this._goToFight();
            }
          } else {
            this._goToFight();
          }
        },
        ui: createButton(this, GAME_WIDTH / 2 - 115, 252, 'REVANCHA', () => {}, {
          width: 100,
          height: 22,
          fontSize: '10px',
        }),
      });

      this.buttons.push({
        action: () => {
          if (this.gameMode === 'online' && this.networkManager) {
            this.networkManager.sendLeave();
            this._goToSelect();
          } else {
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
              this.scene.start('SelectScene', { gameMode: 'local' });
            });
          }
        },
        ui: createButton(this, GAME_WIDTH / 2, 252, 'ELEGIR OTRO', () => {}, {
          width: 100,
          height: 22,
          fontSize: '10px',
        }),
      });

      this.buttons.push({
        action: () => {
          if (this.gameMode === 'online' && this.networkManager) {
            this.networkManager.destroy();
          }
          this.cameras.main.fadeOut(300, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('TitleScene');
          });
        },
        ui: createButton(this, GAME_WIDTH / 2 + 115, 252, 'MENU', () => {}, {
          width: 100,
          height: 22,
          fontSize: '10px',
        }),
      });
    }

    // Attach click events properly
    this.buttons.forEach((btn) => {
      btn.ui.bg.on('pointerdown', () => {
        if (this.game.audioManager) this.game.audioManager.play('ui_confirm');
        btn.action();
      });
    });

    // Global navigation bindings
    this.events.on('wake', this._bindNavEvents, this);
    this.events.on('sleep', this._unbindNavEvents, this);
    this.events.on('shutdown', this._unbindNavEvents, this);
    this._bindNavEvents();
    this.updateSelection();

    // In online mode, listen for rematch/leave from opponent
    if (this.gameMode === 'online' && this.networkManager) {
      this._rematchReceived = false;
      this.networkManager.onRematch(() => {
        this._rematchReceived = true;
        if (this._waitingRematch) {
          this._goToFight();
        }
      });

      this.networkManager.onLeave(() => {
        if (this._rematchText) this._rematchText.destroy();
        this.add
          .text(GAME_WIDTH / 2, 235, 'Oponente quiere cambiar luchador...', {
            fontFamily: 'Arial',
            fontSize: '8px',
            color: '#ffcc00',
          })
          .setOrigin(0.5);
        this.time.delayedCall(800, () => {
          this._goToSelect();
        });
      });

      this.networkManager.onDisconnect(() => {
        this.add
          .text(GAME_WIDTH / 2, 235, 'Oponente desconectado', {
            fontFamily: 'Arial',
            fontSize: '8px',
            color: '#ff4444',
          })
          .setOrigin(0.5);
        this.time.delayedCall(1500, () => {
          this.networkManager.destroy();
          this.cameras.main.fadeOut(300, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('TitleScene');
          });
        });
      });
    }
  }

  _bindNavEvents() {
    this._unbindNavEvents();
    const e = this.game.events;
    e.on('ui_left', this._navPrev, this);
    e.on('ui_right', this._navNext, this);
    e.on('ui_confirm', this._navConfirm, this);
  }

  _unbindNavEvents() {
    const e = this.game.events;
    e.off('ui_left', this._navPrev, this);
    e.off('ui_right', this._navNext, this);
    e.off('ui_confirm', this._navConfirm, this);
  }

  _navPrev() {
    if (this.transitioning) return;
    this.selectedIndex--;
    if (this.selectedIndex < 0) this.selectedIndex = this.buttons.length - 1;
    this.updateSelection();
    this.game.audioManager.play('ui_navigate');
  }

  _navNext() {
    if (this.transitioning) return;
    this.selectedIndex++;
    if (this.selectedIndex >= this.buttons.length) this.selectedIndex = 0;
    this.updateSelection();
    this.game.audioManager.play('ui_navigate');
  }

  _navConfirm() {
    if (this.transitioning) return;
    this.game.audioManager.play('ui_confirm');
    this.buttons[this.selectedIndex].action();
  }

  updateSelection() {
    this.buttons.forEach((btn, index) => {
      const isSelected = index === this.selectedIndex;
      if (isSelected) {
        btn.ui.bg.setStrokeStyle(2, 0xffcc00);
        btn.ui.text.setColor('#ffcc00');
      } else {
        btn.ui.bg.setStrokeStyle(1, 0x4444aa);
        btn.ui.text.setColor('#ffffff');
      }
    });
  }

  async _saveResult() {
    const user = this.game.registry.get('user');
    if (!user) return;

    // Determine if local player won or lost
    let isP1 = true;
    if (this.gameMode === 'online' && this.networkManager) {
      isP1 = this.networkManager.slot === 0;
    }

    const localPlayerId = isP1 ? this.p1Id : this.p2Id;
    const didWin = this.winnerId === localPlayerId;

    try {
      await updateStats(didWin);

      const feedback = this.add
        .text(GAME_WIDTH / 2, 45, didWin ? '+1 VICTORIA' : '+1 DERROTA', {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: didWin ? '#44cc88' : '#ff4444',
        })
        .setOrigin(0.5)
        .setAlpha(0);

      this.tweens.add({
        targets: feedback,
        y: 35,
        alpha: 1,
        duration: 500,
        yoyo: true,
        hold: 2000,
        onComplete: () => feedback.destroy(),
      });
    } catch (e) {
      log.warn('Stats update failed', { err: e.message });
    }
  }

  _goToSelect() {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('SelectScene', {
        gameMode: 'online',
        networkManager: this.networkManager,
      });
    });
  }

  _goToFight() {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('FightScene', {
        p1Id: this.p1Id,
        p2Id: this.p2Id,
        stageId: this.stageId,
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }
}
