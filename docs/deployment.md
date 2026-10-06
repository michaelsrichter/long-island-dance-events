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
| `REVIEW_SECRET_KEY` | for the review center | 64 random characters, the same on every environment. Encrypts the review center's GitHub App key in the `ReviewState` table. Set on 2026-10-05; changing it means connecting GitHub again. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | optional | Use a GitHub App from settings instead of the one stored by the setup button (key as PEM or base64 PEM). `GITHUB_APP_INSTALLATION_ID` optional. |
| `REVIEW_REPO`, `REVIEW_BRANCH` | optional | Default `michaelsrichter/long-island-dance-events` and `main`. |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX` | **production only** | The site's AgentMail inbox (the same as the GitHub secrets of the same names, decision P44). The review center sends permission emails from it after the owner confirms (decision P53). Set them on the `default` environment only. Even if a preview copies them, only requests to `OUTREACH_HOST` send. |
| `OUTREACH_HOST` | optional | The one address that may send email, default `longisland.dance`. Previews and local runs do a dry run instead. |

## Review center: GitHub App (owner, once)

The review center (`/moderate/`, decision P51) writes to GitHub as a GitHub App that only the owner can create:

1. Sign in to GitHub as `michaelsrichter`. Open https://longisland.dance/moderate/ and sign in.
2. On the **To do** tab, press **Connect to GitHub**. GitHub shows "Create GitHub App" with the name **Long Island Dance review center** and its permissions (contents, pull requests, issues, actions: read and write; checks, statuses: read; no webhook). Press **Create GitHub App**.
3. GitHub sends you back through `/api/github-setup`, which swaps the one-time code for the app's private key (stored encrypted in the `ReviewState` table) and opens the install page. Choose **Only select repositories**, pick **long-island-dance-events**, and press **Install**.
4. Back on the review center, the setup card is gone and every tab fills in.

The app is free. To remove it: GitHub, Settings, Applications (installed apps), then Developer settings, GitHub Apps. To set it up again, press **Connect to GitHub** again (it replaces the stored key). For a manual setup, put the app's id and private key in `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` instead. Pull-request previews share the same Storage account, so they use the same app; decisions made on a preview change the real site.

The `ReviewState` table is in `infra/main.bicep`; on the live account it was created with `az storage table create --name ReviewState --account-name stlongislanddance`.

### Permission emails (AgentMail, production only)

The review center emails website owners from the site's AgentMail inbox (decision P53). To set it up again:

```powershell
$app = 'swa-li-dance-events-web'; $rg = 'rg-li-dance-events-web'
# Production only. Paste the values from the AgentMail console; never put them in a file or chat.
az staticwebapp appsettings set -n $app -g $rg --environment-name default --setting-names "AGENTMAIL_API_KEY=<key>" "AGENTMAIL_INBOX=<inbox>@agentmail.to"
```

- Every email we send has the labels `outreach` and `source-<id>` (or `issue-<n>`, `test-<id>`). The newsletter reader skips every thread with the `outreach` label, so answers are never read as newsletters.
- The free plan allows 3 inboxes and 100 emails a day, sends from `@agentmail.to`, and adds a "Sent via AgentMail" footer. A custom domain (for example `hello@longisland.dance`) needs the Developer plan (about $20 a month). Then add the domain in the AgentMail console, put the SPF, DKIM, DMARC and MX records it shows into Namecheap (Advanced DNS), verify, and create an inbox on the domain. This is not done yet, because the owner must approve the cost and publishing the address (decisions P13, P53). The older `GITHUB_ADMIN_CLIENT_ID`/`_SECRET` settings (a planned GitHub sign-in for `/admin/`) were removed on 2026-10-05; the GitHub OAuth app "Long Island Dance admin sign-in" is unused and can be deleted.

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

1. Installs dependencies, then restores the saved share pictures and resized photos from earlier builds (`.cache/og/` and `node_modules/.astro/assets/`, decision P55).
2. Builds `dist/`. Share pictures whose facts did not change are reused instead of drawn again; the build log ends with a line like `[og] share pictures: 1980 reused, 12 drawn`.
3. Checks the site size (`npm run test:size`), forgets saved pictures not used for 14 days, saves the rest for the next build, and saves the live site's `/sitemap-state.json`.
4. Uploads static output and `api/`, then runs the smoke test.
5. Production only: sends new and changed pages to IndexNow (when `INDEXNOW_KEY` is set). This step never fails the deploy.
6. Azure serves static files and Functions.

If a share picture ever looks out of date, start fresh: on GitHub, open **Actions → Caches** and delete the entries whose names start with `site-images-` and `ci-images-`, then run the workflow again. The next build draws every picture (about 5 minutes longer, once). Any change to `src/lib/og.ts`, the fonts or the satori and sharp versions does this by itself.

Before enabling indexing, verify the deployed host:

```powershell
node scripts/smoke.mjs https://<host>
```

## Monitoring dashboard and alerts

`infra/monitoring/monitoring.bicep` adds the usage workbook, a portal dashboard, two metric alerts (more than 10 failed API requests or 20 server errors in an hour), an alert when the Log Analytics daily cap is reached, an email action group that notifies the subscription **Owner**, and a monthly budget for the resource group ($40 since the live database, P56; was $15; emails at 80% and 100% spent and when the forecast passes 100%). It does not touch the website. Deploy or update it with:

```powershell
az deployment group create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
  --template-file infra/monitoring/monitoring.bicep
