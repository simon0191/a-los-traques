import { describe, expect, it } from 'vitest';
import { TournamentManager } from '../../src/services/TournamentManager.js';

describe('TournamentManager - Multi-Human Attribution', () => {
  const fighters = ['alv', 'simon', 'jeka', 'paula', 'richi', 'sun', 'mao', 'gartner'];

  it('correctly attributes userIds in a 3-human lobby with mixed guests and bots', () => {
    // Selection order from SelectScene (strings only)
    // Note: Guests also pick fighters, so they must be in this array
    const humans = ['alv', 'simon', 'cami', 'jeka']; 

    // Lobby participants (contains humans and bots)
    const lobbyParticipants = [
      { id: 'uuid-alv', fighterId: 'alv', type: 'human', name: 'Alv' },
      { id: 'bot-1', type: 'bot', level: 3 },
      { id: 'uuid-simon', fighterId: 'simon', type: 'human', name: 'Simon' },
      { id: 'guest-1', type: 'guest', name: 'Guest 1' },
      { id: 'bot-2', type: 'bot', level: 4 },
      { id: 'uuid-jeka', fighterId: 'jeka', type: 'human', name: 'Jeka' },
    ];

    const manager = TournamentManager.generate(fighters, 8, humans, 1, lobbyParticipants);

    // Scan first round and verify userId attribution
    const findMatchData = (fighterId) => {
        for (const match of manager.rounds[0]) {
            if (match.p1 === fighterId) return { userId: match.p1UserId, level: match.p1Level };
            if (match.p2 === fighterId) return { userId: match.p2UserId, level: match.p2Level };
        }
        return null;
    };

    // Verify humans
    expect(findMatchData('alv').userId).toBe('uuid-alv');
    expect(findMatchData('simon').userId).toBe('uuid-simon');
    expect(findMatchData('cami').userId).toBe('guest-1');
    expect(findMatchData('jeka').userId).toBe('uuid-jeka');

    // Verify bots from lobby (matching by level since fighterId is random)
    const allMatchData = manager.rounds[0].flatMap(m => [
        { id: m.p1, userId: m.p1UserId, level: m.p1Level },
        { id: m.p2, userId: m.p2UserId, level: m.p2Level }
    ]);
    
    expect(allMatchData.some(d => d.level === 4)).toBe(true);
    expect(allMatchData.some(d => d.level === 3)).toBe(true);
  });
});
