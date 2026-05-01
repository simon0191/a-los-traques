# Cloudflare Email Routing for alostraques.com.
#
# Forwards specific addresses listed in var.email_forwards to their mapped
# destinations via Cloudflare's hosted MX servers. Free, but every distinct
# destination must be verified out-of-band: after `terraform apply`, Cloudflare
# emails each recipient a confirmation link — mail won't actually forward to a
# given destination until that link is clicked.
#
# Prerequisite: Email Routing must be enabled on the zone via the Cloudflare
# dashboard (Email → Email Routing → "Get started"). That one-click activation
# adds the required MX + SPF DNS records under Cloudflare's management. We do
# not enable it from terraform because the POST /zones/{id}/email/routing/dns
# endpoint sits behind a permission group that isn't exposed to scoped API
# tokens reliably (403s even with "Email Routing Rules Write"). Once enabled,
# the rule and address endpoints below work with the standard scoped token.

# Verified destination addresses. Account-scoped (one entry per recipient,
# reusable across zones in the same Cloudflare account). One resource per
# distinct value in the map — multiple rules forwarding to the same inbox share
# a single verified address.
resource "cloudflare_email_routing_address" "destinations" {
  for_each = toset(values(var.email_forwards))

  account_id = var.cloudflare_account_id
  email      = each.value
}

# One forwarding rule per (local-part → destination) entry in the map.
# Matcher is a literal `to` field comparison; everything not listed is rejected
# (no catch-all). Rule names are descriptive so they're readable in the
# Cloudflare dashboard.
resource "cloudflare_email_routing_rule" "forwards" {
  for_each = var.email_forwards

  zone_id  = var.cloudflare_zone_id
  enabled  = true
  name     = "${each.key}@${var.domain} → ${each.value}"
  priority = 0

  matchers = [{
    type  = "literal"
    field = "to"
    value = "${each.key}@${var.domain}"
  }]

  actions = [{
    type  = "forward"
    value = [each.value]
  }]

  depends_on = [cloudflare_email_routing_address.destinations]
}
