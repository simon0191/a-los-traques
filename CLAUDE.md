# A Los Traques

Street Fighter-style fighting game starring 16 real friends. iPhone 15 landscape Safari target.
480x270 internal resolution, Phaser 3 running inside a Next.js app, ES6 modules, all UI text in Spanish.

## Monorepo Layout (RFC 0019, Phases 1–3)

Bun workspaces + Turborepo. Apps are runnable; packages are importable.

- `apps/web/` — Next.js 15 App Router. Hosts the marketing pages (`/`, `/about`, `/blog`), the game at `/play`, and every HTTP API route (`app/api/**/route.ts`). Vercel cron lives in `apps/web/vercel.json`.
- `apps/party/` — PartyKit multiplayer relay (unchanged behavior).
- `packages/game/` — `@alostraques/game`: Phaser scenes, systems, entities, data, and the `createGame({ parent, params, env, eventBus })` factory. No Next/React/Vite. Next consumes it via `next/dynamic({ ssr: false })`.
- `packages/sim/` — `@alostraques/sim`: pure simulation. No Phaser, Vite, React, Next.
- `packages/db/` — `@alostraques/db`: raw `pg` pool factory + dbmate migrations.
- `packages/api-core/` — `@alostraques/api-core`: framework-agnostic JWT verify + pluggable storage + Zod-ready validate helpers.
- `tests/` — still at repo root; later phases distribute them into colocated `__tests__/` per package.
- `scripts/` — glue only (`dev-db.js`, `dev-multiplayer.js`, `migrate.sh`, `build-music-manifest.js`, `overlay-export-server.js`, plus asset-pipeline + balance-sim which promote to apps in later phases). `scripts/build-music-manifest.js` runs as an `apps/web` predev/prebuild hook and emits `packages/game/src/data/music-manifest.js` from the MP3s in `apps/web/public/assets/audio/fights/`.

Workspace imports: use `@alostraques/<name>` from any workspace (app or package). No cross-app `../../apps/*` imports; share via `packages/*`.

## Authentication & Persistence

Decoupled architecture: Supabase for Auth (JWT) + Next.js Route Handlers for data persistence.

- **Supabase Client**: lives in `packages/game/src/services/supabase.js`. `createGame({ env })` injects `supabaseUrl` / `supabaseAnonKey` so the package stays framework-agnostic. Moves to a dedicated `@alostraques/auth` package in a later phase.
- **Backend API**: `apps/web/app/api/**/route.ts` (Next.js Route Handlers) — `profile`, `stats`, `leaderboard`, `fights`, `debug-bundles`, `tournament/*`, `admin/*`, `cron/*`, `public-config`.
- **API Service**: `packages/game/src/services/api.js` calls `/api/*` directly (same origin as the game now that it runs from Next.js).
- **JWT Verification**: `@alostraques/api-core` exposes `verifyBearerToken` + `resolveUserId` (framework-agnostic). `apps/web/lib/auth/middleware.ts` is the Next.js `withAuth` / `withAdmin` adapter that pairs the core with a pooled `pg` client from `@alostraques/db`.
- **Dev Bypass**: In non-production, the middleware accepts the `X-Dev-User-Id` header when no Bearer token is present.
- **DB Pool**: `@alostraques/db` exports `createPool`, `createClient`, and `getPool` (memoized on `globalThis`). Route handlers use `getPool` / fresh client per request on Windows.
- **Global State**: Authenticated user object stored in `window.game.registry.get('user')`.
- **Database Schema**:
    - Managed via `dbmate` (pure Postgres). `bun run migrate` calls `scripts/migrate.sh` which points dbmate at `packages/db/migrations/`.
    - `profiles` table (id, nickname, wins, losses, is_admin).
    - `fights` table (id, room_id, players, fighters, stage, result, debug bundle status/TTL).
- **Graceful Degradation**: If the `/api/public-config` response comes back with null Supabase values (or the fetch fails), the game bypasses `LoginScene` and operates in "Guest Mode" automatically.

## Build & Run

