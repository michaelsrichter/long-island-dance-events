# DNS cutover: longisland.dance

The site's address is **https://longisland.dance** (the "apex" or root domain). `www.longisland.dance` and the Azure address https://black-dune-0e0f3e40f.1.azurestaticapps.net redirect there (301).

Status (October 3, 2026, 6:31 PM): **done.** Both domains are `Ready` with free HTTPS certificates; `longisland.dance` is the default domain; `SITE_URL` is `https://longisland.dance`; smoke test 23/23. Search engines are still blocked until launch.

## Records to add at Namecheap

Namecheap: **Domain List → Manage** next to `longisland.dance` → **Advanced DNS** tab → **Host Records**.

1. Make sure the **Nameservers** setting (Domain tab) is **Namecheap BasicDNS**. Advanced DNS records only work with Namecheap's own nameservers.
2. **Delete** Namecheap's parking records if they are there: the `CNAME Record` for `www` pointing to `parkingpage.namecheap.com`, and any `URL Redirect Record` for `@` or `www`.
3. Click **Add New Record** for each row:

| Type | Host | Value | TTL | Why |
| --- | --- | --- | --- | --- |
| ALIAS Record | `@` | `black-dune-0e0f3e40f.1.azurestaticapps.net` | 5 min | Points longisland.dance at the site |
| CNAME Record | `www` | `black-dune-0e0f3e40f.1.azurestaticapps.net` | Automatic | Points www.longisland.dance at the site |
| TXT Record | `@` | `_fzdvr5dwgoujlnny7jhkqudnjs8ou9y` | Automatic | Proves to Azure that you own longisland.dance |
| TXT Record | `_dnsauth.www` | `_fvpz3g30np07c0vpuf6bdacab4e713s` | Automatic | Proves to Azure that you own www.longisland.dance |

4. Click the green check mark on each row to save.

Notes:

- Type the host exactly as shown (`@`, `www`, `_dnsauth.www`). Namecheap adds `.longisland.dance` by itself.
- Leave out `https://` and any trailing `/` in the values.
- Other TXT records at `@` (for example email/SPF) can stay. More than one TXT record per host is fine.
- The tokens above are not secrets. They are meant to be public in DNS, and they only work for this Static Web App.

## How long it takes

Usually 5 to 60 minutes; Azure says apex domains can take up to 72 hours. Azure checks the TXT records on its own, then creates a free HTTPS certificate.

Check progress:

```powershell
az staticwebapp hostname list -n swa-li-dance-events-web -g rg-li-dance-events-web --query "[].{domain:name, status:status}" -o table
Resolve-DnsName longisland.dance -Type TXT
Resolve-DnsName _dnsauth.www.longisland.dance -Type TXT
```

Both domains should show `Ready`.

## After both domains show "Ready" (done by the developer, not the owner)

1. In Azure (portal → Static Web App → **Custom domains**), select `longisland.dance` → **Set default**. Visitors to `www.longisland.dance` and the `azurestaticapps.net` address are then sent to `https://longisland.dance`.
2. Set the GitHub variable `SITE_URL` to `https://longisland.dance` and redeploy, so links, the sitemap and share images use the new address:
   ```powershell
   gh variable set SITE_URL --repo michaelsrichter/long-island-dance-events --body https://longisland.dance
   gh workflow run "Azure Static Web Apps" --repo michaelsrichter/long-island-dance-events --ref main
   ```
3. `ALLOWED_HOSTS` (Azure app setting) already lists `longisland.dance`, `www.longisland.dance` and the Azure address.
4. Run `node scripts/smoke.mjs https://longisland.dance` and check the site on a phone and a computer, in light and dark mode.
5. Search engines stay blocked (`ALLOW_INDEXING=false`) until the owner says to launch. Then: `gh variable set ALLOW_INDEXING --repo michaelsrichter/long-island-dance-events --body true` and redeploy.
6. When editor sign-in is set up, the GitHub OAuth app uses Homepage URL `https://longisland.dance` and callback `https://longisland.dance/api/callback` (keep **Expire user access tokens** unchecked).

## Rollback

The Azure address keeps working the whole time. If something goes wrong: set `SITE_URL` back to `https://black-dune-0e0f3e40f.1.azurestaticapps.net`, unset the default domain in Azure, redeploy, and fix the DNS records.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Azure stays at "Validating" | TXT record host or value is wrong, or DNS has not spread yet | `Resolve-DnsName longisland.dance -Type TXT` must show the token. Check for typos and extra spaces. |
| longisland.dance shows a Namecheap parking page | Parking or URL-redirect record still there | Delete it; keep only the ALIAS for `@`. |
| Certificate warning in the browser | Certificate still being created | Wait up to an hour after "Ready". |
| www works but the root does not | ALIAS record missing or nameservers are not BasicDNS | Add the ALIAS for `@`; set nameservers to Namecheap BasicDNS. |
