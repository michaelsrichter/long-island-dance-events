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

## Custom events

| Event | When | Properties |
| --- | --- | --- |
| `page_view` | Every page (OTel only; GA4 records its own page view) | `page_type`, `release` |
| `view_event` | Event detail page | `event_slug`, `event_status`, `days_until`, `page_type` |
| `select_event` | Opened an event from a card, map, hero or list | `location` |
| `add_to_calendar` | Google, Outlook, Outlook work/school, per-event `.ics`, feed subscription | `method` (`google`, `outlook`, `office365`, `ics`, `subscribe_feed`), `location` |
| `share` | Native share, copy link, copy details, Facebook, email, SMS, download image | `method`, `event_slug`, `location` |
| `share_open` | Share fallback dialog opened | `event_slug`, `location` |
| `copy_failed` | Clipboard copy failed | `method`, `location` |
| `get_directions` | Directions opened | `method` (`google`, `apple`), `location` |
| `outbound_click` | Website/social/phone/email/reviews link opened | `method`, `location`, `target` |
| `click_hotline` | Hotline phone link tapped | `location` |
| `click_email` | Public email link tapped | `location` |
| `newsletter_click` | Email list link opened | `location` |
| `filter_events` | Event filters changed | `filter`, `value`, `results` |
| `view_calendar_month` | Calendar moved to another month | `method` (`previous`, `next`, direct link) |
| `show_more` | Show-more list expanded/collapsed | `method`, `location`, `results` |
| `theme_change` | Visitor picked light, dark or auto | `method`, `location` |
| `faq_open` | FAQ question opened | `question` |
| `empty_state` | Visitor saw an empty upcoming list | `location` |
| `consent_update` | Visitor changed analytics choice | `value`, `mode` |
| `web_vital` | Core Web Vitals | `metric`, `rating`, numeric value |

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
| `site.web.page_views` | Counter | `page_type`, `release` |
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
- Log Analytics is capped in infrastructure parameters to reduce cost.
- Keep analytics documentation synchronized with the public privacy page.