```bash
bun run dev:mp       # Full multiplayer dev (fake auth + PGLite + Next.js + PartyKit)
                     # Game at http://localhost:3000/play
                     # Log in as p1@test.local or p2@test.local (password: password)
                     # Windows: Auto-sets PG_FRESH_CLIENT=1 to avoid ECONNRESET.
                     # RESET DB: rm -r -Force .pglite (PS) or rm -rf .pglite (Unix)
bun run dev:all      # PGLite + Next.js (marketing + /play + API)
bun run dev          # Next.js dev server only (delegates to @alostraques/web)
bun run party:dev    # PartyKit dev server (port 1999)
bun run build        # Production build — delegates to apps/web (Next.js)
bun run start        # Production Next.js server (use after build)
bun run migrate      # Run database migrations (scripts/migrate.sh → dbmate, packages/db/migrations)
bun run test         # Run tests in watch mode (Vitest)
bun run test:run     # Run tests once (CI)
bun run lint         # Lint + format check (Biome)
bun run lint:fix     # Auto-fix lint + format issues
bun run format       # Format code only (Biome)
bun run balance      # Run fighter balance simulation (full 17×17 matrix)
bun run balance -- --fights=50           # Fewer fights per matchup (faster)
bun run balance -- --p1=simon --p2=jeka  # Single matchup deep-dive
```

**Windows Support**: If you experience `ECONNRESET` errors with the local database on Windows, ensure `PG_FRESH_CLIENT=1` is set in your environment. This forces a fresh database connection per request instead of using a pool. This is automatically handled by `bun run dev:mp`.

## Project Structure

```
apps/
  web/                             # Next.js 15 App Router — marketing + API
    app/
      (marketing)                  # Landing + blog + about (Phase 2 inlines these at the root)
      page.tsx                     # `/` landing
      about/page.tsx
      blog/page.tsx, [slug]/page.tsx  # MDX-on-disk blog (content/blog/*.md)
      api/                         # HTTP API surface — thin Route Handlers over service logic
        profile/route.ts
        stats/route.ts, stats/tournament-match/route.ts
        leaderboard/route.ts
        fights/route.ts
        debug-bundles/route.ts
        tournament/create/route.ts, tournament/join/route.ts
        admin/fights/route.ts, admin/debug-bundle/route.ts
        cron/cleanup-bundles/route.ts
        public-config/route.ts
      layout.tsx, globals.css
    lib/
      auth/middleware.ts           # Next.js withAuth/withAdmin (wraps @alostraques/api-core + @alostraques/db)
      env.ts                       # Zod-free env reader (SUPABASE_*, PARTYKIT_HOST, …)
      blog.ts                      # Frontmatter parser for content/blog/*.md
      queries/                     # Server-only SQL kept out of route files
    content/blog/                  # Markdown posts (no CMS — see RFC 0019)
    vercel.json                    # Cron schedule for /api/cron/cleanup-bundles
    next.config.mjs
    tsconfig.json
  party/                           # PartyKit server (+ TURN credential endpoint)
    server.js
    partykit.json
packages/
  game/                            # @alostraques/game — Phaser scenes, systems, entities, data
    src/
      index.js                     # createGame({ parent, params, env, eventBus }) factory
      config.js                    # Env-driven config (configureEnv/getPartyKitHost/isDevMode)
      scenes/                      # Boot -> Title -> MultiplayerMenu -> Select -> …
      services/                    # TournamentManager.js, UIService.js, supabase.js, api.js
      entities/                    # Fighter.js (Phaser wrapper)
      systems/                     # CombatSystem, InputManager, AIController, AudioBridge, VFXBridge, net/*
      editor/                      # OverlayManifest, EditorUI (still in-package; Phase 5 lifts to apps/admin)
      data/                        # fighters.json, stages.json, music-manifest.js (generated)
  sim/                             # @alostraques/sim — pure simulation (no Phaser)
    src/                           # CombatSim, FighterSim, SimulationEngine, FixedPoint, combat-math, combat-block, InputBuffer, constants
  db/                              # @alostraques/db — pg Pool factory + dbmate migrations
    src/                           # pool.js (createPool, createClient, getPool)
    migrations/
    seed-dev.sql
  api-core/                        # @alostraques/api-core — framework-agnostic API primitives
    src/                           # auth.js, storage.js, validate.js
assets/
  references/                      # Golden reference images for generation pipeline
  photos/                          # Source photos of friends (input for generation)
  manifests/                       # JSON configs for asset pipeline (fighter_, portrait_, reference_)
  _raw/                            # Intermediate files from asset pipeline (not shipped)
scripts/
  asset-pipeline/                  # Gemini-based sprite generation pipeline (moves to apps/asset-pipeline later)
  balance-sim/                     # Headless AI-vs-AI balance simulation (moves to apps/balance-sim later)
  dev-db.js / dev-multiplayer.js   # Local dev orchestration (Turbo will replace later)
  migrate.sh                       # dbmate wrapper → packages/db/migrations
tests/                             # Still at repo root during Phase 1–2; distributed in later phases
  simulation/                      # @alostraques/sim unit tests (PureSim, FighterSim, CombatSim)
  systems/                         # combat-math, collision, AI difficulty
  party/                           # PartyKit server (slot assignment, rate limiting, routing)
  data/                            # fighters.json data validation
  balance-sim/                     # Balance simulation adapter + runner tests
  api/                             # storage unit + leaderboard integration. The old
                                   # per-handler unit tests were deleted in Phase 2
                                   # (business logic moves to features/<domain>/service in Phase 3+).
```

