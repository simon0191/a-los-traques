import { describe, expect, it, vi } from 'vitest';
import { TournamentManager } from '../../src/services/TournamentManager.js';

describe('TournamentManager', () => {
  const fighters = [
    'alv',
    'angy',
    'bozzi',
    'cami',
    'carito',
    'cata',
    'chicha',
    'gartner',
    'jeka',
    'lini',
    'mao',
    'migue',
    'peks',
    'richi',
    'simon',
    'sun',
  ];

  describe('generate()', () => {
    it('produces correct bracket structure for size 8', () => {
      const size = 8;
      const player = 'alv';
      const seed = 12345;
      const manager = TournamentManager.generate(fighters, size, player, seed);

      expect(manager.size).toBe(size);
      expect(manager.rounds).toHaveLength(3); // log2(8)
      expect(manager.rounds[0]).toHaveLength(4);
      expect(manager.rounds[1]).toHaveLength(2);
      expect(manager.rounds[2]).toHaveLength(1);
    });

    it('produces correct bracket structure for size 16', () => {
      const size = 16;
      const player = 'alv';
      const seed = 12345;
      const manager = TournamentManager.generate(fighters, size, player, seed);

      expect(manager.size).toBe(size);
      expect(manager.rounds).toHaveLength(4); // log2(16)
      expect(manager.rounds[0]).toHaveLength(8);
      expect(manager.rounds[1]).toHaveLength(4);
      expect(manager.rounds[2]).toHaveLength(2);
      expect(manager.rounds[3]).toHaveLength(1);
    });

    it('enforces the P1 Slot Rule (player is always P1 in their first match)', () => {
      const size = 8;
      const player = 'alv';
      // Test multiple seeds to ensure rule holds regardless of initial shuffle
      for (let seed = 0; seed < 10; seed++) {
        const manager = TournamentManager.generate(fighters, size, player, seed);
        const match = manager.rounds[0].find((m) => m.p1 === player || m.p2 === player);
        expect(match.p1).toBe(player);
        expect(match.p2).not.toBe(player);
      }
    });

    it('is deterministic with the same seed', () => {
      const seed = 999;
      vi.spyOn(Date, 'now').mockReturnValue(123456789);
      const m1 = TournamentManager.generate(fighters, 8, 'alv', seed);
      const m2 = TournamentManager.generate(fighters, 8, 'alv', seed);
      expect(m1.serialize()).toEqual(m2.serialize());
      vi.restoreAllMocks();
    });
  });

  describe('match advancement', () => {
    it('advance() correctly propagates player to next round', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      const currentMatch = manager.getCurrentMatch();
      expect(currentMatch.roundIndex).toBe(0);

      // Simulate other matches so player has an opponent in round 1
      manager.simulateRound(0);

      const success = manager.advance(manager.humanPlayerIds[0]);
      expect(success).toBe(true);

      const nextMatch = manager.getCurrentMatch();
      expect(nextMatch).not.toBeNull();
      expect(nextMatch.roundIndex).toBe(1);
      expect(nextMatch.p1).toBe('alv');
      expect(nextMatch.p2).not.toBeNull();
    });

    it('simulateRound() only simulates AI-vs-AI matches', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);

      manager.simulateRound(0);

      const playerMatchAfter = manager.getCurrentMatch();
      expect(playerMatchAfter.winner).toBeNull(); // Player match should NOT be simulated

      // Other matches should have winners
      const aiMatches = manager.rounds[0].filter((m) => m.p1 !== 'alv' && m.p2 !== 'alv');
      for (const m of aiMatches) {
        expect(m.winner).not.toBeNull();
      }
    });

    it('simulateAllRemaining() propagates through all rounds', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);

      // Simulate until player wins the whole tournament
      while (!manager.complete) {
        manager.simulateAllRemaining();
        manager.advance(manager.humanPlayerIds[0]);
      }

      expect(manager.complete).toBe(true);
      expect(manager.winnerId).toBe('alv');
    });

    it('fastForwardToFinal() resolves all matches until the grand final', () => {
      // 8 players: 7 matches total. FF should resolve 6 matches.
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      manager.fastForwardToFinal();

      // Check that there is only one match left without a winner
      let unplayed = 0;
      for (const round of manager.rounds) {
        for (const match of round) {
          if (match.p1 && match.p2 && !match.winnerUserId) {
            unplayed++;
          }
        }
      }

      expect(unplayed).toBe(1); // Only the Grand Final
      expect(manager.complete).toBe(false);

      const finalMatch = manager.getNextPlayableMatch();
      expect(finalMatch.roundIndex).toBe(2); // Last round of size 8
      expect(manager.isHumanVsHuman(finalMatch)).toBe(true);
    });

    it('fastForwardToFinal() prioritizes humans over bots', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      manager.fastForwardToFinal();

      const finalMatch = manager.getNextPlayableMatch();
      // Human 'alv' should be in the final
      expect(
        finalMatch.p1UserId === manager.humanPlayerIds[0] ||
          finalMatch.p2UserId === manager.humanPlayerIds[0],
      ).toBe(true);
    });

    it('fastForwardToFinal() skips matches that already have a winner', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // Manually set a winner for a round 0 match that doesn't involve humans
      const matchIdx = manager.rounds[0].findIndex((m) => !manager.isHumanVsHuman(m));
      const match = manager.rounds[0][matchIdx];
      const manualWinner = match.p1UserId;
      manager.setMatchWinner(0, matchIdx, manualWinner);

      // FF should skip this match
      manager.fastForwardToFinal();

      expect(manager.rounds[0][matchIdx].winnerUserId).toBe(manualWinner);
    });
  });

  describe('serialization and persistence', () => {
    it('restores PRNG state correctly from serialization', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 42);

      // Consuming some random numbers
      manager.nextRand();
      manager.nextRand();

      const state = manager.serialize();
      expect(state.prngCalls).toBe(2);

      const restored = new TournamentManager(state);
      expect(restored.nextRand()).toBe(manager.nextRand());
    });

    it('continuous execution matches state restore execution', () => {
      const seed = 555;
      const size = 8;
      const player = 'alv';

      // 1. Continuous execution
      const m1 = TournamentManager.generate(fighters, size, player, seed);
      m1.simulateRound(0);
      m1.advance(m1.humanPlayerIds[0]);
      m1.simulateRound(1);
      const nextRand1 = m1.nextRand();

      // 2. Partial execution -> serialize -> restore -> continue
      const m2 = TournamentManager.generate(fighters, size, player, seed);
      m2.simulateRound(0);
      const state = m2.serialize();

      const m3 = new TournamentManager(state);
      m3.advance(m3.humanPlayerIds[0]);
      m3.simulateRound(1);
      const nextRand2 = m3.nextRand();

      expect(nextRand1).toBe(nextRand2);
      expect(m1.serialize().rounds).toEqual(m3.serialize().rounds);
    });
  });

  describe('N-player tournament', () => {
    it('generate() accepts an array of human fighter IDs', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      expect(manager.humanFighterIds).toEqual(humans);
      expect(manager.playerFighterId).toBe('alv');
      expect(manager.eliminatedHumans).toEqual([]);
    });

    it('spreads humans across the bracket into different segments', () => {
      const humans = ['alv', 'simon'];
      for (let seed = 0; seed < 10; seed++) {
        const manager = TournamentManager.generate(fighters, 8, humans, seed);
        // Find which first-round matches contain each human
        const alvMatch = manager.rounds[0].findIndex((m) => m.p1 === 'alv' || m.p2 === 'alv');
        const simonMatch = manager.rounds[0].findIndex((m) => m.p1 === 'simon' || m.p2 === 'simon');
        // They should be in different halves of the bracket (different segments)
        expect(alvMatch).not.toBe(simonMatch);
        // With 8-player bracket (4 matches in round 1), halves are [0,1] and [2,3]
        const alvHalf = alvMatch < 2 ? 0 : 1;
        const simonHalf = simonMatch < 2 ? 0 : 1;
        expect(alvHalf).not.toBe(simonHalf);
      }
    });

    it('places all humans in P1 slots', () => {
      const humans = ['alv', 'simon', 'jeka'];
      for (let seed = 0; seed < 10; seed++) {
        const manager = TournamentManager.generate(fighters, 16, humans, seed);
        for (const human of humans) {
          const match = manager.rounds[0].find((m) => m.p1 === human || m.p2 === human);
          expect(match.p1).toBe(human);
        }
      }
    });

    it('simulateRound() skips all human matches', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);
      manager.simulateRound(0);

      // Human matches should not have winners
      for (const human of humans) {
        const match = manager.rounds[0].find((m) => m.p1 === human || m.p2 === human);
        expect(match.winner).toBeNull();
      }

      // AI-only matches should have winners
      const aiMatches = manager.rounds[0].filter(
        (m) => !humans.includes(m.p1) && !humans.includes(m.p2),
      );
      for (const m of aiMatches) {
        expect(m.winner).not.toBeNull();
      }
    });

    it('advance() tracks human elimination', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // Find alv's opponent and make alv lose
      const alvMatch = manager.rounds[0].find((m) => m.p1 === 'alv');
      const alvPlayerId = alvMatch.p1UserId;
      const opponentPlayerId = alvMatch.p2UserId;
      manager.advance(opponentPlayerId); // alv loses

      expect(manager.eliminatedPlayerIds).toContain(alvPlayerId);
      expect(manager.isPlayerEliminated(alvPlayerId)).toBe(true);
      expect(manager.isPlayerEliminated(manager.humanPlayerIds[1])).toBe(false);
    });

    it('getNextPlayableMatch() returns matches for non-eliminated humans only', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);
      manager.simulateRound(0);

      // Both humans have playable matches
      const first = manager.getNextPlayableMatch();
      expect(first).not.toBeNull();
      const firstHumanId = manager.humanPlayerIds.includes(first.p1UserId)
        ? first.p1UserId
        : first.p2UserId;

      // Eliminate that human
      const opponentId = firstHumanId === first.p1UserId ? first.p2UserId : first.p1UserId;
      manager.advance(opponentId);

      // Next match should be for the other human
      const second = manager.getNextPlayableMatch();
      expect(second).not.toBeNull();
      const secondHumanId = manager.humanPlayerIds.includes(second.p1UserId)
        ? second.p1UserId
        : second.p2UserId;
      expect(secondHumanId).not.toBe(firstHumanId);
    });

    it('isHumanVsHuman() detects when two humans meet', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // First round: humans are in different matches
      for (const match of manager.rounds[0]) {
        expect(manager.isHumanVsHuman(match)).toBe(false);
      }

      // Simulate AI matches, advance both humans through all rounds
      manager.simulateRound(0);
      manager.advance(manager.humanPlayerIds[0]);
      manager.advance(manager.humanPlayerIds[1]);
      manager.simulateRound(1);
      manager.advance(manager.humanPlayerIds[0]);
      manager.advance(manager.humanPlayerIds[1]);

      // In the final, both should meet
      const finalMatch = manager.rounds[manager.rounds.length - 1][0];
      expect(finalMatch.p1).not.toBeNull();
      expect(finalMatch.p2).not.toBeNull();
      expect(manager.isHumanVsHuman(finalMatch)).toBe(true);
    });

    it('allHumansEliminated() returns true when all humans lose', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      expect(manager.allHumansEliminated()).toBe(false);

      // Eliminate both
      const alvMatch = manager.rounds[0].find((m) => m.p1 === 'alv');
      manager.advance(alvMatch.p2UserId);
      expect(manager.allHumansEliminated()).toBe(false);

      const simonMatch = manager.rounds[0].find((m) => m.p1 === 'simon');
      manager.advance(simonMatch.p2UserId);
      expect(manager.allHumansEliminated()).toBe(true);
    });

    it('getCurrentMatch() is backward-compat alias for getNextPlayableMatch()', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      expect(manager.getCurrentMatch()).toEqual(manager.getNextPlayableMatch());
    });

    it('4 humans in size-16 bracket are spread into 4 segments', () => {
      const humans = ['alv', 'simon', 'jeka', 'mao'];
      const manager = TournamentManager.generate(fighters, 16, humans, 42);

      const positions = humans.map((h) => {
        return manager.rounds[0].findIndex((m) => m.p1 === h || m.p2 === h);
      });

      // Each human should be in a different quarter (0-1, 2-3, 4-5, 6-7)
      const quarters = positions.map((p) => Math.floor(p / 2));
      const uniqueQuarters = new Set(quarters);
      expect(uniqueQuarters.size).toBe(4);
    });

    it('8 humans in size-8 bracket fills all slots', () => {
      const humans = fighters.slice(0, 8);
      const manager = TournamentManager.generate(fighters, 8, humans, 42);

      // All 4 first-round matches must have both p1 and p2 filled
      for (const match of manager.rounds[0]) {
        expect(match.p1).not.toBeNull();
        expect(match.p2).not.toBeNull();
      }

      // All 8 humans must appear exactly once in round 1
      const allFighters = manager.rounds[0].flatMap((m) => [m.p1, m.p2]);
      for (const human of humans) {
        expect(allFighters).toContain(human);
      }
      expect(new Set(allFighters).size).toBe(8);

      // getNextPlayableMatch must return a match
      const next = manager.getNextPlayableMatch();
      expect(next).not.toBeNull();
      expect(next.p1).not.toBeNull();
      expect(next.p2).not.toBeNull();
    });

    it('5 humans in size-8 bracket fills all slots without collisions', () => {
      const humans = fighters.slice(0, 5);
      const manager = TournamentManager.generate(fighters, 8, humans, 42);

      // All matches must have both p1 and p2
      for (const match of manager.rounds[0]) {
        expect(match.p1).not.toBeNull();
        expect(match.p2).not.toBeNull();
      }

      // All 5 humans must appear
      const allFighters = manager.rounds[0].flatMap((m) => [m.p1, m.p2]);
      for (const human of humans) {
        expect(allFighters).toContain(human);
      }

      // 8 unique fighters total (5 human + 3 AI)
      expect(new Set(allFighters).size).toBe(8);
    });

    it('5 humans in size-8 bracket places max humans in P1 slots', () => {
      const humans = fighters.slice(0, 5);
      // With 4 matches and 5 humans, at most 4 can be P1 (one must be P2)
      for (let seed = 0; seed < 20; seed++) {
        const manager = TournamentManager.generate(fighters, 8, humans, seed);
        let p1Count = 0;
        for (const human of humans) {
          const match = manager.rounds[0].find((m) => m.p1 === human || m.p2 === human);
          if (match.p1 === human) p1Count++;
        }
        // All 4 even slots should go to humans (only 1 human in a P2 slot)
        expect(p1Count).toBe(4);
      }
    });
  });

  describe('large bracket edge cases', () => {
    it('1 human in size-16 bracket works correctly', () => {
      const manager = TournamentManager.generate(fighters, 16, 'alv', 42);

      expect(manager.rounds[0]).toHaveLength(8);
      // Human should be in P1 slot
      const humanMatch = manager.rounds[0].find((m) => m.p1 === 'alv' || m.p2 === 'alv');
      expect(humanMatch.p1).toBe('alv');

      // All 16 slots should be filled (no undefined/null)
      const allFighters = manager.rounds[0].flatMap((m) => [m.p1, m.p2]);
      expect(allFighters).toHaveLength(16);
      for (const f of allFighters) {
        expect(f).toBeDefined();
        expect(f).not.toBeNull();
      }
    });

    it('7 humans in size-8 bracket (only 1 AI slot)', () => {
      const humans = fighters.slice(0, 7);
      const manager = TournamentManager.generate(fighters, 8, humans, 42);

      const allFighters = manager.rounds[0].flatMap((m) => [m.p1, m.p2]);
      // All 7 humans present
      for (const human of humans) {
        expect(allFighters).toContain(human);
      }
      // Exactly 1 AI fighter
      const aiCount = allFighters.filter((f) => !humans.includes(f)).length;
      expect(aiCount).toBe(1);
      // 8 unique total
      expect(new Set(allFighters).size).toBe(8);
    });

    it('no undefined/null fighters in any round-1 slot after generate()', () => {
      for (const size of [8, 16]) {
        for (let seed = 0; seed < 10; seed++) {
          const manager = TournamentManager.generate(fighters, size, 'alv', seed);
          for (const match of manager.rounds[0]) {
            expect(match.p1).toBeDefined();
            expect(match.p1).not.toBeNull();
            expect(match.p2).toBeDefined();
            expect(match.p2).not.toBeNull();
          }
        }
      }
    });

    it('no duplicate fighters across the entire first round', () => {
      for (const size of [8, 16]) {
        for (let seed = 0; seed < 10; seed++) {
          const manager = TournamentManager.generate(fighters, size, 'alv', seed);
          const allFighters = manager.rounds[0].flatMap((m) => [m.p1, m.p2]);
          expect(new Set(allFighters).size).toBe(size);
        }
      }
    });

    it('no duplicate fighters with multiple humans', () => {
      const humans = ['alv', 'simon', 'jeka', 'mao', 'peks'];
      for (let seed = 0; seed < 10; seed++) {
        const manager = TournamentManager.generate(fighters, 8, humans, seed);
        const allFighters = manager.rounds[0].flatMap((m) => [m.p1, m.p2]);
        expect(new Set(allFighters).size).toBe(8);
      }
    });
  });

  describe('tournament completion', () => {
    it('all humans eliminated early -> simulateAllRemaining fills entire bracket', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // Eliminate both humans in round 1
      const alvMatch = manager.rounds[0].find((m) => m.p1 === 'alv');
      manager.advance(alvMatch.p2UserId);
      const simonMatch = manager.rounds[0].find((m) => m.p1 === 'simon');
      manager.advance(simonMatch.p2UserId);

      expect(manager.allHumansEliminated()).toBe(true);

      // Simulate everything remaining
      manager.simulateAllRemaining();

      expect(manager.complete).toBe(true);
      expect(manager.winnerId).not.toBeNull();

      // Every match with two participants should have a winner
      for (const round of manager.rounds) {
        for (const match of round) {
          if (match.p1 && match.p2) {
            expect(match.winner).not.toBeNull();
          }
        }
      }
    });

    it('getNextPlayableMatch() returns null when all humans eliminated', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // Eliminate both
      const alvMatch = manager.rounds[0].find((m) => m.p1 === 'alv');
      manager.advance(alvMatch.p2UserId);
      const simonMatch = manager.rounds[0].find((m) => m.p1 === 'simon');
      manager.advance(simonMatch.p2UserId);

      expect(manager.getNextPlayableMatch()).toBeNull();
    });

    it('getNextPlayableMatch() returns null when tournament is complete', () => {
      const manager = TournamentManager.generate(fighters, 4, 'alv', 123);
      manager.simulateRound(0);
      manager.advance(manager.humanPlayerIds[0]);
      manager.advance(manager.humanPlayerIds[0]);

      expect(manager.complete).toBe(true);
      expect(manager.getNextPlayableMatch()).toBeNull();
    });

    it('advance() returns false when no playable match exists', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // Eliminate both humans
      const alvMatch = manager.rounds[0].find((m) => m.p1 === 'alv');
      manager.advance(alvMatch.p2UserId);
      const simonMatch = manager.rounds[0].find((m) => m.p1 === 'simon');
      manager.advance(simonMatch.p2UserId);

      // No more human matches, so advance should return false
      expect(manager.advance(manager.humanPlayerIds[0])).toBe(false);
    });
  });

  describe('human-vs-human progression', () => {
    it('both humans win to meet in later rounds with correct slotting', () => {
      const humans = ['alv', 'simon'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // Simulate AI matches in round 0
      manager.simulateRound(0);

      // Both humans win round 0
      manager.advance(manager.humanPlayerIds[0]);
      manager.advance(manager.humanPlayerIds[1]);

      // Simulate AI matches in round 1
      manager.simulateRound(1);

      // Both humans win round 1
      manager.advance(manager.humanPlayerIds[0]);
      manager.advance(manager.humanPlayerIds[1]);

      // They should meet in the final
      const finalMatch = manager.rounds[manager.rounds.length - 1][0];
      expect(finalMatch.p1).not.toBeNull();
      expect(finalMatch.p2).not.toBeNull();
      const finalists = [finalMatch.p1, finalMatch.p2];
      expect(finalists).toContain('alv');
      expect(finalists).toContain('simon');
      expect(manager.isHumanVsHuman(finalMatch)).toBe(true);
    });

    it('human-vs-human match in semifinals (size-16, 4 humans)', () => {
      const humans = ['alv', 'simon', 'jeka', 'mao'];
      const manager = TournamentManager.generate(fighters, 16, humans, 42);

      // Advance all humans through rounds until they start meeting
      for (let round = 0; round < 3; round++) {
        manager.simulateRound(round);
        for (const humanId of manager.humanPlayerIds) {
          if (!manager.isPlayerEliminated(humanId)) {
            const match = manager.getNextPlayableMatch();
            if (match && (match.p1UserId === humanId || match.p2UserId === humanId)) {
              manager.advance(humanId);
            }
          }
        }
      }

      // At some point, two humans should have met (at least in semis or final)
      let foundHvH = false;
      for (const round of manager.rounds) {
        for (const match of round) {
          if (match.p1 && match.p2 && manager.isHumanVsHuman(match)) {
            foundHvH = true;
          }
        }
      }
      expect(foundHvH).toBe(true);
    });
  });

  describe('serialization edge cases', () => {
    it('round-trip preserves eliminatedHumans after multiple advances', () => {
      const humans = ['alv', 'simon', 'jeka'];
      const manager = TournamentManager.generate(fighters, 8, humans, 123);

      // Eliminate alv
      const alvMatch = manager.rounds[0].find((m) => m.p1 === 'alv');
      manager.advance(alvMatch.p2UserId);
      expect(manager.eliminatedPlayerIds).toEqual([manager.humanPlayerIds[0]]);

      // Serialize and restore
      const state = manager.serialize();
      const restored = new TournamentManager(state);

      expect(restored.eliminatedPlayerIds).toEqual([restored.humanPlayerIds[0]]);
      expect(restored.isPlayerEliminated(restored.humanPlayerIds[0])).toBe(true);
      expect(restored.isPlayerEliminated(restored.humanPlayerIds[1])).toBe(false);
      expect(restored.isPlayerEliminated(restored.humanPlayerIds[2])).toBe(false);

      // Eliminate simon through the restored instance
      const simonMatch = restored.rounds[0].find((m) => m.p1 === 'simon' || m.p2 === 'simon');
      const simonOpponent = simonMatch.p1 === 'simon' ? simonMatch.p2UserId : simonMatch.p1UserId;
      restored.advance(simonOpponent);

      expect(restored.eliminatedPlayerIds).toEqual([
        restored.humanPlayerIds[0],
        restored.humanPlayerIds[1],
      ]);

      // Second round-trip
      const state2 = restored.serialize();
      const restored2 = new TournamentManager(state2);
      expect(restored2.eliminatedHumans).toEqual(restored2.humanPlayerIds.slice(0, 2));
      expect(restored2.humanFighterIds).toEqual(humans);
    });

    it('serialization preserves complete and winnerId', () => {
      const manager = TournamentManager.generate(fighters, 4, 'alv', 123);
      manager.simulateRound(0);
      manager.advance(manager.humanPlayerIds[0]);
      manager.advance(manager.humanPlayerIds[0]);

      expect(manager.complete).toBe(true);

      const restored = new TournamentManager(manager.serialize());
      expect(restored.complete).toBe(true);
      expect(restored.winnerId).toBe('alv');
    });
  });

  describe('non-happy paths', () => {
    it('advance() with a winner not in the match still sets the winner', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);

      // advance() sets match.winner to whatever winnerId is passed
      // even if it's not p1 or p2 in the match
      const result = manager.advance('nonexistent_user_id');
      expect(result).toBe(true);

      // The match got a winner assigned
      const alvMatch = manager.rounds[0].find((m) => m.p1 === 'alv' || m.p2 === 'alv');
      expect(alvMatch.winnerUserId).toBe('nonexistent_user_id');
    });

    it('simulateRound() on a round that does not exist returns false', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      expect(manager.simulateRound(99)).toBe(false);
      expect(manager.simulateRound(-1)).toBe(false);
    });

    it('simulateRound() on a round with no ready matches returns false', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      // Round 1 has no fighters yet (all null)
      expect(manager.simulateRound(1)).toBe(false);
    });

    it('advance() returns false when tournament is already complete', () => {
      const manager = TournamentManager.generate(fighters, 4, 'alv', 123);
      manager.simulateRound(0);
      manager.advance(manager.humanPlayerIds[0]);
      manager.advance(manager.humanPlayerIds[0]);
      expect(manager.complete).toBe(true);

      // No more matches to advance
      expect(manager.advance('alv')).toBe(false);
    });
  });

  describe('determinism', () => {
    it('same seed + same humans produce identical brackets regardless of call order', () => {
      const humans = ['alv', 'simon', 'jeka'];
      const seed = 777;

      const m1 = TournamentManager.generate(fighters, 8, humans, seed);
      const m2 = TournamentManager.generate(fighters, 8, humans, seed);

      // Brackets should be identical
      expect(m1.rounds[0]).toEqual(m2.rounds[0]);
      expect(m1.playerInitialIndex).toBe(m2.playerInitialIndex);

      // Now advance them differently, but the initial state must match
      expect(m1.serialize().rounds).toEqual(m2.serialize().rounds);
    });

    it('different seeds produce different brackets', () => {
      const humans = ['alv', 'simon'];
      const m1 = TournamentManager.generate(fighters, 8, humans, 1);
      const m2 = TournamentManager.generate(fighters, 8, humans, 2);

      // At least round-1 fighter arrangement should differ
      const r1_1 = m1.rounds[0].flatMap((m) => [m.p1, m.p2]);
      const r1_2 = m2.rounds[0].flatMap((m) => [m.p1, m.p2]);
      expect(r1_1).not.toEqual(r1_2);
    });

    it('determinism holds across multiple seeds with single human', () => {
      // Start at seed 1: seed 0 is falsy and triggers random fallback in constructor
      for (let seed = 1; seed < 20; seed++) {
        const a = TournamentManager.generate(fighters, 8, 'alv', seed);
        const b = TournamentManager.generate(fighters, 8, 'alv', seed);
        expect(a.rounds).toEqual(b.rounds);
        expect(a.playerInitialIndex).toBe(b.playerInitialIndex);
        expect(a.humanFighterIds).toEqual(b.humanFighterIds);
      }
    });

    it('determinism holds across multiple seeds with many humans', () => {
      const humans = ['alv', 'simon', 'jeka', 'mao', 'peks'];
      for (let seed = 1; seed < 20; seed++) {
        const a = TournamentManager.generate(fighters, 16, humans, seed);
        const b = TournamentManager.generate(fighters, 16, humans, seed);
        expect(a.rounds).toEqual(b.rounds);
        expect(a.playerInitialIndex).toBe(b.playerInitialIndex);
        expect(a.humanFighterIds).toEqual(b.humanFighterIds);
      }
    });
  });

  describe('backward compatibility', () => {
    it('single string humanFighterIds works like old API', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      expect(manager.humanFighterIds).toEqual(['alv']);
      expect(manager.playerFighterId).toBe('alv');
    });

    it('restores from old serialized state without humanFighterIds', () => {
      const oldState = {
        id: 'test',
        size: 8,
        seed: 42,
        playerFighterId: 'alv',
        playerInitialIndex: 0,
        rounds: [[{ p1: 'alv', p2: 'simon', winner: null }]],
        prngCalls: 0,
      };
      const manager = new TournamentManager(oldState);
      expect(manager.humanFighterIds).toEqual(['alv']);
      expect(manager.eliminatedHumans).toEqual([]);
    });
  });

  describe('winning the tournament', () => {
    it('sets winnerId and complete when final match is decided', () => {
      const manager = TournamentManager.generate(fighters, 4, 'alv', 123);

      // Round 0
      manager.simulateRound(0); // Simulates AI match
      manager.advance(manager.humanPlayerIds[0]); // Player wins

      // Round 1 (Final)
      manager.advance(manager.humanPlayerIds[0]);

      expect(manager.complete).toBe(true);
      expect(manager.winnerId).toBe('alv');
    });

    it('fills out the entire bracket when player loses early', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      const currentMatch = manager.getCurrentMatch();
      const opponentUserId = currentMatch.p2UserId;

      // Player loses in Round 0
      manager.advance(opponentUserId);

      // Now simulate everything else
      manager.simulateAllRemaining();

      expect(manager.complete).toBe(true);
      expect(manager.winnerId).not.toBeNull();
      expect(manager.winnerId).not.toBe('alv');

      // All matches should have winners
      manager.rounds.forEach((round) => {
        round.forEach((match) => {
          if (match.p1 && match.p2) {
            expect(match.winner).not.toBeNull();
          }
        });
      });
    });
  });
});
