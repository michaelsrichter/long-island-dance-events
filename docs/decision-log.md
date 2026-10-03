# Decision log

This log keeps reusable architecture, UX, content, security and operations decisions. Project teams can add dated decisions below the starter decisions.

| # | Area | Decision | Rationale | Revisit when |
| ---: | --- | --- | --- | --- |
| 1 | Architecture | Use Astro static output for public pages. | Static pages are fast, cheap and simple for volunteer groups. | The site needs authenticated member-only pages. |
| 2 | Hosting | Use Azure Static Web Apps. | Free/low-cost hosting, previews, managed Functions and automatic HTTPS. | A project already has another hosting standard. |
| 3 | Editing | Use Decap CMS backed by GitHub pull requests. | Editors get a UI; developers keep review, preview and history. | Editors need real-time database workflows. |
| 4 | Auth | Use a small GitHub OAuth bridge in managed Functions. | Avoids third-party CMS auth services and keeps tokens off the server. | Moving to a hosted CMS. |
| 5 | Schemas | Use Astro content collections with shared Zod schemas. | Content errors fail fast in local dev and CI. | CMS supports richer native validation. |
| 6 | Publishing | Require explicit `published` booleans. | Editors can see the true state in CMS toggles. | Decap changes toggle behavior. |
| 7 | Events | Model `host: home` and `host: community`. | Generic home organization naming avoids hard-coded brand keys. | Supporting multiple equal home organizations. |
| 8 | Sorting | Show home events before community events. | Visitors usually came for the organization site; community listings are extra value. | The site is only a community calendar. |
| 9 | Hero | Homepage hero uses next confirmed home event. | Community events should not replace the organization's call to action. | User research shows otherwise. |
| 10 | Recurrence | Generate series occurrences and use event overrides for single dates. | Reduces repeated data while allowing cancellations and band nights. | Complex recurrence rules are needed. |
| 11 | Past events | Compute past/upcoming by event end time. | Events in progress remain upcoming until they end. | Multi-day festivals need richer display. |
| 12 | Client expiry | Promote the next candidate if a built page is viewed after an event ends. | Static sites may not rebuild exactly at event end. | Continuous rebuilds become available. |
| 13 | Show more | Show the next three home events before community listings. | Keeps pages short while showing enough upcoming dates. | A project has very sparse events. |
| 14 | Filters | Filters disable collapsed lists and reveal all matches. | Hidden matches would confuse users. | Filter UI changes. |
| 15 | Calendar feeds | Provide home and community `.ics` feeds separately. | Visitors can subscribe only to what they trust/want. | A project wants one combined feed. |
| 16 | Add-to-calendar | Include Google, Outlook, work/school Outlook and `.ics`. | Covers common visitor workflows. | Calendar providers change URLs. |
| 17 | Sharing | Provide native share and accessible fallback dialog. | Works on phones and desktop browsers. | Browser support changes. |
| 18 | Theme | Support light/dark/auto with localStorage. | Respects user preference without accounts/cookies. | Branding requires single theme. |
| 19 | No JavaScript | Keep event list usable without JS. | Accessibility, resilience and SEO. | Interactive app replaces static pages. |
| 20 | Images | Use responsive images and never upscale. | Prevents blurry images and excess bytes. | Image service changes. |
| 21 | Focus crops | Store focus points in content. | Editors can protect faces/action in different aspect ratios. | Crops become manual art direction. |
| 22 | Sample photos | Ship only open-licensed sample photos with credits. | Avoids accidental reuse of private production photos. | A project replaces all photos. |
| 23 | Videos | Keep slideshow video support but ship no sample video. | Feature remains available without licensing risk. | A site needs video examples. |
| 24 | Map | Use Leaflet/OpenStreetMap, not a proprietary embedded map. | No API key and good accessibility fallback list. | A project needs advanced routing. |
| 25 | Geocoding | Use Census first, Nominatim fallback at one request/second. | Free US source first; respectful fallback. | Non-US sites need another source. |
| 26 | Geocoding guard | Use settings map center and max distance. | Prevents wrong far-away matches. | A region spans a very large area. |
| 27 | Venue details | Show parking, accessibility, photos/reviews links. | Visitors need practical arrival information. | Venue data is not available. |
| 28 | Community listings | Require source and organizer for community events. | Avoids implying the home organization controls them. | Community listings are removed. |
| 29 | External links | Link teachers/bands to their own sites wherever mentioned. | Helps visitors learn more without cluttering cards. | External links prove stale. |
| 30 | CMS config | Keep `cms/config.yml` as source and generate public config. | Allows YAML anchors and avoids editing generated files. | CMS config pipeline changes. |
| 31 | OAuth guidance | Document token-expiration checkbox, callback updates and EMU limitation. | These are common setup failures. | GitHub OAuth UX changes. |
| 32 | Analytics | Make GA4/Clarity optional and consent-gated. | Privacy-friendly default. | Legal/privacy review chooses different policy. |
| 33 | Telemetry | Use first-party OpenTelemetry with validation and rate limits. | Gives operational insight without cookies. | Monitoring is not desired. |
| 34 | Metrics prefix | Default metrics prefix is `site`, configurable with `METRICS_PREFIX`. | Avoids confusion with the `home` host key. | Metrics naming standard changes. |
| 35 | CSP | Generate script hashes postbuild and reject inline styles. | Strong default security with Astro static output. | Framework output changes. |
| 36 | Admin CSP | Use a separate admin CSP. | Decap CMS needs different script/style permissions. | CMS changes. |
| 37 | Redirects | Use both server 301 routes and generated meta-refresh pages. | High-value old URLs get true redirects; long-tail URLs still work. | Hosting supports unlimited redirects. |
| 38 | 404 safety net | Keep a helpful 404 and optional legacy pattern handling. | Visitors should not dead-end. | All old URLs are mapped. |
| 39 | SEO | Unique titles/descriptions, canonical URLs, sitemap and JSON-LD. | Improves search snippets and answer engines. | SEO strategy changes. |
| 40 | JSON-LD | Use `NGO`, `WebSite`, `DanceEvent`, `Place`, `FAQPage`. | Provides structured data from content already maintained. | Schema.org guidance changes. |
| 41 | Header | Keep header compact and wrapping. | Prevents mobile overflow and desktop crowding. | Navigation grows. |
| 42 | Touch targets | Test next-dance card targets at 44 px or taller. | Mobile usability and accessibility. | Design tokens change. |
| 43 | Keyboard | Test skip link, menu, calendar menu and focus indicators. | Ensures non-pointer workflows. | Navigation components change. |
| 44 | Axe | Run axe on key pages in desktop and mobile projects. | Catches regressions automatically. | Tooling changes. |
| 45 | Link checker | Check internal links and fragments after build. | Prevents broken static pages. | Site becomes dynamic. |
| 46 | Smoke test | Keep a deployed-site smoke script. | Verifies headers, redirects, feeds, CMS and API after deploy. | Hosting changes. |
| 47 | Rebrand helper | Provide a script for first-pass names/domain/email/package updates. | Reduces mechanical mistakes. | Template variables are handled upstream. |
| 48 | Documentation | Keep full reusable docs, not only stubs. | Future projects need launch/checklist guidance. | Docs move to a separate kit. |
| 49 | Audit templates | Keep migration/audit docs as fill-in templates. | Every organization has different legacy content. | No legacy site exists. |
| 50 | Test data | Keep e2e tests as one-to-one guardrails with sample names. | Future rebrands know exactly what assumptions to update. | Tests become generated from fixtures. |

