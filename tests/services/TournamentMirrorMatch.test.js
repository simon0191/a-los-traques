import { describe, expect, it } from 'vitest';
import { TournamentManager } from '../../src/services/TournamentManager.js';

describe('TournamentManager Mirror Match Resolution', () => {
  const fighters = ['alv', 'simon', 'jeka', 'paula', 'richi', 'sun', 'mao', 'gartner'];

  it('correctly propagates the winner userId in a mirror match', () => {
    // Both humans pick 'simon'
    // In my previous fix (Phase 4/5), I updated generate to match lobbyHumans[h]
    // with humans[h]. So let's simulate that correctly.
    const mockLobby = [
      { id: 'uuid-p1', fighterId: 'simon', type: 'human' },
      { id: 'uuid-p2', fighterId: 'simon', type: 'human' },
    ];

    const manager = TournamentManager.generate(fighters, 8, ['simon', 'simon'], 123, mockLobby);

    // Find the mirror match in round 1
    // By default generate places humans at slot 0, 4. No mirror in round 1.
    // Let's manually set up a mirror match in round 1 match 0.
    manager.rounds[0][0] = {
      p1: 'simon',
      p2: 'simon',
      p1UserId: 'uuid-p1',
      p2UserId: 'uuid-p2',
      winner: null,
      winnerUserId: null,
    };

    // P2 wins the mirror match (uuid-p2)
    manager.advance('uuid-p2');

    // Check round 2 match 0
    const nextMatch = manager.rounds[1][0];
    expect(nextMatch.p1).toBe('simon');
    expect(nextMatch.p1UserId).toBe('uuid-p2'); // MUST be p2, not p1

    // Robustness check: P1 is eliminated, but P2 is still active.
    // Tournament should NOT be marked as all humans eliminated.
    expect(manager.allHumansEliminated()).toBe(false);
    expect(manager.getNextPlayableMatch()).not.toBeNull();
  });

  it('correctly identifies the loser in a mirror match for elimination tracking', () => {
    const manager = TournamentManager.generate(fighters, 8, ['simon', 'simon'], 123, [
      { id: 'uuid-p1', fighterId: 'simon', type: 'human' },
      { id: 'uuid-p2', fighterId: 'simon', type: 'human' },
    ]);

    // Force mirror match in R1 M0
    manager.rounds[0][0] = {
      p1: 'simon',
      p2: 'simon',
      p1UserId: 'uuid-p1',
      p2UserId: 'uuid-p2',
      winner: null,
      winnerUserId: null,
    };

    // P1 wins (uuid-p1), so P2 (the second 'simon') should be eliminated
    manager.advance('uuid-p1');

    // Round 2 should have uuid-p1
    expect(manager.rounds[1][0].p1UserId).toBe('uuid-p1');

    // We now track by playerId (userId)
    expect(manager.eliminatedPlayerIds).toContain('uuid-p2');
    expect(manager.eliminatedPlayerIds).not.toContain('uuid-p1');

    // Simulate other matches so the winner of the mirror match has an opponent in round 2
    manager.simulateRound(0);

    expect(manager.allHumansEliminated()).toBe(false);
    expect(manager.getNextPlayableMatch()).not.toBeNull();
  });
});
