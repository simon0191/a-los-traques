---
title: "How a single missing input frame creates an unfixable desync"
date: "TBD"
summary: "When the adaptive input delay bumped from 3 to 4, our rollback netcode silently dropped one frame from localInputHistory — and that single hole desynced the match every 9 seconds."
audience: "en-tech"
status: "draft"
---

We had four desyncs per online match. Always under asymmetric RTT (one peer
local, one on BrowserStack via the hybrid E2E test). Always after the same
pattern: match → desync → match → desync. The resync mechanism worked. New
desyncs kept coming.

Three out of four desyncs landed exactly 14 frames after a frame number we
could pre-compute from RTT samples alone. That's not random. That's a bug
with a clock.

## How inputs are stored in our rollback netcode

Each frame, the local peer encodes its input and stores it at a *future*
frame — `currentFrame + inputDelay`. The future-store is what gives both
peers time to confirm each other's inputs before they're needed for
simulation.

```js
// packages/game/src/systems/RollbackManager.js
const targetFrame = this.currentFrame + this.inputDelay;
this.localInputHistory.set(targetFrame, encodedLocal);
```

With `inputDelay = 3`, consecutive frames produce a contiguous sequence:

```
advance(frame=10) → localInputHistory[13] = input
advance(frame=11) → localInputHistory[14] = input
advance(frame=12) → localInputHistory[15] = input  // contiguous
```

The remote peer eventually receives those entries through `sendInput()` and
slots them into its own `remoteInputHistory`. When confirmed inputs arrive,
the rollback manager checks them against the prediction it used for that
frame. Mismatch → restore snapshot, replay.

## The bump that drops a frame

Every 180 frames (~3 seconds) `_recalculateInputDelay()` runs. It reads
the measured RTT, divides by the fixed-step duration, and picks an optimal
delay clamped to the range `[3, 5]`:

```js
// packages/game/src/systems/RollbackManager.js:481
_recalculateInputDelay() {
  const rtt = this.nm.rtt;
  if (!rtt) return;
  const oneWayFrames = Math.ceil(rtt / 16.667);
  const optimal = Math.max(ONLINE_INPUT_DELAY_FRAMES, Math.min(5, oneWayFrames + 1));
  if (optimal > this.inputDelay) {
    this.inputDelay = Math.min(this.inputDelay + 1, optimal);
  } else {
    this.inputDelay = optimal;
  }
  this.maxRollbackFrames = Math.max(7, this.inputDelay * 2 + 1);
}
```

Now the failure case. Imagine RTT just nudged `inputDelay` from 3 to 4
between frames 899 and 900:

```
advance(frame=899, delay=3) → localInputHistory[902] = input
// _recalculateInputDelay() runs at frame 900, delay becomes 4
advance(frame=900, delay=4) → localInputHistory[904] = input
//                                        Frame 903 is NEVER stored
```

The targets jumped from 902 to 904. Frame 903 has no local entry. There's
no `localInputHistory.set(903, ...)` anywhere in the system. The slot
isn't late — it doesn't exist.

## Why the gap is permanent

The `_recalculateInputDelay()` ramp-up is capped at +1 per call:
`Math.min(this.inputDelay + 1, optimal)`. Even if RTT spikes from 20ms to
80ms (giving an optimal of 6), the delay only crawls 3→4→5→6 over three
recalculation intervals — about 9 seconds. That cap is what makes the gap
always exactly one frame, but it's also what guarantees the gap *recurs*
every time RTT drifts upward.

When the simulation runs and asks "what was P2's input on frame 903?", two
things happen on the two peers:

```js
// packages/game/src/systems/RollbackManager.js:466
_getInputForFrame(frame, isP1) {
  const isLocal = (isP1 && this.localSlot === 0) || (!isP1 && this.localSlot === 1);
  if (isLocal) {
    return this.localInputHistory.get(frame) || EMPTY_INPUT;
  }
  if (this.remoteInputHistory.has(frame)) {
    return this.remoteInputHistory.get(frame);
  }
  if (this.predictedRemoteInputs.has(frame)) {
    return this.predictedRemoteInputs.get(frame);
  }
  return predictInput(this.lastConfirmedRemoteInput);
}
```

P2 (the local peer for that input): no entry → `EMPTY_INPUT` → the
fighter stops moving.

