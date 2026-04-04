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
