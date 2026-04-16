# Review Checklist

Per-area things to check. Use this as a prompt, not a bureaucratic checklist — not every item applies to every PR.

## Before writing anything

- Is this PR's scope clean? (description matches diff; no unexplained drift into unrelated files)
- Were claimed tests actually added?
- Is there prior review history I should avoid repeating?
- Does `bun run lint` / `bun run test:run` pass in CI? If CI is failing, that's the first thing to flag.

## Simulation & combat (`src/simulation/`, `src/entities/`, `src/systems/CombatSystem.js`, `combat-math.js`)

- No Phaser imports in the pure layer.
- Fixed-point math used consistently (see `FP_SCALE`).
- No `Math.random()`, `Date.now()`, `performance.now()`, `setTimeout`, `setInterval`.
- No direct side effects (audio, camera shake, animation play) — emit events instead.
- New state on `FighterSim`/`CombatSim` is included in snapshot capture/restore.
- New moves/attacks: damage, startup, active, recovery, hitstun, blockstun all defined in `fighters.json`.
- Balance-relevant changes: ran `bun run balance` and sanity-checked tier movement.

## Network (`src/systems/net/`, rollback logic)

- Module is pure routing/buffering, no game logic.
- Checksums compare confirmed frames, not current.
- Rollback is symmetric across both peers.
- WebSocket fallback path works when DataChannel is down.
- New message types: sender, receiver, what-if-lost semantics documented.
- Rate limiting present for client-triggerable messages.
- Logger instrumentation on non-trivial paths.

## PartyKit server (`party/server.js`)

- State transitions go through the state machine, not ad-hoc flags.
- Server state is authoritative over client state for room lifecycle.
- Structured `_log()` calls for all transitions, connect/disconnect, rate limits.
- `DIAG_TOKEN` check present for `/diagnostics` / `/turn-creds`.
- Grace period / reconnection logic preserves room state correctly; no zombie rooms.

## API (`api/`)

- Endpoint wrapped in `withAuth` or `withAdmin`.
- Parameterized SQL queries (no string concat with user input).
- No `err.message` leaked in 5xx responses.
- Error shape consistent with existing endpoints (`{ error: 'code' }` or similar).
- Tests mock `db` + `jose`; assertions are on behavior, not SQL substrings.
- Shared query logic extracted if used by handler + test.
- CORS / headers consistent with other endpoints.

## Scenes (`src/scenes/`)

- Scene data forwarded correctly (`gameMode`, `networkManager`, `matchContext`).
- `init(data)` receives, `create()` sets up, `shutdown()` cleans up.
- No new booleans that duplicate match state machine states.
- Spanish text for all user-facing UI strings.
- Event listeners registered in `create()` are removed in `shutdown()`.

## Tests (`tests/`)

Test coverage is a **first-class review check**, not a nice-to-have. The project's architectural bet is that pure logic can be tested rigorously in isolation — so every PR that ships pure logic without tests erodes that bet.

**What counts as "pure logic that must have tests":**
- Anything under `src/simulation/` (`FighterSim`, `CombatSim`, `SimulationEngine`).
- `src/systems/combat-math.js`, `src/systems/FixedPoint.js`, `src/systems/InputBuffer.js`, `src/systems/MatchStateMachine.js`, `src/systems/ReconnectionManager.js`.
- `src/entities/combat-block.js` (collision/block logic is pure on purpose).
- Pure helpers inside `src/systems/net/` (e.g. input buffering, prediction functions).
- The pure parts of `src/services/TournamentManager.js` (bracket construction, seeding, `getNextPlayableMatch`).
- State-machine logic in `party/server.js` (room state transitions, slot assignment, grace period).
- All API handlers in `api/*.js` — with mocked `db` and `jose`.

**What's hard to test and is OK without:**
- Phaser scenes (`src/scenes/`), sprite wrappers (`Fighter.js`), audio/VFX bridges, WebRTC transport glue.
- Pattern for making these testable: extract the non-trivial logic into a pure helper and test that (see `VictoryScene` stats test — commit `ac38c45` — for the template).

**Checks for every PR:**
- New pure logic has a test file or cases added to an existing one.
- Bug fixes have a regression test that would have failed before the fix (or a clear explanation why they can't — e.g. pure Phaser interaction).
- Tests claimed in the PR description actually exist in the diff. If a description says "added unit test for X" and no test is there, flag it — this has been a recurring finding.
- Assertions test behavior, not substrings or SQL fragments. `expect(query).toContain('WHERE user_id')` is brittle; assert on the returned data or on a shared query-builder function instead.
- New `if`/`switch` branches are exercised — don't accept a test that only hits the happy path when the diff added three new branches.
- Integration points (API handlers, party server, network modules with buffering) have tests with mocks for `db`, `jose`, network transports.
- E2E tests (`tests/e2e/`) updated when multiplayer flow, reconnection, or rollback logic changes. These are what catch cross-peer desyncs.
- Tests pass locally (`bun run test:run`) and in CI.
- New test files follow the existing directory layout (`tests/<area>/<thing>.test.js`, matching the source layout).

**Severity guidance:**
- Missing tests for new pure logic, or claimed tests that don't exist → **Critical**.
- Tests present but asserting on implementation details, or missing coverage of new branches → **Moderate**.
- Missing test for trivial refactors or utility changes → **Minor**.

## Build, lint, CI

- `bun run lint` clean (Biome: single quotes, semicolons, 2-space indent, 100 char width).
- No `console.log` / `console.warn` / `console.error` in `src/` or `party/` (use `Logger`).
- No committed `.only` / `.skip` / `debugger`.
- CI workflow files (`.github/workflows/`) not accidentally changed.
- No large binary blobs committed to the repo (>500KB gets scrutiny).

## Documentation

- `CLAUDE.md` updated if conventions, architecture, or scene chain changed.
- Relevant `docs/` or `docs/rfcs/` updated if this PR implements or modifies an RFC.
- New top-level features get a one-line mention somewhere discoverable.

## Security & operational

- No secrets in diff (`.env`, API keys, JWT secrets).
- New external network calls: which URL, is it gated, what's the failure mode.
- User input sanitized before it hits the DB, filesystem, or logs.
- No `0.0.0.0` bindings or permissive CORS added without explicit reason.
- TURN credentials, admin tokens, storage keys not logged.
- Retry logic has a bounded backoff (no retry amplification).

## Commit hygiene

- Atomic commits (one logical change per commit).
- Commit messages match project style (terse, imperative, scope-prefixed like `feat(auth):`).
- No "WIP" or "fix lint" commits on the final branch — ask for a squash/rebase if present.
- No merge commits from main unless the branch is genuinely long-lived.
