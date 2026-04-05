# Apex domain binding
resource "vercel_project_domain" "apex" {
  project_id = var.vercel_project_id
  domain     = var.domain
}

# www -> apex redirect (308 permanent)
resource "vercel_project_domain" "www" {
  project_id           = var.vercel_project_id
  domain               = "www.${var.domain}"
  redirect             = vercel_project_domain.apex.domain
  redirect_status_code = 308
}
