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

    // N-player support: humanFighterIds is the source of truth
    if (data.humanFighterIds) {
      this.humanFighterIds = [...data.humanFighterIds];
    } else if (data.playerFighterId) {
      // Backward compat: single-player tournament
      this.humanFighterIds = [data.playerFighterId];
    } else {
      this.humanFighterIds = [];
    }
    this.playerFighterId = this.humanFighterIds[0] || null;

    this.eliminatedHumans = data.eliminatedHumans ? [...data.eliminatedHumans] : [];

    this.playerInitialIndex = data.playerInitialIndex !== undefined ? data.playerInitialIndex : -1;
    this.rounds = data.rounds || [];
    this.complete = data.complete || false;
    this.winnerId = data.winnerId || null;
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
   */
  _isHumanFighter(fighterId) {
    return this.humanFighterIds.includes(fighterId);
  }

  /**
   * Check if a human fighter has been eliminated from the tournament.
   */
  isHumanEliminated(fighterId) {
    return this.eliminatedHumans.includes(fighterId);
  }

  /**
   * Check if a match is human vs human.
   */
  isHumanVsHuman(match) {
    return this._isHumanFighter(match.p1) && this._isHumanFighter(match.p2);
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

    // 1. Place Humans at evenly-spaced positions
    const lobbyHumans = lobbyParticipants.filter((p) => p.type === 'human' || p.type === 'guest');

    for (let h = 0; h < humans.length; h++) {
      const slot = Math.floor((h * size) / humans.length);
      const fId = humans[h];
      // Match by order of selection, which corresponds to lobbyHumans order
      const lobbyP = lobbyHumans[h];
      tournamentFighters[slot] = {
        id: fId,
        userId: lobbyP ? lobbyP.id : null,
        type: 'human',
      };
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
          tournamentFighters[i] = { id: fId, type: 'bot', level: b.level };
        } else {
          tournamentFighters[i] = { id: fId, type: 'bot', level: 3 };
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
      });
    }
    rounds.push(round1);

    for (let r = 1; r < numRounds; r++) {
      const matchesInRound = size / 2 ** (r + 1);
      const round = [];
      for (let m = 0; m < matchesInRound; m++) {
        round.push({ p1: null, p2: null, p1UserId: null, p2UserId: null, winner: null });
      }
      rounds.push(round);
    }

    // Correctly find playerInitialIndex by matching the first human ID
    let playerInitialIndex = 0;
    for (let i = 0; i < tournamentFighters.length; i++) {
      if (tournamentFighters[i] && tournamentFighters[i].id === humans[0]) {
        playerInitialIndex = i;
        break;
      }
    }

    return new TournamentManager({
      id: `tournament-${Date.now()}`,
      tourneyId,
      size,
      seed,
      humanFighterIds: humans,
      playerInitialIndex,
      rounds,
      prngCalls: 0,
    });
  }

  /**
   * Checks if a specific match in a round is on any human's path.
   */
  _isHumanPath(roundIndex, matchIndex) {
    for (const humanId of this.humanFighterIds) {
      if (this.isHumanEliminated(humanId)) continue;
      const humanInitialIdx = this._getHumanInitialIndex(humanId);
      if (humanInitialIdx === -1) continue;
      const humanMatchIndex = Math.floor(humanInitialIdx / 2 ** (roundIndex + 1));
      if (matchIndex === humanMatchIndex) return true;
    }
    return false;
  }

  /**
   * Get the initial bracket index for a human fighter.
   */
  _getHumanInitialIndex(humanId) {
    if (humanId === this.humanFighterIds[0]) return this.playerInitialIndex;
    // For other humans, scan the first round
    for (let m = 0; m < this.rounds[0].length; m++) {
      const match = this.rounds[0][m];
      if (match.p1 === humanId) return m * 2;
      if (match.p2 === humanId) return m * 2 + 1;
    }
    return -1;
  }

  /**
   * Helper to set the winner in the next round with correct slotting.
   */
  _setWinnerInNextRound(currentRoundIdx, currentMatchIdx, winnerId) {
    const nextRoundIdx = currentRoundIdx + 1;
    if (nextRoundIdx >= this.rounds.length) {
      this.complete = true;
      this.winnerId = winnerId;
      return;
    }

    const nextMatchIdx = Math.floor(currentMatchIdx / 2);
    const nextMatch = this.rounds[nextRoundIdx][nextMatchIdx];
    const isP1Slot = currentMatchIdx % 2 === 0;

    // Preserve winner level and userId
    const currentMatch = this.rounds[currentRoundIdx][currentMatchIdx];
    const winnerLevel = winnerId === currentMatch.p1 ? currentMatch.p1Level : currentMatch.p2Level;
    const winnerUserId =
      winnerId === currentMatch.p1 ? currentMatch.p1UserId : currentMatch.p2UserId;

    // Human players always take P1 slot in their next match
    if (this._isHumanFighter(winnerId) && this._isHumanPath(nextRoundIdx, nextMatchIdx)) {
      // Check if the other slot already has a human (human-vs-human upcoming)
      const otherSlotHasHuman =
        (isP1Slot && this._isHumanFighter(nextMatch.p2)) ||
        (!isP1Slot && this._isHumanFighter(nextMatch.p1));

      if (otherSlotHasHuman) {
        // Both are human — use natural slotting to avoid overwriting
        if (isP1Slot) {
          nextMatch.p1 = winnerId;
          nextMatch.p1UserId = winnerUserId;
          nextMatch.p1Level = winnerLevel;
        } else {
          nextMatch.p2 = winnerId;
          nextMatch.p2UserId = winnerUserId;
          nextMatch.p2Level = winnerLevel;
        }
      } else {
        // Human gets P1 slot
        nextMatch.p1 = winnerId;
        nextMatch.p1UserId = winnerUserId;
        nextMatch.p1Level = winnerLevel;
      }
    } else if (this._isHumanPath(nextRoundIdx, nextMatchIdx)) {
      // AI winner advancing into a path where a human might appear
      const isFromHumanSide = this._isHumanPath(currentRoundIdx, currentMatchIdx);
      if (isFromHumanSide) {
        nextMatch.p1 = winnerId;
        nextMatch.p1UserId = winnerUserId;
        nextMatch.p1Level = winnerLevel;
      } else {
        nextMatch.p2 = winnerId;
        nextMatch.p2UserId = winnerUserId;
        nextMatch.p2Level = winnerLevel;
      }
    } else {
      // Pure AI branch: natural slotting
      if (isP1Slot) {
        nextMatch.p1 = winnerId;
        nextMatch.p1UserId = winnerUserId;
        nextMatch.p1Level = winnerLevel;
      } else {
        nextMatch.p2 = winnerId;
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
      if (match.p1 && match.p2 && !match.winner) {
        // Only simulate if neither fighter is a non-eliminated human
        const p1IsActiveHuman = this._isHumanFighter(match.p1) && !this.isHumanEliminated(match.p1);
        const p2IsActiveHuman = this._isHumanFighter(match.p2) && !this.isHumanEliminated(match.p2);
        if (!p1IsActiveHuman && !p2IsActiveHuman) {
          match.winner = this.nextRand() > 0.5 ? match.p1 : match.p2;
          this._setWinnerInNextRound(roundIndex, m, match.winner);
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

  /**
   * Record the result of any match manually (used for AI simulation and testing).
   * @param {number} roundIndex
   * @param {number} matchIndex
   * @param {string} winnerId
   */
  setMatchWinner(roundIndex, matchIndex, winnerId) {
    const match = this.rounds[roundIndex]?.[matchIndex];
    if (!match || match.winner) return false;

    match.winner = winnerId;

    // Track human elimination if applicable
    const loserId = winnerId === match.p1 ? match.p2 : match.p1;
    if (this._isHumanFighter(loserId)) {
      this.eliminatedHumans.push(loserId);
    }

    this._setWinnerInNextRound(roundIndex, matchIndex, winnerId);
    return true;
  }

  /**
   * Record the result of a played match.
   * Finds the first unfinished match involving a non-eliminated human.
   */
  advance(winnerId) {
    for (let r = 0; r < this.rounds.length; r++) {
      const round = this.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (match.winner) continue;
        const p1IsActiveHuman = this._isHumanFighter(match.p1) && !this.isHumanEliminated(match.p1);
        const p2IsActiveHuman = this._isHumanFighter(match.p2) && !this.isHumanEliminated(match.p2);
        if (p1IsActiveHuman || p2IsActiveHuman) {
          match.winner = winnerId;
          // Track human elimination
          const loserId = winnerId === match.p1 ? match.p2 : match.p1;
          if (this._isHumanFighter(loserId)) {
            this.eliminatedHumans.push(loserId);
          }
          this._setWinnerInNextRound(r, m, winnerId);
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
        if (match.winner) continue;
        if (!match.p1 || !match.p2) continue;
        const p1IsActiveHuman = this._isHumanFighter(match.p1) && !this.isHumanEliminated(match.p1);
        const p2IsActiveHuman = this._isHumanFighter(match.p2) && !this.isHumanEliminated(match.p2);
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
    return this.humanFighterIds.every((id) => this.eliminatedHumans.includes(id));
  }

  serialize() {
    return {
      id: this.id,
      tourneyId: this.tourneyId,
      size: this.size,
      seed: this.seed,
      humanFighterIds: this.humanFighterIds,
      eliminatedHumans: this.eliminatedHumans,
      playerFighterId: this.playerFighterId,
      playerInitialIndex: this.playerInitialIndex,
      rounds: this.rounds,
      complete: this.complete,
      winnerId: this.winnerId,
      prngCalls: this.prngCalls,
    };
  }
}