P1 (remote viewpoint): no confirmed input arrives because P2 never *sent*
one for frame 903 → falls through to `predictInput(lastConfirmedRemoteInput)`
→ which is just `lastInput & MOVEMENT_MASK` (`0b00001111`), preserving
movement bits, zeroing attack bits → if the last confirmed P2 input was
"hold right", P1 thinks P2 keeps holding right.

Two peers, two different inputs for the same frame, two different sims.
Position diverges.

The state divergence is bounded — the next confirmed input for frame 904
will overwrite the prediction starting at 904, both peers walk forward in
lock-step again. But frame 903's contribution to position is permanent
unless someone rolls back through it. Nobody will, because rollback fires
on a confirmed-vs-prediction mismatch, and the confirmed input for 903
never arrives. There is nothing to compare against. The mispredicted frame
is invisible.

## The 14-frame fingerprint

Checksums fire every 30 frames at a fixed safety offset. The current code
computes the offset at construction:

```js
// packages/game/src/systems/RollbackManager.js:86
this._checksumSafeOffset = Math.max(maxRollbackFrames, MAX_ADAPTIVE_ROLLBACK_FRAMES) + 2;
```

That works out to `max(7, 11) + 2 = 13`. Given the 30-frame checksum
interval, the first checksum frame at or beyond `gap + 13` is always
`gap + 14`. (The math: checksums fire at multiples of 30; the offset is 13;
for any gap frame, the next eligible checksum frame is `gap + 14`.) So if
the bug is real, the desync should always show up exactly 14 frames after
a gap.

We pulled the debug bundle from a hybrid E2E run (P1 = local Playwright,
P2 = BrowserStack Chrome on Win11; `seed=42`, simon vs jeka on beach). P2
had 449 rollbacks, max depth 7, four desyncs. RTT averaged 36ms with
spikes to 42ms — exactly enough to oscillate `oneWayFrames` between 2 and
3, which oscillates `optimal` between 3 and 4.

We computed the predicted gap frames from P2's 19 RTT samples and the
adaptive-delay formula, then matched them against the four observed
desync frames. Three of four desyncs landed at the predicted `gap + 14`:

| Gap Frame | Last P2 Input | `predictInput()` | Equals EMPTY? | Desync Frame |
|-----------|---------------|-------------------|---------------|--------------|
| 183       | 260 (up+sp)   | 4 (up)            | Yes (race)    | None         |
| 903       | 2 (right)     | 2 (right)         | No            | 917          |
| 1443      | 128 (hk)      | 0                 | Yes           | None         |
| 2343      | 8 (down)      | 8 (down)          | No            | 2537 (later) |
| 3063      | 1 (left)      | 1 (left)          | No            | 3077         |
| 3423      | 2 (right)     | 2 (right)         | No            | 3437         |

The "harmless" rows are gaps where the prediction happened to equal
`EMPTY_INPUT`: when the last input was attack-only (e.g. heavy kick =
`128`), `128 & 0b1111 = 0`, so both peers see no movement. No divergence.
That's why one of the four desyncs is shifted — frame 2343's gap *did*
diverge, but the divergence didn't cross a checksum boundary cleanly until
frame 2537.

The pattern in the checksum log around each desync was tidy:

```
Frame 887: P1=−917249474   P2=−917249474   match
Frame 917: P1=−612355444   P2=−1686097764  DESYNC  ← gap at 903
Frame 947: P1= 350984532   P2= 350984532   match   ← fixed by resync
```

Every 30 frames a desync fires, the resync mechanism kicks in, both peers
agree on the next checksum, and then the next adaptive-delay bump opens
another gap and we do it again.

## Why only the BrowserStack peer

P1 (local, RTT ~20ms): `oneWayFrames = ceil(20/16.667) = 2`, `optimal = 3`,
delay never moves off the floor of 3. No bumps, no gaps.

P2 (BrowserStack, RTT ~36ms with jitter): `oneWayFrames` oscillates
between 2 and 3 as RTT drifts across 33ms (`16.667 * 2`), so `optimal`
oscillates between 3 and 4. Every 3→4 transition opens a gap; every 4→3
transition causes a *collision* — two consecutive `advance()` calls
target the same frame.

Asymmetric RTT was the trigger because only the higher-RTT peer crossed
the boundary that flips `oneWayFrames`. A symmetric setup either both
floors at 3 (no problem) or both bumps in lockstep (then both have gaps,
but they happen to agree on the prediction often enough).

## The fix: fill the gap, send each filled frame

