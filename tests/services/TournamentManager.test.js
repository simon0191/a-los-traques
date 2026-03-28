import { describe, it, expect } from 'vitest';
import { TournamentManager } from '../../src/services/TournamentManager.js';

describe('TournamentManager', () => {
  const fighters = ['alv', 'angy', 'bozzi', 'cami', 'carito', 'cata', 'chicha', 'gartner', 'jeka', 'lini', 'mao', 'migue', 'peks', 'richi', 'simon', 'sun'];

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
        const match = manager.rounds[0].find(m => m.p1 === player || m.p2 === player);
        expect(match.p1).toBe(player);
        expect(match.p2).not.toBe(player);
      }
    });

    it('is deterministic with the same seed', () => {
      const seed = 999;
      const m1 = TournamentManager.generate(fighters, 8, 'alv', seed);
      const m2 = TournamentManager.generate(fighters, 8, 'alv', seed);
      expect(m1.serialize()).toEqual(m2.serialize());
    });
  });

  describe('match advancement', () => {
    it('advance() correctly propagates player to next round', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      const currentMatch = manager.getCurrentMatch();
      expect(currentMatch.roundIndex).toBe(0);
      
      // Simulate other matches so player has an opponent in round 1
      manager.simulateRound(0);

      const success = manager.advance('alv');
      expect(success).toBe(true);
      
      const nextMatch = manager.getCurrentMatch();
      expect(nextMatch).not.toBeNull();
      expect(nextMatch.roundIndex).toBe(1);
      expect(nextMatch.p1).toBe('alv');
      expect(nextMatch.p2).not.toBeNull();
    });

    it('simulateRound() only simulates AI-vs-AI matches', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      const playerMatchBefore = manager.getCurrentMatch();
      
      manager.simulateRound(0);
      
      const playerMatchAfter = manager.getCurrentMatch();
      expect(playerMatchAfter.winner).toBeNull(); // Player match should NOT be simulated
      
      // Other matches should have winners
      const aiMatches = manager.rounds[0].filter(m => m.p1 !== 'alv' && m.p2 !== 'alv');
      aiMatches.forEach(m => expect(m.winner).not.toBeNull());
    });

    it('simulateAllRemaining() propagates through all rounds', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 123);
      
      // Simulate until player wins the whole tournament
      while (!manager.complete) {
        manager.simulateAllRemaining();
        manager.advance('alv');
      }
      
      expect(manager.complete).toBe(true);
      expect(manager.winnerId).toBe('alv');
    });
  });

  describe('serialization and persistence', () => {
    it('restores PRNG state correctly from serialization', () => {
      const manager = TournamentManager.generate(fighters, 8, 'alv', 42);
      
      // Consuming some random numbers
      const r1 = manager.nextRand();
      const r2 = manager.nextRand();
      
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
        m1.advance(player);
        m1.simulateRound(1);
        const nextRand1 = m1.nextRand();

        // 2. Partial execution -> serialize -> restore -> continue
        const m2 = TournamentManager.generate(fighters, size, player, seed);
        m2.simulateRound(0);
        const state = m2.serialize();
        
        const m3 = new TournamentManager(state);
        m3.advance(player);
        m3.simulateRound(1);
        const nextRand2 = m3.nextRand();

        expect(nextRand1).toBe(nextRand2);
        expect(m1.serialize().rounds).toEqual(m3.serialize().rounds);
    });
  });

  describe('winning the tournament', () => {
      it('sets winnerId and complete when final match is decided', () => {
          const manager = TournamentManager.generate(fighters, 4, 'alv', 123);
          
          // Round 0
          manager.simulateRound(0); // Simulates AI match
          manager.advance('alv');  // Player wins
          
          // Round 1 (Final)
          manager.advance('alv');
          
          expect(manager.complete).toBe(true);
          expect(manager.winnerId).toBe('alv');
      });
  });
});
