# Skill: Diagnose E2E Test Failures

Analyze E2E multiplayer test failures using the artifacts produced by the Playwright test suite (reports, bundles, console logs). Identifies the failure type, pinpoints the root cause in the source code, and suggests fixes.

## Usage

`/diagnose-e2e [path-or-PR]`

- `test-results/` — local test results directory
- `path/to/bundle.json` — a specific reproducibility bundle
- `path/to/artifact.zip` — downloaded CI artifact ZIP
- `#123` or PR URL — read failure from PR comments (CI posts summary on failure)
- _(no argument)_ — look for `test-results/` in the project root

## Phase 0: Load Artifacts

### From local files
1. If a ZIP file: extract with `unzip -o <file> -d /tmp/e2e-diag`
2. If a directory: use it directly
3. If a single `.json` file: treat as a bundle, skip to Phase 2
4. Find all files:
   - `ci-summary.md` — read first for overview
   - `*-report.md` — formatted per-test reports
   - `*-bundle.json` — reproducibility bundles (the richest data source)
   - `*-console.log` — browser console output from P1 and P2
   - Also check `*/attachments/*` subdirectories (Playwright attachment format)

### From a PR (CI failure)
1. Use `mcp__github__pull_request_read` to read the PR and find the E2E failure comment
   - The CI workflow posts a comment starting with "**E2E multiplayer tests failed**" containing `ci-summary.md` content
2. The CI step "Print test results to CI logs" dumps ALL reports, bundles, and console logs to stdout — but these aren't accessible via MCP tools
3. Parse the PR comment for: which tests failed, hash match/mismatch, desync count, winner
4. For deeper analysis, ask the user to provide the bundle JSON (from the CI artifact download link in the comment, or by re-running locally)

### What's in a bundle

```
{
  version, generatedAt,
  config: { p1FighterId, p2FighterId, stageId, seed, speed, aiDifficulty },
  confirmedInputs: [{ frame, p1, p2 }],       // merged confirmed input pairs
  p1: {                                         // (p2 has same structure)
    playerSlot,
    inputs: [{ frame, encoded }],               // sparse: only when input changes
    checksums: [{ frame, hash }],               // every 30 confirmed frames
    roundEvents: [{ frame, type, winnerIndex }], // ko, timeup
    networkEvents: [{ time, type, ... }],        // rollback, desync, socket_close, etc.
    finalState: {
      frame,
      p1: { simX, simY, simVX, simVY, hp, special, stamina, state, ... },
      p2: { simX, simY, simVX, simVY, hp, special, stamina, state, ... },
      combat: { roundNumber, p1RoundsWon, p2RoundsWon, timer, roundActive, matchOver, ... }
    },
    finalStateHash,
    totalFrames, rollbackCount, maxRollbackFrames, desyncCount
  },
  urls: { p1, p2 }
}
```

Input encoding: 9 booleans packed as bits 0-8 (left, right, up, down, lp, hp, lk, hk, sp). Decode with `src/systems/InputBuffer.js:decodeInput()`.

## Phase 1: Triage

Read each report (or `ci-summary.md`). Classify each failed test into one or more categories:

| # | Failure Type | How to Detect |
|---|---|---|
| 1 | **Hash mismatch** | `p1.finalStateHash !== p2.finalStateHash` |
| 2 | **Checksum divergence** | Mismatched checksums at confirmed frames |
| 3 | **Desync events** | `desyncCount > 0` or `type: "desync"` in networkEvents |
| 4 | **Frame count drift** | `p1.totalFrames !== p2.totalFrames` (>2 frames apart is suspicious) |
| 5 | **Rollback storm** | `rollbackCount > 50` or `maxRollbackFrames >= 5` |
| 6 | **Connection failure** | Test timeout, no bundle produced, WebRTC errors in console |
| 7 | **Round event disagreement** | P1 and P2 roundEvents differ (different winners or frame numbers) |
| 8 | **Reconnection failure** | `socket_close` without `socket_open`, or `reconnection_disconnect` in events |

Present a summary table to the user showing which tests failed and why.

