/**
 * Headless match runner — runs a single AI-vs-AI fight and collects stats.
 * Uses SimulationEngine.tick() for deterministic frame advance with event telemetry.
 */

import { createCombatSim, createFighterSim, tick } from '@alostraques/sim';
import { GAME_WIDTH, ROUND_TIME } from '../../packages/game/src/config.js';
import fightersData from '../../packages/game/src/data/fighters.json' with { type: 'json' };
import { createHeadlessAI, getEncodedInput } from './ai-input-adapter.js';

const P1_START_X = Math.trunc(GAME_WIDTH * 0.3);
const P2_START_X = Math.trunc(GAME_WIDTH * 0.7);

// Safety cap: 5 minutes at 60fps (should never be reached)
const MAX_FRAMES = 60 * 60 * 5;

function emptyPlayerStats() {
  return {
    damageDealt: 0,
    damageBlocked: 0,
    hitsLanded: 0,
    hitsBlocked: 0,
    specialsUsed: 0,
    whiffs: 0,
  };
}

/**
 * Run a single headless match between two fighters.
 *
 * @param {string} p1Id - Fighter ID for player 1
 * @param {string} p2Id - Fighter ID for player 2
 * @param {number} seed - PRNG seed for deterministic AI
 * @param {'easy'|'medium'|'hard'} [difficulty='hard']
 * @returns {MatchResult}
 */
export function runMatch(p1Id, p2Id, seed, difficulty = 'hard') {
  const p1Data = fightersData.find((f) => f.id === p1Id);
  const p2Data = fightersData.find((f) => f.id === p2Id);
  if (!p1Data) throw new Error(`Fighter not found: ${p1Id}`);
  if (!p2Data) throw new Error(`Fighter not found: ${p2Id}`);

  const p1 = createFighterSim(P1_START_X, 0, p1Data);
  const p2 = createFighterSim(P2_START_X, 1, p2Data);
  const combat = createCombatSim();

  // Distinct PRNG streams for each AI
  const ai1 = createHeadlessAI(p1, p2, difficulty, seed);
  const ai2 = createHeadlessAI(p2, p1, difficulty, seed + 10000);

  const p1Stats = emptyPlayerStats();
  const p2Stats = emptyPlayerStats();
  const rounds = [];

  let roundStartFrame = 0;
  let frame = 0;

  for (; !combat.matchOver && frame < MAX_FRAMES; frame++) {
    // Fast-forward round transitions (skip 300 dead frames between rounds)
    if (!combat.roundActive && combat.transitionTimer > 0) {
      combat.transitionTimer = 0;
      p1.resetForRound(P1_START_X);
      p2.resetForRound(P2_START_X);
      combat.timer = ROUND_TIME;
      combat._timerAccumulator = 0;
      combat.roundActive = true;
      roundStartFrame = frame;
    }

    const p1Input = getEncodedInput(ai1);
    const p2Input = getEncodedInput(ai2);
    const { events } = tick(p1, p2, combat, p1Input, p2Input, frame);

    // Collect stats from events
    for (const evt of events) {
      switch (evt.type) {
        case 'hit': {
          const stats = evt.attackerIndex === 0 ? p1Stats : p2Stats;
          stats.damageDealt += evt.damage;
          stats.hitsLanded++;
          break;
        }
        case 'hit_blocked': {
          const stats = evt.attackerIndex === 0 ? p1Stats : p2Stats;
          stats.damageBlocked += evt.damage;
          stats.hitsBlocked++;
          break;
        }
        case 'whiff': {
          const stats = evt.playerIndex === 0 ? p1Stats : p2Stats;
          stats.whiffs++;
          break;
        }
        case 'special_charge': {
          const stats = evt.playerIndex === 0 ? p1Stats : p2Stats;
          stats.specialsUsed++;
          break;
        }
        case 'round_ko':
        case 'round_timeup': {
          rounds.push({
            winnerIndex: evt.winnerIndex,
            type: evt.type === 'round_ko' ? 'ko' : 'timeup',
            frames: frame - roundStartFrame,
            p1HpRemaining: p1.hp,
            p2HpRemaining: p2.hp,
          });
          roundStartFrame = frame;
          break;
        }
      }
    }
  }

  const winnerIndex = combat.p1RoundsWon > combat.p2RoundsWon ? 0 : 1;

  return {
    p1Id,
    p2Id,
    seed,
    winnerIndex,
    winnerId: winnerIndex === 0 ? p1Id : p2Id,
    totalFrames: frame,
    rounds,
    p1Stats,
    p2Stats,
    p1RoundsWon: combat.p1RoundsWon,
    p2RoundsWon: combat.p2RoundsWon,
  };
}

/**
 * Run a full matchup: N fights between two fighters with sequential seeds.
 *
 * @param {string} p1Id
 * @param {string} p2Id
 * @param {number} fightsPerMatchup
 * @param {'easy'|'medium'|'hard'} difficulty
 * @returns {MatchupResult}
 */
