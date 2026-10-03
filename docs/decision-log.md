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