## Conventions

- Named exports for all scenes/classes (not default). Exception: `apps/party/server.js` uses default export (PartyKit requirement)
- Import Phaser in any file using Phaser classes
- `fighters.json` uses string IDs, scenes look up by ID with `.find()`
- Placeholder textures: colored rectangles generated in BootScene, used when no real sprites exist
- `gameMode`: `'local'` (vs AI or local 2P) or `'online'` (vs player) passed through scene chain
- `matchContext`: payload containing competition logic. `type: 'tournament'` (bracket), `type: 'versus'` (local 2P quick match), or absent (regular local/online).
- Scenes pass data via `scene.start('SceneName', { p1Id, p2Id, stageId, gameMode, networkManager, matchContext })`
- FightScene uses `MatchStateMachine` for flow control: `isPaused` is a getter on SM state, `_reconnecting`/`_onlineDisconnected` eliminated, update loop guards on `matchState.state` instead of `combat.roundActive`
- **Logging**: Use `Logger.create('ModuleName')` from `packages/game/src/systems/Logger.js` instead of `console.log/warn/error`. Zero overhead when level is OFF (default). See RFC 0005.
- **Pure simulation imports**: always from `@alostraques/sim` (FP math, combat math, input encoding, sim classes). Never reach into `packages/sim/src/*.js` via relative path from outside the package.
- **Before every commit**: run `bun run lint:fix` to auto-fix formatting/lint issues, then verify with `bun run lint`. CI runs Biome lint and will fail on any error.
- **Atomic commits**: make a separate commit for each logical change. Don't bundle unrelated changes into one commit.

## Asset Pipeline

Generate fighter sprites via Gemini image generation + ImageMagick post-processing.

### Pipeline types
```bash
node scripts/asset-pipeline/cli.js reference <config.json>  # Golden reference (single pose)
node scripts/asset-pipeline/cli.js fighter <config.json>     # Animation frames
node scripts/asset-pipeline/cli.js portrait <config.json>    # Character portrait
node scripts/asset-pipeline/cli.js stage <config.json>       # Stage background
node scripts/asset-pipeline/cli.js poses <config.json>       # Pose keypoints per frame
```

### Fighter generation workflow
Use the `/generate-fighter` skill for the full workflow. Key points:
- **Two-phase**: generate golden reference first, then animation frames using it
- **Adaptive background**: auto-switches to magenta `#FF00FF` when description contains "green" to avoid chroma-key conflicts
- **Reference chain**: golden reference sheet → first idle frame → previous frame (motion continuity). `referenceImages` (photos) are optional.
- **Facing**: sprites must face RIGHT. Gemini ignores this ~30% of the time. Manual QA + ImageMagick `-flop` to fix
- **Frame sizes**: 128x128 per frame, assembled into horizontal strip PNGs
- **Requires**: `GEMINI_API_KEY` environment variable
- **Stale cache**: `assets/_raw/fighters/{id}/` caches intermediate frames. When regenerating a fighter, **always delete this directory first** or the pipeline will reuse old frames
- **referenceSheet**: should point to `assets/references/{id}_ref_padded.png` (the bg-removed, padded version of the golden reference)
- **Manifest field names**: `reference_{id}.json` and `fighter_{id}.json` use `description`; `portrait_{id}.json` uses `prompt`

