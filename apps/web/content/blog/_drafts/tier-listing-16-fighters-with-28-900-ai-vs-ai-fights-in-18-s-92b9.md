---
title: "Tier-listing 16 fighters with 28,900 AI-vs-AI fights in 18 seconds"
date: "TBD"
summary: "The pure simulation already runs without Phaser, so we let two AIs hammer each other 28,900 times to find out which fighter was overpowered."
audience: "en-tech"
status: "draft"
---

Players said some fighters felt overpowered. We had no data — just vibes. The
game has 17 fighters (16 at the time of the original rebalance, before
Motauakiller was added), each with their own stats and frame data on five
moves. Manual balancing is guesswork at that surface area.

So we let the game balance itself. Both peers in online play already run a
pure-JS simulation with zero Phaser dependencies — that's how rollback netcode
works at all. If the sim runs headless during a match, it runs headless in a
script. Plug in two seeded AI controllers, run 100 fights per matchup across
the full 17×17 matrix, and you get a tier list in under 20 seconds.

## The sim is already pure

The hard part was already done. `packages/sim/` exports `tick(p1, p2, combat,
p1Input, p2Input, frame)` — pure integer math, deterministic, no scene, no
sprites. The same function powers online matches and rollback resimulation.

What we needed was a way to drive it from AI decisions instead of human
inputs. The catch: `AIController.applyDecisions()` mutates the fighter
directly, but `tick()` expects encoded integer inputs and applies them via
`applyInputToFighter()`. Use both and you double-apply.

The fix is a tiny adapter (`scripts/balance-sim/ai-input-adapter.js`):

```js
export function getEncodedInput(ai) {
  ai.update(0, 0); // ticks frame counter; fires think() on interval

  const d = ai.decision;

  const encoded = encodeInput({
    left: d.moveDir < 0, right: d.moveDir > 0,
    up: d.jump, down: d.block,
    lp: d.attack === 'lightPunch', hp: d.attack === 'heavyPunch',
    lk: d.attack === 'lightKick',  hk: d.attack === 'heavyKick',
    sp: d.attack === 'special',
  });

  // Consume single-shot decisions so they don't repeat every frame
  // until the next think() cycle. Movement (moveDir) persists intentionally.
  if (d.jump) d.jump = false;
  if (d.attack) d.attack = null;

  return encoded;
}
```

The AI runs as normal, populates `decision`, we read it, encode it, hand it to
`tick()`. Single-shot actions (jumps, attacks) get nulled after consumption so
they fire on one frame — same semantics as a human pressing and releasing a
button.

`AIController` was already seedable. It uses mulberry32 internally
(`setSeed(n)` then `_rng()` for all decisions). Same seed, same fight, every
time.

## Match runner

The runner (`scripts/balance-sim/match-runner.js`) is a 60-line loop:

```js
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

  // collect stats from events…
}
```

Two real things in there worth noting:

1. **Skip the round transitions.** A full match plays three rounds with a
   300-frame cooldown between each. That's ~10 seconds of dead air per match
   we don't need. Force-resetting the transition timer to zero saves something
   like 40% of total simulation frames across the matrix.

2. **The events array is the API.** `tick()` returns `{ state, events,
   roundEvent }`. Stats come from filtering events: `hit`, `hit_blocked`,
   `whiff`, `special_charge`, `round_ko`, `round_timeup`. No log-scraping, no
   instrumentation, no diff between runs. The same events feed the audio and
   VFX bridges in the real game — they're free here.

## P1 won 79% of mirror matches

First run: every mirror matchup (Simo vs Simo, etc.) showed P1 winning 65–79%
of the time. Mirrors should converge to 50% — same fighter, same AI, same
difficulty.

The bias was structural. `tick()` processes P1's input first, then P2's. Hit
detection, attack resolution, anything that depends on processing order tilts
toward whoever moves first. With identical inputs both fighters often want to
attack on the same frame; the one who got their input applied first lands the
hit.

The fix is one of the cheapest possible: alternate sides each fight.
`scripts/balance-sim/match-runner.js`:

```js
if (i % 2 === 0) {
  results.push(runMatch(p1Id, p2Id, seed, difficulty));
} else {
  const flipped = runMatch(p2Id, p1Id, seed, difficulty);
  // Flip perspective so p1Id is always "P1" in aggregation
  results.push({ ...flipped,
    winnerIndex: flipped.winnerIndex === 0 ? 1 : 0,
    p1Stats: flipped.p2Stats, p2Stats: flipped.p1Stats,
    // …
  });
}
```

Each fighter spends equal time as the slot that ticks first. The bias is still
there for any individual fight, but it cancels in aggregate. Mirrors now sit
at ~50% — the bias didn't go away, it just stopped being a confounder.

Worth flagging though: this isn't a fix to the underlying issue. P1 still has
a tick-order advantage in real online matches. We just don't measure it
anymore.

## What the data showed

Pre-rebalance, with the original power/defense numbers, the tier list was
brutal:

```
S-tier (>57%): Simo 79%, Camilo 78%, Sun 77%, Alv 76%, Mao 67%
D-tier (<43%): Peks 22%, Chicha 21%, Carito 18%, LinaPcmn 17%
Spread: 16% → 79%
```

