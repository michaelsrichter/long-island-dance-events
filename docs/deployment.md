# Deployment

This site deploys as static files plus Azure Static Web Apps managed Functions.

## Environments

| Environment | URL | Trigger | Indexing |
| --- | --- | --- | --- |
| Local | `http://localhost:4321` | `npm run dev` | noindex in local builds |
| Pull request preview | Azure preview URL | Pull request workflow | noindex |
| Pre-launch Azure host | `https://<app>.azurestaticapps.net` | Manual or main branch | usually noindex |
| Production custom domain | `https://www.example.org` | main branch | `ALLOW_INDEXING=true` |

## Required tools

```powershell
az version
gh --version
node --version
npm --version
```

Login:

```powershell
az login
gh auth login
```

## Provision Azure

```powershell
./infra/deploy.ps1 -Name <slug> -Repo <owner/repo>
```

With custom domain known:

```powershell
./infra/deploy.ps1 -Name <slug> -Repo <owner/repo> -CustomDomain www.example.org
```

The script derives:

| Resource | Pattern | Example |
| --- | --- | --- |
| Resource group | `rg-<slug>-web` | `rg-li-dance-events-web` |
| Static Web App | `swa-<slug>-web` | `swa-li-dance-events-web` |
| Log Analytics | `log-swa-<slug>-web` | `log-swa-li-dance-events-web` |
| Application Insights | `appi-swa-<slug>-web` | `appi-swa-li-dance-events-web` |

It also sets:

- GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN`
- GitHub variable `SITE_URL`
- GitHub variable `ALLOW_INDEXING`
- SWA app setting `ALLOWED_HOSTS`
- SWA app setting `APPLICATIONINSIGHTS_CONNECTION_STRING` when monitoring is enabled
- OAuth settings if supplied

## Manual app settings

Use Azure portal or CLI:

```powershell
az staticwebapp appsettings set --name <swa-name> --resource-group <rg> --setting-names KEY=value
```

Common settings:

| Setting | Required? | Description |
| --- | --- | --- |
| `ALLOWED_HOSTS` | yes | Comma-separated public hosts allowed for auth/telemetry. |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | optional | Enables Azure Monitor export. |
| `METRICS_PREFIX` | optional | Prefix for OTel metrics, default `site`. |
| `GITHUB_OAUTH_CLIENT_ID` | for CMS sign-in | GitHub OAuth app client id. |
| `GITHUB_OAUTH_CLIENT_SECRET` | for CMS sign-in | GitHub OAuth app secret. |
| `EXTID_CLIENT_ID` | for visitor sign-in | Entra External ID app (client) id. Set by `infra/configure-external-id.ps1 -NewSecret`. |
| `EXTID_CLIENT_SECRET` | for visitor sign-in | Its client secret (expires after 2 years; rerun the script with `-NewSecret`). |
| `COMMUNITY_STORAGE` | for community features | Connection string of the community Storage account. |
| `CONTENT_SAFETY_ENDPOINT` | for community features | Azure AI Content Safety endpoint. |
| `CONTENT_SAFETY_KEY` | for community features | Its key. Without it every note waits for a person. |
| `ADMIN_EMAILS` | for moderation | Comma-separated emails that get the `admin` role at sign-in. |
| `SITE_URL` | optional | Used in GitHub issues opened for corrections. |
| `GITHUB_ISSUES_TOKEN` | optional | Fine-grained token with "Issues: write" on this repo; private corrections then also open an issue. |
| `MODERATION_DENY_WORDS` | optional | Comma-separated words that always reject a note. |

## Visitor sign-in and community features

Likes, notes, private corrections and photos (decision P21) need four things. Everything lives in the owner's personal subscription `fd38bfe4-1b60-405d-bff9-020f3ff54d88` (decision P35).

| Piece | Where | Made by |
| --- | --- | --- |
| Static Web App, **Standard** plan (custom sign-in needs it) | `rg-li-dance-events-web` / `swa-li-dance-events-web` | `infra/main.bicep` (`skuName = 'Standard'`) |
| Storage account `stlongislanddance` (tables, `pending`/`photos`/`community`/`backups` containers, CORS, lifecycle rules) | same group | `infra/main.bicep` |
| Azure AI Content Safety `cs-longislanddance` (Free tier) | same group | `infra/main.bicep` |
| Entra External ID tenant `longislanddance.onmicrosoft.com` (`a72c253f-3125-4592-b3c6-b8e23ed18054`) | `rg-li-dance-identity` | `infra/external-id.bicep`, then `infra/configure-external-id.ps1` |

Set up from scratch:

```powershell
az login --tenant <personal-directory-id>        # an account that may create tenants
az deployment group create -g rg-li-dance-identity -f infra/external-id.bicep
az deployment group create -g rg-li-dance-events-web -f infra/main.bicep -p infra/main.bicepparam
./infra/configure-external-id.ps1 -NewSecret      # app registration, email-code user flow, client secret -> SWA settings
```

Then set `COMMUNITY_STORAGE`, `CONTENT_SAFETY_ENDPOINT`, `CONTENT_SAFETY_KEY` and `ADMIN_EMAILS` (see the table above). The sign-in provider itself is in `public/staticwebapp.config.json` (`auth`), with the tenant's OpenID address.

The script registers `https://longisland.dance/.auth/login/extid/callback` as the redirect address. Pull-request preview sites have other addresses, so sign-in does not work on previews (everything else does).

