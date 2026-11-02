# Analytics and telemetry

The site can measure visits in three layers. Only first-party OpenTelemetry is designed to run without cookies, and even that can be disabled.

| Layer | Always on? | Cookies | Where data goes | Configure |
| --- | --- | --- | --- | --- |
| First-party OpenTelemetry (`/api/telemetry`) | Yes when endpoint is enabled | None | Azure Monitor / Application Insights | `APPLICATIONINSIGHTS_CONNECTION_STRING`, optional `METRICS_PREFIX` |
| Google Analytics 4 | Only after visitor consent (`opt-in`) | Yes | Google | `PUBLIC_GA4_ID` |
| Microsoft Clarity | Only after visitor consent | Yes | Microsoft Clarity | `PUBLIC_CLARITY_ID` |

If neither GA4 nor Clarity is configured, the consent banner is not shown. Global Privacy Control is treated as a refusal.

## Browser event sources

Events are tracked in two ways:

1. Declarative `data-track` attributes on links and buttons.
2. Explicit calls from scripts in `src/scripts/` for filters, theme, slideshow and web vitals.

All accepted events can go to OpenTelemetry. GA4 and Clarity receive events only after consent.

## Custom events (event dictionary)

Every browser event also carries `page` (the address path), `page_type`, `release`, and on event and directory pages `event_slug` and/or `entity` (for example `venue:the-paramount`, `event:<series id>`, `town:huntington`). Strings are cleaned in the browser (only letters, digits and `- . , : / # ( ) & '` are kept) so the server's checks never drop them.

| Event | When | Properties |
| --- | --- | --- |
| `page_view` | Every page (OTel only; GA4 records its own page view). A `page_type` of `404` means a missing page; `page` is the address that was missing. | `page_type`, `device` (`phone`, `tablet`, `desktop`), `ref` (the other site's name such as `google.com`, or `direct`, or `internal`), `ref_page` (when `internal`: the previous page's type, e.g. `events`, `calendar`, `map`), `utm_source`, `utm_medium`, `utm_campaign`, `entity`, `town`, `category` |
| `view_event` | Event detail page | `event_slug`, `event_status`, `days_until`, `entity`, `town`, `category` |
| `select_event` | Opened an event from a card, map, hero or list | `location` |
| `select_person` | Opened a band, DJ or teacher from a card | `location` |
| `search` | Typed in a search box (events list or a directory), 1.5 s after typing stops; or arrived with `?q=` in the address | `term` (lowercase; email addresses and phone numbers become `(hidden)`), `results` (how many matches showed; `0` = nothing found), `location` (page type), `method` (`typed`, `link`) |
| `filter_events` | Event filters changed | `filter`, `value`, `results`, `location` |
| `view_calendar_month` | Calendar moved to another month | `method` (`previous`, `next`, direct link) |
| `add_to_calendar` | Google, Outlook, Outlook work/school, per-event `.ics`, feed subscription | `method` (`google`, `outlook`, `office365`, `ics`, `subscribe_feed`), `location` |
| `share` | Shared an event or a directory page. `method`: `native` (phone share menu), `copy_text`, `copy_link`, `whatsapp`, `facebook`, `x`, `email`, `sms`, `download_image` | `method`, `event_slug` or `entity`, `location` |
| `share_open` | Share preview opened (picture + text) | `event_slug` or `entity`, `location` |
| `copy_failed` | Clipboard copy failed | `method`, `location` |
| `get_directions` | Directions opened | `method` (`google`, `apple`), `location` |
| `outbound_click` | Website/social/phone/email/reviews link opened | `method`, `location`, `target` (domain only) |
| `report_problem` | "Report a problem with this listing" | `location` |
| `sign_in_start` | Clicked a sign-in link (`/.auth/login/...`) | `location` |
| `click_hotline`, `click_email`, `newsletter_click` | Contact actions | `location` |
| `show_more` | Show-more list expanded/collapsed | `method`, `location`, `results` |
| `theme_change` | Visitor picked light, dark or auto | `method`, `location` |
| `faq_open` | FAQ question opened | `question` |
| `empty_state` | Visitor saw an empty upcoming list | `location` |
| `js_error` | A script on our own pages failed (at most 5 per page; browser add-ons are ignored) | `message` (first 100 characters), `source` (file name), `line` |
| `consent_update` | Visitor changed analytics choice | `value`, `mode` |
| `web_vital` | Core Web Vitals (metrics only, not a custom event) | `metric`, `rating`, numeric value |

### Events sent by the server (community features)

The API records these itself (no user ids, no text): `community_like` (`type`: event, venue, performer..., `value`: `like`/`unlike`), `community_save` (`value`: `save`/`unsave`), `community_note` (`type`, `kind`: `note`/`correction`, `result`: `published`/`queued`/`rejected`), `community_photo` (`type`, `result`), `community_flag` (`type`, `value`: `reported`/`hidden`, `reason`). Sign-ins are the `requests` rows named `roles` (one per sign-in).