The single biggest finding was the formula in `packages/sim/src/combat-math.js`.
The original numbers:

- Power multiplier: `700 + power*100` → range `0.8x` to `1.2x` (50% damage swing)
- Defense multiplier: `1100 - def*40` → range `0.9x` to `1.06x` (16% swing)

Power was a 50% damage swing. Defense barely moved the needle. A power-4
fighter against a defense-1 fighter dealt nearly 1.5× damage on every hit. The
power stat was, effectively, the only stat.

Iteration 1 narrowed power and widened defense. The current code:

```js
// packages/sim/src/combat-math.js
export function calculateDamage(baseDamage, attackerPower, defenderDefense) {
  const powerMod = 850 + attackerPower * 50;   // 0.90x..1.10x
  const defMod  = 1200 - defenderDefense * 60; // 0.90x..1.14x
  return Math.round((baseDamage * powerMod * defMod) / 1_000_000);
}
```

The `1_000_000` is from running both modifiers at 1000× scale and combining —
keeps everything in integer math so the simulation stays bit-exact across
peers.

That alone wasn't enough. D-tier fighters were double-penalized: low power
*and* low base damage on their moves. So iteration 2 added base damage to
Jeka, Chicha, Carito, Peks, Lini, Gartner, Angy. Iterations 3 and 4 walked
back fast fighters that had overshot (1-frame-startup light punches plus a
damage buff was too much) and trimmed the remaining outliers.

After four passes, the spread closed from `16%–79%` to `45%–57%`. Every
fighter was within striking distance of 50%.

## Drift

The post-rebalance numbers I just quoted are from PR #94 in April. Today, a
fresh run looks different:

```
S: Sun (64.3%), Motauakiller (59.0%)
A: Panchito 56.9%, Angy 53.8%, Simo 53.6%, Cata 53.5%
B: Alv 52.6%, LinaPcmn 52.0%, Migue 51.4%, Jecat 48.9%
C: Bozz 46.0%, Mao 45.5%, Carito 44.3%
D: Peks 42.8%, Chicha 41.7%, Ric 41.5%, Camilo 41.4%
```

Spread is back to `41% → 64%`. Sun is dominating again, Camilo cratered.
Motauakiller showed up after the rebalance and walked into A-tier without any
tuning. The April fix wasn't a permanent solution — it was a snapshot, and
the snapshot has aged.

This is the actual point of the pipeline: balance isn't done, it's *cheap to
re-check*. Run `bun run balance` after any stat change, get a tier list, see
what broke. The cycle from "I want to nerf Sun's heavy kick by one frame" to
"here's the new tier list" is about 30 seconds.

## Some things that surprised me

- **The `special` stat (range 2–5) is dead.** Nothing reads it. Fighters with
  special 5 — Chicha, Peks, Carito — got literally zero benefit. They were
  also the ones at the bottom of D-tier. Whether anyone ever wires it up or
  the field gets deleted is a separate question.

- **All 17 fighters had a 100% KO rate.** Not a single fight ended on the
  round timer. AI-vs-AI on hard difficulty is aggressive enough that someone
  always dies first. Useful as a sanity check — if the timer started winning
  fights, something's broken.

- **Outlier matchups don't go away.** Even with the spread closed, Sun beats
  Camilo 80% of the time. Some matchups are just bad. The pipeline reports
  every matchup above 70% so they're at least visible (16 of them today,
  Sun in 6 of them).

- **AI-vs-AI doesn't equal human-vs-human.** Two `hard` AIs play optimally
  for the AI's heuristics, not optimally in general. Humans find exploits the
  AI never tries — like spamming a single move that the AI doesn't punish.
  This pipeline catches stat-driven imbalances cleanly. It doesn't catch
  meta-game issues.

## Cost

Full matrix, default settings:

```
$ bun run balance
Running full balance simulation: 100 fights/matchup, hard difficulty
Total fights: 28,900
Progress: 100% — done in 19.63s
```

That's 19.63 seconds for 28,900 complete three-round fights, on a laptop, in
Bun, on a single thread, with no native code. Pure JS integer math is
embarrassingly fast when you're not bottlenecked on rendering.

The bigger lesson: when your simulation is pure, balance becomes a script.
Same code path that runs in production runs in your terminal, deterministically,
28,900 times. There's no separate "test simulation" to keep in sync, no model
mismatch between what you tested and what ships. The AI-input adapter is
literally the only piece of glue.

## Sources

- [PR #94 — feat: fighter balance simulation pipeline + data-driven rebalancing](https://github.com/simon0191/a-los-traques/pull/94)
- [docs/rfcs/0013-fighter-balance-simulation.md](../docs/rfcs/0013-fighter-balance-simulation.md)
- [scripts/balance-sim/ai-input-adapter.js](../scripts/balance-sim/ai-input-adapter.js)
- [scripts/balance-sim/match-runner.js](../scripts/balance-sim/match-runner.js)
- [packages/sim/src/combat-math.js](../packages/sim/src/combat-math.js)
