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

**Each environment has its own copy of the app settings.** A pull-request preview copies production's settings when it is created; after that, changing a setting without `--environment-name` changes **production only** (`default`). To change a setting everywhere (for example `ADMIN_EMAILS`), set it on every environment:

```powershell
$app = 'swa-li-dance-events-web'; $rg = 'rg-li-dance-events-web'
foreach ($envName in az staticwebapp environment list -n $app -g $rg --query "[].name" -o tsv) {
  az staticwebapp appsettings set -n $app -g $rg --environment-name $envName --setting-names "ADMIN_EMAILS=a@example.com,b@example.com" --output none
}
```

Moderator (`admin`) roles are given at sign-in, so a new moderator signs out and in again afterwards.

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
| `ADMIN_NOTIFY_URL` | optional | Secret trigger address of the alert Logic App (see "Email alerts for moderators" below). Without it, no alert emails are sent. |
| `MODERATION_DENY_WORDS` | optional | Comma-separated words that always reject a note. |

## Visitor sign-in and community features

Likes, notes, private corrections and photos (decision P21) need four things. Everything lives in the owner's personal subscription `fd38bfe4-1b60-405d-bff9-020f3ff54d88` (decision P37).

| Piece | Where | Made by |
| --- | --- | --- |
| Static Web App, **Standard** plan (custom sign-in needs it) | `rg-li-dance-events-web` / `swa-li-dance-events-web` | `infra/main.bicep` (`skuName = 'Standard'`) |
| Storage account `stlongislanddance` (tables, `pending`/`photos`/`community`/`backups` containers, CORS, lifecycle rules) | same group | `infra/main.bicep` |
| Azure AI Content Safety `cs-longislanddance` (Free tier) | same group | `infra/main.bicep` |
| Entra External ID tenant `longislanddance.onmicrosoft.com` (`a72c253f-3125-4592-b3c6-b8e23ed18054`) | `rg-li-dance-identity` | `infra/external-id.bicep`, then `infra/configure-external-id.ps1` |
| Logic App `logic-li-dance-notify` + Outlook.com connection `outlook-1` (moderator email alerts) | `rg-li-dance-events-web` | `infra/notify.bicep` |

Set up from scratch:

```powershell
az login --tenant <personal-directory-id>        # an account that may create tenants
az deployment group create -g rg-li-dance-identity -f infra/external-id.bicep
az deployment group create -g rg-li-dance-events-web -f infra/main.bicep -p infra/main.bicepparam
./infra/configure-external-id.ps1 -NewSecret      # app registration, email-code user flow, client secret -> SWA settings
```

Then set `COMMUNITY_STORAGE`, `CONTENT_SAFETY_ENDPOINT`, `CONTENT_SAFETY_KEY` and `ADMIN_EMAILS` (see the table above). The sign-in provider itself is in `public/staticwebapp.config.json` (`auth`), with the tenant's OpenID address.

Also save the same Storage connection string as the GitHub secret `COMMUNITY_STORAGE`. The **Community maintenance** workflow (`.github/workflows/community-maintenance.yml`) uses it every morning and after each production deploy. It creates an empty file for each new page (so browsers never get a "not found" error), backs up the tables, and deletes old rejected posts and old log rows.

The script registers `https://longisland.dance/.auth/login/extid/callback` (and `-ExtraSiteUrls`) as redirect addresses and keeps any already on the app. To test sign-in on a pull-request preview, add that preview's `https://<preview-host>/.auth/login/extid/callback` to the app registration.

"Sign out" ends only the site's session. `staticwebapp.config.json` lists the External ID endpoints itself instead of the discovery document, so Static Web Apps never sends people to External ID's sign-out page (that page asks "Which account do you want to sign out of?" and often lists no account). The user flow asks only for the email address; the site's welcome step asks for the public name.

### How long people stay signed in

There are two sessions, and they end at different times:

| Session | Kept in | Ends |
| --- | --- | --- |
| The website's own (Static Web Apps) | cookie `StaticWebAppsAuthCookie` on longisland.dance | 8 hours after signing in (Azure's fixed limit; it cannot be changed) |
| The sign-in service's (External ID) | cookies on longislanddance.ciamlogin.com | when the browser is closed (today), or after many days with the setting below |

When a browser that was signed in before comes back and the website's session has ended, the page signs the visitor back in silently: while the sign-in service still remembers them, a sign-in needs no form (Microsoft answers at once), so the page makes that one quick trip and comes back to the same page, without the welcome step. The header keeps showing their name, and Like, Save and notes work without reloading. A click made while the session had ended (for example a Like on a page left open all day) is remembered and finished after the trip. This is `ensureSession()` in `src/scripts/account-state.ts`. (Static Web Apps cannot pass `prompt=none` to the sign-in service: `loginParameterNames` does not forward it.)

The trip is only made when the sign-in service very likely still remembers the visitor, so nobody is sent to a sign-in form they did not ask for. The site sets its own cookie `li-sso` while signed in; it lasts as long as the sign-in service remembers (until the browser closes, or `signInServiceDays` in `src/data/community.json`). Without it, the visitor is shown as signed out at once, with a short "Your sign-in ended" note. The sign-in service does not remember a brand-new sign-up the way it remembers a sign-in (tested 2026-10-05), so the welcome step sets `li-sso=0` for the rest of that browser session; the next normal sign-in allows the silent trip again. If a sign-in comes back with an error (for example "Cancel"), Static Web Apps answers 401; the `401` response override shows `/signed-out/`, which goes straight back to the page, signed out. "Sign out" forgets the saved name and `li-sso` at once, so the site never signs anyone back in by itself. (Pressing "Sign in" again in the same browser session can still sign the last person in without a code, because the sign-in service remembers them; on a shared computer, close the browser after signing out.)

To test the whole flow with real sign-ins, use `scripts/e2e-signin.mjs` steps `sa` to `sd` (see the top of that file).

### Stay signed in the next day (owner, External ID admin center)

Today the sign-in service forgets visitors when the browser closes, so someone who returns the next day must enter a new email code. External ID decides this with a **Conditional Access** setting, not a user-flow setting, and Conditional Access cannot be used while **security defaults** are on. To keep visitors signed in for 90 days:

