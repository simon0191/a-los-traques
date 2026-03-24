import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';

export class BracketScene extends Phaser.Scene {
  constructor() {
    super('BracketScene');
  }

  init(data) {
    this.tournament = data.tournament;
    this.playerFighterId = data.playerFighterId;
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

    this._drawBrackets();

    const currentMatch = this._getCurrentPlayerMatch();
    if (currentMatch) {
      this._createButton(GAME_WIDTH / 2 - 75, GAME_HEIGHT - 30, 'SIGUIENTE COMBATE', () => {
        this.goToMatch(currentMatch);
      });
      this._createButton(GAME_WIDTH / 2 + 75, GAME_HEIGHT - 30, 'SALIR', () => {
        this.scene.start('TitleScene');
      });
    } else if (this.tournament.complete) {
      const winner = this.tournament.rounds[this.tournament.rounds.length - 1][0].winner;
      const winnerName = fightersData.find((f) => f.id === winner).name;
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT - 60, `CAMPEÓN: ${winnerName}`, {
          fontSize: '18px',
          color: '#ffcc00',
          fontFamily: 'Arial Black',
        })
        .setOrigin(0.5);

      this._createButton(GAME_WIDTH / 2, GAME_HEIGHT - 30, 'SALIR', () => {
        this.scene.start('TitleScene');
      });
    } else {
      // All other matches are AI vs AI, simulate them
      this._simulateAIMatches();
      this.time.delayedCall(1000, () => {
        this.scene.restart({ tournament: this.tournament, playerFighterId: this.playerFighterId });
      });
    }
  }

  _drawBrackets() {
    const rounds = this.tournament.rounds;
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
      match.p1 === this.playerFighterId
        ? '#ff0000'
        : match.winner === match.p1 && match.p1
          ? '#00ff00'
          : '#ffffff';
    const p2Color =
      match.p2 === this.playerFighterId
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

  _getCurrentPlayerMatch() {
    for (let r = 0; r < this.tournament.rounds.length; r++) {
      const round = this.tournament.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (
          !match.winner &&
          (match.p1 === this.playerFighterId || match.p2 === this.playerFighterId)
        ) {
          if (match.p1 && match.p2) {
            return { round: r, match: m, ...match };
          }
        }
      }
    }
    return null;
  }

  _simulateAIMatches() {
    let simulated = false;
    for (let r = 0; r < this.tournament.rounds.length; r++) {
      const round = this.tournament.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (!match.winner && match.p1 && match.p2) {
          if (match.p1 !== this.playerFighterId && match.p2 !== this.playerFighterId) {
            // AI vs AI: pick random winner
            match.winner = Math.random() > 0.5 ? match.p1 : match.p2;
            this._advanceWinner(r, m, match.winner);
            simulated = true;
          }
        }
      }
    }

    if (!simulated && !this._getCurrentPlayerMatch()) {
      this.tournament.complete = true;
    }
  }

  _advanceWinner(roundIdx, matchIdx, winner) {
    const nextRound = this.tournament.rounds[roundIdx + 1];
    if (nextRound) {
      const nextMatchIdx = Math.floor(matchIdx / 2);
      const isP1 = matchIdx % 2 === 0;

      // If winner is player, force them to P1 slot for simplicity in FightScene/InputManager
      if (winner === this.playerFighterId) {
        // If we are advancing to a match where we should be P2, swap with the other side
        if (!isP1) {
          // Move whoever was in P1 to P2
          nextRound[nextMatchIdx].p2 = nextRound[nextMatchIdx].p1;
          nextRound[nextMatchIdx].p1 = winner;
        } else {
          nextRound[nextMatchIdx].p1 = winner;
        }
      } else {
        // AI winner, just fill the slot
        if (isP1) {
          nextRound[nextMatchIdx].p1 = winner;
        } else {
          nextRound[nextMatchIdx].p2 = winner;
        }
      }
    }
  }

  goToMatch(matchData) {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const stageIndex = Phaser.Math.Between(0, stagesData.length - 1);
      this.scene.start('PreFightScene', {
        p1Id: matchData.p1,
        p2Id: matchData.p2,
        stageId: stagesData[stageIndex].id,
        gameMode: 'tournament',
        tournament: this.tournament,
        playerFighterId: this.playerFighterId,
        matchRound: matchData.round,
        matchIndex: matchData.match,
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
