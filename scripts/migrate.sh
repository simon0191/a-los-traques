#!/usr/bin/env bash
# Thin dbmate wrapper pointed at the packages/db workspace.
# Keeps `bun run migrate` working from the repo root after the monorepo reshuffle.
set -euo pipefail

export DBMATE_MIGRATIONS_DIR="${DBMATE_MIGRATIONS_DIR:-packages/db/migrations}"
exec dbmate "$@"