### Add Google or Facebook sign-in (owner)

Both are free. Create the app with **your own** Google or Facebook account (steps below), then put its id and secret into the tenant (last bullet).

- **Google:** Google Cloud console → new project → **OAuth consent screen**: External, app name "Long Island Dance Events", support email, authorized domains `ciamlogin.com` and `microsoftonline.com`, home page `https://longisland.dance/`, privacy policy `https://longisland.dance/privacy/`. Only the `openid`, `email` and `profile` scopes, so Google needs no verification. **Credentials** → OAuth client ID → Web application, redirect URIs:
  - `https://login.microsoftonline.com`
  - `https://login.microsoftonline.com/te/a72c253f-3125-4592-b3c6-b8e23ed18054/oauth2/authresp`
  - `https://login.microsoftonline.com/te/longislanddance.onmicrosoft.com/oauth2/authresp`
  - `https://a72c253f-3125-4592-b3c6-b8e23ed18054.ciamlogin.com/a72c253f-3125-4592-b3c6-b8e23ed18054/federation/oidc/accounts.google.com`
  - `https://a72c253f-3125-4592-b3c6-b8e23ed18054.ciamlogin.com/longislanddance.onmicrosoft.com/federation/oidc/accounts.google.com`
  - `https://longislanddance.ciamlogin.com/a72c253f-3125-4592-b3c6-b8e23ed18054/federation/oauth2`
  - `https://longislanddance.ciamlogin.com/longislanddance.onmicrosoft.com/federation/oauth2`
  Paste the client id and secret into the tenant's **Google** provider.
- **Facebook:** developers.facebook.com → **Create App** → "Authenticate and request data from users with Facebook Login" → not a game → app name "Long Island Dance Events". In **App settings → Basic**: privacy policy URL `https://longisland.dance/privacy/`, terms URL `https://longisland.dance/community-rules/`, user data deletion URL `https://longisland.dance/privacy/#delete-your-account`, a category; **Add platform → Website** with site URL `https://longisland.dance/`. Under **Use cases → Authentication and account creation → Facebook Login settings**, Valid OAuth Redirect URIs:
  - `https://login.microsoftonline.com/te/a72c253f-3125-4592-b3c6-b8e23ed18054/oauth2/authresp`
  - `https://login.microsoftonline.com/te/longislanddance.onmicrosoft.com/oauth2/authresp`
  - `https://longislanddance.ciamlogin.com/a72c253f-3125-4592-b3c6-b8e23ed18054/federation/oidc/www.facebook.com`
  - `https://longislanddance.ciamlogin.com/longislanddance.onmicrosoft.com/federation/oidc/www.facebook.com`
  - `https://longislanddance.ciamlogin.com/a72c253f-3125-4592-b3c6-b8e23ed18054/federation/oauth2`
  - `https://longislanddance.ciamlogin.com/longislanddance.onmicrosoft.com/federation/oauth2`
  Add the **email** permission (`public_profile` and `email` need no app review), then **Go live**. Copy the **App ID** and **App Secret**.
