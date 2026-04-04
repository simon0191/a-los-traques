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

variable "vercel_project_id" {
  description = "Vercel project ID for a-los-traques"
  type        = string
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

# --- Domain ---

variable "domain" {
  description = "The apex domain"
  type        = string
  default     = "alostraques.com"
}