# Optional: --parameters alertEmails='["someone@example.com"]' budgetAmount=50
```

Cost: the workbook, dashboard, action group emails and budget are free; the two metric alerts are about $0.10 a month each and the daily-cap log alert (every 6 hours) about $0.50 a month (decision P50).

## Live database and server (phases 1 and 2)

Decisions P56 to P59; the plan is [proposals/postgres-live-site.md](proposals/postgres-live-site.md). Git is still the master copy: the live PostgreSQL database is a faithful copy of `src/content/**`, refreshed every night and after every content change, and checked byte for byte each time. The App Service server makes the same pages as today's site **from the database records** (it checks for changes every 2 seconds, P59) at the test address **https://new.longisland.dance**; nothing on longisland.dance uses it yet.

**Region: Central US (P57).** This Visual Studio subscription may not create PostgreSQL or Azure SQL in East US or East US 2. Central US is the only US region that allows PostgreSQL and also has App Service, Content Safety, Logic Apps and monitoring, so everything moves there (see "Moving the rest to Central US" below). **No private network:** the database has a public address, but its firewall lets in only Azure services, it accepts only Microsoft Entra sign-in (no passwords) and only encrypted connections.

| Resource (rg-li-dance-events-web, Central US) | What it is | Cost a month |
| --- | --- | ---: |
| `psql-li-dance-events` | PostgreSQL 17, Burstable B1ms, 32 GB, 7-day point-in-time restore. Firewall: Azure services only. Microsoft Entra sign-in only; the web app is its administrator. | $18.18 |
| `app-li-dance-events` + plan `plan-li-dance-events` | App Service, Linux B1 (1 core, 1.75 GB), Node 24 LTS, always on, health check `/api/live` (P58). Code in `server/`. Test addresses: https://new.longisland.dance (free managed certificate, P59) and https://app-li-dance-events.azurewebsites.net; both tell search engines not to list them. | $13.14 |
| `id-github-deploy-li-dance-events` | The identity GitHub Actions uses to deploy the app, from `main` only (federated credential, no secret; subject `repo:michaelsrichter@1242059/long-island-dance-events@1402631995:ref:refs/heads/main`, the format with GitHub's account and repository ids that this repository's tokens use). It may only change this one app. | $0 |

Phase 1 ran on a small Azure Functions app (`func-li-dance-events`, plan `asp-li-dance-events`, storage `stlidancefunc`). It was deleted on October 6, after the App Service app had run the sync (P58). Its database role still owned the tables (it created them), so only it could change their design, and Azure would not remove it ("objects depend on it"). Migration `server/migrations/002_app_service_owner.sql` makes the App Service app the owner the first time it starts; then the old role is removed:

```powershell
az postgres flexible-server microsoft-entra-admin delete -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
  --server-name psql-li-dance-events --object-id 1efa5668-7948-47fb-a1ab-5f549a24244e --yes
```

If the server log ever shows `[migrate] WARNING: could not take over the objects of func-li-dance-events`, Azure refused the handover: add your own account as a database administrator for a moment, let your address through the firewall, run `REASSIGN OWNED BY "func-li-dance-events" TO "app-li-dance-events";` in the `lidance` database, then remove both again.

Template: `infra/live/main.bicep` (safe to run again):

```powershell
az deployment group create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
  --name live-app-service --template-file infra/live/main.bicep
```

If the deploy identity is ever recreated, copy its new client id (`deployClientId` output) into the `AZURE_CLIENT_ID` variable. To run the sync now: `gh workflow run database-sync.yml --repo michaelsrichter/long-island-dance-events --ref main`. The first sync applies the database design (`server/migrations/`) and copies everything in. The run page shows a table of what was added and "Database round trip: identical", and `/api/health` then shows `"database": "ok"` and the counts.

**App settings that matter** (all set by the template): `SITE_URL=https://longisland.dance` (the pages' own address, whatever name the server is reached by), `CANONICAL_HOST=longisland.dance` (any other host name gets `X-Robots-Tag: noindex, nofollow`), `ALLOW_INDEXING=false` until switch day (pages say "noindex" and `robots.txt` disallows everything; deploy with `allowIndexing=true` on switch day), `IMAGE_CACHE_DIR=/home/data/image-cache` (resized photos kept between restarts).

**Web addresses (host names).** `main.bicep` does not declare them, so running it again never touches them. Each name gets its own small deployment, once its DNS records exist (CNAME `<name>` → `app-li-dance-events.azurewebsites.net`, TXT `asuid.<name>` → the app's `customDomainVerificationId`):

```powershell
az deployment group create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
  --name domain-new --template-file infra/live/custom-domain.bicep --parameters hostName=new.longisland.dance
```

It binds the name, makes a free App Service managed certificate (renewed by Azure) and turns on HTTPS. To repair a binding later without a moment without HTTPS, add `thumbprint=<the certificate's thumbprint>` (output of the first run). `new.longisland.dance` was set up this way on October 6 (certificate thumbprint `BB37118EB7F44110A996A57978EDEE4063F1F17C`, valid to 2027-04-06).

**Sign-in and the community /api code (P60).** The app uses App Service's built-in sign-in with the same External ID provider (`extid`) as Static Web Apps; sign-ins last 14 days. The server matches each person to the user id Static Web Apps gave them (table `IdpLinks` in the community storage), so likes, notes and photos carry over. `/api/health` shows `"signIn": "built-in"`. Settings:

| Where | What |
| --- | --- |
| `infra/live/main.bicep` | Sign-in (`authsettingsV2`), `ALLOWED_HOSTS`, community storage, Content Safety and the owner-email Logic App (read from the existing resources), Key Vault `kv-li-dance-events` |
| Key Vault (Key Vault references in the app settings) | `extid-client-secret`, `admin-emails`, `agentmail-api-key`, `agentmail-inbox`, `github-oauth-client-id`, `github-oauth-client-secret`, `review-secret-key` |

To copy the secrets from the Static Web App again (for example after changing one there): `./infra/live/copy-secrets.ps1`. It never prints a value, refreshes the app's Key Vault references and restarts the app; every line should end in `Resolved`. To change one only on App Service: `az keyvault secret set --vault-name kv-li-dance-events --name <name> --file <file>`, then the same refresh (see the script).

**Each new web address needs its sign-in return address** in the External ID app registration (owner, in [entra.microsoft.com](https://entra.microsoft.com): longislanddance directory → App registrations → Long Island Dance website → Authentication → Web → Add URI): `https://<address>/.auth/login/extid/callback`. For `new.longisland.dance` this was requested on October 6. `longisland.dance` is already there.

**Pages from the database (P59).** Every 2 seconds the server reads `site_state.data_version`; when it changed, it reads every record again (only changed ones are checked again) and the next visitor sees the change. `/api/health` shows `pages.dataVersion` (what the pages show) next to `dataVersion` (the database's), and lists any record it had to leave out. Sitemap "last changed" dates are kept in the `sitemap_state` table (filled once from the live site's `/sitemap-state.json`).

**Run the server on your computer** (with a local PostgreSQL; the pages then come from it):

```powershell
npm run build                                   # the static site (also makes the resized photos)
npm run build:server -- --static-images dist    # the server site in server/site, with the photos and share pictures
npm ci --prefix server
npx tsx scripts/db/build-payload.ts --out payload.json.gz
$env:DATABASE_URL='postgres://postgres@127.0.0.1:5432/lidance_live'   # an empty test database
node scripts/live/load-db.mjs payload.json.gz
$env:PORT='8080'; $env:SITE_URL='https://longisland.dance'; $env:ALLOW_INDEXING='true'; node server/src/main.js
# in another window: every file of the static site must come back identical
node scripts/live/parity.mjs --static dist --base http://127.0.0.1:8080
# and a change in the database must show on its page within seconds (test databases only)
node scripts/live/change-check.mjs --base http://127.0.0.1:8080
```

Without `DATABASE_URL` the server uses the records it was built with. To compare the test address with the static site: build the deployed commit with the same settings as the server (`ALLOW_INDEXING=false`, the `PUBLIC_*` variables), then `node scripts/live/parity.mjs --static dist --base https://new.longisland.dance --host new.longisland.dance --concurrency 6`.

### Moving the rest to Central US

| Today in East US 2 | When it moves | How |
| --- | --- | --- |
| Static Web App `swa-li-dance-events-web` | **It does not move; it is deleted on switch day.** Its pages come from Azure's worldwide edge, so its region hardly matters, and moving it now would mean checking the custom domains at Namecheap twice. | Switch day (phase 4): the domain points at the Central US app. |
| Storage `stlongislanddance` (likes, notes, photos, review state) | Phase 2, when the `/api` code moves into the Central US app | New account in Central US; copy tables and blobs; update `COMMUNITY_STORAGE` and the public photo address in `src/data/community.json`; delete the old one. |
| Content Safety `cs-longislanddance` (free tier) | Phase 2 | Only one free tier per subscription: delete the old one, then create the new one in Central US. |
| Logic App `logic-li-dance-notify` (owner emails) | Phase 2 | Redeploy `infra/notify.bicep` in Central US; the owner signs in to Outlook once to authorize the new connection. |
| Application Insights, Log Analytics, alerts, dashboard, budget | Phase 2 | Redeploy `infra/main.bicep` parts and `infra/monitoring/monitoring.bicep` in Central US (old usage history stays readable in the old workspace for 30 days). |
| External ID (visitor sign-in) | Never needs to | It is a separate directory, not tied to a region. |
### GitHub variables (not secrets; set once)

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | `deployClientId` output of the template (the deploy identity) |
| `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | `tenantId` and `subscriptionId` outputs |
| `SERVER_APP_NAME` | `app-li-dance-events` |
| `SERVER_URL` | `https://app-li-dance-events.azurewebsites.net` (becomes `https://longisland.dance` on switch day) |

### What runs

- **Server** (`.github/workflows/server.yml`): on pull requests that touch the site, `server/` or the content, (1) the server tests run against a real PostgreSQL 17 in GitHub's runner, including the full round trip with the real content and the restore drill; (2) the static site and the server site are built from the same commit, the server is started, and every file of the static site must come back identical (`scripts/live/parity.mjs`). On `main` it then deploys the checked package to the App Service app, waits until `/api/health` reports the new commit, checks a few pages, and starts the database sync.
- **Database sync** (`.github/workflows/database-sync.yml`): every night at about 3:45 AM New York time, after every content change on `main`, and on demand. It builds a snapshot of `src/content/**` (every record checked with the site's own schemas, `scripts/db/build-payload.ts`), sends it to `/api/sync/import` (the database is made to match; every change goes into `history`), reads everything back from `/api/sync/export` and compares it with git, byte for byte (`scripts/db/compare-export.ts`). Any difference fails the run. Only this workflow file on `main` may call these endpoints: the app checks GitHub's signed token (repository, branch, workflow file), so there is no password to leak.
- **Restore drill:** every Sunday (and on demand with **Run workflow → drill**) the app copies every record into empty tables, exports the copy and checks it is identical, then throws the copy away.

### Restore

- **Any minute in the last 7 days (point-in-time restore):** Azure makes a new server from the backups:
  ```powershell
  az postgres flexible-server restore -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
    --source-server psql-li-dance-events --name psql-li-dance-events-drill --restore-time "2026-10-07T03:00:00Z"
  ```
  Azure does not copy firewall rules to a restored server, so first let Azure services in:
  ```powershell
  az postgres flexible-server firewall-rule create -g rg-li-dance-events-web --subscription fd38bfe4-1b60-405d-bff9-020f3ff54d88 `
    --server-name psql-li-dance-events-drill --name AllowAllAzureServicesAndResourcesWithinAzureIps --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
  ```
  To compare it with the live one, run **Database sync → Run workflow** with `drill_server` = `psql-li-dance-events-drill` (if the app cannot sign in to the copy, add it as Microsoft Entra administrator of the copy: `az postgres flexible-server microsoft-entra-admin create --server-name psql-li-dance-events-drill -g rg-li-dance-events-web --object-id <app principal id> --display-name app-li-dance-events --type ServicePrincipal`). Delete the copy afterwards; it costs as much as the live server while it exists.
- **Tested on October 6, 2026:** a copy restored to 01:30 UTC matched the live database in all 11 kinds of records (run 37399821081); the app signed in to the copy with its own identity (Azure keeps the Microsoft Entra administrators, but not the firewall rules). The copies were deleted afterwards.
- **In phase 1 git is the master copy,** so a lost database is simply filled again by the next sync.

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
