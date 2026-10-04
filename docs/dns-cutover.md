# DNS cutover: longisland.dance

The site's address is **https://longisland.dance** (the "apex" or root domain). `www.longisland.dance` and the Azure address https://black-dune-0e0f3e40f.1.azurestaticapps.net redirect there (301).

Status (October 3, 2026, 6:31 PM): **done.** Both domains are `Ready` with free HTTPS certificates; `longisland.dance` is the default domain; `SITE_URL` is `https://longisland.dance`; smoke test 23/23. Search engines are still blocked until launch.

## Move to the new Azure app (October 4, 2026)

The site is moving from the old Azure app (`black-dune…`, Microsoft work subscription) to a new one in the owner's own subscription (**Richter Cloud 150Credit**, resource group `rg-li-dance-events-web`, address **https://gentle-glacier-01b92ea0f.3.azurestaticapps.net**). The new app also has the storage, content-safety and visitor sign-in settings for the community features. Deploys from `main` already go to the new app. `longisland.dance` keeps showing the old app until the DNS records below change.

Done by the developer: the new app has the latest site (smoke test 23/23), and Azure is waiting to verify both names on it (`Validating`).

**Step 1: TXT records for the new app (no downtime).** At Namecheap, Advanced DNS, the TXT values must be **exactly** these. On October 4 at 12:06 PM the first codes (`_1z5hq…` and `_vb8ey…`) were replaced: Azure checked once before those records existed and never checked again, so both names were removed and added back with new codes.

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| TXT Record | `@` | `_0sb092kfpr2wabeium2mql1p6gj1ilw` | Automatic |
| TXT Record | `_dnsauth.www` | `_z5bc1gizrs5yslniimu1s2jdrp79nct` | Automatic |

Edit the two records you added before (`_1z5hq…` at `@`, `_vb8ey…` at `_dnsauth.www`) and paste the new values. Also delete the old app's TXT records (`_fzdvr…` at `@`, `_fvpz3…` at `_dnsauth.www`); the old app is already verified and doesn't need them. That leaves one Azure code per host, plus the SPF record at `@`, which stays.

**Step 2: after the developer confirms both names show `Ready` on the new app, point the site at it.** Edit the two existing records:

| Type | Host | Old value | New value |
| --- | --- | --- | --- |
| ALIAS Record | `@` | `black-dune-0e0f3e40f.1.azurestaticapps.net` | `gentle-glacier-01b92ea0f.3.azurestaticapps.net` |
| CNAME Record | `www` | `black-dune-0e0f3e40f.1.azurestaticapps.net` | `gentle-glacier-01b92ea0f.3.azurestaticapps.net` |

In a hurry? You can do step 1 and step 2 together. The site may then show a certificate warning for a few minutes up to about an hour, until Azure finishes. It is not launched yet, so that is low risk.

**Step 3 (developer):** set `longisland.dance` as the default domain on the new app, run the smoke test against `https://longisland.dance`, and check light and dark mode on phone and desktop. Then remove the two names from the old app. Once the owner agrees, delete the old app; it is on the paid Standard plan. After that, the old TXT records (`_fzdvr…` and `_fvpz3…`) can be deleted.

Check progress (new app):

```powershell
az staticwebapp hostname list -n swa-li-dance-events-web -g rg-li-dance-events-web --subscription "Richter Cloud 150Credit" --query "[].{domain:name, status:status}" -o table
Resolve-DnsName longisland.dance -Type TXT
```

Rollback: point the ALIAS and CNAME back at `black-dune-0e0f3e40f.1.azurestaticapps.net` (the old app keeps its names until step 3).

If a name sits at `Validating` for more than an hour while `Resolve-DnsName` already shows the right code, Azure has stopped checking. Remove the name and add it again on the new app (`az staticwebapp hostname delete`, then `hostname set --validation-method dns-txt-token`), and put the new code in DNS.

## Records to add at Namecheap (original setup, October 3)

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
