# ---------------------------------------------------------------------------
# apps/web — Next.js on Vercel
# ---------------------------------------------------------------------------

# Vercel runs `next build` inside `apps/web/`. Workspace deps resolve because
# `install_command` cd's back to the repo root. The package.json prebuild
# hook regenerates `packages/game/src/data/music-manifest.js` before the
# Next build starts.
resource "vercel_project" "web" {
  team_id   = var.vercel_team_id
  name      = "a-los-traques"
  framework = "nextjs"

  root_directory             = "apps/web"
  serverless_function_region = "iad1"
  node_version               = "22.x"

  # bun workspaces live at the repo root — install from there so
  # @alostraques/* symlinks resolve inside apps/web.
  install_command  = "cd ../.. && bun install"
  build_command    = "bun run build"
  output_directory = ".next"

  # Auto-deploy wiring. Vercel's GitHub app watches this repo; merges to
  # `production_branch` get promoted to https://alostraques.com, every other
  # branch / PR gets a preview URL (auto-cleaned when the PR closes).
  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }
}

# ---------------------------------------------------------------------------
# Environment variables — applied to Production + Preview so PR previews can
# actually reach Supabase. `sensitive = true` hides them from `terraform plan`
# output and the Vercel UI's plain-text view.
# ---------------------------------------------------------------------------

locals {
  web_env_targets = ["production", "preview"]
}

resource "vercel_project_environment_variable" "database_url" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "DATABASE_URL"
  value      = var.database_url
  target     = local.web_env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "supabase_jwt_secret" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "SUPABASE_JWT_SECRET"
  value      = var.supabase_jwt_secret
  target     = local.web_env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "supabase_project_id" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "SUPABASE_PROJECT_ID"
  value      = var.supabase_project_ref
  target     = local.web_env_targets
}

resource "vercel_project_environment_variable" "supabase_url" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "SUPABASE_URL"
  value      = var.supabase_url
  target     = local.web_env_targets
}

resource "vercel_project_environment_variable" "supabase_anon_key" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "SUPABASE_ANON_KEY"
  value      = var.supabase_anon_key
  target     = local.web_env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "supabase_service_role_key" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "SUPABASE_SERVICE_ROLE_KEY"
  value      = var.supabase_service_role_key
  target     = local.web_env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "storage_backend" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "STORAGE_BACKEND"
  value      = "supabase"
  target     = local.web_env_targets
}

resource "vercel_project_environment_variable" "cron_secret" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "CRON_SECRET"
  value      = var.cron_secret
  target     = ["production"]
  sensitive  = true
}

# NEXT_PUBLIC_ vars are inlined into the client bundle at build time, so they
# must be set before `next build` runs — which is why they live here, not in
# the app code.
resource "vercel_project_environment_variable" "next_public_partykit_host" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  key        = "NEXT_PUBLIC_PARTYKIT_HOST"
  value      = var.partykit_host
  target     = local.web_env_targets
}

# ---------------------------------------------------------------------------
# Domain bindings
# ---------------------------------------------------------------------------

resource "vercel_project_domain" "apex" {
  team_id    = var.vercel_team_id
  project_id = vercel_project.web.id
  domain     = var.domain
}

# www -> apex redirect (308 permanent)
resource "vercel_project_domain" "www" {
  team_id              = var.vercel_team_id
  project_id           = vercel_project.web.id
  domain               = "www.${var.domain}"
  redirect             = vercel_project_domain.apex.domain
  redirect_status_code = 308
}
