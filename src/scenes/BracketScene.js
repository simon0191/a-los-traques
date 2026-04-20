import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';
import { TournamentManager } from '../services/TournamentManager.js';
import { createButton } from '../services/UIService.js';
import { DevConsole } from '../systems/DevConsole.js';
import { autoPickAccessories } from './accessory-select-helpers.js';
import { Logger } from '../systems/Logger.js';

const log = Logger.create('BracketScene');

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
        // All humans out — reveal everything and sync with backend
        this._simulateAndReport(true);
      } else {
        // Simulate AI-vs-AI matches in the completed round
        const completedRoundIdx = this.matchContext.matchInfo.roundIndex;
        this._simulateAndReport(false, completedRoundIdx);
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

      // Determine botLevel if one of the players is an AI
      let botLevel = null;
      if (!this.manager._isHumanFighter(matchData.p1)) {
        botLevel = matchData.p1Level || 3;
      } else if (!this.manager._isHumanFighter(matchData.p2)) {
        botLevel = matchData.p2Level || 3;
      }
      this.matchContext.botLevel = botLevel;
      this.matchContext.humanP1 = this.manager._isHumanFighter(matchData.p1);
      this.matchContext.humanP2 = this.manager._isHumanFighter(matchData.p2);

      const stageId = stagesData[stageIndex].id;
      const hasHuman = this.matchContext.humanP1 || this.matchContext.humanP2;
      // Seed bot auto-picks from the tournament PRNG so runs are reproducible.
      const rng = () => this.manager.nextRand();

      if (!hasHuman) {
        // Bot-vs-bot auto-sim match — skip the picker and auto-equip both
        // bots so they aren't at a (future) stat-bonus disadvantage.
        const manifest = this.game.registry.get('overlayManifest');
        this.matchContext.accessories = {
          p1: autoPickAccessories(manifest, matchData.p1, rng),
          p2: autoPickAccessories(manifest, matchData.p2, rng),
        };
        // Serialize AFTER consuming the auto-pick randoms so the next round's
        // rehydrated TournamentManager doesn't replay them.
        this.matchContext.tournamentState = this.manager.serialize();
        this.scene.start('PreFightScene', {
          p1Id: matchData.p1,
          p2Id: matchData.p2,
          stageId,
          isRandomStage: true,
          gameMode: this.gameMode,
          matchContext: this.matchContext,
        });
        return;
      }

      // At least one human plays this match — route through the picker.
      // Seed bot loadouts here (not in AccessorySelectScene) so the seeded
      // tournament PRNG drives them and E2E replays are reproducible.
      const manifest = this.game.registry.get('overlayManifest');
      const accessories = {};
      if (!this.matchContext.humanP1) {
        accessories.p1 = autoPickAccessories(manifest, matchData.p1, rng);
      }
      if (!this.matchContext.humanP2) {
        accessories.p2 = autoPickAccessories(manifest, matchData.p2, rng);
      }
      this.matchContext.accessories = accessories;
      // Serialize AFTER the auto-pick rng calls.
      this.matchContext.tournamentState = this.manager.serialize();
      this.matchContext.stageId = stageId;
      this.matchContext.isRandomStage = true;
      this.matchContext.nextScene = 'PreFightScene';
      this.scene.start('AccessorySelectScene', {
        p1Id: matchData.p1,
        p2Id: matchData.p2,
        gameMode: this.gameMode,
        matchContext: this.matchContext,
      });
    });
  }

  /**
   * Simulates AI-vs-AI matches and reports them to the backend to keep state in sync.
   */
  async _simulateAndReport(allRemaining, specificRound = null) {
    const tourneyId = this.manager.tourneyId;
    if (!tourneyId) {
      if (allRemaining) this.manager.simulateAllRemaining();
      else if (specificRound !== null) this.manager.simulateRound(specificRound);
      return;
    }

    // We must simulate matches one by one to report them correctly
    for (let r = 0; r < this.manager.rounds.length; r++) {
      if (specificRound !== null && r !== specificRound) continue;

      const round = this.manager.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (match.p1 && match.p2 && !match.winnerUserId) {
          const p1IsActiveHuman =
            this.manager._isHumanPlayer(match.p1UserId) &&
            !this.manager.isPlayerEliminated(match.p1UserId);
          const p2IsActiveHuman =
            this.manager._isHumanPlayer(match.p2UserId) &&
            !this.manager.isPlayerEliminated(match.p2UserId);

          if (!p1IsActiveHuman && !p2IsActiveHuman) {
            // AI vs AI: Simulate
            const winnerUserId = this.manager.nextRand() > 0.5 ? match.p1UserId : match.p2UserId;
            const loserUserId = winnerUserId === match.p1UserId ? match.p2UserId : match.p1UserId;

            this.manager._assignMatchWinner(match, winnerUserId);
            this.manager._setWinnerInNextRound(r, m, winnerUserId);

            // Report to backend (Fire and forget, but tracked)
            this._reportSimulatedMatch(tourneyId, winnerUserId, loserUserId);
          }
        }
      }
      if (!allRemaining && r === specificRound) break;
    }
  }

  async _reportSimulatedMatch(tourneyId, winnerUserId, loserUserId) {
    try {
      const isFinal = this.manager.complete;
      const championId = isFinal ? this.manager.winnerUserId : null;

      // The backend validates that winnerId/loserId are UUIDs for stat updates.
      // For bots, we can't update stats, but we MUST report the match to increment matches_played.
      // We pass null for bot IDs to satisfy the API check if it expects a participant ID.
      // Actually, looking at the backend, it only updates stats if the ID is a valid UUID.
      const isUuid = (id) =>
        id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      const payload = {
        tourneyId,
        winnerId: isUuid(winnerUserId) ? winnerUserId : null,
        loserId: isUuid(loserUserId) ? loserUserId : null,
      };

      if (isFinal && championId && isUuid(championId)) {
        payload.isFinal = true;
        payload.championId = championId;
      } else if (isFinal) {
        // Still mark as final even if champion is a bot
        payload.isFinal = true;
      }

      const { reportTournamentMatch } = await import('../services/api.js');
      await reportTournamentMatch(payload);
      log.info(`Simulated match reported: ${winnerUserId} beat ${loserUserId}`);
    } catch (e) {
      log.warn('Failed to report simulated match', { err: e.message });
    }
  }
}
