# Infrastructure (Terraform)

Manages DNS, domain, and auth settings for `alostraques.com` via Terraform.

## Resources

| Provider | Resource | Purpose |
|----------|----------|---------|
| Cloudflare | `cloudflare_dns_record.apex` | CNAME `@` → `cname.vercel-dns.com` |
| Cloudflare | `cloudflare_dns_record.www` | CNAME `www` → `cname.vercel-dns.com` |
| Vercel | `vercel_project_domain.apex` | Binds `alostraques.com` to project |
| Vercel | `vercel_project_domain.www` | Redirects `www` → apex (308) |
| Supabase | `supabase_settings.auth` | Sets site_url + OAuth redirect allowlist |

## State Backend

State is stored in 1Password via [tfstateproxy](https://github.com/simon0191/tfstateproxy).
Start the proxy before running any Terraform commands:

```bash
tfstateproxy serve --backend onepassword --op-vault <vault-name>
```

## Secrets

All secrets come from 1Password. Run `./init-tfvars.sh` to generate `terraform.auto.tfvars` using the `op` CLI.

The tfvars file is gitignored. Never commit it.

## Commands

```bash
./init-tfvars.sh       # Generate terraform.auto.tfvars from 1Password
terraform init         # Install providers (run once or after provider changes)
terraform plan         # Preview changes
terraform apply        # Apply changes
```

## DNS Setup

Cloudflare is DNS-only (`proxied = false`). Vercel handles SSL via auto-provisioned Let's Encrypt certificates. No Cloudflare proxy/CDN in the path.

## OAuth Redirect Allowlist

Managed in `supabase.tf`. Current entries:
- `https://alostraques.com/**` (production)
- `https://www.alostraques.com/**` (www)
- `https://a-los-traques.vercel.app/**` (Vercel default domain)
- `https://a-los-traques-*.vercel.app/**` (Vercel preview deploys)
- `http://localhost:5173/**` (local dev)
