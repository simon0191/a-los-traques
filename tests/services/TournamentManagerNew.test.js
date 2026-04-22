import { describe, expect, it } from 'vitest';
import { TournamentManager } from '../../apps/game-vite/src/services/TournamentManager.js';

describe('TournamentManager - Bot Level Extensions', () => {
  const fighters = ['alv', 'angy', 'bozzi', 'cami', 'carito', 'cata', 'chicha', 'gartner'];

  describe('generate() with lobby bots', () => {
    it('assigns specific levels to lobby bots', () => {
      const lobbyParticipants = [
        { name: 'BossBot', type: 'bot', level: 5 },
        { name: 'NoobBot', type: 'bot', level: 1 },
      ];
      const humans = ['alv'];
      const manager = TournamentManager.generate(fighters, 8, humans, 1, lobbyParticipants);

      // Verify bots exist in first round with correct levels
      const r1 = manager.rounds[0];
      const botLevels = [];
      r1.forEach((m) => {
        if (m.p1Level) botLevels.push(m.p1Level);
        if (m.p2Level) botLevels.push(m.p2Level);
      });

      expect(botLevels).toContain(5);
      expect(botLevels).toContain(1);
    });

    it('defaults auto-filled bots to level 3', () => {
      const humans = ['alv'];
      const manager = TournamentManager.generate(fighters, 8, humans, 1, []);

      const r1 = manager.rounds[0];
      r1.forEach((m) => {
        // Find a bot slot (not 'alv')
        if (m.p1 !== 'alv') expect(m.p1Level).toBe(3);
        if (m.p2 !== 'alv') expect(m.p2Level).toBe(3);
      });
    });
  });

  describe('bot level propagation', () => {
    it('preserves level 5 bot when advancing', () => {
      const lobbyParticipants = [{ name: 'SuperBot', type: 'bot', level: 5 }];
      const manager = TournamentManager.generate(fighters, 8, ['alv'], 1, lobbyParticipants);

      // Find where SuperBot is (it should have level 5)
      let botFound = false;
      let botSlot = -1;
      let matchIdx = -1;

      manager.rounds[0].forEach((m, idx) => {
        if (m.p1Level === 5) {
          botFound = true;
          botSlot = 1;
          matchIdx = idx;
        }
        if (m.p2Level === 5) {
          botFound = true;
          botSlot = 2;
          matchIdx = idx;
        }
      });

      expect(botFound).toBe(true);

      // Advance the bot manually
      const match = manager.rounds[0][matchIdx];
      const botUserId = botSlot === 1 ? match.p1UserId : match.p2UserId;
      manager.setMatchWinner(0, matchIdx, botUserId);

      // Check next round
      const nextMatchIdx = Math.floor(matchIdx / 2);
      const nextMatch = manager.rounds[1][nextMatchIdx];

      const promotedLevel =
        nextMatch.p1UserId === botUserId ? nextMatch.p1Level : nextMatch.p2Level;
      expect(promotedLevel).toBe(5); // MUST be 5, not 3
    });
  });
});
