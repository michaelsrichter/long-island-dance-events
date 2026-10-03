# DNS cutover

This guide moves a site from the Azure default hostname to a production custom domain.

## Before DNS changes

- Full verification passes locally.
- Deployment workflow succeeds on the Azure host.
- `node scripts/smoke.mjs https://<azure-host>` passes.
- OAuth works on the Azure host or is intentionally pending.
- Content is approved.
- Rollback plan is known.

## Recommended domain shape

Use `www.example.org` as the canonical site unless your DNS provider supports apex CNAME flattening reliably.

Common setup:

- Production: `https://www.example.org`
- Apex `example.org`: forwarded/redirected to `https://www.example.org`

## Azure custom domain steps

1. Open the Static Web App in Azure.
2. Go to **Custom domains**.
3. Add `www.example.org`.
4. Azure shows a CNAME target and TXT validation token.
5. Add DNS records.
6. Return to Azure and validate.
7. Wait for managed certificate provisioning.

## DNS records

| Type | Host/name | Value |
| --- | --- | --- |
| CNAME | `www` | `<static-web-app>.azurestaticapps.net` |
| TXT | `_dnsauth.www` | Azure validation token |

TTL can be 300 seconds during cutover, then raised later.

## Namecheap example

In **Advanced DNS**:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME Record | `www` | `<static-web-app>.azurestaticapps.net` | Automatic or 5 min |
| TXT Record | `_dnsauth.www` | `<token>` | Automatic or 5 min |
| URL Redirect Record | `@` | `https://www.example.org/` | Unmasked, if you want apex forwarding |

Namecheap sometimes appends the domain automatically. If Azure asks for `_dnsauth.www.example.org`, the Namecheap host is usually `_dnsauth.www`.

## After domain validates

Update GitHub variables:

```powershell
gh variable set SITE_URL --repo <owner/repo> --body https://www.example.org
gh variable set ALLOW_INDEXING --repo <owner/repo> --body true
```

Update OAuth app:

- Homepage URL: `https://www.example.org`
- Callback URL: `https://www.example.org/api/callback`
- Keep **Expire user access tokens** unchecked.

Update Azure app setting:

```powershell
az staticwebapp appsettings set --name <swa-name> --resource-group <rg> --setting-names ALLOWED_HOSTS=www.example.org,<azure-host>
```

Redeploy.

## Verification

```powershell
curl -I https://www.example.org
node scripts/smoke.mjs https://www.example.org
```

Check:

- HTTPS certificate is valid.
- Canonical links use the production domain.
- `/admin/` sign-in redirects back to the production domain.
- `/sitemap-index.xml` uses production URLs.
- `robots.txt` allows indexing only when ready.
- Key old URLs redirect.

## Rollback

If cutover fails:

1. Set `ALLOW_INDEXING=false` if a broken host is public.
2. Revert DNS records to the previous site or Azure host.
3. Reset `SITE_URL` to the working host.
4. Update OAuth callback back to the working host.
5. Redeploy or rerun the last successful workflow.
6. Document what failed before trying again.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Azure cannot validate domain | TXT host/value wrong or DNS not propagated | Check with `nslookup -type=TXT _dnsauth.www.example.org`. |
| Browser certificate warning | Certificate still provisioning | Wait; verify Azure custom domain status. |
| Site loads but assets fail | Wrong `SITE_URL` or mixed old deployment | Redeploy after variable update. |
| CMS sign-in fails | OAuth callback still old | Update OAuth app and app settings. |
| Apex does not redirect | DNS provider forwarding not configured | Add URL redirect or use provider-specific forwarding. |
| Search indexes Azure host | Indexing enabled before custom domain | Set `ALLOW_INDEXING=false` on non-production and request removal if needed. |
