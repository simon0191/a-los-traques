import { describe, expect, it } from 'vitest';
import { runMatch, runMatchup } from '../../scripts/balance-sim/match-runner.js';

describe('runMatch', () => {
  it('runs a match to completion', () => {
    const result = runMatch('simon', 'jeka', 42);
    expect(result.p1Id).toBe('simon');
    expect(result.p2Id).toBe('jeka');
    expect(result.winnerIndex).toBeOneOf([0, 1]);
    expect(result.winnerId).toBeOneOf(['simon', 'jeka']);
    expect(result.totalFrames).toBeGreaterThan(0);
    expect(result.rounds.length).toBeGreaterThanOrEqual(2); // best of 3
    expect(result.p1RoundsWon + result.p2RoundsWon).toBeGreaterThanOrEqual(2);
  });

  it('produces deterministic results with the same seed', () => {
    const r1 = runMatch('simon', 'jeka', 42);
    const r2 = runMatch('simon', 'jeka', 42);
    expect(r1.winnerIndex).toBe(r2.winnerIndex);
    expect(r1.totalFrames).toBe(r2.totalFrames);
    expect(r1.p1Stats).toEqual(r2.p1Stats);
    expect(r1.p2Stats).toEqual(r2.p2Stats);
    expect(r1.rounds).toEqual(r2.rounds);
  });

  it('produces different results with different seeds', () => {
    // Use a balanced matchup (similar stats) so both sides can win
    const results = [];
    for (let seed = 0; seed < 20; seed++) {
      results.push(runMatch('simon', 'alv', seed * 7919));
    }
    // With similar fighters and 20 seeds, we should see variation
    const p1Wins = results.filter((r) => r.winnerIndex === 0).length;
    expect(p1Wins).toBeGreaterThan(0);
    expect(p1Wins).toBeLessThan(20);
  });

  it('collects hit and damage stats', () => {
    const result = runMatch('simon', 'chicha', 123);
    // Both fighters should land some hits in a full match
    expect(result.p1Stats.hitsLanded).toBeGreaterThan(0);
    expect(result.p2Stats.hitsLanded).toBeGreaterThan(0);
    expect(result.p1Stats.damageDealt).toBeGreaterThan(0);
    expect(result.p2Stats.damageDealt).toBeGreaterThan(0);
  });

  it('handles all fighter IDs without crashing', () => {
    const fighters = [
      'simon',
      'jeka',
      'chicha',
      'cata',
      'carito',
      'mao',
      'peks',
      'lini',
      'alv',
      'sun',
      'gartner',
      'richi',
      'cami',
      'migue',
      'bozzi',
      'angy',
    ];
    for (const id of fighters) {
      const result = runMatch(id, 'simon', 1);
      expect(result.winnerId).toBeDefined();
    }
  });

  it('records round results with KO or timeup type', () => {
    const result = runMatch('simon', 'jeka', 42);
    for (const round of result.rounds) {
      expect(round.type).toBeOneOf(['ko', 'timeup']);
      expect(round.winnerIndex).toBeOneOf([0, 1]);
      expect(round.frames).toBeGreaterThan(0);
      expect(round.p1HpRemaining).toBeGreaterThanOrEqual(0);
      expect(round.p2HpRemaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('mirror match converges toward 50% over many fights', () => {
    let p1Wins = 0;
    const N = 50;
    for (let i = 0; i < N; i++) {
      const result = runMatch('simon', 'simon', i * 31);
      if (result.winnerIndex === 0) p1Wins++;
    }
    const winRate = p1Wins / N;
    // Mirror match should be roughly balanced (allow wide margin for small N)
    expect(winRate).toBeGreaterThan(0.2);
    expect(winRate).toBeLessThan(0.8);
  });
});

describe('runMatchup', () => {
  it('aggregates multiple fights into a matchup result', () => {
    const result = runMatchup('simon', 'jeka', 10);
    expect(result.totalFights).toBe(10);
    expect(result.p1Wins + result.p2Wins).toBe(10);
    expect(result.p1WinRate).toBeGreaterThanOrEqual(0);
    expect(result.p1WinRate).toBeLessThanOrEqual(1);
    expect(result.avgP1DamageDealt).toBeGreaterThan(0);
    expect(result.avgTotalFrames).toBeGreaterThan(0);
  });
});
