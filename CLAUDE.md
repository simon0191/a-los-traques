# A Los Traques

Street Fighter-style fighting game starring 16 real friends. iPhone 15 landscape Safari target.
480x270 internal resolution, Phaser 3 + Vite, ES6 modules, all UI text in Spanish.

## Build & Run

```bash
bun run dev          # Vite dev server
bun run party:dev    # PartyKit dev server (port 1999)
bunx vite build      # Production build (Phaser chunk size warning is expected)
bun test             # Run tests in watch mode (Vitest)
bun run test:run     # Run tests once (CI)
bun run lint         # Lint + format check (Biome)
bun run lint:fix     # Auto-fix lint + format issues
bun run format       # Format only (auto-fix)
```

## Project Structure

```
src/
  scenes/          # Boot -> Title -> Select -> PreFight -> Fight -> Victory
  entities/        # Fighter.js (sprite + state machine + animation)
  systems/         # CombatSystem, InputManager, TouchControls, AIController, NetworkManager
  data/            # fighters.json (16 fighters), stages.json (5 stages)
  config.js        # Constants (dimensions, ground Y, fighter size 128x128)
assets/
  references/      # Golden reference images for generation pipeline
  photos/          # Source photos of friends (input for generation)
  manifests/       # JSON configs for asset pipeline (fighter_, portrait_, reference_)
  _raw/            # Intermediate files from asset pipeline (not shipped)
public/
  assets/
    fighters/{id}/ # Animation strip PNGs (idle.png, walk.png, etc.)
    portraits/     # Portrait images per fighter
    audio/         # Music, SFX, announcer MP3s
scripts/
  asset-pipeline/  # Gemini-based sprite generation pipeline
party/
  server.js        # PartyKit multiplayer server
tests/
  data/            # fighters.json data validation
  party/           # PartyKit server (slot assignment, rate limiting, routing)
  systems/         # combat-math, collision, AI difficulty
```

## Conventions

- Named exports for all scenes/classes (not default). Exception: `party/server.js` uses default export (PartyKit requirement)
- Import Phaser in any file using Phaser classes
- `fighters.json` uses string IDs, scenes look up by ID with `.find()`
- Placeholder textures: colored rectangles generated in BootScene, used when no real sprites exist
- `gameMode`: `'local'` (vs AI) or `'online'` (vs player) passed through scene chain
- Scenes pass data via `scene.start('SceneName', { p1Id, p2Id, stageId, gameMode, networkManager })`

## Asset Pipeline

Generate fighter sprites via Gemini image generation + ImageMagick post-processing.

### Pipeline types
```bash
node scripts/asset-pipeline/cli.js reference <config.json>  # Golden reference (single pose)
node scripts/asset-pipeline/cli.js fighter <config.json>     # Animation frames
node scripts/asset-pipeline/cli.js portrait <config.json>    # Character portrait
node scripts/asset-pipeline/cli.js stage <config.json>       # Stage background
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
4. Add fighter ID to `FIGHTERS_WITH_SPRITES` in `src/scenes/BootScene.js` and `src/scenes/InspectorScene.js`

### Regenerating an existing fighter
1. Delete stale cache: `rm -rf assets/_raw/fighters/{id}`
2. Delete old output: `rm -f public/assets/fighters/{id}/*.png`
3. If the golden reference changed, delete derivatives: `rm -f assets/references/{id}_ref_*.png` (keep `{id}_ref.png`)
4. Run reference pipeline with `--skip-generate` (reprocesses existing `{id}_ref.png`)
5. Run fighter pipeline, then portrait pipeline

### Animation frame counts
idle(4), walk(4), light_punch(4), heavy_punch(5), light_kick(4), heavy_kick(5), special(5), block(2), hurt(3), knockdown(4), victory(4), defeat(3), jump(3)

## Fighter Entity

- Sprites face RIGHT natively. `setFlipX(!this.facingRight)` handles mirroring.
- Attack animation framerate is dynamic: `spriteFrames / attackDuration * 1000` fps, so animations complete within the gameplay cooldown window.
- `_prevAnimState` tracks animation to avoid re-triggering. Set to `null` on attack to force replay.
- `hasAnims` flag checked before playing animations (falls back to static sprite for placeholder fighters).

## Tests

Vitest, configured in `vitest.config.js`. Tests live in `tests/` (not alongside source).
Pure logic is extracted into small modules (`src/systems/combat-math.js`, `src/entities/combat-block.js`) to enable Phaser-free unit testing.
CI runs via GitHub Actions (`.github/workflows/test.yml`) on PRs and pushes to main — runs lint (Biome) then tests.

## Documentation Diagrams

Excalidraw diagrams in `docs/` document key systems. When making significant changes to a documented system, update the relevant diagram to stay in sync. When adding a major new system or feature, create a new diagram for it.

- Use the `/excalidraw-diagram-skill` skill to create or update diagrams
- Existing diagrams: `docs/rollback-netcode.excalidraw` (rollback netcode architecture), `docs/multiplayer-security.excalidraw` (server hardening)
- Commit both `.excalidraw` and `.png` files together

## Online Multiplayer

- PartyKit server at `party/server.js`, max 2 players per room (pure relay, no game logic)
- **Rollback netcode** (GGPO-style): both peers run identical simulations locally with zero perceived input lag
- P1 authoritative for round events (KO/timeup) only — P2 sets `suppressRoundEvents=true` and receives `round_event` messages
- Input prediction: repeat last movement, zero attack buttons. Rollback + re-simulate on misprediction (max 7 frames)
- Fixed timestep: `FIXED_DELTA = 16.667ms` for deterministic online simulation
- Input encoding: 9 booleans packed as single integer (bits 0-8) via `InputBuffer.js`
- Fighter timers are deterministic (no `scene.time.delayedCall` in simulation path)
- `CombatSystem.tickTimer()` counts frames (60 frames = 1 second) instead of Phaser timer events
- Audio/particles/camera shake suppressed during rollback re-simulation (`muteEffects`)
- Spectators receive P1 sync snapshots (same as old model, no rollback)
- URL join: `?room=XXXX` skips title, goes directly to LobbyScene
- `bun run party:dev` for local dev, `bun run party:deploy` to deploy
