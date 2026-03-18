# A Los Traques

Street Fighter-style fighting game starring 16 real friends. iPhone 15 landscape Safari target.
480x270 internal resolution, Phaser 3 + Vite, ES6 modules, all UI text in Spanish.

## Build & Run

```bash
npm run dev          # Vite dev server
npm run party:dev    # PartyKit dev server (port 1999)
npx vite build       # Production build (Phaser chunk size warning is expected)
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
- **Reference chain**: photo → golden reference → first idle frame → previous frame (motion continuity)
- **Facing**: sprites must face RIGHT. Gemini ignores this ~30% of the time. Manual QA + ImageMagick `-flop` to fix
- **Frame sizes**: 128x128 per frame, assembled into horizontal strip PNGs
- **Requires**: `GEMINI_API_KEY` environment variable

### Adding a new fighter with sprites
1. Add photo to `assets/photos/{id}.jpg`
2. Create manifests: `reference_{id}.json` and `fighter_{id}.json`
3. Run `/generate-fighter {id}`
4. Add fighter ID to `FIGHTERS_WITH_SPRITES` in `src/scenes/BootScene.js` and `src/scenes/InspectorScene.js`

### Animation frame counts
idle(4), walk(4), light_punch(4), heavy_punch(5), light_kick(4), heavy_kick(5), special(5), block(2), hurt(3), knockdown(4), victory(4), defeat(3), jump(3)

## Fighter Entity

- Sprites face RIGHT natively. `setFlipX(!this.facingRight)` handles mirroring.
- Attack animation framerate is dynamic: `spriteFrames / attackDuration * 1000` fps, so animations complete within the gameplay cooldown window.
- `_prevAnimState` tracks animation to avoid re-triggering. Set to `null` on attack to force replay.
- `hasAnims` flag checked before playing animations (falls back to static sprite for placeholder fighters).

## Online Multiplayer

- PartyKit server at `party/server.js`, max 2 players per room
- Host-authoritative: P1 (slot 0) runs hit detection + timer, sends sync every 3 frames
- URL join: `?room=XXXX` skips title, goes directly to LobbyScene
- `npm run party:dev` for local dev, `npm run party:deploy` to deploy
