import { describe, expect, it } from 'vitest';
import { TournamentManager } from '../../src/services/TournamentManager.js';

describe('TournamentManager Mirror Match Resolution', () => {
  const fighters = ['alv', 'simon', 'jeka', 'paula', 'richi', 'sun', 'mao', 'gartner'];

  it('correctly propagates the winner userId in a mirror match', () => {
    // Both humans pick 'simon'
    // In my previous fix (Phase 4/5), I updated generate to match lobbyHumans[h]
    // with humans[h]. So let's simulate that correctly.
    const mockLobby = [
      { fighterId: 'simon', id: 'uuid-player-1', type: 'human' },
      { fighterId: 'simon', id: 'uuid-player-2', type: 'human' },
    ];

    const manager = TournamentManager.generate(fighters, 8, ['simon', 'Pa1'], 123, mockLobby);

    // Find the mirror match in round 1
    // By default generate places humans at slot 0, 4. No mirror in round 1.
    // Let's manually set up a mirror match in round 1 match 0.
    manager.rounds[0][0] = {
      p1: 'simon',
      p2: 'simon',
      p1UserId: 'uuid-p1',
      p2UserId: 'uuid-p2',
      winner: null,
    };

    // P2 wins the mirror match (winnerIndex = 1)
    manager.advance('simon', 1);

    // Check round 2 match 0
    const nextMatch = manager.rounds[1][0];
    expect(nextMatch.p1).toBe('simon');
    expect(nextMatch.p1UserId).toBe('uuid-p2'); // MUST be p2, not p1
  });

  it('correctly identifies the loser in a mirror match for elimination tracking', () => {
    const manager = TournamentManager.generate(fighters, 8, ['simon', 'simon'], 123, [
      { fighterId: 'simon', id: 'uuid-p1', type: 'human' },
      { fighterId: 'simon', id: 'uuid-p2', type: 'human' },
    ]);

    // Force mirror match in R1 M0
    manager.rounds[0][0] = {
      p1: 'simon',
      p2: 'simon',
      p1UserId: 'uuid-p1',
      p2UserId: 'uuid-p2',
      winner: null,
    };

    // P1 wins (winnerIndex = 0), so P2 (the second 'simon') should be eliminated
    manager.advance('simon', 0);

    // Round 2 should have uuid-p1
    expect(manager.rounds[1][0].p1UserId).toBe('uuid-p1');

    // We still have the fighterId in eliminatedHumans for now
    // (until the full architectural playerId refactor)
    // But since both are 'simon', adding 'simon' is correct for the legacy check.
    expect(manager.eliminatedHumans).toContain('simon');
  });
});
