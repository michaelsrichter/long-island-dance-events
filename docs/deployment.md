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
| Resource group | `rg-<slug>-web` | `rg-riverbend-web` |
| Static Web App | `swa-<slug>-web` | `swa-riverbend-web` |
| Log Analytics | `log-swa-<slug>-web` | `log-swa-riverbend-web` |
| Application Insights | `appi-swa-<slug>-web` | `appi-swa-riverbend-web` |

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