### Adding a new fighter with sprites
1. Add photo to `assets/photos/{id}.jpg` (optional — only needed if manifest `referenceImages` references it)
2. Create manifests: `reference_{id}.json` and `fighter_{id}.json`
3. Run `/generate-fighter {id}`
4. Add fighter ID to `FIGHTERS_WITH_SPRITES` in `packages/game/src/data/animations.js` (single source of truth — consumed by BootScene, OverlayEditorScene, InspectorScene, and the calibrate-overlays CLI)

### Regenerating an existing fighter
1. Delete stale cache: `rm -rf assets/_raw/fighters/{id}`
2. Delete old output: `rm -f public/assets/fighters/{id}/*.png`
3. If the golden reference changed, delete derivatives: `rm -f assets/references/{id}_ref_*.png` (keep `{id}_ref.png`)
4. Run reference pipeline with `--skip-generate` (reprocesses existing `{id}_ref.png`)
5. Run fighter pipeline, then portrait pipeline

### Animated stage backgrounds
Use the `/generate-animated-stage` skill for the full workflow. Key points:
- **stages.json fields**: `animated` (bool), `animFrames` (int), `animFrameRate` (int, default 6 fps)
- **Format**: horizontal strip PNG (480*N x 270), same pattern as fighter spritesheets
- **Manifest**: `assets/manifests/stage_{id}.json` with `prompt`, `output`, `animated: true`, `animFrames`
- **Reference chain**: first generated frame is passed as reference to subsequent frames for consistency
- **Stale cache**: `assets/_raw/stages/stages_{id}_frame*` — delete before regenerating

### Animation frame counts
idle(4), walk(4), light_punch(4), heavy_punch(5), light_kick(4), heavy_kick(5), special(5), block(2), hurt(3), knockdown(4), victory(4), defeat(3), jump(3)

### Pose estimation
Use the `/generate-poses` skill to extract per-frame keypoints for attaching runtime effects (hats, weapons, VFX) to body parts. Key points:
- **Model**: MediaPipe PoseLandmarker heavy (BlazePose GHUM) via Python + `uv`. Managed in `scripts/asset-pipeline/pose/` with its own `pyproject.toml`.
- **Must run AFTER `/generate-fighter` Phase 4** (facing fixes). Running before swaps `left*`/`right*` keypoints across an animation.
- **Frame splitting gotcha**: strips have a `128x128+0+0` page geometry from `+append`; split must use `+repage -crop 128x128 +repage` or only the first frame is produced.
- **Output**: `apps/web/public/assets/fighters/{id}/poses.json` — one consolidated file per fighter with all 13 animations. 23 named keypoints per frame (pixel-space, top-left origin) + derived `head/torso/leftHand/rightHand/leftFoot/rightFoot` angles (degrees, CCW from +x).
- **Low-vis frames**: `block`, `hurt`, `knockdown` sometimes have contorted poses MediaPipe can't read — stored as `detected: false`, runtime code should skip attachment or interpolate.
- **`--debug`**: writes skeleton-overlay strips to `assets/_raw/poses/{id}/{anim}_debug.png` for QA.
- **Model file** (~30 MB) auto-downloads to `scripts/asset-pipeline/pose/models/` on first run. Gitignored.

### Accessory calibration seed (RFC 0018)

Pose data seeds the overlay editor's manifest so accessories start on/near the head instead of at the default. Run AFTER `/generate-poses` so `apps/web/public/assets/fighters/{id}/poses.json` exists:

```bash
node scripts/asset-pipeline/calibrate-overlays.js              # seed only missing (fighter, category, anim) combos
node scripts/asset-pipeline/calibrate-overlays.js --force      # overwrite existing — destroys hand-tuned data
node scripts/asset-pipeline/calibrate-overlays.js --fighter=simon --category=gafas --dry-run
```

