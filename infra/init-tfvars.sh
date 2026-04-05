#!/usr/bin/env bash
# Generates terraform.auto.tfvars from 1Password secrets using the op CLI.
# Usage: ./init-tfvars.sh
set -euo pipefail

TFVARS_FILE="$(dirname "$0")/terraform.auto.tfvars"

cat > "$TFVARS_FILE" <<EOF
cloudflare_api_token  = "$(op read "op://a-los-traques/k2v5rzytg527mgvkiegxzupmcq/credential")"
cloudflare_zone_id    = "$(op read "op://a-los-traques/k2v5rzytg527mgvkiegxzupmcq/zone_id")"
vercel_api_token      = "$(op read "op://a-los-traques/6wlocezvrxylct5jf3cewn2tea/credential")"
vercel_project_id     = "$(op read "op://a-los-traques/6wlocezvrxylct5jf3cewn2tea/project_id")"
supabase_access_token = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/credential")"
supabase_project_ref  = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/project_id")"
EOF

echo "Wrote $TFVARS_FILE"
