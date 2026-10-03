# Redirect plan

Use this plan after a legacy-site audit. Replace examples with real old URLs.

## Why two layers

| Layer | What | How | HTTP status |
| --- | --- | --- | --- |
| 1. Server redirects | The most valuable old pages | `routes` in `public/staticwebapp.config.json` | **301 Moved Permanently** |
| 2. Redirect pages | Every other crawled legacy address | Generated at build time by `scripts/postbuild.mjs` from `src/data/legacy-redirects.json`; each page has meta refresh, canonical, noindex and a visible link | 200 → instant redirect |
| 3. Safety net | Any unmatched old section | Helpful 404 page and optional client-side pattern redirects | 404 → suggested destination |

## Layer 1: server-side 301 redirects

| Old address | New address | Notes |
| --- | --- | --- |
| `/index.php` | `/` | Example old home page. |
| `/events.php` | `/events/` | Example old events list. |
| `/contact.php` | `/contact/` | Example old contact page. |

Add only the small set of high-value routes here. Static Web Apps has config size limits.

## Layer 2: generated redirect pages

| Legacy pattern | Count | Target | Notes |
| --- | ---: | --- | --- |
| `/old-gallery.php` | 1 | `/gallery/` | Starter example used by e2e tests. |
| `/events/<old-id>` | TODO | `/events/<new-slug>/` | Fill from audit. |
| `/venues/<old-id>` | TODO | `/venues/<new-slug>/` | Fill from audit. |
| `/performers/<old-id>` | TODO | `/performers/<new-slug>/` or `/performers/` | Fill from audit. |
| `/archive/<year>/<month>` | TODO | `/events/calendar/<yyyy-mm>/` or `/events/past/` | Fill from audit. |

Data file shape:

```json
[
  { "from": "/old-gallery.php", "to": "/gallery/" }
]
```

## Verification

```powershell
$env:BUILD_NOW='2026-10-01T22:00:00-04:00'; npm run build
npm test -- tests/unit/seo-config.test.ts
npx playwright test tests/e2e/journeys.spec.ts -g "legacy"
npm run test:links
```

Manual checks:

- Open each 301 source and confirm the final URL.
- Open a generated redirect page with JavaScript disabled and confirm the visible link works.
- Confirm generated redirect pages are `noindex`.
- Confirm targets exist.

## Updating the map

When an old URL target changes:

1. Update `src/data/legacy-redirects.json`.
2. Update server redirects if it is a high-value route.
3. Rebuild.
4. Re-run link and redirect tests.
5. Update this document.

## After DNS cutover

- Keep redirects indefinitely where practical.
- Submit sitemap to search engines.
- Monitor 404s or analytics for old URL hits.
- Add missing redirects when real visitors find gaps.
