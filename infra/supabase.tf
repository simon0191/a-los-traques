resource "supabase_settings" "auth" {
  project_ref = var.supabase_project_ref

  auth = jsonencode({
    site_url = "https://${var.domain}"
    uri_allow_list = join(",", [
      "https://${var.domain}/**",
      "https://www.${var.domain}/**",
      "https://a-los-traques.vercel.app/**",
      "https://a-los-traques-*.vercel.app/**",
      # Local dev is Next.js on :3000 post-monorepo (was Vite on :5173).
      "http://localhost:3000/**",
    ])
  })
}
