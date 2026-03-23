terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  # Authenticates via CLOUDFLARE_API_TOKEN env var
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

# Cloudflare TURN app — generates a key ID + bearer token
# for WebRTC NAT traversal (mobile carriers, corporate WiFi)
resource "cloudflare_calls_turn_app" "turn" {
  account_id = var.cloudflare_account_id
  name       = "a-los-traques-turn"
}

# These outputs are used as PartyKit env vars:
#   npx partykit env add CLOUDFLARE_TURN_KEY_ID "$(terraform output -raw turn_key_id)"
#   npx partykit env add CLOUDFLARE_TURN_API_TOKEN "$(terraform output -raw turn_api_token)"
output "turn_key_id" {
  description = "TURN key ID — set as CLOUDFLARE_TURN_KEY_ID in PartyKit"
  value       = cloudflare_calls_turn_app.turn.uid
}

output "turn_api_token" {
  description = "TURN bearer token — set as CLOUDFLARE_TURN_API_TOKEN in PartyKit"
  value       = cloudflare_calls_turn_app.turn.key
  sensitive   = true
}