- Writes into the consolidated `apps/web/public/assets/overlays/manifest.json` — `calibrations[fighterId][category][animation] = {frameCount, frames, keyframes, lastEditedAt}`. Categories come from `packages/game/src/data/accessories.json` (currently `sombreros`, `gafas`).
- **Skips existing entries by default** so hand-tuned calibrations from the editor aren't clobbered. `--force` overwrites.
- **Anchor strategy**: `sombreros` place the hat center so the bottom edge sits ~2 px below the top of head landmarks (eyes/ears/nose min y). `gafas` center on the eye-line midpoint. Both categories use `derived.head.center.x` for X.
- **Scale model** (new in v2): `renderedWidth = FIGHTER_HEIGHT × scale` — independent of the accessory PNG's pixel dimensions. Uniform per (fighter, category) as the editor enforces. Derived from shoulder distance (shoulders are more reliable than ears in 3/4-view sprites): `scale = (shoulderWidth × widthRatio) / 128`, where `widthRatio = 1.3` for sombreros, `0.85` for gafas.
- Undetected frames copy the nearest detected frame's transform (prev preferred); fully-undetected animations fall back to the idle[0] anchor. Detected frames are marked as keyframes so the editor's `I` (interpolate) preserves them.
- Open the editor with `?editor=1` to fine-tune visually after seeding.

## Fighter Entity

- **Two layers**: `FighterSim` (pure state + logic, no Phaser) and `Fighter` (Phaser sprite wrapper, delegates to FighterSim via proxied fields)
- Both local and online modes run `tick()` on `FighterSim` objects. `Fighter` is only for presentation.
- `syncSprite()` updates position, flip (`setFlipX(!facingRight)`), and state-driven tints (block blue, special yellow). Called at visual rate after sim ticks.
- `updateAnimation()` maps sim state to Phaser animations. Called at visual rate after `syncSprite()`.
- Attack animation framerate is dynamic: `spriteFrames / attackDuration * 1000` fps, so animations complete within the gameplay cooldown window.
- `_prevAnimState` tracks animation to avoid re-triggering. Set to `null` on attack to force replay.
- `hasAnims` flag checked before playing animations (falls back to static sprite for placeholder fighters).

## Tests

Vitest, configured in `vitest.config.js`. Tests live in `tests/` (not alongside source).
Pure logic is extracted into small modules (`packages/game/src/systems/combat-math.js`, `packages/game/src/entities/combat-block.js`) to enable Phaser-free unit testing.
CI runs via GitHub Actions (`.github/workflows/test.yml`) on PRs and pushes to main — runs lint (Biome) then tests.

### E2E Multiplayer Testing

Playwright-based framework that spawns two browser instances in autoplay mode, runs a full multiplayer match, and verifies determinism. See `docs/e2e-testing.md` for full details.

```bash
bun run test:e2e          # Run E2E tests headless
bun run test:e2e:headed   # Watch both browsers fight
bun run test:e2e:remote   # Remote browsers via BrowserStack (requires BROWSERSTACK_USERNAME + BROWSERSTACK_ACCESS_KEY)
```

**Autoplay URL params**: `?autoplay=1&createRoom=1&fighter=simon&seed=42&speed=2`
- `AutoplayController` reads params, drives scenes without human interaction
- `FightRecorder` captures inputs, checksums, rollbacks, desyncs to `window.__FIGHT_LOG`
- `AIController.setSeed(n)` enables reproducible AI decisions (mulberry32 PRNG)
- `?speed=N` overclocks simulation (N steps per visual frame, default 2x in E2E tests)

## Documentation

Markdown docs with Mermaid diagrams in `docs/`. When making significant changes to a documented system, update the relevant doc to stay in sync.

