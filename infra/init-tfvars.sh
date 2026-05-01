#!/usr/bin/env bash
# Generates terraform.auto.tfvars from 1Password secrets using the op CLI.
# Usage: ./init-tfvars.sh
#
# 1Password items (item title / field) in the vault below:
#   alostraques.cloudflare.com / api_token, zone_id, account_id
#   alostraques.vercel.com     / api_token, project_id
#   alostraques.supabase.com   / access_token, project_ref, database_url,
#                                project_url, anon_key, jwt_secret,
#                                service_role_key
#   alostraques.com            / cron_secret, email_forwards
#
# The `email_forwards` 1Password field is a multiline string containing a raw
# HCL map literal — it is splatted into tfvars unquoted. Example contents:
#   {
#     hello = "you@example.com"
#     admin = "you@example.com"
#   }
set -euo pipefail

TFVARS_FILE="$(dirname "$0")/terraform.auto.tfvars"
OP_ACCOUNT="${OP_ACCOUNT:-my.1password.com}"
OP_VAULT="${OP_VAULT:-ok7w54ncq6rqp4q73guhs4t7lq}"

op_read() { op read --account "$OP_ACCOUNT" "op://$OP_VAULT/$1"; }

cat > "$TFVARS_FILE" <<EOF
cloudflare_api_token      = "$(op_read "alostraques.cloudflare.com/api_token")"
cloudflare_zone_id        = "$(op_read "alostraques.cloudflare.com/zone_id")"
cloudflare_account_id     = "$(op_read "alostraques.cloudflare.com/account_id")"

vercel_api_token          = "$(op_read "alostraques.vercel.com/api_token")"

supabase_access_token     = "$(op_read "alostraques.supabase.com/access_token")"
supabase_project_ref      = "$(op_read "alostraques.supabase.com/project_ref")"

# App runtime env vars — fed into the Vercel project by vercel.tf.
database_url              = "$(op_read "alostraques.supabase.com/database_url")"
supabase_url              = "$(op_read "alostraques.supabase.com/project_url")"
supabase_anon_key         = "$(op_read "alostraques.supabase.com/anon_key")"
supabase_jwt_secret       = "$(op_read "alostraques.supabase.com/jwt_secret")"
supabase_service_role_key = "$(op_read "alostraques.supabase.com/service_role_key")"
cron_secret               = "$(op_read "alostraques.com/cron_secret")"
email_forwards            = $(op_read "alostraques.com/email_forwards")
EOF

echo "Wrote $TFVARS_FILE"