The review center (`/moderate/`, editors only) records `review_decision` for each owner decision: `area` (`listing`, `collected`, `source`, `run`, `candidate`, `message`, `copilot`, `outreach` (an email to a website owner: `action` is `permission`, `followup`, `correction` or `test`), `setup`), `action` (for example `publish`, `fix`, `hide`, `cancel`, `undo`, `bulk`, `enable`, `permission`, `reject`, `close`, `connect`) and `count`. The full record (who, what, when, why) is in the private `ModLog` table and the review center's **Log** tab.

### Dashboard

- **Workbook:** "Long Island Dance Events: how people use the site" in resource group `rg-li-dance-events-web` (Azure portal, then **Monitor**, then **Workbooks**, or open Application Insights `appi-swa-li-dance-events-web` and choose **Workbooks**). Source: `infra/monitoring/site-usage.workbook.json`, deployed by `infra/monitoring/monitoring.bicep` (see [deployment.md](deployment.md#monitoring-dashboard-and-alerts)).
- **Portal dashboard:** "Long Island Dance Events: usage" (`dash-li-dance-events`) links to the workbook and logs.
- Sections: visitors at a glance (daily and weekly, week-over-week), what people look at (events, venues, bands, styles, towns, pages), searches (and searches that found nothing), filters, from looking to going (event page → calendar, directions, share, organizer links), sharing, community, where visitors come from (including AI assistants), phones and computers, page speed, problems (script errors, missing pages, API health), day-of-week × hour, and the data budget.
## Locations

Use consistent `location` values to make reports readable:

| Location | Meaning |
| --- | --- |
| `home_next` | Homepage featured next-dance card |
| `home` | Homepage upcoming list |
| `home_venue` | Homepage venue section |
| `events` | Main event list |
| `events_community` | Community feed/list action |
| `card` | Event card or person mention |
| `event` | Event detail main content |
| `event_aside` | Event detail side panel |
| `action_bar` | Sticky mobile action bar |
| `calendar` | Month calendar |
| `map`, `map_pin`, `map_list`, `map_popup` | Map page actions |
| `venue`, `venue_panel` | Venue page actions |
| `performer`, `performers` | Performer pages/list |
| `community` | Community organizer page |
| `contact` | Contact page |
| `header`, `footer`, `menu` | Global layout controls |

## OpenTelemetry metrics

Metric names use `METRICS_PREFIX`, default `site`. Do not use `home` as a prefix; `home` already means the home organization host key.

| Metric | Type | Dimensions |
| --- | --- | --- |
| `site.web.page_views` | Counter | `page_type`, `release`, `device` |
| `site.web.event_views` | Counter | `page_type`, `event_status`, `release` |
| `site.web.interactions` | Counter | `action`, `method`, `location`, `page_type` |
| `site.web.consent_updates` | Counter | `value`, `mode` |
| `site.web.vitals.lcp` | Histogram, ms | `page_type`, `rating` |
| `site.web.vitals.inp` | Histogram, ms | `page_type`, `rating` |
| `site.web.vitals.fcp` | Histogram, ms | `page_type`, `rating` |
| `site.web.vitals.ttfb` | Histogram, ms | `page_type`, `rating` |
| `site.web.vitals.cls` | Histogram, CLS × 1000 | `page_type`, `rating` |
| `site.telemetry.rejected` | Counter | `reason` |
| `site.cms.auth` | Counter | `result` |

Set a custom prefix in Azure app settings:

```powershell
az staticwebapp appsettings set --name <swa-name> --resource-group <rg> --setting-names METRICS_PREFIX=<slug>
```

Valid prefixes begin with a letter and contain only letters, numbers, `_`, `-` and `.`. Invalid values fall back to `site`.

## Custom events table

Custom events are written through OpenTelemetry logs with `microsoft.custom_event.name`. In Application Insights they appear in `customEvents` with dimensions such as page path, event slug, method and location.

## KQL examples

```kusto
// Most-used actions in the last 7 days
customEvents
| where timestamp > ago(7d) and name != "page_view"
| summarize count() by name, method = tostring(customDimensions.method)
| order by count_ desc
```

```kusto
// Add-to-calendar by method
customEvents
| where timestamp > ago(30d) and name == "add_to_calendar"
| summarize count() by tostring(customDimensions.method)
```

```kusto
// Most viewed upcoming event pages
customEvents
| where timestamp > ago(30d) and name == "view_event"
| summarize views = count() by event = tostring(customDimensions.event_slug)
| top 10 by views
```

```kusto
// Core Web Vitals p75 by page type; change prefix if METRICS_PREFIX is custom
customMetrics
| where timestamp > ago(7d) and name startswith "site.web.vitals."
| summarize p75 = percentile(value, 75) by name, page_type = tostring(customDimensions.page_type)
```

```kusto
// Rejected telemetry, useful for bugs or abuse
customMetrics
| where timestamp > ago(1d) and name == "site.telemetry.rejected"
| summarize rejected = sum(valueSum) by reason = tostring(customDimensions.reason)
| order by rejected desc
```

```kusto
// CMS sign-in results
customMetrics
| where timestamp > ago(30d) and name == "site.cms.auth"
| summarize attempts = sum(valueSum) by result = tostring(customDimensions.result)
```

```kusto
// Searches that found nothing (ideas for listings or wording to add)
customEvents
| where timestamp > ago(30d) and name == "search" and toint(customDimensions.results) == 0
| summarize times = count() by term = tostring(customDimensions.term), where = tostring(customDimensions.location)
| top 25 by times
```

```kusto
// From looking to going: what people do after opening event pages
let views = toscalar(customEvents | where timestamp > ago(30d) and name == "view_event" | count);
customEvents
| where timestamp > ago(30d) and name in ("add_to_calendar", "get_directions", "share", "outbound_click")
| summarize actions = count() by name
| extend per_100_event_views = round(100.0 * actions / views, 1)
```

```kusto
// Where visits come from, including AI assistants
customEvents
| where timestamp > ago(30d) and name == "page_view"
| extend ref = tostring(customDimensions.ref)
| extend kind = case(ref in ("direct", "internal"), ref,
    ref has_any ("chatgpt", "openai", "perplexity", "copilot", "gemini", "claude"), "AI assistant",
    ref has_any ("google", "bing", "duckduckgo", "yahoo", "ecosia"), "Search engine",
    ref has_any ("facebook", "instagram", "t.co", "x.com", "whatsapp", "linkedin", "reddit"), "Social",
    "Other site")
| summarize visits = count() by kind, ref
| order by visits desc
```

```kusto
// When people visit (New York time): day of week x hour
customEvents
| where timestamp > ago(30d) and name == "page_view"
| extend local = datetime_utc_to_local(timestamp, "America/New_York")
| summarize views = count() by day = dayofweek(local) / 1d, hour = hourofday(local)
| evaluate pivot(hour, sum(views))
| order by day asc
```

```kusto
// API health: requests, failures and speed per function
requests
| where timestamp > ago(7d)
| summarize requests = count(), failed = countif(success == false), p95_ms = percentile(duration, 95) by name
| order by requests desc
```

The workbook (`infra/monitoring/site-usage.workbook.json`) has about 40 more queries, one per chart.
## Setting up GA4 and Clarity

1. Create a GA4 property and Web data stream for the production domain.
2. Copy the Measurement ID (`G-...`) into GitHub variable `PUBLIC_GA4_ID`.
3. Keep Google signals off unless the organization has explicitly approved them.
4. Create a Microsoft Clarity project.
5. Copy the Project ID into GitHub variable `PUBLIC_CLARITY_ID`.
6. Set Clarity masking to **Strict**.
7. Redeploy.

Recommended GA4 key events:

- `add_to_calendar`
- `share`
- `get_directions`
- `newsletter_click`
- `click_hotline`

## Consent behavior

| Situation | Behavior |
| --- | --- |
| No GA4/Clarity IDs | No banner is shown. |
| IDs configured and no prior choice | Banner asks for consent. |
| Visitor clicks Allow | Third-party scripts may load and events are sent. |
| Visitor clicks No thanks | Only first-party telemetry continues if enabled. |
| Global Privacy Control | Treated as No thanks. |
| Footer Privacy choices | Reopens the consent controls. |

## Disable options

| Goal | How |
| --- | --- |
| Disable GA4 | Remove `PUBLIC_GA4_ID` and redeploy. |
| Disable Clarity | Remove `PUBLIC_CLARITY_ID` and redeploy. |
| Disable browser telemetry entirely | Set `PUBLIC_TELEMETRY_ENDPOINT=off` and redeploy. |
| Keep endpoint but disable Azure export | Remove `APPLICATIONINSIGHTS_CONNECTION_STRING`. |
| Change metric prefix | Set `METRICS_PREFIX=<prefix>` in app settings. |

## Privacy and cost notes

- IP addresses are not stored by the app. A short-lived in-memory salt is used only for rate limiting.
- Unknown properties are stripped before recording.
- Script-like values are rejected.
- Payloads have size and item-count limits.
- Log Analytics is capped at 0.1 GB a day (free). An alert (`sqr-li-dance-log-cap-reached`) emails the subscription owner if the cap is ever reached, because data collection then stops until the next day. To stay well under it, the Functions host no longer sends CPU/memory counters, its health-check chatter or an info line for every request (`api/host.json`), and the OpenTelemetry distro has performance counters off (`api/src/telemetry-setup.js`). Requests themselves are kept (`Host.Results`), which is what the API health charts use.
- Browser events never include names, emails, internet addresses or full referrer addresses. Search terms that look like an email address or phone number are sent as `(hidden)`.
- Keep analytics documentation synchronized with the public privacy page.
