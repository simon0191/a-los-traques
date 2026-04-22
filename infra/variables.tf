# --- Cloudflare ---

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS edit permissions for the zone"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for alostraques.com"
  type        = string
}

# --- Vercel ---

variable "vercel_api_token" {
  description = "Vercel API token"
  type        = string
  sensitive   = true
}

variable "vercel_team_id" {
  description = "Vercel team ID (optional — leave empty for personal account)"
  type        = string
  default     = null
}

# --- GitHub ---

variable "github_repo" {
  description = "GitHub repo in owner/name form, used by Vercel's Git integration for auto-deploys"
  type        = string
  default     = "simon0191/a-los-traques"
}

# --- Supabase ---

variable "supabase_access_token" {
  description = "Supabase access token (from supabase.com/dashboard/account/tokens)"
  type        = string
  sensitive   = true
}

variable "supabase_project_ref" {
  description = "Supabase project ref (subdomain from your-project.supabase.co)"
  type        = string
}

# --- App runtime secrets (fed into apps/web as env vars) ---

variable "database_url" {
  description = "Postgres connection string (prod uses the Supabase pooler, port 6543, pgbouncer=true)"
  type        = string
  sensitive   = true
}

variable "supabase_url" {
  description = "Public Supabase URL (https://<ref>.supabase.co)"
  type        = string
}

variable "supabase_anon_key" {
  description = "Supabase anon key — safe for the browser bundle but still treat as sensitive"
  type        = string
  sensitive   = true
}

variable "supabase_jwt_secret" {
  description = "Supabase JWT secret (HS256 fast path for withAuth/withAdmin)"
  type        = string
  sensitive   = true
}

variable "supabase_service_role_key" {
  description = "Supabase service-role key — used server-side for debug-bundle storage"
  type        = string
  sensitive   = true
}

variable "cron_secret" {
  description = "Bearer token Vercel Cron sends to /api/cron/cleanup-bundles"
  type        = string
  sensitive   = true
}

variable "partykit_host" {
  description = "PartyKit signaling host — exposed to the browser as NEXT_PUBLIC_PARTYKIT_HOST"
  type        = string
  default     = "a-los-traques.simon0191.partykit.dev"
}

# --- Domain ---

variable "domain" {
  description = "The apex domain"
  type        = string
  default     = "alostraques.com"
}
