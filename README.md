# A Los Traques

A Street Fighter-style fighting game starring 16 real friends as playable characters. Built as a collaborative art experiment and hobby project.

480x270 internal resolution, optimized for iPhone 15 landscape Safari. All UI text in Spanish.

## Features

- **16 playable fighters** with unique stats, moves, and AI-generated pixel art sprites
- **8 stages** with hand-crafted and animated backgrounds
- **Local multiplayer** -- VS mode (split keyboard) and bracket tournaments for up to 8 players
- **Online multiplayer** -- peer-to-peer with GGPO-style rollback netcode, WebRTC data channels, and TURN fallback
- **AI opponents** with configurable difficulty
- **Balance simulation** -- headless AI-vs-AI pipeline to tune fighter stats
- **Authentication & persistence** -- Supabase auth + Vercel Functions backend with fight history and debug bundles

## Tech Stack

- **Engine**: [Phaser 3](https://phaser.io/) (ES6 modules)
- **Bundler**: [Vite](https://vite.dev/)
- **Multiplayer server**: [PartyKit](https://partykit.io/)
- **Backend**: [Vercel Functions](https://vercel.com/docs/functions)
- **Auth**: [Supabase](https://supabase.com/) (JWT)
- **Database**: PostgreSQL, managed with [dbmate](https://github.com/amacneil/dbmate)
- **Asset generation**: [Gemini](https://ai.google.dev/) image generation + ImageMagick
- **Linting**: [Biome](https://biomejs.dev/)
- **Testing**: [Vitest](https://vitest.dev/) (unit), [Playwright](https://playwright.dev/) (E2E)
- **Runtime**: [Bun](https://bun.sh/)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [dbmate](https://github.com/amacneil/dbmate) (for database migrations)

### Install

```bash
bun install
```

### Run

```bash
# Full multiplayer dev (fake auth + PGLite + Vite + Vercel Dev + PartyKit)
bun run dev:mp

# Vite + Vercel Dev (no multiplayer server)
bun run dev:all

# Vite dev server only (single player)
bun run dev
```

In multiplayer dev mode, log in as `p1@test.local` or `p2@test.local` (password: `password`).

### Test

```bash
bun test              # Unit tests (watch mode)
bun run test:run      # Unit tests (single run, CI)
bun run test:e2e      # E2E multiplayer tests (headless)
bun run test:e2e:headed  # E2E with visible browsers
```

### Lint

```bash
bun run lint          # Check
bun run lint:fix      # Auto-fix
```

### Build

```bash
bunx vite build
```

## Project Structure

```
src/
  scenes/         # Game scenes (Boot, Title, Select, Fight, Victory, etc.)
  entities/       # Fighter (Phaser wrapper) + combat block logic
  simulation/     # Pure simulation core (no Phaser dependency)
  systems/        # Combat, input, audio, VFX, AI, logging, debug overlay
    net/          # Networking modules (signaling, transport, input sync, rollback)
  services/       # Tournament manager, UI service, API client
  data/           # fighters.json, stages.json
party/            # PartyKit multiplayer server
api/              # Vercel Functions (profile, stats, debug bundles, admin)
db/               # Database migrations (dbmate)
scripts/
  asset-pipeline/ # Gemini-based sprite generation
  balance-sim/    # Headless AI-vs-AI balance simulation
tests/            # Unit and E2E tests
docs/             # Architecture docs and RFCs
```

## Balance Simulation

Run headless AI-vs-AI fights to evaluate fighter balance:

```bash
bun run balance                          # Full 16x16 matrix (25,600 fights)
bun run balance -- --fights=50           # Fewer fights per matchup
bun run balance -- --p1=simon --p2=jeka  # Single matchup
```

Outputs a tier list, win-rate heatmap, and outlier analysis.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Dual-licensed. Code under [MIT](LICENSE), assets under [CC BY-SA 4.0](LICENSE). See [LICENSE](LICENSE) for details.
