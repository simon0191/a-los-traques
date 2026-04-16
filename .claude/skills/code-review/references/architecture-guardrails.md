# Architecture Guardrails

The architectural rules that matter most for this codebase. Flag violations of these as **Critical** — they tend to break determinism, rollback, or cross-peer consistency, and bugs in these areas are expensive to track down later.

## Table of contents
- [Simulation purity (no Phaser in the sim layer)](#simulation-purity-no-phaser-in-the-sim-layer)
- [Determinism (fixed-point, no wall clock, no Math.random without seed)](#determinism)
- [Event-driven presentation (no side effects in sim)](#event-driven-presentation)
- [Network layer boundaries](#network-layer-boundaries)
- [Match state machine (no ad-hoc `isPaused` flags)](#match-state-machine)
- [Rollback netcode invariants](#rollback-netcode-invariants)
- [API layer (auth, SQL, error leakage)](#api-layer)
- [PartyKit server (authority, message types, logging)](#partykit-server)
- [Logger over console](#logger-over-console)
- [Scene data flow](#scene-data-flow)

---

## Simulation purity (no Phaser in the sim layer)

`src/simulation/` and pure logic modules (`src/systems/FixedPoint.js`, `src/systems/combat-math.js`, `src/systems/InputBuffer.js`, `src/systems/MatchStateMachine.js`, `src/systems/ReconnectionManager.js`) must not import Phaser or depend on any Phaser classes. The same applies to `src/entities/combat-block.js`.

Why it matters: the pure layer is what runs during rollback re-simulation on both peers. If Phaser leaks in, the sim becomes non-headless, can't be tested without a browser, and may produce side effects during rollback that show up as audio/VFX spam or desyncs.

**Phaser sprite logic lives in `src/entities/Fighter.js`, which wraps `FighterSim` via `Object.defineProperty` proxies.** New visual state should go on `Fighter`, not `FighterSim`. New game state should go on `FighterSim`, and `Fighter` should proxy it if needed.

**Red flags:**
- `import Phaser` in any file under `src/simulation/`.
- `scene.time.delayedCall`, `scene.tweens.add`, `this.sprite.setFlipX` in simulation code.
- New fields on `FighterSim` that are set from Phaser-side code but never used in the sim path (dead state that only exists to be rendered — belongs on `Fighter`).

## Determinism

The online multiplayer runs the *same* simulation on both peers and assumes identical outputs given identical inputs. Anything that breaks this causes desyncs.

**Rules:**
- **Fixed-point math.** Position, velocity, and physics use integer fixed-point with `FP_SCALE = 1000`. New physics code must use `FixedPoint.js` helpers, not raw floats. Floats are allowed at the presentation boundary (sprite rendering) but never in the sim path.
- **No `Math.random()` in the sim path without a seeded PRNG.** AI uses `mulberry32` seeded via `AIController.setSeed(n)` — new randomness must follow the same pattern.
- **No wall clock.** No `Date.now()`, no `performance.now()`, no `setTimeout`/`setInterval` in simulation code. Timers count frames (60 frames = 1 second); see `CombatSystem.tickTimer()`.
- **No `scene.time.delayedCall` in the sim path.** These fire on the Phaser clock, which is not frame-locked across peers.

**Red flags:**
- New `Math.random()` anywhere in `src/simulation/`, `src/entities/combat-block.js`, `src/systems/combat-math.js`, or `src/systems/CombatSystem.js`.
- Floating-point multiplications that were previously integer operations (subtle regressions — check whether the original code used `FP_SCALE`).
- `Date.now()` or timestamps used to compute gameplay state (as opposed to telemetry/logging).

## Event-driven presentation

`SimulationEngine.tick()` returns `{ state, events, roundEvent }`. Audio and VFX come from the events array, consumed by `AudioBridge` and `VFXBridge`. The sim itself must not call `audioManager.play()`, `cameras.main.shake()`, or trigger animations directly.

Why it matters: during rollback, the engine re-simulates frames to correct a misprediction. Events from those re-runs are discarded so the player doesn't hear the same hit sound twice. If a side effect lives in the sim path, it fires during rollback and produces audio/VFX spam or even crashes.

**Red flags:**
- `this.audioManager.play(...)` or `this.scene.cameras.main.shake(...)` inside `FighterSim`, `CombatSim`, or `SimulationStep`.
- New animation triggers (`sprite.anims.play(...)`) that bypass `Fighter.updateAnimation()`.
- A `_muteEffects` or `_isRollback` flag being added to work around this — that's the wrong fix. Return an event instead.

## Network layer boundaries

`src/systems/net/` is a composition of single-purpose modules: SignalingClient (WS to PartyKit), TransportManager (WebRTC + fallback), InputSync (buffers), RollbackManager (GGPO-style rewind), ConnectionMonitor (RTT), SpectatorRelay. `NetworkFacade` composes them.

**Rules:**
- Network modules should not contain game logic. They route, buffer, and measure. Game logic (damage, hit detection, state transitions) lives in the simulation layer.
- WebSocket inputs are always accepted regardless of DataChannel state — this is intentional for asymmetric reconnection. Don't add gating on transport state.
- Checksums compare *confirmed* frames (`currentFrame - maxRollbackFrames - 1`), not the current frame. Comparing the current frame causes false positives from predicted inputs.
- New network message types need a matching handler on both sides and a clear ownership model: which peer emits it, which receives it, what happens if it's lost.

**Red flags:**
- A network module directly mutating fighter state or combat state (should go through sim tick).
- `sendInput` that drops messages when the DataChannel is down (should fall through to WS).
- New checksum logic that compares current frame instead of confirmed frame.
- Round events handled in the network layer with custom state — they should route through `AudioBridge`/`VFXBridge` like other sim events.

## Match state machine

`src/systems/MatchStateMachine.js` is the source of truth for match flow. Historical regressions in this repo include booleans like `_reconnecting`, `_onlineDisconnected`, and ad-hoc `isPaused` flags on FightScene — all of them were consolidated into state machine transitions.

**Rules:**
- `isPaused` is a *getter* that reads state machine state, not an owned boolean.
- Update loops guard on `matchState.state === MatchState.ROUND_ACTIVE`, not on `combat.roundActive` or similar legacy flags.
- Invalid transitions throw — don't catch and swallow.

**Red flags:**
- New boolean fields on `FightScene` or `NetworkFacade` that overlap with state machine states.
- Code that checks multiple flags to infer what state the match is in (`if (!_reconnecting && !_paused && roundActive)` — if you need three booleans, you probably need a state).
- Try/catch around `matchState.transition()` that silently continues — the throw is load-bearing.

## Rollback netcode invariants

From the rollback RFCs (0006, 0007, 0014):

- Both peers run rollback symmetrically. An old bug had P1 never rolling back — don't reintroduce one-sided prediction.
- Checksum validation happens every 30 frames, on confirmed inputs only, offset by `maxRollbackFrames + 1` to avoid predicted-input false positives.
- History retention is 120 frames; rollback depth is capped at 7. These numbers are tuned — don't change them casually.
- Adaptive input delay gaps caused desyncs; fixed delay is the safe default. If you're modifying delay logic, check RFC 0014.
- Snapshots are mutable-in-place plain objects, captured/restored via `captureSnapshot`/`restoreSnapshot`. New fighter state added to `FighterSim` must be serialized by the snapshot helpers, or rollback will silently drop it.

**Red flags:**
- New fields on `FighterSim` or `CombatSim` that aren't in the snapshot capture/restore path.
- Asymmetric rollback logic (P1 vs P2 treated differently).
- Changes to `maxRollbackFrames`, history retention, or checksum interval without a linked RFC or clear justification.

## API layer

Endpoints live in `api/` and run as Vercel Functions. Every data endpoint must be wrapped in `withAuth(...)` or `withAdmin(...)` from `api/_lib/handler.js`.

**Rules:**
- JWT verification is enforced via `jose` in prod. Dev bypass (`X-Dev-User-Id`) only activates when `SUPABASE_JWT_SECRET` is missing — do not add unconditional bypasses.
- SQL uses parameterized queries via `pg`. String-concatenated SQL is a critical issue.
- Error responses must not leak `err.message` or stack traces for 5xx errors (flagged historically on `api/fights.js`).
- Admin endpoints require `is_admin` on the profile — use `withAdmin`, not an inline check.
- Shared query logic between a handler and its test should be extracted into a function both import, rather than duplicating SQL strings or asserting on SQL substrings.

**Red flags:**
- A handler that's `export default async (req, res) => {...}` without `withAuth` / `withAdmin`.
- `res.status(500).json({ error: err.message })`.
- Template-literal SQL with user input interpolated in.
- Test that asserts `expect(sql).toContain('WHERE user_id')` instead of asserting on behavior.

## PartyKit server

`party/server.js` is a *relay*, not a game logic server. It tracks room state (`roomState` enum), assigns player slots, relays messages, and manages the reconnection grace period. It does not simulate the fight.

**Rules:**
- The server state machine is authoritative for room lifecycle (who's in the room, whether someone is in the grace period, whether the room should return to select or disconnect). Client state that contradicts server state is wrong; the client should reconcile to the server, not the other way around.
- All server logs go through `_log()` (structured JSON, ring buffer). Don't add `console.log` in the party server.
- `DIAG_TOKEN` gates `/diagnostics` and `/turn-creds`. Don't expose these without the token check.
- New message types need rate limiting if they can be triggered by a client at will.
- Binary asset uploads to the repo should be checked — an 8MB portrait file was flagged historically. Assets over ~500KB get scrutiny.

## Logger over console

`src/systems/Logger.js` has the ring buffer that feeds the debug bundle. `console.log` output does not. If a log would help debug a user-reported desync or disconnect in the field, it must go through Logger.

**Rules:**
- `Logger.create('ModuleName')` at the top of the file, use the returned instance.
- Default level is OFF (zero overhead). `?debug=1` URL param enables verbose levels.
- Error-level logs that indicate real failures should be INFO or WARN, not hidden behind DEBUG — they need to show up in bundles from default runs.

**Red flags:**
- `console.log`, `console.warn`, `console.error` in `src/` or `party/` outside of genuinely dev-only code paths.
- `Logger.debug` for things that are actually errors (moves important signal out of bundles).

## Scene data flow

Scenes receive data via `scene.start('NextScene', { p1Id, p2Id, stageId, gameMode, networkManager, matchContext })`. The chain is load-bearing — missing fields break downstream scenes.

**Rules:**
- Scene transitions propagate `gameMode`, `networkManager`, and `matchContext` forward. New scene parameters should be added to the payload and documented.
- `matchContext.type` distinguishes `'tournament'`, `'versus'`, or absent (regular). Scenes that behave differently per mode should switch on this explicitly rather than inferring from other fields.
- Scenes clean up listeners, audio, and timers in `shutdown()`. Forgetting this causes leaks across scene restarts.

**Red flags:**
- `scene.start` without forwarding `networkManager` when the next scene needs it.
- New per-scene booleans that should be `matchContext` fields.
- Scene `create()` that adds listeners with no matching cleanup in `shutdown()`.
