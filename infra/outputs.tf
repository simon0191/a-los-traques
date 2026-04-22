output "apex_domain" {
  value = vercel_project_domain.apex.domain
}

output "www_domain" {
  value = vercel_project_domain.www.domain
}

output "dns_apex_record_id" {
  value = cloudflare_dns_record.apex.id
}

output "dns_www_record_id" {
  value = cloudflare_dns_record.www.id
}

output "vercel_project_id" {
  description = "Vercel project id for apps/web — useful for CLI scripts (vercel CLI, deploy hooks)."
  value       = vercel_project.web.id
}
