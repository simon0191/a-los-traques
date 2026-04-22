#!/usr/bin/env bash
# One-time import of the pre-existing Vercel project (and its domain
# bindings) into Terraform state. Run this once against the live project,
# then `terraform apply` reconciles build settings and env vars.
#
# Prerequisites:
#   - tfstateproxy running (see CLAUDE.md)
#   - ./init-tfvars.sh already ran
#   - op CLI authenticated
#
# Safe to re-run: each `terraform import` is skipped if the target is
# already tracked in state.

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v op >/dev/null 2>&1; then
  echo "error: 1Password CLI (\`op\`) not on PATH" >&2
  exit 1
fi

PROJECT_ID="$(op read "op://a-los-traques/6wlocezvrxylct5jf3cewn2tea/project_id")"
DOMAIN="${DOMAIN:-alostraques.com}"

import_if_missing() {
  local resource="$1"
  local target_id="$2"
  if terraform state show "$resource" >/dev/null 2>&1; then
    echo "→ $resource already in state"
    return 0
  fi
  echo "→ importing $resource ($target_id)"
  terraform import "$resource" "$target_id"
}

echo "== project =="
import_if_missing "vercel_project.web" "$PROJECT_ID"

echo "== domain bindings =="
import_if_missing "vercel_project_domain.apex" "$PROJECT_ID/$DOMAIN"
import_if_missing "vercel_project_domain.www"  "$PROJECT_ID/www.$DOMAIN"

echo
echo "Done. Next:"
echo "  1. Check \`terraform plan\` — expect drift on build settings"
echo "     (root_directory, install_command, build_command)."
echo "  2. If any env vars from vercel.tf already exist in the Vercel"
echo "     dashboard with those keys, delete them there first — Terraform"
echo "     will recreate them on apply with the values from terraform.auto.tfvars."
echo "  3. \`terraform apply\`"
