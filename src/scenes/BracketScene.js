import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';
import { TournamentManager } from '../services/TournamentManager.js';
import { createButton } from '../services/UIService.js';

export class BracketScene extends Phaser.Scene {
  constructor() {
    super('BracketScene');
  }

  init(data) {
    this.gameMode = data.gameMode || 'local';
    this.matchContext = data.matchContext;
    this.manager = new TournamentManager(this.matchContext.tournamentState);

    // Track if we just came from a match result
    this.fromMatch = data.fromMatch || false;
    this.lastMatchResult = data.winnerId || null;
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

    // Logic for revealing matches:
    // 1. If we return from a match the player LOST, simulate EVERYTHING immediately.
    // 2. If we return from a match the player WON, simulate only the OTHER matches of that same round.
    // 3. If we are entering for the first time, don't simulate anything.
    if (this.fromMatch) {
      if (this.lastMatchResult !== this.manager.playerFighterId) {
        // Player lost, show everything
        this.manager.simulateAllRemaining();
      } else {
        // Player won, reveal only the peers of the round just completed
        const completedRoundIdx = this.matchContext.matchInfo.roundIndex;
        this.manager.simulateRound(completedRoundIdx);
      }
      // Update state in context and RE-INITIALIZE manager to reflect completion if it happened
      this.matchContext.tournamentState = this.manager.serialize();
      this.manager = new TournamentManager(this.matchContext.tournamentState);
    }

    this._drawBrackets();

    const currentMatch = this.manager.getCurrentMatch();
    if (currentMatch) {
      createButton(this, GAME_WIDTH / 2 - 75, GAME_HEIGHT - 30, 'SIGUIENTE COMBATE', () => {
        this.goToMatch(currentMatch);
      });
      createButton(this, GAME_WIDTH / 2 + 75, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
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

      createButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
        this.scene.start('TitleScene');
      });
    } else {
      createButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
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

    const p1 = match.p1 ? fightersData.find((f) => f.id === match.p1) : null;
    const p2 = match.p2 ? fightersData.find((f) => f.id === match.p2) : null;

    const p1Name = p1 ? p1.name : '???';
    const p2Name = p2 ? p2.name : '???';

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
      // Deterministic stage selection using tournament seed
      const stageIndex = Math.floor(this.manager.nextRand() * stagesData.length);

      // Update matchInfo in context before passing it
      this.matchContext.matchInfo = {
        roundIndex: matchData.roundIndex,
        matchIndex: matchData.matchIndex,
      };

      // Persist the PRNG state after consumption
      this.matchContext.tournamentState = this.manager.serialize();

      this.scene.start('PreFightScene', {
        p1Id: matchData.p1,
        p2Id: matchData.p2,
        stageId: stagesData[stageIndex].id,
        gameMode: this.gameMode,
        matchContext: this.matchContext,
      });
    });
  }
}
