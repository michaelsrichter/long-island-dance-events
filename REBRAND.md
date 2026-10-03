# Rebrand this starter into your organization's site

This guide turns the fictional Riverbend sample into a real organization site. Each step includes files, commands and verification.

## 1. Create a repository from the template

```powershell
gh repo create <owner>/<name> --template michaelsrichter/community-site-starter --public --clone
cd <name>
npm ci
npm ci --prefix api
```

Verify:

```powershell
npx astro check
npx vitest run
```

## 2. Run the rebrand helper

```powershell
node scripts/rebrand.mjs --name "Full Organization Name" --short "Short Name" --slug short-name --domain https://www.example.org --email info@example.org --region "Your Region"
```

What it updates:

- `src/content/settings/site.yml`
- `package.json`
- `public/site.webmanifest`
- `infra/main.bicepparam`
- `infra/deploy.ps1` defaults
- README title

Verify:

```powershell
git diff -- src/content/settings/site.yml package.json public/site.webmanifest infra README.md
npm run check
```

## 3. Finish site settings

Edit `src/content/settings/site.yml`:

| Field | What to enter |
| --- | --- |
| `siteName` | Full public organization name. |
| `shortName` | Short label used in badges and buttons. |
| `legalName` | Legal entity name, if any. |
| `region` | Human-friendly service area. |
| `tagline`, `description`, `mission` | Plain-language description for visitors and search. |
| `hotlinePhone`, `email`, `mailingAddress` | Public contact information only. |
| `newsletterUrl`, social URLs | Use real links or leave optional fields blank. |
| `membershipFee`, `membershipYear`, `standardPrices` | Door prices and membership copy. |
| `defaultVenue` | Venue id for the homepage. |
| `mapCenter`, `maxDistanceKm` | Geocoding guardrails for your region. |

Verify:

```powershell
npm test -- tests/unit/schemas.test.ts
```

## 4. Replace logo, favicons and app icons

Files:

