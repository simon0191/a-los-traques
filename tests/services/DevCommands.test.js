import { describe, expect, it } from 'vitest';
import { TournamentManager } from '../../src/services/TournamentManager.js';

describe('TournamentManager Dev Commands Extension', () => {
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

  describe('fastForwardToFinal({ excludeP1: true })', () => {
    it('forces P1 to lose even if they are human', () => {
      const size = 8;
      const playerFighterId = 'alv';
      const seed = 12345;
      const manager = TournamentManager.generate(fighters, size, [playerFighterId], seed);
      const hostId = manager.humanPlayerIds[0];

      // Regular fast forward (P1 wins because they are human)
      const manager1 = new TournamentManager(manager.serialize());
      manager1.fastForwardToFinal({ excludeP1: false });
      expect(manager1.rounds[manager1.rounds.length - 1][0].p1UserId).toBe(hostId);

      // Exclude P1 fast forward (P1 loses their first match)
      const manager2 = new TournamentManager(manager.serialize());
      manager2.fastForwardToFinal({ excludeP1: true });

      // Check first round match of host
      const hostMatchR0 = manager2.rounds[0].find(
        (m) => m.p1UserId === hostId || m.p2UserId === hostId,
      );
      expect(hostMatchR0.winnerUserId).not.toBe(hostId);

      // Check final round match: host should not be there
      const finalMatch = manager2.rounds[manager2.rounds.length - 1][0];
      expect(finalMatch.p1UserId).not.toBe(hostId);
      expect(finalMatch.p2UserId).not.toBe(hostId);
    });
  });

  describe('setMatchWinner()', () => {
    it('manually sets the winner of a match and propagates it', () => {
      const size = 8;
      const playerFighterId = 'alv';
      const seed = 111;
      const manager = TournamentManager.generate(fighters, size, [playerFighterId], seed);

      const r0m0 = manager.rounds[0][0];
      const p2UserId = r0m0.p2UserId;

      // Force P2 to win the first match of first round
      const result = manager.setMatchWinner(0, 0, p2UserId);
      expect(result).toBe(true);
      expect(r0m0.winnerUserId).toBe(p2UserId);

      // Check propagation to round 1
      const r1m0 = manager.rounds[1][0];
      expect(r1m0.p1UserId).toBe(p2UserId);
    });

    it('prevents overwriting an already finished match', () => {
      const size = 8;
      const manager = TournamentManager.generate(fighters, size, ['alv'], 123);
      const r0m0 = manager.rounds[0][0];

      manager.setMatchWinner(0, 0, r0m0.p1UserId);
      const secondAttempt = manager.setMatchWinner(0, 0, r0m0.p2UserId);

      expect(secondAttempt).toBe(false);
      expect(r0m0.winnerUserId).toBe(r0m0.p1UserId);
    });
  });
});
