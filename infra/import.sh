#!/usr/bin/env bash
# One-time import of the pre-existing Vercel project (and its domain
# bindings + any pre-existing env vars) into Terraform state. Run once
# against the live project; then `terraform apply` reconciles build
# settings and env var values.
#
# Prerequisites:
#   - tfstateproxy running (see CLAUDE.md)
#   - ./init-tfvars.sh already ran
#   - op CLI + jq + curl authenticated / on PATH
#
# Safe to re-run: each `terraform import` is skipped if the target is
# already tracked in state.

set -euo pipefail

cd "$(dirname "$0")"

for tool in op jq curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: \`$tool\` not on PATH" >&2
    exit 1
  fi
done

OP_ACCOUNT="${OP_ACCOUNT:-my.1password.com}"
OP_VAULT="${OP_VAULT:-ok7w54ncq6rqp4q73guhs4t7lq}"

op_read() { op read --account "$OP_ACCOUNT" "op://$OP_VAULT/$1"; }

PROJECT_ID="$(op_read "alostraques.vercel.com/project_id")"
VERCEL_API_TOKEN="$(op_read "alostraques.vercel.com/api_token")"
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

# Maps Terraform resource name -> env var key as declared in vercel.tf.
# If a key with the same name already exists on Vercel, import it so
# Terraform takes ownership instead of failing with ENV_CONFLICT.
declare -a ENV_RESOURCES=(
  "vercel_project_environment_variable.database_url|DATABASE_URL"
  "vercel_project_environment_variable.supabase_jwt_secret|SUPABASE_JWT_SECRET"
  "vercel_project_environment_variable.supabase_project_id|SUPABASE_PROJECT_ID"
  "vercel_project_environment_variable.supabase_url|SUPABASE_URL"
  "vercel_project_environment_variable.supabase_anon_key|SUPABASE_ANON_KEY"
  "vercel_project_environment_variable.supabase_service_role_key|SUPABASE_SERVICE_ROLE_KEY"
  "vercel_project_environment_variable.storage_backend|STORAGE_BACKEND"
  "vercel_project_environment_variable.cron_secret|CRON_SECRET"
  "vercel_project_environment_variable.next_public_partykit_host|NEXT_PUBLIC_PARTYKIT_HOST"
)

echo "== env vars =="
ENV_LIST_JSON="$(curl -fsSL \
  -H "Authorization: Bearer $VERCEL_API_TOKEN" \
  "https://api.vercel.com/v9/projects/$PROJECT_ID/env?decrypt=false")"

for pair in "${ENV_RESOURCES[@]}"; do
  resource="${pair%%|*}"
  key="${pair##*|}"
  env_id="$(echo "$ENV_LIST_JSON" | jq -r --arg key "$key" '.envs[] | select(.key==$key) | .id' | head -n1)"
  if [[ -z "$env_id" || "$env_id" == "null" ]]; then
    echo "→ $key not yet on Vercel — Terraform will create it"
    continue
  fi
  import_if_missing "$resource" "$PROJECT_ID/$env_id"
done

echo
echo "Done. Next:"
echo "  1. \`terraform plan\` — expect in-place updates on the imported"
echo "     resources (build settings + env var values reconciling to tfvars)."
echo "  2. \`terraform apply\`"
