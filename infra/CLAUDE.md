# Infrastructure (Terraform)

Manages DNS, the Vercel project for `apps/web`, and Supabase auth settings
for `alostraques.com`.

## Resources

| Provider | Resource | Purpose |
|----------|----------|---------|
| Cloudflare | `cloudflare_dns_record.apex` | CNAME `@` → `cname.vercel-dns.com` |
| Cloudflare | `cloudflare_dns_record.www` | CNAME `www` → `cname.vercel-dns.com` |
| Vercel | `vercel_project.web` | apps/web build settings + GitHub auto-deploy |
| Vercel | `vercel_project_environment_variable.*` | Prod + preview env vars (DATABASE_URL, SUPABASE_*, CRON_SECRET, NEXT_PUBLIC_PARTYKIT_HOST, STORAGE_BACKEND) |
| Vercel | `vercel_project_domain.apex` | Binds `alostraques.com` to `vercel_project.web` |
| Vercel | `vercel_project_domain.www` | Redirects `www` → apex (308) |
| Supabase | `supabase_settings.auth` | Sets site_url + OAuth redirect allowlist |

## Auto-deploy

`vercel_project.web.git_repository` wires Vercel's GitHub app at
`simon0191/a-los-traques`. Behavior:

- Merges to `main` → production deploy to `https://alostraques.com`.
- Every other push / PR → preview deploy at a unique `*.vercel.app` URL.
- Closing a PR retires its preview.

No hooks, no workflows. If auto-deploy ever needs to be paused, toggle
**Settings → Git → Ignored Build Step** in the Vercel dashboard instead of
mutating Terraform.

## State Backend

State is stored in 1Password via [tfstateproxy](https://github.com/simon0191/tfstateproxy).
Start the proxy before running any Terraform commands:

```bash
tfstateproxy serve --backend onepassword --op-vault <vault-name>
```

## Secrets

All secrets come from 1Password. Run `./init-tfvars.sh` to generate
`terraform.auto.tfvars` using the `op` CLI. The app runtime secrets
(`DATABASE_URL`, `SUPABASE_*`, `CRON_SECRET`) live alongside
`supabase_project_ref` under the same 1Password item — keep them in sync
when rotating.

The tfvars file is gitignored. Never commit it.

## Commands

```bash
./init-tfvars.sh       # Generate terraform.auto.tfvars from 1Password
terraform init         # Install providers (run once or after provider changes)
terraform plan         # Preview changes
terraform apply        # Apply changes
```

## Migrating from the pre-monorepo project

Before this file, `vercel_project_id` was an external input and only the
domain bindings were managed. The first apply after the monorepo migration
needs one of:

1. **Import the existing project** (keeps deploy history + production domain continuity):
   ```bash
   terraform import vercel_project.web <old-project-id>
   terraform import vercel_project_domain.apex alostraques.com
   terraform import vercel_project_domain.www www.alostraques.com
   # envs need one import each (or let Terraform create them net-new — dashboard
   # entries silently get overwritten):
   terraform import vercel_project_environment_variable.database_url <project-id>/<env-var-id>
   ```
   Grab the env var ids from `vercel env ls` via the CLI.

2. **Start fresh** (simpler, but loses deploy history + domain reverifies):
   - Delete the old project in the Vercel dashboard.
   - Run `terraform apply`.
   - Reconnect `alostraques.com` — Vercel asks to verify; since DNS is already
     pointing at `cname.vercel-dns.com` via `cloudflare_dns_record.apex`, it
     verifies automatically.

## DNS Setup

Cloudflare is DNS-only (`proxied = false`). Vercel handles SSL via
auto-provisioned Let's Encrypt certificates. No Cloudflare proxy/CDN in the
path.

## OAuth Redirect Allowlist

Managed in `supabase.tf`. Current entries:
- `https://alostraques.com/**` (production)
- `https://www.alostraques.com/**` (www)
- `https://a-los-traques.vercel.app/**` (Vercel default domain)
- `https://a-los-traques-*.vercel.app/**` (Vercel preview deploys)
- `http://localhost:3000/**` (local Next.js dev)
