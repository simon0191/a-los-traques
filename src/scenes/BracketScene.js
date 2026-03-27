import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';
import { TournamentManager } from '../services/TournamentManager.js';

export class BracketScene extends Phaser.Scene {
  constructor() {
    super('BracketScene');
  }

  init(data) {
    this.gameMode = data.gameMode || 'local';
    this.matchContext = data.matchContext;
    this.manager = new TournamentManager(this.matchContext.tournamentState);
  }

  create() {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add
      .text(GAME_WIDTH / 2, 20, 'TORNEO', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Run AI simulations if needed
    const simulated = this.manager.simulateAI();
    if (simulated) {
      this.matchContext.tournamentState = this.manager.serialize();
    }

    this._drawBrackets();

    const currentMatch = this.manager.getCurrentMatch();
    if (currentMatch) {
      this._createButton(GAME_WIDTH / 2 - 75, GAME_HEIGHT - 30, 'SIGUIENTE COMBATE', () => {
        this.goToMatch(currentMatch);
      });
      this._createButton(GAME_WIDTH / 2 + 75, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
        this.scene.start('TitleScene');
      });
    } else if (this.manager.complete) {
      const winner = fightersData.find((f) => f.id === this.manager.winnerId);

      // Display Champion Portrait
      if (this.textures.exists(`portrait_${this.manager.winnerId}`)) {
        this.add
          .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, `portrait_${this.manager.winnerId}`)
          .setDisplaySize(80, 80);
      } else {
        this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 80, 80, parseInt(winner.color, 16));
      }
      this.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 80, 80, 0x000000, 0)
        .setStrokeStyle(3, 0xffcc00);

      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 55, `¡CAMPEÓN: ${winner.name.toUpperCase()}!`, {
          fontSize: '18px',
          color: '#ffcc00',
          fontFamily: 'Arial Black',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5);

      this._createButton(GAME_WIDTH / 2, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
        this.scene.start('TitleScene');
      });
    } else {
      // If we got here but no player match and not complete, something might be stuck
      // or we are waiting for an animation. Just in case, show back button.
      this._createButton(GAME_WIDTH / 2, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
        this.scene.start('TitleScene');
      });
    }
  }

  _drawBrackets() {
    const rounds = this.manager.rounds;
    const numRounds = rounds.length;
    const roundWidth = GAME_WIDTH / (numRounds + 1);

    rounds.forEach((round, roundIdx) => {
      const x = (roundIdx + 0.5) * roundWidth;
      const matchSpacing = GAME_HEIGHT / (round.length + 1);

      round.forEach((match, matchIdx) => {
        const y = (matchIdx + 1) * matchSpacing;
        this._drawMatch(x, y, match);
      });
    });
  }

  _drawMatch(x, y, match) {
    const boxW = 60;
    const boxH = 30;

    // Draw match box
    this.add.rectangle(x, y, boxW, boxH, 0x222244).setStrokeStyle(1, 0x4444aa);

    const p1Name = match.p1 ? fightersData.find((f) => f.id === match.p1).name : '???';
    const p2Name = match.p2 ? fightersData.find((f) => f.id === match.p2).name : '???';

    const p1Color =
      match.p1 === this.manager.playerFighterId
        ? '#ff0000'
        : match.winner === match.p1 && match.p1
          ? '#00ff00'
          : '#ffffff';
    const p2Color =
      match.p2 === this.manager.playerFighterId
        ? '#ff0000'
        : match.winner === match.p2 && match.p2
          ? '#00ff00'
          : '#ffffff';

    this.add
      .text(x, y - 7, p1Name, {
        fontSize: '8px',
        color: p1Color,
      })
      .setOrigin(0.5);
    this.add
      .text(x, y + 7, p2Name, {
        fontSize: '8px',
        color: p2Color,
      })
      .setOrigin(0.5);

    if (match.winner) {
      this.add.text(x + 25, y, '✔', { fontSize: '10px', color: '#00ff00' }).setOrigin(0.5);
    }
  }

  goToMatch(matchData) {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const stageIndex = Phaser.Math.Between(0, stagesData.length - 1);

      // Update matchInfo in context before passing it
      this.matchContext.matchInfo = {
        roundIndex: matchData.roundIndex,
        matchIndex: matchData.matchIndex,
      };

      this.scene.start('PreFightScene', {
        p1Id: matchData.p1,
        p2Id: matchData.p2,
        stageId: stagesData[stageIndex].id,
        gameMode: this.gameMode,
        matchContext: this.matchContext,
      });
    });
  }

  _createButton(x, y, label, callback) {
    const bg = this.add
      .rectangle(x, y, 140, 24, 0x222244)
      .setStrokeStyle(1, 0x4444aa)
      .setInteractive({ useHandCursor: true });

    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    bg.on('pointerover', () => {
      bg.setFillStyle(0x333366);
      text.setColor('#ffcc00');
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(0x222244);
      text.setColor('#ffffff');
    });
    bg.on('pointerdown', () => {
      this.game.audioManager.play('ui_confirm');
      callback();
    });
  }
}