export function runMatchup(p1Id, p2Id, fightsPerMatchup, difficulty = 'hard') {
  const results = [];
  for (let i = 0; i < fightsPerMatchup; i++) {
    // Deterministic seed per fight: hash of matchup + fight index
    const seed = simpleHash(`${p1Id}:${p2Id}:${i}`);

    // Alternate sides to eliminate P1 positional advantage.
    // Even fights: p1Id is P1. Odd fights: p2Id is P1 (result flipped).
    if (i % 2 === 0) {
      results.push(runMatch(p1Id, p2Id, seed, difficulty));
    } else {
      const flipped = runMatch(p2Id, p1Id, seed, difficulty);
      // Flip perspective so p1Id is always "P1" in aggregation
      results.push({
        ...flipped,
        p1Id,
        p2Id,
        winnerIndex: flipped.winnerIndex === 0 ? 1 : 0,
        winnerId: flipped.winnerIndex === 0 ? p2Id : p1Id,
        p1Stats: flipped.p2Stats,
        p2Stats: flipped.p1Stats,
        p1RoundsWon: flipped.p2RoundsWon,
        p2RoundsWon: flipped.p1RoundsWon,
        rounds: flipped.rounds.map((r) => ({
          ...r,
          winnerIndex: r.winnerIndex === 0 ? 1 : 0,
          p1HpRemaining: r.p2HpRemaining,
          p2HpRemaining: r.p1HpRemaining,
        })),
      });
    }
  }
  return aggregateMatchup(p1Id, p2Id, results);
}

/**
 * Run the full 16×16 matrix of all matchups.
 *
 * @param {object} options
 * @param {number} [options.fightsPerMatchup=100]
 * @param {'easy'|'medium'|'hard'} [options.difficulty='hard']
 * @param {function} [options.onProgress] - Called after each matchup with (completed, total)
 * @returns {{ matrix: Object, fighters: Object, meta: Object }}
 */
export function runFullMatrix({ fightsPerMatchup = 100, difficulty = 'hard', onProgress } = {}) {
  const fighterIds = fightersData.map((f) => f.id);
  const totalMatchups = fighterIds.length * fighterIds.length;
  let completed = 0;

  const matrix = {};
  for (const p1Id of fighterIds) {
    matrix[p1Id] = {};
    for (const p2Id of fighterIds) {
      matrix[p1Id][p2Id] = runMatchup(p1Id, p2Id, fightsPerMatchup, difficulty);
      completed++;
      if (onProgress) onProgress(completed, totalMatchups);
    }
  }

  // Aggregate per-fighter stats across all matchups
  const fighters = {};
  for (const id of fighterIds) {
    let totalWins = 0;
    let totalMatches = 0;
    let totalDamageDealt = 0;
    let totalHitsLanded = 0;
    let totalSpecials = 0;
    let koWins = 0;
    let timeupWins = 0;

    for (const oppId of fighterIds) {
      const m = matrix[id][oppId];
      totalWins += m.p1Wins;
      totalMatches += m.totalFights;
      totalDamageDealt += m.avgP1DamageDealt * m.totalFights;
      totalHitsLanded += m.avgP1HitsLanded * m.totalFights;
      totalSpecials += m.avgP1SpecialsUsed * m.totalFights;
      koWins += m.koWins;
      timeupWins += m.timeupWins;
    }

    fighters[id] = {
      name: fightersData.find((f) => f.id === id).name,
      winRate: totalWins / totalMatches,
      totalWins,
      totalMatches,
      avgDamagePerMatch: totalDamageDealt / totalMatches,
      avgHitsPerMatch: totalHitsLanded / totalMatches,
      avgSpecialsPerMatch: totalSpecials / totalMatches,
      koWinRate: koWins / (koWins + timeupWins || 1),
    };
  }

  return {
    matrix,
    fighters,
    meta: {
      timestamp: new Date().toISOString(),
      fightsPerMatchup,
      difficulty,
      totalFights: totalMatchups * fightsPerMatchup,
      totalMatchups,
      fighterCount: fighterIds.length,
    },
  };
}

// -- Helpers --

function aggregateMatchup(p1Id, p2Id, results) {
  const totalFights = results.length;
  const p1Wins = results.filter((r) => r.winnerIndex === 0).length;

  let koWins = 0;
  let timeupWins = 0;
  for (const r of results) {
    for (const round of r.rounds) {
      if (round.winnerIndex === 0) {
        if (round.type === 'ko') koWins++;
        else timeupWins++;
      }
    }
  }

  const sum = (arr, fn) => arr.reduce((s, r) => s + fn(r), 0);

  return {
    p1Id,
    p2Id,
    totalFights,
    p1Wins,
    p2Wins: totalFights - p1Wins,
    p1WinRate: p1Wins / totalFights,
    koWins,
    timeupWins,
    avgP1DamageDealt: sum(results, (r) => r.p1Stats.damageDealt) / totalFights,
    avgP2DamageDealt: sum(results, (r) => r.p2Stats.damageDealt) / totalFights,
    avgP1HitsLanded: sum(results, (r) => r.p1Stats.hitsLanded) / totalFights,
    avgP1SpecialsUsed: sum(results, (r) => r.p1Stats.specialsUsed) / totalFights,
    avgTotalFrames: sum(results, (r) => r.totalFrames) / totalFights,
  };
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}
