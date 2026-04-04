# Apex domain -> Vercel (DNS-only, Vercel handles SSL)
resource "cloudflare_dns_record" "apex" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  type    = "CNAME"
  content = "cname.vercel-dns.com"
  proxied = false
  ttl     = 300
}

# www subdomain -> Vercel
resource "cloudflare_dns_record" "www" {
  zone_id = var.cloudflare_zone_id
  name    = "www"
  type    = "CNAME"
  content = "cname.vercel-dns.com"
  proxied = false
  ttl     = 300
}