## Phase 2: Deep Analysis

For each failed test, read the bundle JSON and perform failure-specific analysis.

### 2a. Hash Mismatch (most common)

This means the two peers' simulations diverged. The goal is to find **when** and **why**.

1. **Compare final states field-by-field:**
   ```
   p1.finalState.frame vs p2.finalState.frame
   p1.finalState.p1.hp vs p2.finalState.p1.hp
   p1.finalState.p1.simX vs p2.finalState.p1.simX
   ... (all fighter fields)
   p1.finalState.combat vs p2.finalState.combat
   ```
   Report which fields differ and by how much.

2. **Find first checksum divergence:**
   Compare `p1.checksums` vs `p2.checksums` at shared frames. The first mismatch indicates the earliest known divergence point (checksums are every ~30 frames).

3. **Check frame counts:**
   - If `totalFrames` differs, one peer ran extra frames after match-over. This is a common source of hash mismatch even when simulation was identical during gameplay.
   - If `finalState.frame` differs, the snapshot was taken at different simulation points.
   - A few frames of difference (1-6) is normal due to P2 receiving the match-over event with network delay.

4. **Examine rollback patterns:**
   - Filter `networkEvents` for `type: "rollback"`. Note the frame ranges.
   - High asymmetry (P1 has 0 rollbacks, P2 has many) suggests P1's inputs reach P2 faster than vice versa — may indicate WebRTC asymmetry.
   - Rollbacks near round transitions are highest risk for divergence.

5. **Compare round events:**
   - Are roundEvents present on both sides? (P1 fires round events, P2 receives via network — P2 may have empty roundEvents if it relies on the network handler.)
   - Do they agree on winner and frame?

6. **Inspect inputs around divergence:**
   - Look at `confirmedInputs` around the first checksum divergence or round-end frame.
   - Check if both peers had the same confirmed inputs at critical frames.

### 2b. Checksum Divergence

1. Find the exact frame of first checksum mismatch from the report.
2. Look at both peers' inputs for ~30 frames before and after that frame.
3. Check networkEvents for rollbacks in that frame window.
4. If the divergence frame is near a round transition (compare with roundEvents), the issue is likely in round-end/round-start state management.

### 2c. Desync Events

1. Extract all `type: "desync"` events with their frame numbers, localHash, and remoteHash.
2. Cross-reference with rollback events in the same frame range.
3. Check if desync is followed by re-convergence (later checksums match again) or permanent.
4. Desyncs during rollback recovery suggest snapshot/restore issues.

### 2d. Connection / Timeout Failures

1. Read the console logs for both P1 and P2.
2. Look for:
   - `[WebRTC P1] failed` / `[WebRTC P2] failed` — WebRTC connection failure
   - `[TM] TURN credentials fetched` — did TURN work?
   - `[SYNC] Frame-0 sync confirmed` — did initial sync happen?
   - Missing `[SYNC]` messages — frame sync never completed
3. If no bundle was produced, the test likely timed out before match completion.

### 2e. Reconnection Failures

1. Check `networkEvents` for the sequence: `socket_close` -> `socket_open` -> `reconnection_resume`
2. Missing `socket_open` after `socket_close` = reconnection failed
3. `reconnection_disconnect` = grace period expired before peer reconnected
4. `reconnection_pause` without `reconnection_resume` = peer saw disconnect but never saw recovery

## Phase 3: Source Code Investigation

Based on the failure type, read the relevant source files to identify the root cause.

### Key source files by failure type

**Simulation divergence (hash mismatch, checksum divergence):**
- `src/systems/net/InputSync.js` — rollback netcode: `advance()`, `simulateFrame()`, checksum logic, snapshot/restore
- `src/systems/CombatSystem.js` — `simulateFrame()`, `checkHit()`, `tickTimer()`, round end handling, `handleRoundEnd()`
- `src/entities/Fighter.js` — `update()` physics, state machine transitions, `snapshot()`/`restore()`
- `src/simulation/SimulationEngine.js` — simulation loop, `step()`, state management
- `src/systems/FixedPoint.js` — fixed-point math (determinism)