- **Put them in the tenant (both):** [Entra admin center](https://entra.microsoft.com) → switch to the **Long Island Dance** directory → **Entra ID → External Identities → All identity providers** → **Google** (or **Facebook**) → **Configure** → paste the id and secret → Save. Then **External Identities → User flows → "Long Island Dance sign-up and sign-in" → Identity providers** → tick Google and Facebook → Save. The sign-in page shows the new buttons right away; nothing on the website changes. (The Azure CLI cannot do this step: Microsoft does not let its app manage identity providers.)
- **Instagram** sign-in is not possible for personal accounts (Meta ended it on December 4, 2024).

### Moving `longisland.dance` to a new Static Web App

1. Add both host names to the new app with TXT validation: `az staticwebapp hostname set -n <app> -g <rg> --hostname longisland.dance --validation-method dns-txt-token --no-wait` (and `www.longisland.dance`), then read the tokens with `az staticwebapp hostname list`.
2. At the DNS host (Namecheap): add TXT records `_dnsauth` and `_dnsauth.www` with those tokens.
3. When both show **Ready**, point DNS at the new app: `www` CNAME → `<new>.azurestaticapps.net`, and the bare domain ALIAS → `<new>.azurestaticapps.net` (replacing the old A record).
4. In the portal, make `longisland.dance` the **default** domain so the other addresses redirect to it.
5. Run `node scripts/smoke.mjs https://longisland.dance`.

## GitHub variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `SITE_URL` | `https://www.example.org` | Canonical URL used by Astro, sitemap, metadata and links. |
| `ALLOW_INDEXING` | `true` | Allows `index,follow`; false emits noindex. |
| `PUBLIC_GA4_ID` | `G-...` | Optional GA4. |
| `PUBLIC_CLARITY_ID` | `abcd123` | Optional Clarity. |
| `PUBLIC_ANALYTICS_CONSENT_MODE` | `opt-in` | Consent mode; keep `opt-in` unless reviewed. |
| `PUBLIC_TELEMETRY_ENDPOINT` | `/api/telemetry` or `off` | Browser telemetry endpoint. |

## Deployment workflow

The deployment action:

1. Installs dependencies.
2. Builds `dist/`.
3. Uploads static output and `api/`.
4. Azure serves static files and Functions.

Before enabling indexing, verify the deployed host:

```powershell
node scripts/smoke.mjs https://<host>
```

## Custom domain deployment order

1. Deploy to the Azure host first.
2. Add custom domain in Azure Static Web Apps.
3. Create DNS validation and CNAME records.
4. Wait for the managed certificate.
5. Update `SITE_URL` to the custom domain.
6. Update OAuth callback to `https://<domain>/api/callback`.
7. Re-run deployment.
8. Set `ALLOW_INDEXING=true` only after content is final.

## Build commands in CI

```powershell
npm ci
npm ci --prefix api
npm run check
npm test
npm test --prefix api
$env:BUILD_NOW='2026-10-01T22:00:00-04:00'; npm run build
npm run test:links
npx playwright test
```

## Troubleshooting deployment

| Problem | Cause | Fix |
| --- | --- | --- |
| Action cannot deploy | Missing or wrong deployment token | Re-run `infra/deploy.ps1` or update `AZURE_STATIC_WEB_APPS_API_TOKEN`. |
| OAuth works on Azure host but not custom domain | Callback URL not updated | Update GitHub OAuth app and `ALLOWED_HOSTS`. |
| Site metadata points to wrong host | `SITE_URL` still old | Update GitHub variable and redeploy. |
| Search engines index preview host | `ALLOW_INDEXING=true` too early | Set false and redeploy; use Search Console removals if needed. |
| Build fails on content | Schema validation error | Read the file/line from Astro output; fix content. |
| Link check fails | Missing page or broken fragment | Fix link or add the target id/page. |
| Rare Windows build crash | libuv assertion | Re-run the build. |

## Operational checklist

- [ ] `SITE_URL` is correct.
- [ ] `ALLOW_INDEXING` matches environment.
- [ ] OAuth app callback matches live domain.
- [ ] CMS sign-in tested.
- [ ] Smoke test passes.
- [ ] Analytics/telemetry choices documented.
- [ ] Rollback plan known before DNS cutover.