1. [Entra admin center](https://entra.microsoft.com) → switch to the **Long Island Dance** directory.
2. **Entra ID → Conditional Access → Policies → New policy**, name "Admins need MFA": Users: **Directory roles** → Global Administrator (and any other admin role in use); Target resources: **All resources**; Grant: **Require multifactor authentication**; turn it **On**. This replaces the admin protection that security defaults give today.
3. **Entra ID → Overview → Properties → Manage security defaults** → **Disabled** (reason: "Using Conditional Access"). Do this only after step 2 is saved.
4. **New policy**, name "Visitors stay signed in": Users: **All users**, exclude your admin account; Target resources: **Select resources** → **Long Island Dance website**; Session: **Sign-in frequency** = 90 days and **Persistent browser session** = **Always persistent**; turn it **On**.
5. In `src/data/community.json` set `"signInServiceDays": 90` (so the site knows the sign-in service now remembers visitors for that long) and publish.
6. Check: sign in on the website, close the browser completely, open it the next day (or wait 8 hours): your name is still in the header and Like works. With the harness, step `sb` "next day" passes.

### Email alerts for moderators

When something new waits in the moderation queue (a private correction, a note or photo for a person to check, a post hidden by reports, or an "It shows me" request), the API (`api/src/lib/notify.js`) posts `{ subject, html }` to a Logic App, which emails the owner through **Outlook.com**. Rules:

- **At most one email every 15 minutes** (in blocks of the clock, for example 2:00–2:15). The first new item in a block sends it; the rest are counted in the next one. A row in the `Limits` table (`_alerts` partition) marks each used block; the daily maintenance job deletes old rows.
- The email has **counts and a link** to `/moderate/` only: no post text, names or email addresses. The Logic App run history is set to "secure inputs/outputs", so it keeps nothing readable either.
- It never slows or breaks a visitor's post: the API waits at most 2.5 seconds and ignores errors. If sending fails, the block stays free and the next item tries again.
- **Daily reminder:** the Community maintenance workflow sends one reminder a day if anything has waited more than 6 hours.
- Pull-request previews use the same storage, so posts made on a preview are in the real queue and alert too.

Set up (already done for production; the owner's personal subscription):

1. `az deployment group create -g rg-li-dance-events-web -f infra/notify.bicep -p notifyTo=<owner email>`. Today it sends to the owner's Gmail address. For several people, separate addresses with `;`.
2. Azure portal → API connection **outlook-1** → **Edit API connection** → **Authorize**, sign in with the Outlook.com account that sends the mail (the owner's personal Microsoft account), **Save**. Work or school accounts need the "Office 365 Outlook" connector instead.
3. Copy the trigger address (Logic App → **Overview** → **Workflow URL**) into the app setting **`ADMIN_NOTIFY_URL`** on every environment and into the GitHub secret **`ADMIN_NOTIFY_URL`** (daily reminder). The address contains a secret signature: never put it in git, an issue or a chat.
   - On Windows, `az staticwebapp appsettings set` cuts a value at the first `&`, and this address has several. Set it in the portal (**Environment variables**), or read the current settings with the `listAppSettings` REST call and `PUT` them all back to `config/appsettings`. Check the stored value is complete afterwards.
   - For the GitHub secret, pipe it so it is never shown: `<value> | gh secret set ADMIN_NOTIFY_URL`.
4. Test: post a private correction on the site, then check the Logic App **Runs history** (both steps green) and the inbox. Mark the test correction **Done** in `/moderate/`.

To change who gets the emails: Logic App → **Logic app designer** → **Parameters** → `notifyTo`, or redeploy step 1 with a new `notifyTo`. To pause alerts, disable the Logic App (posts are not affected). If a redeploy ever shows the connection as "Unauthenticated", repeat step 2.

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
| `INDEXNOW_KEY` | 32 letters and digits | Optional. Turns on IndexNow: the site serves `/<key>.txt` and each production deploy sends new and changed pages to Bing and other IndexNow search engines (`scripts/indexnow.mjs`). The key is public by design. |
| `PUBLIC_GOOGLE_SITE_VERIFICATION` | code from Search Console | Optional. Adds `<meta name="google-site-verification">` if the owner verifies with an HTML tag instead of DNS. |
| `PUBLIC_BING_SITE_VERIFICATION` | code from Bing Webmaster Tools | Optional. Adds `<meta name="msvalidate.01">`. |

## Deployment workflow

The deployment action:

1. Installs dependencies.
2. Builds `dist/`.
3. Checks the site size (`npm run test:size`) and saves the live site's `/sitemap-state.json`.
4. Uploads static output and `api/`, then runs the smoke test.
5. Production only: sends new and changed pages to IndexNow (when `INDEXNOW_KEY` is set). This step never fails the deploy.
6. Azure serves static files and Functions.

Before enabling indexing, verify the deployed host:

```powershell
node scripts/smoke.mjs https://<host>
```

## Monitoring dashboard and alerts

`infra/monitoring/monitoring.bicep` adds the usage workbook, a portal dashboard, two metric alerts (more than 10 failed API requests or 20 server errors in an hour), an alert when the Log Analytics daily cap is reached, an email action group that notifies the subscription **Owner**, and a monthly budget for the resource group ($15, emails at 80% and 100% spent and when the forecast passes 100%). It does not touch the website. Deploy or update it with:

```powershell
az deployment group create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
  --template-file infra/monitoring/monitoring.bicep
# Optional: --parameters alertEmails='["someone@example.com"]' budgetAmount=20
```

Cost: the workbook, dashboard, action group emails and budget are free; the two metric alerts are about $0.10 a month each and the daily-cap log alert (every 6 hours) about $0.50 a month (decision P50).
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
