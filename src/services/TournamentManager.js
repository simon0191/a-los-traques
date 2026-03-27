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
 * Decoupled from Phaser scenes for testability and serializability.
 */
export class TournamentManager {
  /**
   * @param {Object} data - Initial state or serialized tournament data
   */
  constructor(data) {
    this.id = data.id || `tournament-${Date.now()}`;
    this.size = data.size || 8;
    this.seed = data.seed || Math.floor(Math.random() * 1000000);
    this.playerFighterId = data.playerFighterId || null;
    this.rounds = data.rounds || [];
    this.complete = data.complete || false;
    this.winnerId = data.winnerId || null;

    // Initialize PRNG with the tournament seed
    this._prng = mulberry32(this.seed);
  }

  /**
   * Generates a new tournament bracket.
   * Ensures the player is in a valid slot (P1 slot for their matches).
   * @param {Array<string>} fighterIds - Pool of available fighter IDs
   * @param {number} size - 8 or 16
   * @param {string} playerFighterId - ID of the human player's fighter
   * @param {number} seed - Random seed for shuffling
   * @returns {TournamentManager}
   */
  static generate(fighterIds, size, playerFighterId, seed) {
    const prng = mulberry32(seed);
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(prng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    // Filter out 'random' if it exists and pick required number of AI opponents
    const available = fighterIds.filter((id) => id !== 'random' && id !== playerFighterId);
    shuffle(available);
    const tournamentFighters = [playerFighterId, ...available.slice(0, size - 1)];
    shuffle(tournamentFighters);

    // Apply "P1 Slot Rule": If player is in a P2 slot (odd index), swap with P1 (even index)
    const playerIdx = tournamentFighters.indexOf(playerFighterId);
    if (playerIdx % 2 !== 0) {
      const p1Idx = playerIdx - 1;
      [tournamentFighters[p1Idx], tournamentFighters[playerIdx]] = [
        tournamentFighters[playerIdx],
        tournamentFighters[p1Idx],
      ];
    }

    const rounds = [];
    const numRounds = Math.log2(size);

    // Round 1 Initialization
    const round1 = [];
    for (let i = 0; i < size / 2; i++) {
      round1.push({
        p1: tournamentFighters[i * 2],
        p2: tournamentFighters[i * 2 + 1],
        winner: null,
      });
    }
    rounds.push(round1);

    // Initialize empty future rounds
    for (let r = 1; r < numRounds; r++) {
      const matchesInRound = size / 2 ** (r + 1);
      const round = [];
      for (let m = 0; m < matchesInRound; m++) {
        round.push({ p1: null, p2: null, winner: null });
      }
      rounds.push(round);
    }

    return new TournamentManager({
      size,
      seed,
      playerFighterId,
      rounds,
    });
  }

  /**
   * Simulates all AI vs AI matches in all rounds that are ready.
   * Returns true if any changes were made.
   */
  simulateAI() {
    let changed = false;

    for (let r = 0; r < this.rounds.length; r++) {
      const round = this.rounds[r];
      const nextRound = this.rounds[r + 1];

      for (let m = 0; m < round.length; m++) {
        const match = round[m];

        // Only simulate if match has both participants and no winner yet
        if (match.p1 && match.p2 && !match.winner) {
          // Skip if player is involved
          if (match.p1 !== this.playerFighterId && match.p2 !== this.playerFighterId) {
            match.winner = this._prng() > 0.5 ? match.p1 : match.p2;
            changed = true;

            // Advance winner to next round
            if (nextRound) {
              const nextMatchIdx = Math.floor(m / 2);
              const isP1Slot = m % 2 === 0;
              if (isP1Slot) nextRound[nextMatchIdx].p1 = match.winner;
              else nextRound[nextMatchIdx].p2 = match.winner;
            } else {
              // Final match
              this.complete = true;
              this.winnerId = match.winner;
            }
          }
        }
      }
    }

    return changed;
  }

  /**
   * Advances the winner of the player's current match.
   * @param {string} winnerId - ID of the fighter who won
   */
  advance(winnerId) {
    const matchData = this.getCurrentMatch();
    if (!matchData) return false;

    const { roundIndex, matchIndex } = matchData;
    const match = this.rounds[roundIndex][matchIndex];
    match.winner = winnerId;

    const nextRound = this.rounds[roundIndex + 1];
    if (nextRound) {
      const nextMatchIdx = Math.floor(matchIndex / 2);
      const isP1Slot = matchIndex % 2 === 0;

      // "P1 Slot Rule" for advancement: force player to P1 slot in next round
      if (winnerId === this.playerFighterId) {
        if (!isP1Slot) {
          // If we advanced from P2 side, we swap whatever was in P1 to P2
          // (AI vs AI from the other side might have already populated P1)
          nextRound[nextMatchIdx].p2 = nextRound[nextMatchIdx].p1;
          nextRound[nextMatchIdx].p1 = winnerId;
        } else {
          nextRound[nextMatchIdx].p1 = winnerId;
        }
      } else {
        // AI winner, just fill the slot
        if (isP1Slot) nextRound[nextMatchIdx].p1 = winnerId;
        else nextRound[nextMatchIdx].p2 = winnerId;
      }
    } else {
      // Champion!
      this.complete = true;
      this.winnerId = winnerId;
    }

    return true;
  }

  /**
   * Finds the current pending match involving the player.
   */
  getCurrentMatch() {
    for (let r = 0; r < this.rounds.length; r++) {
      const round = this.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (
          !match.winner &&
          (match.p1 === this.playerFighterId || match.p2 === this.playerFighterId)
        ) {
          // Ensure opponent is known before returning
          if (match.p1 && match.p2) {
            return { roundIndex: r, matchIndex: m, ...match };
          }
        }
      }
    }
    return null;
  }

  /**
   * Returns a serializable version of the state.
   */
  serialize() {
    return {
      id: this.id,
      size: this.size,
      seed: this.seed,
      playerFighterId: this.playerFighterId,
      rounds: this.rounds,
      complete: this.complete,
      winnerId: this.winnerId,
    };
  }
}
