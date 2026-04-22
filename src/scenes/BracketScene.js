import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config.js';
import fightersData from '../data/fighters.json';
import stagesData from '../data/stages.json';
import { isUuid, reportTournamentMatch } from '../services/api.js';
import { TournamentManager } from '../services/TournamentManager.js';
import { createButton } from '../services/UIService.js';
import { DevConsole } from '../systems/DevConsole.js';
import { Logger } from '../systems/Logger.js';
import { autoPickAccessories } from './accessory-select-helpers.js';

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
    this.isHost = this.matchContext?.isHost ?? false;
    this.manager = new TournamentManager(this.matchContext.tournamentState);

    // Hardening: Warn if isHost is missing in a tournament context to prevent silent reporting failures.
    if (this.matchContext?.type === 'tournament' && !this.matchContext.isHost) {
      log.warn(
        'isHost flag missing in tournament matchContext; simulated matches will not be reported.',
      );
    }

    // Track if we just came from a match result
    this.fromMatch = data.fromMatch || false;

    // Hardening: Surface repeated reporting failures to the Host
    this._reportingFailures = 0;
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

  async executeFastForward(excludeP1 = false) {
    this.manager.fastForwardToFinal({ excludeP1 });
    this.matchContext.tournamentState = this.manager.serialize();
    if (this.isHost && this.manager.tourneyId) {
      try {
        await this._reportAllFinishedMatches();
      } catch (e) {
        log.error('Dev fast-forward reporting failed', { err: e.message });
      }
    }
    this.scene.restart();
  }

  async executeSetWinner(roundIndex, matchIndex, winnerUserId) {
    const success = this.manager.setMatchWinner(roundIndex, matchIndex, winnerUserId);
    if (success) {
      this.matchContext.tournamentState = this.manager.serialize();
      if (this.isHost && this.manager.tourneyId) {
        try {
          await this._reportAllFinishedMatches();
        } catch (e) {
          log.error('Dev set-winner reporting failed', { err: e.message });
        }
      }
      this.scene.restart();
    }
  }

  async _reportAllFinishedMatches() {
    const tourneyId = this.manager.tourneyId;
    if (!tourneyId) return;

    log.info(`[Bracket] Starting batch-report of all finished matches for tourney ${tourneyId}`);

    for (let r = 0; r < this.manager.rounds.length; r++) {
      const round = this.manager.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (match.winnerUserId) {
          const loserUserId = match.winnerUserId === match.p1UserId ? match.p2UserId : match.p1UserId;
          try {
             await this._reportSimulatedMatch(tourneyId, match.winnerUserId, loserUserId, r, m);
          } catch (e) {
             // If a single match fails (e.g. conflict already handled), we log but keep going.
             log.debug('Match already reported or failed (ignoring)', { r, m, err: e.message });
          }
        }
      }
    }
    log.info('[Bracket] Batch-report complete');
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
    // Only the Host should report simulated results to the backend
    if (!this.isHost) {
      if (allRemaining) this.manager.simulateAllRemaining();
      else if (specificRound !== null) this.manager.simulateRound(specificRound);
      return;
    }

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

            // Report to backend (Sequential await to avoid overwhelming connection pool)
            await this._reportSimulatedMatch(tourneyId, winnerUserId, loserUserId, r, m);
          }
        }
      }
      if (!allRemaining && r === specificRound) break;
    }
  }

  async _reportSimulatedMatch(tourneyId, winnerUserId, loserUserId, roundIndex, matchIndex) {
    try {
      const isFinal =
        this.manager.complete &&
        roundIndex === this.manager.rounds.length - 1 &&
        matchIndex === 0;

      // Authoritative champion check
      const championUserId = isFinal ? this.manager.winnerUserId : null;

      const payload = {
        tourneyId,
        winnerId: isUuid(winnerUserId) ? winnerUserId : null,
        loserId: isUuid(loserUserId) ? loserUserId : null,
        roundIndex,
        matchIndex,
      };

      if (isFinal && championUserId && isUuid(championUserId)) {
        payload.isFinal = true;
        payload.championId = championUserId;
        log.info(`[Bracket] Reporting FINAL match: ${winnerUserId} beat ${loserUserId}. Champion: ${championUserId}`);
      } else if (isFinal) {
        payload.isFinal = true;
        log.info(`[Bracket] Reporting FINAL match: ${winnerUserId} beat ${loserUserId}. (AI Champion)`);
      } else {
        log.info(`[Bracket] Reporting match: R${roundIndex} M${matchIndex}: ${winnerUserId} beat ${loserUserId}`);
      }

      const resp = await reportTournamentMatch(payload);
      this._reportingFailures = 0; // Reset on success
      return resp;
    } catch (e) {
      this._reportingFailures++;
      log.warn('Failed to report simulated match', {
        err: e.message,
        roundIndex,
        matchIndex,
        failures: this._reportingFailures,
      });

      if (this._reportingFailures >= 3) {
        this._showSyncError();
      }
      throw e; // Bubble up so the dev command can report failure
    }
  }

  _showSyncError() {
    const errorText = this.add
      .text(GAME_WIDTH / 2, 40, '⚠ RESULTADOS NO SINCRONIZADOS', {
        fontFamily: 'Arial Black',
        fontSize: '10px',
        color: '#ff4444',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.tweens.add({
      targets: errorText,
      alpha: 1,
      duration: 500,
      yoyo: true,
      hold: 2000,
      onComplete: () => errorText.destroy(),
    });
  }
}
