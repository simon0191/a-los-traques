resource "supabase_settings" "auth" {
  project_ref = var.supabase_project_ref

  auth = jsonencode({
    site_url             = "https://${var.domain}"
    uri_allow_list       = join(",", [
      "https://${var.domain}/**",
      "https://www.${var.domain}/**",
      "https://a-los-traques.vercel.app/**",
      "https://a-los-traques-*.vercel.app/**",
      "http://localhost:5173/**",
    ])
  })
}