- `docs/rollback-netcode.md` — Rollback netcode architecture (GGPO-style, peer-equal)
- `docs/webrtc-transport.md` — WebRTC P2P transport (DataChannel, signaling, fallback)
- `docs/multiplayer-security.md` — Trust boundaries, server protections, known gaps
- `docs/graceful-reconnection.md` — Reconnection state machine, grace period, module responsibilities
- `docs/room-state-machine.md` — Server room state (`roomState` transitions, `return_to_select` vs `disconnect`)
- `docs/e2e-testing.md` — E2E multiplayer testing framework (autoplay, FightRecorder, Playwright)
- `docs/rfcs/0001-networking-redesign.md` — Full networking rewrite RFC (Phases 1-4 complete, Phase 5 optional)
- `docs/rfcs/0002-multiplayer-redesign.md` — Multiplayer architecture redesign (Phases 1, 2A, 2B, 3 complete, Phase 4 next)
- `docs/rfcs/0004-authentication-redesign-vercel.md` — Authentication & persistence (Supabase + Vercel)
- `docs/rfcs/0005-multiplayer-debuggability.md` — Multiplayer debuggability (Phases 1-4 complete)
- `docs/rfcs/0006-fix-p1-no-rollback.md` — Fix P1 never rolls back
- `docs/rfcs/0007-fix-desync-detection.md` — Fix desync detection between peers with different RTT
- `docs/rfcs/0009-e2e-remote-browser-testing.md` — Remote browser E2E testing via BrowserStack
- `docs/rfcs/0011-auto-upload-debug-bundles.md` — Auto-upload debug bundles to object storage
- `docs/rfcs/0012-e2e-bot-user.md` — E2E bot user for debug bundle uploads (proposed)
- `docs/rfcs/0013-fighter-balance-simulation.md` — Headless AI-vs-AI balance simulation pipeline
- `docs/rfcs/0014-fix-desync-adaptive-delay-gap.md` — Fix desync from adaptive input delay frame gaps
- `docs/rfcs/0015-local-multiplayer-tournament.md` — Local multiplayer tournament + VS Local (N human players, split keyboard)

## Balance Simulation

Headless pipeline that runs AI-vs-AI fights to identify overpowered/underpowered fighters. Uses the pure simulation layer (no Phaser) with seeded AIController for deterministic, reproducible results.

- **Scripts**: `scripts/balance-sim/` — adapter, match runner, report generator, CLI
- **Key adapter**: `ai-input-adapter.js` reads `AIController.decision` and converts to encoded inputs for `tick()`
- **Output**: `balance-report.json` (machine-readable) + `balance-report.md` (tier list, heatmap, outliers)
- **Default**: 100 fights per matchup × 289 matchups = 28,900 fights, completes in ~20 seconds

## Local Multiplayer (RFC 0015)

- **VS Local**: 2-player quick match from TitleScene via MultiplayerMenuScene. Split keyboard: P1 = WASD + FGCVT, P2 = Arrows + IOKLP.
- **Tournament**: 1–8 human players in a bracket. Sequential fighter selection, no duplicate fighters.
- **Input profiles** (`packages/game/src/systems/InputProfiles.js`): `keyboard_full` (single player), `keyboard_left` (P1 in 2P), `keyboard_right` (P2 in 2P). `InputManager` accepts `profileId` parameter.
- **TournamentManager**: `humanFighterIds` array tracks N humans. `getNextPlayableMatch()` routes matches. `isHumanVsHuman()` triggers split keyboard in FightScene.
- **matchContext.isHumanVsHuman**: set per-match by BracketScene when both fighters are human.
- **matchContext.type === 'versus'**: signals VS Local mode — FightScene creates two InputManagers.
- Humans are seeded in separate bracket segments so they meet as late as possible.
- When all humans are eliminated, remaining bracket is auto-simulated.

## Online Multiplayer

- PartyKit server at `apps/party/server.js`, max 2 players per room (pure relay, no game logic, TURN credential endpoint)
- **Network modules** in `packages/game/src/systems/net/`: SignalingClient (WebSocket), TransportManager (WebRTC + TURN), InputSync (buffers), ConnectionMonitor (ping/RTT), SpectatorRelay, NetworkFacade (composes all, same API as old NetworkManager)
- **Cloudflare TURN**: TURN key created via Cloudflare dashboard, credentials stored as PartyKit env vars (`CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`). Server endpoint `/turn-creds` generates short-lived ICE credentials. Enables P2P behind symmetric NAT (mobile carriers).
- **Rollback netcode** (GGPO-style): both peers run identical simulations locally with zero perceived input lag
- **Event-driven presentation** (Phase 3): `tick()` returns `{ state, events, roundEvent }`. `AudioBridge` and `VFXBridge` consume events for audio/VFX — no direct `audioManager.play()` or `cameras.main.shake()` in simulation code. During rollback resimulation, events are discarded (no `_muteEffects` flag).
- **Deferred round events**: `tick()` returns round events as part of the events array (`round_ko`, `round_timeup`). P1 handles from `advance()` return. P2 receives via `onRoundEvent` network handler. Both route through bridges.
- Input prediction: repeat last movement, zero attack buttons. Rollback + re-simulate on misprediction (max 7 frames)
- Fixed timestep: `FIXED_DELTA = 16.667ms` for deterministic online simulation
- Input encoding: 9 booleans packed as single integer (bits 0-8) via `InputBuffer.js`
- Fighter timers are deterministic (no `scene.time.delayedCall` in simulation path)
- `CombatSystem.tickTimer()` counts frames (60 frames = 1 second), returns `{ timeup: true }` instead of calling `timeUp()` directly
- `CombatSystem.checkHit()` returns `{ hit, ko }` on hit — pure delegation to CombatSim, no side effects
- `Fighter.syncSprite()` handles position, flip, and state-driven tints (block blue, special yellow)
- Checksum compares confirmed frames (`currentFrame - maxRollbackFrames - 1`) to avoid false positives from predicted inputs
- WebSocket inputs always accepted regardless of DataChannel state (resilient to asymmetric WebRTC reconnection)
- Spectators receive P1 sync snapshots (same as old model, no rollback)
- URL join: `?room=XXXX` skips title, goes directly to LobbyScene
- `bun run party:dev` for local dev, `bun run party:deploy` to deploy

