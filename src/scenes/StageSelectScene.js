import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import stagesData from '../data/stages.json';
import { createButton } from '../services/UIService.js';

const COLS = 4;
const GRID_GAP = 10;
const CELL_W = 70;
const CELL_H = 50;
const GRID_START_X = (GAME_WIDTH - (COLS * (CELL_W + GRID_GAP) - GRID_GAP)) / 2 + CELL_W / 2;
const GRID_START_Y = 100;

export class StageSelectScene extends Phaser.Scene {
  constructor() {
    super('StageSelectScene');
  }

  init(data) {
    this.p1Id = data.p1Id;
    this.p2Id = data.p2Id;
    this.gameMode = data.gameMode || 'local';
    this.networkManager = data.networkManager || null;
    this.matchContext = data.matchContext || null;

    this.isP1 = true;
    if (this.gameMode === 'online' && this.networkManager) {
      this.isP1 = this.networkManager.playerSlot === 0;
    }
  }

  create() {
    const audio = this.game.audioManager;
    audio.setScene(this);

    this.cameras.main.fadeIn(300, 0, 0, 0);

    this.stages = [
      ...stagesData,
      {
        id: 'random',
        name: 'ALEATORIO',
        description: 'Cualquier lugar es bueno para una pelea.',
        texture: null,
        bgColor: '#555555',
      },
    ];

    this.selectedIndex = 0;
    this.transitioning = false;

    // Background
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    // Header
    this.headerText = this.add
      .text(GAME_WIDTH / 2, 30, this.isP1 ? 'ELIGE EL ESCENARIO' : 'ESPERANDO ESCENARIO...', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '20px',
        color: '#ffcc00',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    // Grid
    this.gridCells = [];
    for (let i = 0; i < this.stages.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = GRID_START_X + col * (CELL_W + GRID_GAP);
      const y = GRID_START_Y + row * (CELL_H + GRID_GAP);

      const stage = this.stages[i];

      // Cell background
      const rect = this.add
        .rectangle(x, y, CELL_W, CELL_H, 0x333333)
        .setInteractive({ useHandCursor: this.isP1 });

      if (stage.texture && this.textures.exists(stage.texture)) {
        this.add
          .sprite(x, y, stage.texture, stage.animated ? 0 : undefined)
          .setDisplaySize(CELL_W - 4, CELL_H - 4);
      } else {
        const color = Phaser.Display.Color.HexStringToColor(stage.bgColor || '#555555').color;
        this.add.rectangle(x, y, CELL_W - 4, CELL_H - 4, color);
        if (stage.id === 'random') {
          this.add
            .text(x, y, '?', { fontSize: '24px', color: '#ffffff', fontFamily: 'Arial Black' })
            .setOrigin(0.5);
        }
      }

      const border = this.add.rectangle(x, y, CELL_W, CELL_H).setStrokeStyle(2, 0xffffff, 0);
      this.gridCells.push({ rect, border, stage });

      if (this.isP1) {
        rect.on('pointerdown', () => {
          this.selectedIndex = i;
          this.updateSelection();
        });
      }
    }

    // LISTO Button (Only for P1 or local)
    if (this.isP1) {
      this.listoBtn = createButton(
        this,
        GAME_WIDTH / 2,
        GAME_HEIGHT - 25,
        'LISTO',
        () => {
          this.confirmSelection();
        },
        { width: 100, height: 25, fontSize: '12px' },
      );
    }

    // Selection Info
    this.infoContainer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 75);
    this.stageNameText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial Black',
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    this.stageDescText = this.add
      .text(0, 25, '', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#aaaaaa',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 40 },
      })
      .setOrigin(0.5);
    this.infoContainer.add([this.stageNameText, this.stageDescText]);

    // Cursor
    this.cursor = this.add.rectangle(0, 0, CELL_W + 4, CELL_H + 4).setStrokeStyle(3, 0xffcc00);

    // Back button
    createButton(
      this,
      60,
      GAME_HEIGHT - 20,
      'VOLVER',
      () => {
        this.handleBack();
      },
      { width: 110, height: 20, fontSize: '9px' },
    );

