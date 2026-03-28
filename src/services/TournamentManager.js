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
 */
export class TournamentManager {
  constructor(data) {
    this.id = data.id || `tournament-${Date.now()}`;
    this.size = data.size || 8;
    this.seed = data.seed || Math.floor(Math.random() * 1000000);
    this.playerFighterId = data.playerFighterId || null;
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

  static generate(fighterIds, size, playerFighterId, seed) {
    const tempPrng = mulberry32(seed);
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(tempPrng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    const available = fighterIds.filter((id) => id !== 'random' && id !== playerFighterId);
    shuffle(available);
    const tournamentFighters = [playerFighterId, ...available.slice(0, size - 1)];
    shuffle(tournamentFighters);

    // Initial P1 Slot Rule
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
    const round1 = [];
    for (let i = 0; i < size / 2; i++) {
      round1.push({
        p1: tournamentFighters[i * 2],
        p2: tournamentFighters[i * 2 + 1],
        winner: null,
      });
    }
    rounds.push(round1);

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
      playerInitialIndex: tournamentFighters.indexOf(playerFighterId),
      rounds,
      prngCalls: 0,
    });
  }

  /**
   * Checks if a specific match in a round is on the player's path.
   */
  _isPlayerPath(roundIndex, matchIndex) {
    if (this.playerInitialIndex === -1) return false;
    const playerMatchIndex = Math.floor(this.playerInitialIndex / 2 ** (roundIndex + 1));
    return matchIndex === playerMatchIndex;
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

    // Special logic for matches leading into the player's path
    if (this._isPlayerPath(nextRoundIdx, nextMatchIdx)) {
      if (winnerId === this.playerFighterId) {
        // Player always takes P1
        nextMatch.p1 = winnerId;
      } else {
        // AI winner. Does it come from the "player's side" or "opponent's side"?
        const isFromPlayerSide = this._isPlayerPath(currentRoundIdx, currentMatchIdx);
        if (isFromPlayerSide) {
          // This AI beat the player (or replaced them), takes P1
          nextMatch.p1 = winnerId;
        } else {
          // This AI is the opponent from the other match, takes P2
          nextMatch.p2 = winnerId;
        }
      }
    } else {
      // Normal AI branch: use natural slotting
      if (isP1Slot) nextMatch.p1 = winnerId;
      else nextMatch.p2 = winnerId;
    }
  }

  simulateRound(roundIndex) {
    let changed = false;
    const round = this.rounds[roundIndex];
    if (!round) return false;

    for (let m = 0; m < round.length; m++) {
      const match = round[m];
      // Only simulate if match is ready (both p1 and p2 present) and not decided
      if (match.p1 && match.p2 && !match.winner) {
        // Only simulate AI vs AI
        if (match.p1 !== this.playerFighterId && match.p2 !== this.playerFighterId) {
          // Pure coin-flip simulation for AI vs AI matches.
          // Deterministic based on the tournament seed.
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
    // We must simulate round by round to ensure participants propagate
    for (let r = 0; r < this.rounds.length; r++) {
      // A single pass might not be enough if round propagation is deep
      // but round-by-round should work since we loop r from 0 to N
      if (this.simulateRound(r)) {
        changed = true;
      }
    }
    return changed;
  }

  simulateAI() {
    return this.simulateAllRemaining();
  }

  advance(winnerId) {
    for (let r = 0; r < this.rounds.length; r++) {
      const round = this.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (
          !match.winner &&
          (match.p1 === this.playerFighterId || match.p2 === this.playerFighterId)
        ) {
          match.winner = winnerId;
          this._setWinnerInNextRound(r, m, winnerId);
          return true;
        }
      }
    }
    return false;
  }

  getCurrentMatch() {
    for (let r = 0; r < this.rounds.length; r++) {
      const round = this.rounds[r];
      for (let m = 0; m < round.length; m++) {
        const match = round[m];
        if (
          !match.winner &&
          (match.p1 === this.playerFighterId || match.p2 === this.playerFighterId)
        ) {
          if (match.p1 && match.p2) {
            return { roundIndex: r, matchIndex: m, ...match };
          }
        }
      }
    }
    return null;
  }

  serialize() {
    return {
      id: this.id,
      size: this.size,
      seed: this.seed,
      playerFighterId: this.playerFighterId,
      playerInitialIndex: this.playerInitialIndex,
      rounds: this.rounds,
      complete: this.complete,
      winnerId: this.winnerId,
      prngCalls: this.prngCalls,
    };
  }
}