## Multiplayer Debuggability (RFC 0005)

- **Logger** (`packages/game/src/systems/Logger.js`): Static singleton with levels OFF/ERROR/WARN/INFO/DEBUG/TRACE, per-module tags, 256-entry ring buffer. Zero overhead when OFF. All net modules instrumented.
- **MatchTelemetry** (`packages/game/src/systems/MatchTelemetry.js`): Always-on counters (rollbacks, desyncs, RTT samples, transport changes). Wired in `_setupOnlineMode()`.
- **Debug mode**: `?debug=1` URL param or triple-tap top-right corner. Activates FightRecorder for real matches, verbose logging, debug overlay.
- **DebugOverlay** (`packages/game/src/systems/DebugOverlay.js`): Bottom-left HUD showing RTT, transport mode, rollback stats, match state. Tap to expand. Spanish labels.
- **DebugBundleExporter** (`packages/game/src/systems/DebugBundleExporter.js`): Generates v2 bundles with FightRecorder data + Logger ring buffer + MatchTelemetry + environment info. Supports clipboard copy and file download.
- **1-click bundle collection**: "Exportar Todo" collects bundles from both peers + server `/diagnostics` endpoint. Uses `debug_request`/`debug_response` message relay.
- **Session ID**: Generated in SignalingClient, passed as PartySocket query param, included in all server logs and debug bundles for client-server correlation.
- **Server logging**: `apps/party/server.js` uses structured JSON logging (`_log()` method) with ring buffer. State transitions, connect/disconnect, rejoin, rate limits all logged.
- **Server diagnostics**: `GET /parties/main/{roomId}/diagnostics` returns room state, players, event log. Token-protected via `DIAG_TOKEN` env var.

## Debug Bundle Auto-Upload (RFC 0011)

- **Fight ID**: UUID generated in PartyKit server when both players ready, included in `start` message, stored in `FightRecorder.log.fightId`.
- **Auto-upload**: In debug mode, both peers independently upload debug bundles per-round and at match end via `POST /api/debug-bundles`.
- **Storage interface** (`api/_lib/storage.js`): Pluggable backend — `STORAGE_BACKEND=local` (filesystem, dev) or `STORAGE_BACKEND=supabase` (Supabase Storage, prod). Path: `{fightId}/p{slot}_round{round}.json`.
- **Fights table**: `packages/db/migrations/20260401000000_create_fights.sql` — tracks all online fights with player IDs, fighters, stage, result, debug bundle status/TTL.
- **Admin panel**: Preact SPA at `/admin/` (CDN imports, no build step). Protected by `is_admin` column on profiles table. `withAdmin()` middleware in `api/_lib/handler.js`.
- **Admin API**: `GET /api/admin/fights` (paginated, filterable), `GET /api/admin/debug-bundle` (download).
- **TTL cleanup**: Vercel Cron daily at 3 AM UTC (`api/cron/cleanup-bundles.js`), deletes bundles older than 7 days.

## CRITICAL: Keep this file updated

You are co-owner of this project. Treat this codebase like your own — update CLAUDE.md on the fly as
architecture evolves, decisions are made, or conventions are established. This file is your memory —
if it's wrong or stale, you'll make wrong decisions next session.
