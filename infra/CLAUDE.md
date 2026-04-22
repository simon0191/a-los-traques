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

## One-time: import the pre-existing Vercel project

Before this file, only the domain bindings were in Terraform — the project
itself was dashboard-managed. Bring it under Terraform control with:

```bash
./import.sh            # Imports vercel_project.web + both vercel_project_domain.*
```

What the script does:

1. Reads the existing project ID from 1Password (same item as
   `vercel_api_token`).
2. `terraform import vercel_project.web <project-id>`.
3. `terraform import vercel_project_domain.apex <project-id>/alostraques.com`.
4. `terraform import vercel_project_domain.www  <project-id>/www.alostraques.com`.
5. Skips anything already in state — safe to re-run.

**Env vars are not imported** — they're always rewritten from
`terraform.auto.tfvars` on apply. If the project already has the keys
`DATABASE_URL`, `SUPABASE_*`, `CRON_SECRET`, `STORAGE_BACKEND`, or
`NEXT_PUBLIC_PARTYKIT_HOST` set in the dashboard, delete them there before
the first apply so Vercel doesn't reject the create. Any values Terraform
doesn't track (say, a hand-added `DEBUG_FLAG`) are left alone.

After the import:

```bash
terraform plan         # Expect drift on root_directory, install_command,
                       # build_command, and N new env vars.
terraform apply
```

**Alternative — start fresh** (simpler, but loses deploy history and the
domain re-verifies): delete the old project in the Vercel dashboard, skip
`./import.sh`, and run `terraform apply` directly. DNS already points at
`cname.vercel-dns.com` so the domain verifies automatically.

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
