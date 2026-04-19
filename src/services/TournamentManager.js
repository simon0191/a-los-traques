/**
 * Seeded PRNG (mulberry32) for reproducible results.
 * @param {number} a - Seed
 */
function mulberry32(a) {
  let seed = a;
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pure JavaScript class to manage tournament bracket logic.
 * Supports N human players (1–8) in a single bracket.
 */
export class TournamentManager {
  constructor(data) {
    this.id = data.id || `tournament-${Date.now()}`;
    this.tourneyId = data.tourneyId || null;
    this.size = data.size || 8;
    this.seed = data.seed || Math.floor(Math.random() * 1000000);

    // Human player identities (unique userIds)
    this.humanPlayerIds = data.humanPlayerIds || [];

    // N-player support: humanFighterIds is kept for UI legend purposes
    if (data.humanFighterIds) {
      this.humanFighterIds = [...data.humanFighterIds];
    } else if (data.playerFighterId) {
      // Backward compat: single-player tournament
      this.humanFighterIds = [data.playerFighterId];
    } else {
      this.humanFighterIds = [];
    }

    // Eliminated player identities (unique userIds)
    this.eliminatedPlayerIds = data.eliminatedPlayerIds || [];

    // Backward compatibility for old saves using fighter IDs for logic
    if (data.eliminatedHumans && this.eliminatedPlayerIds.length === 0) {
      console.warn(
        'TournamentManager: Falling back to legacy eliminatedHumans. State may be inconsistent.',
      );
      this.eliminatedPlayerIds = [...data.eliminatedHumans];
    }
    if (this.humanPlayerIds.length === 0 && this.humanFighterIds.length > 0) {
      console.warn(
        'TournamentManager: Falling back to legacy humanFighterIds for identity. State may be inconsistent.',
      );
      this.humanPlayerIds = [...this.humanFighterIds];
    }

    this.playerFighterId = this.humanFighterIds[0] || null;
    this.playerInitialIndex = data.playerInitialIndex !== undefined ? data.playerInitialIndex : -1;
    this.rounds = data.rounds || [];
    this.complete = data.complete || false;
    this.winnerId = data.winnerId || null;
    this.winnerUserId = data.winnerUserId || null;
    this.prngCalls = data.prngCalls || 0;

    // Initialize PRNG and fast-forward to the saved state
    this._prng = mulberry32(this.seed);
    for (let i = 0; i < this.prngCalls; i++) {
      this._prng();
    }
  }

  /**
   * Safe PRNG wrapper that tracks calls.
   */
  nextRand() {
    this.prngCalls++;
    return this._prng();
  }

  /**
   * Check if a fighter ID belongs to a human player.
   * @deprecated Use _isHumanPlayer where possible.
   */
  _isHumanFighter(fighterId) {
    return this.humanFighterIds.includes(fighterId);
  }

  /**
   * Check if a participant's userId belongs to a human player.
   */
  _isHumanPlayer(playerId) {
    return this.humanPlayerIds.includes(playerId);
  }

  /**
   * Check if a player has been eliminated from the tournament.
   */
  isPlayerEliminated(playerId) {
    return this.eliminatedPlayerIds.includes(playerId);
  }

  /**
   * Check if a human player has been eliminated (legacy alias).
   */
  isHumanEliminated(id) {
    return this.isPlayerEliminated(id);
  }

  /**
   * Alias for compatibility with old code/tests.
   */
  get eliminatedHumans() {
    return this.eliminatedPlayerIds;
  }

  /**
   * Check if a match is human vs human.
   */
  isHumanVsHuman(match) {
    return this._isHumanPlayer(match.p1UserId) && this._isHumanPlayer(match.p2UserId);
  }

  /**
   * Internal helper to atomically assign a match winner by userId and sync fighterId.
   */
  _assignMatchWinner(match, winnerUserId) {
    match.winnerUserId = winnerUserId;
    match.winner = winnerUserId === match.p1UserId ? match.p1 : match.p2;
  }

  /**
   * Generate a tournament bracket with N human players.
   * @param {string[]} fighterIds - All available fighter IDs
   * @param {number} size - Tournament size (8 or 16)
   * @param {string|string[]} humanFighterIds - Human player fighter ID(s)
   * @param {number} seed - PRNG seed
   * @param {object[]} [lobbyParticipants] - Optional specific bots/humans from lobby
   * @param {string} [tourneyId] - Optional backend session ID
   */
  static generate(
    fighterIds,
    size,
    humanFighterIds,
    seed,
    lobbyParticipants = [],
    tourneyId = null,
  ) {
    // Normalize to array for backward compat
    const humans = typeof humanFighterIds === 'string' ? [humanFighterIds] : [...humanFighterIds];

    const tempPrng = mulberry32(seed);
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(tempPrng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    // Separate specific bots from lobby
    const lobbyBots = lobbyParticipants.filter((p) => p.type === 'bot');

    // Build AI pool (exclude humans and 'random')
    const available = fighterIds.filter((id) => id !== 'random' && !humans.includes(id));
    shuffle(available);

    // Fill bracket: humans + enough AI to reach size
    const aiFighters = available.slice(0, size - humans.length);
    const tournamentFighters = new Array(size);
    const humanPlayerIds = [];

    // 1. Place Humans at evenly-spaced positions
    const lobbyHumans = lobbyParticipants.filter((p) => p.type === 'human' || p.type === 'guest');

    for (let h = 0; h < humans.length; h++) {
      const slot = Math.floor((h * size) / humans.length);
      const fId = humans[h];
      // Match by order of selection, which corresponds to lobbyHumans order
      const lobbyP = lobbyHumans[h];
      const pId = lobbyP?.id || `human-${h}`;
      tournamentFighters[slot] = {
        id: fId,
        userId: pId,
        type: 'human',
      };
      humanPlayerIds.push(pId);
    }

    // 2. Prepare specific bots from lobby
    const botsToPlace = [...lobbyBots];

    // Second pass: move odd-slot humans to nearby empty even slots
    for (let i = 0; i < size; i++) {
      if (i % 2 !== 0 && tournamentFighters[i]?.type === 'human') {
        if (!tournamentFighters[i - 1]) {
          tournamentFighters[i - 1] = tournamentFighters[i];
          tournamentFighters[i] = undefined;
        } else {
          let best = -1;
          for (let e = 0; e < size; e += 2) {
            if (!tournamentFighters[e]) {
              if (best === -1 || Math.abs(e - i) < Math.abs(best - i)) {
                best = e;
              }
            }
          }
          if (best !== -1) {
            tournamentFighters[best] = tournamentFighters[i];
            tournamentFighters[i] = undefined;
          }
        }
      }
    }

    // 3. Fill remaining slots: first with specific lobby bots, then generic AI
    let aiIdx = 0;
    for (let i = 0; i < size; i++) {
      if (!tournamentFighters[i]) {
        const fId = aiFighters[aiIdx++];
        if (botsToPlace.length > 0) {
          const b = botsToPlace.shift();
          tournamentFighters[i] = {
            id: fId,
            type: 'bot',
            level: b.level,
            userId: b.id || `bot-${i}`,
          };
        } else {
          tournamentFighters[i] = { id: fId, type: 'bot', level: 3, userId: `bot-${i}` };
        }
      }
    }

    // Build rounds
    const rounds = [];
    const numRounds = Math.log2(size);
    const round1 = [];
    for (let i = 0; i < size / 2; i++) {
      const p1Data = tournamentFighters[i * 2];
      const p2Data = tournamentFighters[i * 2 + 1];

      round1.push({
        p1: p1Data.id,
        p2: p2Data.id,
        p1UserId: p1Data.userId || null,
        p2UserId: p2Data.userId || null,
        p1Level: p1Data.type === 'bot' ? p1Data.level : null,
        p2Level: p2Data.type === 'bot' ? p2Data.level : null,
        winner: null,
        winnerUserId: null,
      });
    }
    rounds.push(round1);

    for (let r = 1; r < numRounds; r++) {
      const matchesInRound = size / 2 ** (r + 1);
      const round = [];
      for (let m = 0; m < matchesInRound; m++) {
        round.push({
          p1: null,
          p2: null,
          p1UserId: null,
          p2UserId: null,
          winner: null,
          winnerUserId: null,
        });
      }
      rounds.push(round);
    }

    // Correctly find playerInitialIndex by matching the first human player identity
    let playerInitialIndex = 0;
    for (let i = 0; i < tournamentFighters.length; i++) {
      if (tournamentFighters[i] && tournamentFighters[i].userId === humanPlayerIds[0]) {
        playerInitialIndex = i;
        break;
      }
    }

    return new TournamentManager({
      tourneyId,
      size,
      seed,
      humanFighterIds: humans,
      humanPlayerIds,
      playerInitialIndex,
      rounds,
      prngCalls: 0,
    });
  }

  /**
   * Checks if a specific match in a round is on any human's path.
   */
  _isHumanPath(roundIndex, matchIndex) {
    for (const playerId of this.humanPlayerIds) {
      if (this.isPlayerEliminated(playerId)) continue;
      const initialIdx = this._getPlayerInitialIndex(playerId);
      if (initialIdx === -1) continue;
      const pathMatchIndex = Math.floor(initialIdx / 2 ** (roundIndex + 1));
      if (matchIndex === pathMatchIndex) return true;
    }
    return false;
  }

  /**
   * Get the initial bracket index for a human player.
   */
  _getPlayerInitialIndex(playerId) {
    // Check the first round for this playerId
    for (let m = 0; m < this.rounds[0].length; m++) {
      const match = this.rounds[0][m];
      if (match.p1UserId === playerId) return m * 2;
      if (match.p2UserId === playerId) return m * 2 + 1;
    }
    return -1;
  }

  /**
   * Set the winner in the next round's match slot.
   */
  _setWinnerInNextRound(currentRoundIdx, currentMatchIdx, winnerUserId) {
    const nextRoundIdx = currentRoundIdx + 1;
    if (nextRoundIdx >= this.rounds.length) {
      this.complete = true;
      this.winnerUserId = winnerUserId;
      // Also set fighter ID for UI compatibility
      const currentMatch = this.rounds[currentRoundIdx][currentMatchIdx];
      this.winnerId = currentMatch.p1UserId === winnerUserId ? currentMatch.p1 : currentMatch.p2;
      return;
    }

    const nextMatchIdx = Math.floor(currentMatchIdx / 2);
    const nextMatch = this.rounds[nextRoundIdx][nextMatchIdx];
    const isP1Slot = currentMatchIdx % 2 === 0;

    // Preserve winner details
    const currentMatch = this.rounds[currentRoundIdx][currentMatchIdx];
    const isP1Winner = currentMatch.p1UserId === winnerUserId;
    const winnerFighterId = isP1Winner ? currentMatch.p1 : currentMatch.p2;
    const winnerLevel = isP1Winner ? currentMatch.p1Level : currentMatch.p2Level;

    // Human players always take P1 slot in their next match
    if (this._isHumanPlayer(winnerUserId) && this._isHumanPath(nextRoundIdx, nextMatchIdx)) {
      // Check if the other slot already has a human (human-vs-human upcoming)
      const otherSlotHasHuman =
        (isP1Slot && this._isHumanPlayer(nextMatch.p2UserId)) ||
        (!isP1Slot && this._isHumanPlayer(nextMatch.p1UserId));

      if (otherSlotHasHuman) {
        // Both are human — use natural slotting to avoid overwriting
        if (isP1Slot) {
          nextMatch.p1 = winnerFighterId;
          nextMatch.p1UserId = winnerUserId;
          nextMatch.p1Level = winnerLevel;
        } else {
          nextMatch.p2 = winnerFighterId;
          nextMatch.p2UserId = winnerUserId;
          nextMatch.p2Level = winnerLevel;
        }
      } else {
        // Human gets P1 slot
        nextMatch.p1 = winnerFighterId;
        nextMatch.p1UserId = winnerUserId;
        nextMatch.p1Level = winnerLevel;
      }
    } else if (this._isHumanPath(nextRoundIdx, nextMatchIdx)) {
      // AI winner advancing into a path where a human might appear
      const isFromHumanSide = this._isHumanPath(currentRoundIdx, currentMatchIdx);
      if (isFromHumanSide) {
        nextMatch.p1 = winnerFighterId;
        nextMatch.p1UserId = winnerUserId;
        nextMatch.p1Level = winnerLevel;
      } else {
        nextMatch.p2 = winnerFighterId;
        nextMatch.p2UserId = winnerUserId;
        nextMatch.p2Level = winnerLevel;
      }
    } else {
      // Pure AI branch: natural slotting
      if (isP1Slot) {
        nextMatch.p1 = winnerFighterId;
        nextMatch.p1UserId = winnerUserId;
        nextMatch.p1Level = winnerLevel;
      } else {
        nextMatch.p2 = winnerFighterId;
        nextMatch.p2UserId = winnerUserId;
        nextMatch.p2Level = winnerLevel;
      }
    }
  }

  simulateRound(roundIndex) {
    let changed = false;
    const round = this.rounds[roundIndex];
    if (!round) return false;

    for (let m = 0; m < round.length; m++) {
      const match = round[m];
      if (match.p1 && match.p2 && !match.winnerUserId) {
        // Only simulate if neither player is a non-eliminated human
        const p1IsActiveHuman =
          this._isHumanPlayer(match.p1UserId) && !this.isPlayerEliminated(match.p1UserId);
        const p2IsActiveHuman =
          this._isHumanPlayer(match.p2UserId) && !this.isPlayerEliminated(match.p2UserId);
        if (!p1IsActiveHuman && !p2IsActiveHuman) {
          const winnerUserId = this.nextRand() > 0.5 ? match.p1UserId : match.p2UserId;
          this._assignMatchWinner(match, winnerUserId);
          this._setWinnerInNextRound(roundIndex, m, winnerUserId);
          changed = true;
        }
      }
    }
    return changed;
  }

  simulateAllRemaining() {
    let changed = false;
    for (let r = 0; r < this.rounds.length; r++) {
      if (this.simulateRound(r)) {
        changed = true;
      }
    }
    return changed;
  }

  simulateAI() {
    return this.simulateAllRemaining();
  }

  fastForwardToFinal() {
    // Iterate through all rounds except the final round
    for (let r = 0; r < this.rounds.length - 1; r++) {
      const round = this.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (match.winnerUserId) continue;

        // If participants are missing (should not happen in round order),
        // we skip to avoid errors, but they should be filled by previous round iterations.
        if (!match.p1UserId || !match.p2UserId) continue;

        const p1IsHuman = this._isHumanPlayer(match.p1UserId);
        const p2IsHuman = this._isHumanPlayer(match.p2UserId);

        let winnerUserId;
        // Priority: Human always beats Bot. If both human, P1 beats P2.
        if (p1IsHuman) {
          winnerUserId = match.p1UserId;
        } else if (p2IsHuman) {
          winnerUserId = match.p2UserId;
        } else {
          // Bot vs Bot: Random
          winnerUserId = this.nextRand() > 0.5 ? match.p1UserId : match.p2UserId;
        }

        this._assignMatchWinner(match, winnerUserId);
        this._setWinnerInNextRound(r, m, winnerUserId);
      }
    }
  }

  /**
   * Record the result of any match manually (used for AI simulation and testing).
   * @param {number} roundIndex
   * @param {number} matchIndex
   * @param {string} winnerUserId
   */
  setMatchWinner(roundIndex, matchIndex, winnerUserId) {
    const match = this.rounds[roundIndex]?.[matchIndex];
    if (!match || match.winnerUserId) return false;

    this._assignMatchWinner(match, winnerUserId);

    // Track human elimination if applicable
    const loserUserId = winnerUserId === match.p1UserId ? match.p2UserId : match.p1UserId;
    if (this._isHumanPlayer(loserUserId)) {
      this.eliminatedPlayerIds.push(loserUserId);
    }

    this._setWinnerInNextRound(roundIndex, matchIndex, winnerUserId);
    return true;
  }

  /**
   * Record the result of a played match.
   * Finds the first unfinished match involving a non-eliminated human.
   * @param {string} winnerUserId
   */
  advance(winnerUserId) {
    for (let r = 0; r < this.rounds.length; r++) {
      const round = this.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (match.winnerUserId) continue;
        const p1IsActiveHuman =
          this._isHumanPlayer(match.p1UserId) && !this.isPlayerEliminated(match.p1UserId);
        const p2IsActiveHuman =
          this._isHumanPlayer(match.p2UserId) && !this.isPlayerEliminated(match.p2UserId);
        if (p1IsActiveHuman || p2IsActiveHuman) {
          this._assignMatchWinner(match, winnerUserId);

          // Track human elimination
          const loserUserId = winnerUserId === match.p1UserId ? match.p2UserId : match.p1UserId;
          if (this._isHumanPlayer(loserUserId)) {
            this.eliminatedPlayerIds.push(loserUserId);
          }
          this._setWinnerInNextRound(r, m, winnerUserId);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get the next match that requires human play.
   * Scans rounds in order, returns first match where at least one participant
   * is a non-eliminated human and both slots are filled.
   */
  getNextPlayableMatch() {
    for (let r = 0; r < this.rounds.length; r++) {
      const round = this.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (match.winnerUserId) continue;
        if (!match.p1UserId || !match.p2UserId) continue;
        const p1IsActiveHuman =
          this._isHumanPlayer(match.p1UserId) && !this.isPlayerEliminated(match.p1UserId);
        const p2IsActiveHuman =
          this._isHumanPlayer(match.p2UserId) && !this.isPlayerEliminated(match.p2UserId);
        if (p1IsActiveHuman || p2IsActiveHuman) {
          return { roundIndex: r, matchIndex: m, ...match };
        }
      }
    }
    return null;
  }

  /**
   * Backward-compat alias for getNextPlayableMatch.
   */
  getCurrentMatch() {
    return this.getNextPlayableMatch();
  }

  /**
   * Check if all human players have been eliminated.
   */
  allHumansEliminated() {
    return this.humanPlayerIds.every((id) => this.eliminatedPlayerIds.includes(id));
  }

  serialize() {
    return {
      id: this.id,
      tourneyId: this.tourneyId,
      size: this.size,
      seed: this.seed,
      humanFighterIds: this.humanFighterIds,
      humanPlayerIds: this.humanPlayerIds,
      eliminatedPlayerIds: this.eliminatedPlayerIds,
      playerFighterId: this.playerFighterId,
      playerInitialIndex: this.playerInitialIndex,
      rounds: this.rounds,
      complete: this.complete,
      winnerId: this.winnerId,
      winnerUserId: this.winnerUserId,
      prngCalls: this.prngCalls,
    };
  }
}
