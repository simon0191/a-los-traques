import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Phaser before importing anything that uses it
vi.mock('phaser', () => ({
  default: {
    Scene: class MockScene {},
  },
}));

import { VictoryScene } from '../../apps/game-vite/src/scenes/VictoryScene.js';
import * as api from '../../apps/game-vite/src/services/api.js';

vi.mock('../../apps/game-vite/src/services/api.js', () => ({
  updateStats: vi.fn(),
  reportTournamentMatch: vi.fn(),
}));

describe('VictoryScene Stats recording', () => {
  let scene;

  beforeEach(() => {
    vi.clearAllMocks();

    // Minimal mock for Phaser.Scene
    scene = new VictoryScene();

    // Mock game registry
    scene.game = {
      registry: {
        get: vi.fn((key) => {
          if (key === 'user') return { id: 'test-user' };
          return null;
        }),
      },
    };

    // Mock Phaser.Scene's methods used in _saveResult
    scene.add = {
      text: vi.fn().mockReturnValue({
        setOrigin: vi.fn().mockReturnThis(),
        setAlpha: vi.fn().mockReturnThis(),
      }),
    };
    scene.tweens = {
      add: vi.fn(),
    };
  });

  describe('_saveResult', () => {
    it('correctly calculates win in a mirror match where IDs match', async () => {
      // Setup a mirror match where both pick 'simon'
      scene.init({
        winnerId: 'simon',
        loserId: 'simon',
        p1Id: 'simon',
        p2Id: 'simon',
        winnerIndex: 0, // Player 1 (simon) won
        gameMode: 'online',
        networkManager: { playerSlot: 0 }, // Current player is P1
      });

      await scene._saveResult();

      // P1 won, winnerIndex was 0, local player slot is 0 -> should be a win
      expect(api.updateStats).toHaveBeenCalledWith(true);
    });

    it('correctly calculates loss in a mirror match where IDs match', async () => {
      // Setup a mirror match where both pick 'simon'
      scene.init({
        winnerId: 'simon',
        loserId: 'simon',
        p1Id: 'simon',
        p2Id: 'simon',
        winnerIndex: 1, // Player 2 (simon) won
        gameMode: 'online',
        networkManager: { playerSlot: 0 }, // Current player is P1
      });

      await scene._saveResult();

      // P2 won, winnerIndex was 1, local player slot is 0 -> should be a loss
      expect(api.updateStats).toHaveBeenCalledWith(false);
    });

    it('falls back to ID comparison if winnerIndex is missing', async () => {
      scene.init({
        winnerId: 'simon',
        loserId: 'jeka',
        p1Id: 'simon',
        p2Id: 'jeka',
        // winnerIndex: undefined,
        gameMode: 'online',
        networkManager: { playerSlot: 0 },
      });

      await scene._saveResult();

      // Fallback: winnerId ('simon') === localPlayerId (P1 is 'simon') -> win
      expect(api.updateStats).toHaveBeenCalledWith(true);
    });

    it('handles offline mode (local) correctly where player is always P1', async () => {
      scene.init({
        winnerId: 'jeka',
        loserId: 'simon',
        p1Id: 'simon',
        p2Id: 'jeka',
        winnerIndex: 1, // AI (P2) won
        gameMode: 'local',
      });

      await scene._saveResult();

      // Local mode: isP1 is true, winnerIndex is 1 -> loss
      expect(api.updateStats).toHaveBeenCalledWith(false);
    });

    it('reports tournament match results via reportTournamentMatch', async () => {
      const p1User = 'uuid-1';
      const p2User = 'uuid-2';

      scene.init({
        winnerId: 'simon',
        loserId: 'jeka',
        p1Id: 'simon',
        p2Id: 'jeka',
        winnerIndex: 0,
        gameMode: 'local',
        matchContext: {
          type: 'tournament',
          tournamentState: { tourneyId: 'abcdef' },
        },
      });

      // Inject the current match info that VictoryScene expects
      scene._currentMatch = {
        p1: 'simon',
        p2: 'jeka',
        p1UserId: p1User,
        p2UserId: p2User,
      };

      await scene._saveResult();

      expect(api.reportTournamentMatch).toHaveBeenCalledWith({
        tourneyId: 'abcdef',
        winnerId: p1User,
        loserId: p2User,
      });
      expect(api.updateStats).not.toHaveBeenCalled();
    });

    it('atomically crowns champion in the final tournament match', async () => {
      const winnerUser = 'uuid-winner';
      const loserUser = 'uuid-loser';

      scene.init({
        winnerId: 'simon',
        loserId: 'jeka',
        p1Id: 'simon',
        p2Id: 'jeka',
        winnerIndex: 0,
        gameMode: 'local',
        matchContext: {
          type: 'tournament',
          tournamentState: { tourneyId: 'abcdef' },
        },
      });

      // Setup scene state as if tournament just finished
      scene._currentMatch = {
        p1: 'simon',
        p2: 'jeka',
        p1UserId: winnerUser,
        p2UserId: loserUser,
      };
      scene._tournamentComplete = true;
      scene._championUserId = winnerUser;

      await scene._saveResult();

      expect(api.reportTournamentMatch).toHaveBeenCalledWith({
        tourneyId: 'abcdef',
        winnerId: winnerUser,
        loserId: loserUser,
        isFinal: true,
        championId: winnerUser,
      });
    });

    it('correctly attributes champion in a mirror-match tournament final', async () => {
      const winnerUser = 'uuid-p2';
      const loserUser = 'uuid-p1';

      scene.init({
        winnerId: 'simon', // Both picked simon
        loserId: 'simon',
        p1Id: 'simon',
        p2Id: 'simon',
        winnerIndex: 1, // P2 won
        gameMode: 'local',
        matchContext: {
          type: 'tournament',
          tournamentState: { tourneyId: 'abcdef' },
        },
      });

      // Tournament state would have propagated p2UserId correctly after my refactor
      scene._currentMatch = {
        p1: 'simon',
        p2: 'simon',
        p1UserId: loserUser,
        p2UserId: winnerUser,
      };
      scene._tournamentComplete = true;
      scene._championUserId = winnerUser;

      await scene._saveResult();

      expect(api.reportTournamentMatch).toHaveBeenCalledWith({
        tourneyId: 'abcdef',
        winnerId: winnerUser,
        loserId: loserUser,
        isFinal: true,
        championId: winnerUser,
      });
    });

    it('falls back to personal stats if tournament session creation failed (null tourneyId)', async () => {
      const hostUser = 'test-user';
      const botUser = null;

      scene.init({
        winnerId: 'simon',
        loserId: 'bot',
        p1Id: 'simon',
        p2Id: 'bot',
        winnerIndex: 0,
        gameMode: 'local',
        matchContext: {
          type: 'tournament',
          tournamentState: { tourneyId: null }, // Session failed
        },
      });

      scene._currentMatch = {
        p1: 'simon',
        p2: 'bot',
        p1UserId: hostUser,
        p2UserId: botUser,
      };

      await scene._saveResult();

      // Should fall through and record Host win
      expect(api.reportTournamentMatch).not.toHaveBeenCalled();
      expect(api.updateStats).toHaveBeenCalledWith(true);
    });

    it('correctly attributes win to Host even if they are P2 in a failed tournament session', async () => {
      const hostUser = 'test-user';

      scene.init({
        winnerId: 'simon',
        loserId: 'jeka',
        p1Id: 'jeka',
        p2Id: 'simon',
        winnerIndex: 1, // P2 (simon) won
        gameMode: 'local',
        matchContext: {
          type: 'tournament',
          tournamentState: { tourneyId: null },
        },
      });

      scene._currentMatch = {
        p1: 'jeka',
        p2: 'simon',
        p1UserId: 'bot-uuid',
        p2UserId: hostUser,
      };

      await scene._saveResult();

      // Host was P2 and winnerIndex was 1 -> win
      expect(api.updateStats).toHaveBeenCalledWith(true);
    });

    it('does not record stats if Host did not participate in a failed tournament match', async () => {
      scene.init({
        winnerId: 'jeka',
        loserId: 'sun',
        p1Id: 'jeka',
        p2Id: 'sun',
        winnerIndex: 0,
        gameMode: 'local',
        matchContext: {
          type: 'tournament',
          tournamentState: { tourneyId: null },
        },
      });

      scene._currentMatch = {
        p1: 'jeka',
        p2: 'sun',
        p1UserId: 'other-user-1',
        p2UserId: 'other-user-2',
      };

      await scene._saveResult();

      // Host (test-user) not in match -> no stats recorded
      expect(api.reportTournamentMatch).not.toHaveBeenCalled();
      expect(api.updateStats).not.toHaveBeenCalled();
    });
  });
});
