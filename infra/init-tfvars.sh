#!/usr/bin/env bash
# Generates terraform.auto.tfvars from 1Password secrets using the op CLI.
# Usage: ./init-tfvars.sh
set -euo pipefail

TFVARS_FILE="$(dirname "$0")/terraform.auto.tfvars"

cat > "$TFVARS_FILE" <<EOF
cloudflare_api_token      = "$(op read "op://a-los-traques/k2v5rzytg527mgvkiegxzupmcq/credential")"
cloudflare_zone_id        = "$(op read "op://a-los-traques/k2v5rzytg527mgvkiegxzupmcq/zone_id")"

vercel_api_token          = "$(op read "op://a-los-traques/6wlocezvrxylct5jf3cewn2tea/credential")"

supabase_access_token     = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/credential")"
supabase_project_ref      = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/project_id")"

# App runtime env vars — fed into the Vercel project by vercel.tf.
# Database/auth items live under the same Supabase 1Password item;
# cron_secret is a standalone random string stored in the same item.
database_url              = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/database_url")"
supabase_url              = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/project_url")"
supabase_anon_key         = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/anon_key")"
supabase_jwt_secret       = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/jwt_secret")"
supabase_service_role_key = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/service_role_key")"
cron_secret               = "$(op read "op://a-los-traques/wj2elyoqu355i55oupxgmam3uy/cron_secret")"
EOF

echo "Wrote $TFVARS_FILE"