## Long Island Dance Events decisions (2026-10)

These project decisions replace starter decisions 7-9, 13, 15, 28, 37-38 and 49, which were for a single organization's own website.

| # | Area | Decision | Rationale | Revisit when |
| ---: | --- | --- | --- | --- |
| P1 | Purpose | This is a regional aggregator for Nassau and Suffolk, not one club's site. There is no "home" organization; all events are equal, sorted by date. | The brief asks for "the definitive" Long Island listing. | A partner organization wants featured placement. |
| P2 | CMS | Keep **Decap CMS** instead of Keystatic (deviation from the brief). | The starter and kit are built and tested around Decap (OAuth bridge Function, generated config, admin CSP, e2e test, editor guide). Both store edits as git commits, so GitOps is unchanged. | Keystatic is needed for a feature Decap lacks, or Decap is unmaintained. |
| P3 | Data | Entities are JSON files (events, venues, organizers, instructors, performers, sources) linked by file name (id). Styles, FAQs and settings stay YAML. | JSON is easy for the ingest program to write with stable key order; small diffs in pull requests. | Editors find JSON hard in the CMS (they use forms, so unlikely). |
| P4 | Repeating events | One event file per repeating listing with an RRULE subset (weekly, monthly by ordinal weekday, INTERVAL, UNTIL, COUNT, RDATE, EXDATE); occurrences are expanded at build time up to 120 days ahead. | Fewer files, readable "every Tuesday" text, and calendar export works. | Sources need yearly or daily rules. |
| P5 | Inferring repeats | Monthly "Nth weekday" rules are used only when the source says so, or when 2+ months show 3+ matching dates. Otherwise dates are listed (RDATE). A weekly series with one missing date gets an EXDATE. | Avoids guessing a pattern from one month (e.g. "alternating Tuesdays"). | More months of history are stored. |
| P6 | Scope | A listing is kept only if its town is in `src/data/long-island-places.json` (Nassau + Suffolk, 283 places with aliases). Others are counted as "out of area". | The brief limits scope to Nassau and Suffolk. Clear, testable rule. | The owner wants nearby Queens events. |
| P7 | Own words | Titles and summaries are generated from facts by `ingest/lib/describe.ts`; original wording is never stored in git. Raw PDFs are cached locally only (Blob storage in phase 6). | Copyright guardrail in the brief (§5). | A source grants permission to quote. |
| P8 | Review | Low-confidence listings (< 0.6) and listings that vanish from a month the source still covers become `pending-review` and are hidden. Nothing is ever deleted; ended events become `past`. | Never guess; keep history. | A moderation UI exists (phase 5) and thresholds can be tuned. |
| P9 | Hand edits win | Fields listed in an event's `lockedFields` are never overwritten by the weekly run. | Editors can fix mistakes in a source without losing them next week. | - |
| P10 | PDF reading | A custom font-aware extractor (PyMuPDF) replaces the kit's `parse-pdf-calendar.py` for The Dance Calendar. | The kit parser joined text across town headers that contain commas ("Little Neck, Queens"). Font size/bold gives reliable day, section and town headings. | The newsletter layout changes (golden test will fail). |
| P11 | Test "now" | Tests and CI pin `BUILD_NOW` to 8 AM New York time on the day of the latest scrape (`scripts/build-now.mjs`). | Results stay repeatable while the data changes weekly. Production builds use the real time. | - |
| P12 | Corrections | Corrections, new listings and opt-out/takedown requests use GitHub issue forms for the MVP (free account needed). | No backend needed yet. Phase 5 adds a public form that writes to Table Storage and opens the issue. | Phase 5 ships. |
| P13 | Takedown email | No public email is shown yet. | The owner has not chosen a public contact address; we do not publish a work email without permission. | The owner picks an address (set `email` in `settings/site.yml`). |
| P14 | Weekly email | The weekly run (phase 7) will open a pull request that @mentions and requests review from `michaelsrichter`; GitHub's own notification email is the weekly email. | Free, no secrets, no mail app registration in a corporate tenant. The PR already carries the run report. | The owner wants a custom HTML email (then use a free transactional email service with a GitHub secret). |
| P15 | Photos | No owner photos yet. Reuse the starter's openly licensed CC BY 2.0 photos (Thomas Quine) with credit and the caption "not a Long Island event". | The brief says no photos were supplied; never imply a photo shows a local event. | Organizers share photos with permission. |
| P16 | Map | Map pins use venue coordinates from the U.S. Census geocoder or Nominatim, checked to be within 130 km of the Long Island map center; two venues were set by hand from OpenStreetMap. | Free, no API key. | - |
| P17 | Focus | The site leads with **dances and live music**. Home shows today's dances and this week's dances; classes get a shorter "Classes this week" section. The events list starts on "Dances & live music" (`category` left out of the address), with "Live music", "Classes" and "Everything" one tap away. Home search looks at everything (`category=all`). Without JavaScript every event shows. | Owner feedback: "we should be showing dance and live music events." Classes outnumber dances about 3 to 1 in the source, so an unfiltered list buried the dances. | Owners want classes to have equal billing. |
| P18 | Look | Modern theme: black, dark red, silver and white; Inter (variable web font) for all text; dark header, heroes and page headers with soft red gradients; white or near-black content cards with a red edge for dances and a silver edge for classes; swipeable quick links and sticky day headings on phones. Light and dark modes keep the same tokens pattern. | Owner preference ("black, dark red, silver and white … sans serif … clean gradients … prioritize mobile portrait"). A single web font also makes layouts identical on every device and in Linux CI. | Brand guidelines change. |
| P19 | Hosting | Live on Azure Static Web Apps **Free** (`swa-li-dance-events-web`, resource group `rg-li-dance-events-web`, East US 2) with managed Functions, Log Analytics (0.1 GB/day cap, 30-day retention) and Application Insights, all from `infra/main.bicep` via `infra/deploy.ps1`. URL: https://black-dune-0e0f3e40f.1.azurestaticapps.net. `ALLOW_INDEXING=false` until the owner launches. | ~$0/month; same pattern as the owner's other community sites. | A custom domain is added (then set `SITE_URL`, `ALLOWED_HOSTS`, the OAuth callback, and `ALLOW_INDEXING=true`). |
| P20 | Storage | The Azure Storage account (Tables + Blobs) is **not created yet**; it arrives with phase 5 (feedback, moderation queue, run logs). | Nothing uses it yet. SWA Free managed Functions cannot use managed identity, so how Functions reach Storage (connection string in app settings vs. short-lived SAS) is a phase-5 design choice. An unused account would only add something to secure. | Phase 5 starts. |
| P21 | Community | **Proposal, awaiting owner decision (not decided).** Visitor sign-in (Google, Facebook, email code; Instagram is not possible for personal accounts) for likes, comments and photos, all moderated by AI plus a human queue. The proposal recommends Microsoft Entra External ID + our own Functions + one Storage account + Azure AI Content Safety on SWA Free (about $0.10-$0.50 a month at 200-2,000 signed-in users), with SWA Standard ($9 a month) as runner-up; phase 1 = likes + text comments, phase 2 = photos. See [docs/proposals/social-sign-in-and-community-features.md](proposals/social-sign-in-and-community-features.md). | The owner asked for options with costs before choosing. Owner must decide: the option, which subscription/tenant owns visitor accounts (plus a custom domain), and the age and photo rules. | The owner chooses an option (then replace this row with the decision). |
