# RFC 0013: Fighter Balance Simulation Pipeline

**Status**: Proposed  
**Date**: 2026-04-06

## Problem

Players report some fighters feel overpowered and others too weak. With 16 fighters, each having unique stats (speed, power, defense, special) and move frame data (startup, active, recovery, hitstun, blockstun, reach, damage × 5 moves), manual balancing is guesswork. We need empirical data.

## Solution

A CLI pipeline that runs thousands of deterministic AI-vs-AI headless fights, collects per-matchup statistics, and produces a balance report identifying tier placement and outlier matchups.

### Why this is feasible now

The simulation layer (`src/simulation/`) has **zero Phaser dependencies**:
- `FighterSim` — pure state + logic
- `CombatSim` — combat state machine
- `SimulationEngine.tick()` — deterministic frame advance, returns `{ state, events, roundEvent }`
- `AIController` — seeded PRNG (mulberry32), works with `FighterSim` directly

Existing precedent: `tests/helpers/replay-engine.js` already runs complete headless fights.

## Design

### The AI-to-Input Adapter

**Problem**: `AIController.applyDecisions()` mutates the fighter directly, but `tick()` expects encoded integer inputs and applies them via `applyInputToFighter()`. Using both would double-apply inputs.

**Solution**: Read `AIController.decision` (set by `think()`) and convert to an encoded input integer without calling `applyDecisions()`:

```js
export function getEncodedInput(ai) {
  ai.update(0, 0);  // ticks frame counter, fires think() on interval
  
  const d = ai.decision;
  const encoded = encodeInput({
    left: d.moveDir < 0, right: d.moveDir > 0,
    up: d.jump, down: d.block,
    lp: d.attack === 'lightPunch', hp: d.attack === 'heavyPunch',
    lk: d.attack === 'lightKick',  hk: d.attack === 'heavyKick',
    sp: d.attack === 'special',
  });
  
  // Consume single-shot decisions (attacks fire once, movement persists)
  if (d.jump) d.jump = false;
  if (d.attack) d.attack = null;
  
  return encoded;
}
```

### Match Runner

```
for each frame until matchOver or MAX_FRAMES:
  1. Fast-forward round transitions (skip 300-frame cooldown)
  2. Get encoded inputs from both AIs
  3. tick(p1, p2, combat, p1Input, p2Input, frame)
  4. Collect stats from events array (hits, blocks, KOs, damage)
```

- Both AIs use `hard` difficulty for fair comparison
- Seed splitting: P1 gets `seed`, P2 gets `seed + 10000`
- Fast-forward transitions: saves ~40% of total simulation frames

### Matrix

- 16 × 16 = 256 matchups (including mirrors for sanity checking)
- Default 100 fights per matchup = 25,600 total fights
- Deterministic seeds: `hash(p1Id + ':' + p2Id + ':' + fightIndex)`
- Estimated runtime: 10-30 seconds (pure integer math, Bun)

### Stats Collected

From `tick()`'s events array per frame:
- Hits landed, hits blocked, damage dealt/taken
- Specials used, KO vs timeout ratio
- Round-level HP remaining, fight duration

### Report Output

**`balance-report.json`** — machine-readable full results:
```json
{
  "meta": { "timestamp", "fightsPerMatchup", "difficulty", "totalFights" },
  "matrix": { "<p1Id>": { "<p2Id>": { "wins", "losses", "winRate", ... } } },
  "fighters": { "<id>": { "overallWinRate", "avgDamagePerMatch", ... } },
  "tierList": { "S": [...], "A": [...], "B": [...], "C": [...], "D": [...] }
}
```

**`balance-report.md`** — human-readable summary:
- 16×16 win rate heatmap table
- Tier list (S: >57%, A: 53-57%, B: 47-53%, C: 43-47%, D: <43%)
- Outlier matchups (>70% or <30% win rate)
- Per-fighter breakdown

### CLI

```bash
bun run balance                          # Full matrix, 100 fights/matchup
bun run balance -- --fights=50           # Faster run
bun run balance -- --difficulty=medium   # Different AI level
bun run balance -- --p1=simon --p2=jeka  # Single matchup deep-dive
```

## File Plan

### New files

| File | Purpose |
|------|---------|
| `scripts/balance-sim/run.js` | CLI entry point |
| `scripts/balance-sim/ai-input-adapter.js` | AI decision → encoded input |
| `scripts/balance-sim/match-runner.js` | Single match + stat collection |
| `scripts/balance-sim/report.js` | JSON + markdown generation |
| `tests/balance-sim/ai-input-adapter.test.js` | Adapter tests |
| `tests/balance-sim/match-runner.test.js` | Match runner tests |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add `"balance"` script |
| `CLAUDE.md` | Document the pipeline |

## Reused Infrastructure

- `SimulationEngine.tick()` — deterministic frame loop
- `createFighterSim()` / `createCombatSim()` — headless sim objects
- `AIController` — seeded AI with difficulty presets
- `encodeInput()` / `decodeInput()` — input encoding
- `fighters.json` — all 16 fighter definitions

## Alternatives Considered

1. **Modify AIController to produce encoded inputs directly**: Would pollute production code with balance-sim-only concerns. The adapter is cleaner.

2. **Use `simulateFrame()` instead of `tick()`**: `simulateFrame()` doesn't return events, so we'd lose hit/block telemetry. `tick()` gives us everything.

3. **Run in browser via autoplay mode**: Much slower (rendering overhead), harder to collect structured data, can't run 25K fights in reasonable time.

## Risks

- **AI behavior may not reflect human play**: AI-vs-AI reveals stat-driven imbalances but not exploits humans discover. This is a starting point, not the final word.
- **Special stat (2-5) has no mechanical effect**: The `special` stat doesn't currently affect gameplay — it's essentially flavor. This will show up as a non-factor in the data, which is useful information.
- **Same-difficulty AI eliminates skill asymmetry**: Both fighters use identical AI logic, so the results purely measure stat + frame data differences. This is the desired behavior for balance testing.
