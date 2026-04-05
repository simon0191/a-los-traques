terraform {
  required_version = ">= 1.5"

  backend "http" {
    address        = "http://localhost:8080/state/a-los-traques"
    lock_address   = "http://localhost:8080/state/a-los-traques"
    unlock_address = "http://localhost:8080/state/a-los-traques"
    lock_method    = "LOCK"
    unlock_method  = "UNLOCK"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 4.0"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "vercel" {
  api_token = var.vercel_api_token
}

provider "supabase" {
  access_token = var.supabase_access_token
}