- `src/components/Logo.astro`
- `public/favicon.svg`
- `public/favicon.ico`
- `public/icons/apple-touch-icon.png`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/maskable-512.png`
- `public/site.webmanifest`

Regenerate icons from `public/favicon.svg`:

```powershell
node -e "import sharp from 'sharp'; import {readFileSync} from 'node:fs'; const svg=readFileSync('public/favicon.svg'); await sharp(svg).resize(32,32).toFile('public/favicon.ico'); await sharp(svg).resize(180,180).png().toFile('public/icons/apple-touch-icon.png'); await sharp(svg).resize(192,192).png().toFile('public/icons/icon-192.png'); await sharp(svg).resize(512,512).png().toFile('public/icons/icon-512.png'); await sharp(svg).resize(512,512,{fit:'contain',background:'#24162f'}).png().toFile('public/icons/maskable-512.png');"
```

Verify:

```powershell
npm run build
```

Open the homepage and inspect the header and browser icon.

## 5. Choose colors carefully

Edit design tokens in `src/styles/global.css`.

Rules:

- Keep light and dark token blocks in sync. Every token in one block should exist in the other.
- Keep contrast high enough for WCAG AA.
- Run the theme token test after editing.

Verify:

```powershell
npm test -- tests/unit/theme-css.test.ts
npx playwright test tests/e2e/quality.spec.ts -g "axe|320 px"
```

## 6. Replace content collections

Collections to edit:

- `src/content/pages/`
- `src/content/settings/site.yml`
- `src/content/venues/`
- `src/content/series/`
- `src/content/events/`
- `src/content/organizers/`
- `src/content/instructors/`
- `src/content/performers/`
- `src/content/faqs/`
- `src/content/gallery/`
- `src/content/announcements/`
- `src/content/styles/` if your site needs different taxonomy

Rules:

- Every event, series, FAQ, gallery album and announcement must have explicit `published: true` or `published: false`.
- Use `host: home` for your organization's events.
- Use `host: community` for other organizers; include `organizer`, `sourceName` and contact info.
- Keep every collection non-empty.

Verify:

```powershell
npm test -- tests/unit/schemas.test.ts
```

## 7. Replace sample photos safely

The starter ships only open-licensed sample photos. You may keep them if you keep the credits, but most real sites should replace them with local photos.

Files and folders:

- `src/assets/uploads/`
- `src/content/gallery/*.yml`
- Event `featuredImage` fields
- Series `featuredImage` fields
- Page sections that use `src/lib/photos.ts`

Photo rules:

- Use only photos your organization owns, created, licensed or has written permission to publish.
- Keep photographer credit and license URL when required.
- Write meaningful alt text.
- Do not upload flyers with important text as the only source of schedule information.

Verify:

```powershell
npm run build
npm run test:links
npx playwright test tests/e2e/journeys.spec.ts -g "photos"
```

## 8. Set focus points

Focus points keep faces or important action visible when images crop.

Format: `50% 30%` where the first number is left-to-right and the second is top-to-bottom.

Where used:

- Gallery images: `focus`
- Event/series images: `featuredImageFocus`
- Person images: `imageFocus`

Verify crops on desktop and mobile screenshots.

## 9. Geocode venues

Update venue addresses first. Then run a dry run:

```powershell
npm run geocode -- --dry --center=41.5034,-73.9696 --max-distance-km=80
```

If results look right:

```powershell
npm run geocode -- --force --center=41.5034,-73.9696 --max-distance-km=80
```

You can also set `mapCenter` and `maxDistanceKm` in `src/content/settings/site.yml` and omit the flags.

Verify:

```powershell
npm test -- tests/unit/photos-map.test.ts
npx playwright test tests/e2e/journeys.spec.ts -g "map"
```

## 10. Build legacy redirects from the audit

Use the kit's legacy-site-audit skill to inventory old URLs and recommended targets. Then edit:

- `src/data/legacy-redirects.json`
- `public/staticwebapp.config.json` for the handful of high-value 301 routes
- `docs/redirect-plan.md`
- `docs/legacy-site-migration.md`

Rules:

- Use server 301 routes for the most valuable old addresses.
- Use generated meta-refresh pages for long-tail old addresses.
- Keep targets internal and current.

Verify:

```powershell
$env:BUILD_NOW='2026-10-01T22:00:00-04:00'; npm run build
npm test -- tests/unit/seo-config.test.ts
npx playwright test tests/e2e/journeys.spec.ts -g "legacy"
```

## 11. Configure analytics and consent

Optional GitHub variables:

- `PUBLIC_GA4_ID`
- `PUBLIC_CLARITY_ID`
- `PUBLIC_ANALYTICS_CONSENT_MODE` (`opt-in` recommended)
- `PUBLIC_TELEMETRY_ENDPOINT` (`/api/telemetry` or `off`)

Optional Azure app setting:

- `METRICS_PREFIX` (default `site`), used for metrics such as `site.web.page_views`.

Verify:

```powershell
npm test --prefix api
```

Read [docs/analytics.md](docs/analytics.md) before enabling third-party analytics.

## 12. Deploy Azure resources

```powershell
./infra/deploy.ps1 -Name <slug> -Repo <owner/repo>
```

With a custom domain:

```powershell
./infra/deploy.ps1 -Name <slug> -Repo <owner/repo> -CustomDomain www.example.org
```

The script creates or updates the resource group, Static Web App, monitoring resources, GitHub secret and GitHub variables.

Verify:

```powershell
gh variable list --repo <owner/repo>
gh secret list --repo <owner/repo>
```

## 13. Create the OAuth app

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:

- Application name: `<siteName> CMS`
- Homepage URL: `https://<domain>`
- Authorization callback URL: `https://<domain>/api/callback`
- Uncheck **Expire user access tokens**.

Set app settings:

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `ALLOWED_HOSTS=<domain>,<azure-host>`

If you add or change a custom domain later, update the OAuth callback. Enterprise Managed User accounts cannot be collaborators on personal repositories.

Verify by opening `https://<domain>/admin/` and clicking GitHub sign-in.

## 14. Configure custom domain DNS

In Azure Static Web Apps, add `www.example.org`.

At your DNS provider:

- `CNAME www -> <static-web-app>.azurestaticapps.net`
- `TXT _dnsauth.www -> <Azure validation token>`

After validation:

- Set `SITE_URL=https://www.example.org`.
- Set `ALLOW_INDEXING=true` only when ready.
- Update OAuth callback to the same domain.

Verify:

```powershell
curl -I https://www.example.org
```

## 15. Update smoke test expectations

Edit `scripts/smoke.mjs` after changing sample names or routes. Update:

- Next-dance text.
- Hotline number.
- Legacy redirect samples.
- Event structured data sample route.
- CMS config repository if needed.

Run:

```powershell
node scripts/smoke.mjs https://<domain>
```

## 16. Update e2e test data assumptions

If you replace Riverbend sample data, update tests that reference:

- `Thursday Night Swing`
- `/events/2026-10-08-thursday-night-swing/`
- `Beacon Blues Night`
- `/events/2026-10-03-beacon-blues-night/`
- `Riverbend Community Hall`
- `Maya Rivera`
- `The Riverbend Syncopators`
- `Riverbend` labels and `host=home`
- `https://www.facebook.com/groups/example`
- `/old-gallery.php` legacy redirect sample

Run Playwright twice to catch flakiness:

```powershell
npx playwright test
npx playwright test
```

## 17. Launch checklist

- [ ] All content reviewed by a human editor.
- [ ] All sample names replaced or intentionally kept as examples in documentation only.
- [ ] Photos have permission, credits and alt text.
- [ ] Venue coordinates verified on the map.
- [ ] Old high-value URLs redirect.
- [ ] CMS sign-in works on the production domain.
- [ ] `SITE_URL` matches production.
- [ ] `ALLOW_INDEXING=true` only on production.
- [ ] Analytics IDs and privacy copy are correct.
- [ ] Full verification passes.
- [ ] Smoke test passes against the live domain.