**Network issues (rollback storms, connection failures):**
- `src/systems/net/TransportManager.js` — WebRTC setup, DataChannel, TURN
- `src/systems/net/SignalingClient.js` — WebSocket, message dispatch
- `src/systems/net/ConnectionMonitor.js` — ping/RTT measurement
- `src/systems/net/NetworkFacade.js` — composes all network modules

**Reconnection:**
- `src/systems/net/SignalingClient.js` — socket lifecycle, reconnection
- `src/scenes/FightScene.js` — reconnection state machine, grace period

**Recording/test infrastructure:**
- `src/systems/FightRecorder.js` — what gets recorded and when
- `tests/e2e/multiplayer-determinism.spec.js` — test assertions
- `tests/e2e/multiplayer-reconnection.spec.js` — reconnection test
- `tests/e2e/helpers/bundle-generator.js` — bundle structure

### What to look for

- **Non-deterministic code in simulation path:** `Math.random()` (should use seeded PRNG), `Date.now()` (should use frame count), `scene.time.delayedCall()` (should use deterministic timers)
- **State missing from snapshot/restore:** Fields in Fighter or CombatSystem that affect simulation but aren't included in `snapshot()`/`restore()`
- **Round-end timing asymmetry:** P1 fires round events via `combat.handleRoundEnd()` from `advance()` return values. P2 receives via `onRoundEvent` network handler. If P2 processes it at a different frame, state diverges.
- **Post-match-over simulation:** If one peer continues simulating frames after `matchOver=true` while the other stops, their final states will differ even though gameplay was identical.
- **Floating-point drift:** All simulation should use fixed-point math (`FP_SCALE`). Any raw floating-point in the simulation path will cause cross-platform divergence.

## Phase 4: Report

Present findings to the user:

1. **Summary:** Which tests failed, failure type(s) for each
2. **Root cause:** Hypothesis with evidence from the bundle data
3. **Source location:** Specific `file:line` references to the likely problematic code
4. **Suggested fix:** Concrete code changes to address the issue
5. **Verification:** How to confirm the fix works
   - `bun run test:e2e` for headless run
   - `bun run test:e2e:headed` to watch visually
   - For targeted testing: open two browser tabs with autoplay URLs from the bundle's `urls` field

## Common Patterns

### "Hash mismatch but all checksums match, frame counts differ by 3-6"
**Likely cause:** Post-match-over frame drift. P1 detects match-over and captures finalState immediately. P2 receives the round event a few frames later and runs extra simulation frames before capturing. The simulation was identical during gameplay but the snapshot timing differs.
**Where to look:** `FightRecorder.js` (when finalState is captured), `InputSync.js` (how match-over is communicated).

### "Hash mismatch, P1 has 0 rollbacks, P2 has many rollbacks"
**Likely cause:** Asymmetric WebRTC — P1's inputs reach P2 via WebSocket only (WebRTC failed for P1). P2's inputs may arrive with different timing, causing more mispredictions on P2's side. If rollbacks near round transitions cause state divergence, look at round-end handling during rollback.
**Where to look:** Console logs for `[WebRTC P1] failed`, `TransportManager.js`, `InputSync.js` rollback logic.

### "Checksum mismatch at specific frame, diverges permanently after"
**Likely cause:** A bug in the simulation determinism at that frame. Look at what happened ~30 frames before (the checksum interval). Check if a round ended in that window.
**Where to look:** `CombatSystem.js` round transition logic, `Fighter.js` state reset.

### "desyncCount > 0 but test still passed checksums"
**Likely cause:** Transient desync during rollback that self-corrected. The desync detection compares confirmed-frame checksums; if a rollback resolved the mismatch before the next checksum, it appears as a desync event but checksums still match.
**Where to look:** `InputSync.js` desync detection vs checksum comparison.

### "Test timed out, no bundle produced"
**Likely cause:** Game stuck in a scene transition, or both players never reached FightScene. Check console logs for errors.
**Where to look:** `AutoplayController.js`, scene chain (Boot -> Title -> Lobby -> Select -> PreFight -> Fight -> Victory).
