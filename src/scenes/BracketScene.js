import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';
import { TournamentManager } from '../services/TournamentManager.js';
import { createButton } from '../services/UIService.js';
import { DevConsole } from '../systems/DevConsole.js';

const HUMAN_COLORS = [
  '#ff3333',
  '#3366ff',
  '#33cc33',
  '#ffcc00',
  '#cc33ff',
  '#33cccc',
  '#ff8800',
  '#ff66aa',
];

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
  }

  create() {
    this.devConsole = new DevConsole(this);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1e);

    this.add
      .text(GAME_WIDTH / 2, 20, 'TORNEO', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    if (this.fromMatch) {
      if (this.manager.allHumansEliminated()) {
        // All humans out — reveal everything
        this.manager.simulateAllRemaining();
      } else {
        // Simulate AI-vs-AI matches in the completed round
        const completedRoundIdx = this.matchContext.matchInfo.roundIndex;
        this.manager.simulateRound(completedRoundIdx);
      }
      this.matchContext.tournamentState = this.manager.serialize();
      this.manager = new TournamentManager(this.matchContext.tournamentState);
    }

    this._drawBrackets();

    const currentMatch = this.manager.getNextPlayableMatch();
    if (currentMatch) {
      const p1Fighter = fightersData.find((f) => f.id === currentMatch.p1);
      const p2Fighter = fightersData.find((f) => f.id === currentMatch.p2);
      const p1Name = p1Fighter ? p1Fighter.name : '???';
      const p2Name = p2Fighter ? p2Fighter.name : '???';

      createButton(
        this,
        GAME_WIDTH / 2 - 75,
        GAME_HEIGHT - 30,
        `SIGUIENTE: ${p1Name} vs ${p2Name}`,
        () => this.goToMatch(currentMatch),
      );
      createButton(this, GAME_WIDTH / 2 + 75, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
        this.scene.start('MultiplayerMenuScene');
      });
    } else if (this.manager.complete) {
      const winner = fightersData.find((f) => f.id === this.manager.winnerId);

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
        this.scene.start('MultiplayerMenuScene');
      });
    } else {
      createButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 30, 'SALIR AL MENÚ', () => {
        this.scene.start('MultiplayerMenuScene');
      });
    }

    this._drawParticipantsLegend();
  }

  _drawParticipantsLegend() {
    const round1 = this.manager.rounds[0];
    if (!round1) return;

    const panelX = GAME_WIDTH - 85;
    const panelY = 45;

    this.add
      .text(panelX, panelY - 15, 'PARTICIPANTES', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '9px',
        color: '#ffcc00',
      })
      .setOrigin(0, 0);

    // Collect all participants from Round 1
    const participants = [];
    round1.forEach((m) => {
      participants.push({ id: m.p1, level: m.p1Level });
      participants.push({ id: m.p2, level: m.p2Level });
    });

    participants.forEach((p, i) => {
      const fighter = fightersData.find((f) => f.id === p.id);
      const fighterName = fighter ? fighter.name : '???';

      // Find original name from lobby if it was a human/guest
      const lobbyPlayer = this.matchContext?.lobbyPlayers?.find((lp) => lp.fighterId === p.id);

      let displayName = '';
      let color = '#ffffff';

      if (lobbyPlayer && lobbyPlayer.type !== 'bot') {
        displayName = lobbyPlayer.name.toUpperCase();
        if (displayName.startsWith('INVITADO ')) {
          displayName = `INV${displayName.split(' ')[1]}`;
        }
        const humanFighterIds = this.manager.humanFighterIds;
        const colorIdx = humanFighterIds.indexOf(p.id);
        if (colorIdx !== -1) {
          color = HUMAN_COLORS[colorIdx % HUMAN_COLORS.length];
        }
      } else {
        // It's a bot (either manual or auto-filled)
        displayName = `BOT NIV${p.level || 3}`;
      }

      if (displayName.length > 8 && !displayName.startsWith('BOT')) {
        displayName = `${displayName.substring(0, 7)}.`;
      }

      this.add
        .text(panelX, panelY + i * 11, `${displayName}:`, {
          fontFamily: 'Arial',
          fontSize: '7px',
          color: color,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);

      this.add
        .text(panelX + 45, panelY + i * 11, fighterName.toUpperCase(), {
          fontFamily: 'Arial',
          fontSize: '7px',
          color: '#aaaaaa',
        })
        .setOrigin(0, 0);
    });
  }

  getNavMenu() {
    const buttons = this.children.list
      .filter((child) => child.type === 'Rectangle' && child.input?.enabled)
      .sort((a, b) => a.x - b.x);
    return { items: buttons };
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

  _getHumanColor(fighterId) {
    const idx = this.manager.humanFighterIds.indexOf(fighterId);
    if (idx === -1) return null;
    return HUMAN_COLORS[idx % HUMAN_COLORS.length];
  }

  _drawMatch(x, y, match) {
    const boxW = 60;
    const boxH = 30;

    this.add.rectangle(x, y, boxW, boxH, 0x222244).setStrokeStyle(1, 0x4444aa);

    const p1 = match.p1 ? fightersData.find((f) => f.id === match.p1) : null;
    const p2 = match.p2 ? fightersData.find((f) => f.id === match.p2) : null;

    const p1Name = p1 ? p1.name : '???';
    const p2Name = p2 ? p2.name : '???';

    const p1HumanColor = this._getHumanColor(match.p1);
    const p2HumanColor = this._getHumanColor(match.p2);

    const p1Color = p1HumanColor
      ? p1HumanColor
      : match.winner === match.p1 && match.p1
        ? '#00ff00'
        : '#ffffff';
    const p2Color = p2HumanColor
      ? p2HumanColor
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

  executeFastForward() {
    this.manager.fastForwardToFinal();
    this.matchContext.tournamentState = this.manager.serialize();
    this.scene.restart();
  }

  goToMatch(matchData) {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const stageIndex = Math.floor(this.manager.nextRand() * stagesData.length);

      this.matchContext.matchInfo = {
        roundIndex: matchData.roundIndex,
        matchIndex: matchData.matchIndex,
      };

      this.matchContext.isHumanVsHuman = this.manager.isHumanVsHuman(matchData);
      this.matchContext.tournamentState = this.manager.serialize();

      // Determine botLevel if one of the players is an AI
      let botLevel = null;
      if (!this.manager._isHumanFighter(matchData.p1)) {
        botLevel = matchData.p1Level || 3;
      } else if (!this.manager._isHumanFighter(matchData.p2)) {
        botLevel = matchData.p2Level || 3;
      }
      this.matchContext.botLevel = botLevel;

      this.scene.start('PreFightScene', {
        p1Id: matchData.p1,
        p2Id: matchData.p2,
        stageId: stagesData[stageIndex].id,
        isRandomStage: true,
        gameMode: this.gameMode,
        matchContext: this.matchContext,
      });
    });
  }
}