    if (this.isP1) {
      this.input.keyboard.on('keydown', (event) => {
        if (this.transitioning) return;

        if (event.code === 'Escape' || event.code === 'Backspace') {
          this.handleBack();
          return;
        }

        const _row = Math.floor(this.selectedIndex / COLS);
        const _col = this.selectedIndex % COLS;

        if (event.code === 'ArrowRight') {
          if (this.selectedIndex < this.stages.length - 1) {
            this.selectedIndex++;
            audio.play('ui_navigate');
          }
        } else if (event.code === 'ArrowLeft') {
          if (this.selectedIndex > 0) {
            this.selectedIndex--;
            audio.play('ui_navigate');
          }
        } else if (event.code === 'ArrowDown') {
          if (this.selectedIndex + COLS < this.stages.length) {
            this.selectedIndex += COLS;
            audio.play('ui_navigate');
          }
        } else if (event.code === 'ArrowUp') {
          if (this.selectedIndex - COLS >= 0) {
            this.selectedIndex -= COLS;
            audio.play('ui_navigate');
          }
        } else if (event.code === 'KeyZ' || event.code === 'Enter' || event.code === 'Space') {
          this.confirmSelection();
        }

        this.updateSelection();
      });
    }

    if (this.gameMode === 'online' && this.networkManager) {
      // P1: Listen for create_fight signal — create fight record, then confirm
      this.networkManager.signaling.on('create_fight', (data) => {
        this.headerText?.setText('CREANDO PELEA...');
        import('../services/api.js').then(({ createFight }) => {
          createFight({
            fightId: data.fightId,
            roomId: this.networkManager.roomId,
            p1Fighter: data.p1Id,
            p2Fighter: data.p2Id,
            stageId: data.stageId,
          })
            .then(() => {
              this.networkManager.signaling.send({ type: 'fight_created' });
            })
            .catch((err) => {
              // Still send fight_created to unblock the match even if DB fails
              console.warn('Fight creation failed, continuing anyway:', err.message);
              this.networkManager.signaling.send({ type: 'fight_created' });
            });
        });
      });

      // Listen for start signal (sent by server after fight_created)
      this.networkManager.onStart((data) => {
        this._fightId = data.fightId;

        // P2: register as second player in the fight record
        if (!this.isP1) {
          import('../services/api.js').then(({ updateFight }) => {
            updateFight({ fightId: data.fightId, registerP2: true }).catch(() => {});
          });
        }

        this.goToPreFight(data.stageId, data.isRandomStage);
      });

      this.networkManager.onReturnToSelect(() => {
        this.handleBack(true);
      });

      if (!this.isP1) {
        // P2 just waits for the 'start' message which contains the stageId
      }
    }

    // Autoplay: auto-select first stage and confirm
    if (this.game.autoplay?.enabled && this.isP1) {
      this.time.delayedCall(500, () => {
        if (!this.transitioning) {
          this.selectedIndex = 0; // Pick first stage
          this.updateSelection();
          this.confirmSelection();
        }
      });
    }

    this.updateSelection();
  }
  handleBack(remote = false) {
    if (this.transitioning && !remote) return;

    const audio = this.game.audioManager;
    if (!remote) audio.play('ui_cancel');

    if (this.gameMode === 'online' && this.networkManager && !remote) {
      this.networkManager.sendLeave();
    }

    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const destination = this.matchContext?.type === 'tournament' ? 'BracketScene' : 'SelectScene';
      this.scene.start(destination, {
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }

  updateSelection() {
    const stage = this.stages[this.selectedIndex];
    const cell = this.gridCells[this.selectedIndex];

    this.cursor.setPosition(cell.rect.x, cell.rect.y);
    this.stageNameText.setText(stage.name.toUpperCase());
    this.stageDescText.setText(stage.description);
  }

  confirmSelection() {
    if (this.transitioning) return;

    const audio = this.game.audioManager;
    audio.play('ui_confirm');

    let stageId = this.stages[this.selectedIndex].id;
    const isRandom = stageId === 'random';

    if (isRandom) {
      const realStages = stagesData;
      stageId = realStages[Phaser.Math.Between(0, realStages.length - 1)].id;
    }

    if (this.gameMode === 'online' && this.networkManager) {
      if (this.isP1) {
        this.networkManager.sendStageSelect(stageId, isRandom);
        this.headerText.setText('ESPERANDO SERVIDOR...');
        this.transitioning = true;
      }
    } else {
      this.goToPreFight(stageId, isRandom);
    }
  }

  goToPreFight(stageId, isRandomStage = false) {
    if (this.transitioning && this.gameMode !== 'online') return;
    this.transitioning = true;

    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('PreFightScene', {
        p1Id: this.p1Id,
        p2Id: this.p2Id,
        stageId: stageId,
        fightId: this._fightId || null,
        isRandomStage: isRandomStage,
        gameMode: this.gameMode,
        networkManager: this.networkManager,
        matchContext: this.matchContext,
      });
    });
  }
}