The fix is small and lives in `advance()`. Track the previous target
frame; on each call, if the new target jumped past `lastTarget + 1`, fill
every gap frame in `localInputHistory` with the current input *and* send
each gap frame to the remote so they get a confirmed input instead of a
permanent prediction.

```js
// packages/game/src/systems/RollbackManager.js:128
if (this._lastLocalTargetFrame >= 0 && targetFrame > this._lastLocalTargetFrame + 1) {
  for (let f = this._lastLocalTargetFrame + 1; f < targetFrame; f++) {
    this.localInputHistory.set(f, encodedLocal);
  }
}
```

Then in the network-send block:

```js
// packages/game/src/systems/RollbackManager.js:146
if (this._lastLocalTargetFrame >= 0 && targetFrame > this._lastLocalTargetFrame + 1) {
  for (let f = this._lastLocalTargetFrame + 1; f < targetFrame; f++) {
    const hist = [];
    for (let i = 1; i <= INPUT_REDUNDANCY; i++) {
      const hf = f - i;
      if (this.localInputHistory.has(hf)) hist.push([hf, this.localInputHistory.get(hf)]);
    }
    this.nm.sendInput(f, rawLocalInput, hist);
  }
}
```

Picking the *current* input as the gap-frame value isn't ideal — strictly,
the player held something during that 16ms — but it's the best we have
without modifying the input pipeline upstream of `advance()`. And it's
identical to what would have happened if `inputDelay` had stayed at 3:
that same `encodedLocal` would have been stored at `frame+3`. The peer
receives a real input for frame 903, so it isn't predicting forever.

## The mirror bug: collisions when delay decreases

Once we wrote the gap-fill, the symmetric case became obvious. Ramp-down
is *not* capped — `this.inputDelay = optimal` runs immediately when
`optimal <= this.inputDelay`. So a delay drop of exactly 1 (e.g. 4→3)
makes two consecutive `advance()` calls target the same frame:

```
advance(frame=899, delay=4) → localInputHistory[903] = inputA
// delay becomes 3
advance(frame=900, delay=3) → localInputHistory[903] = inputB  ← overwrites
```

Without protection, the second write overwrites the first. The remote peer
might receive both messages out of order, or only one. If it sees inputA
first, then inputB arrives, it triggers an unnecessary rollback; if inputB
gets dropped on an unreliable transport, the two peers permanently
disagree about frame 903.

The fix is one `has()` check — first-written input wins:

```js
// packages/game/src/systems/RollbackManager.js:138
const alreadyStored = this.localInputHistory.has(targetFrame);
if (!alreadyStored) {
  this.localInputHistory.set(targetFrame, encodedLocal);
}
// ... later, only send if !alreadyStored
```

The collision case is harmless in practice today (the rollback machinery
converges either way), but the fix is two lines and it removes a
message-loss hazard.

## What we learned

- Future-store input designs (encoded delay, schedule into the buffer,
  process later) have a hidden invariant: *the writer must produce a
  contiguous sequence of target frames*. Anything that mutates the offset
  while the writer is running breaks the invariant in a way the consumer
  cannot detect.
- Asymmetric RTT is the meanest test environment. Symmetric setups mask
  half the bugs because both peers cross thresholds together. The hybrid
  E2E setup (Playwright local + BrowserStack remote) is the only thing
  that flushed this one out.
- "Three of four desyncs land at exactly `gap + 14`" was the moment the
  bug stopped being mysterious. If you can predict a failure from inputs
  the system has already exposed (RTT samples, the delay formula, the
  checksum offset), you don't need a stack trace — you have a model.

## Sources

- [#97 — fix: desync under asymmetric rollback — adaptive input delay gap](https://github.com/simon0191/a-los-traques/pull/97)
- [0014-fix-desync-adaptive-delay-gap.md](../docs/rfcs/0014-fix-desync-adaptive-delay-gap.md)
- [packages/game/src/systems/RollbackManager.js#L119](../packages/game/src/systems/RollbackManager.js#L119) — `advance()` with the gap-fill and collision-skip
- [packages/game/src/systems/RollbackManager.js#L466](../packages/game/src/systems/RollbackManager.js#L466) — `_getInputForFrame()` showing the `EMPTY_INPUT` fallback
- [packages/game/src/systems/RollbackManager.js#L481](../packages/game/src/systems/RollbackManager.js#L481) — `_recalculateInputDelay()` with the +1 ramp-up cap
- [packages/sim/src/InputBuffer.js#L64](../packages/sim/src/InputBuffer.js#L64) — `predictInput()` (movement-bits-only)
