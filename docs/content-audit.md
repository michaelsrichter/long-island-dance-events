# Content audit and migration report template

Use this template before replacing the sample content. The goal is to decide what to keep, rewrite, merge, redirect or delete.

## Summary

| Item | Finding |
| --- | --- |
| Platform | TODO: old CMS/static host/social page/spreadsheet. |
| Pages fetched | TODO count and crawl date. |
| Event archive | TODO date range and number of entries. |
| Next dated event on the old site | TODO. |
| Images | TODO count, known permission status and alt text quality. |
| Titles and descriptions | TODO duplicate titles/descriptions. |
| Dead calls to action | TODO. |
| External links | TODO count and issues. |

## Additional sources

| Source | What was taken | Counts | Notes |
| --- | --- | --- | --- |
| Current organizer spreadsheet | Upcoming home events, prices, venue notes | TODO | Confirm with event chair. |
| Sample community listing | Beacon Blues Night details | 1 example | Replace with real source. |

## Facts migrated (and where they came from)

| Fact | Value on the new site | Source on the old site | Status |
| --- | --- | --- | --- |
| Organization | Riverbend Swing Dance Club, Inc. | Sample settings | Replace/confirm. |
| Weekly dance | Thursday Night Swing at Riverbend Community Hall | Sample series | Replace/confirm. |
| Lesson | 7:30 PM | Sample series | Replace/confirm. |
| Social dancing | 8:00 to 10:30 PM | Sample series | Replace/confirm. |
| Admission | $15 general, $10 members, $5 students | Sample settings | Replace/confirm. |
| Hotline | (555) 010-0123 | Sample settings | Replace/confirm. |
| Email | info@example.org | Sample settings | Replace/confirm. |

## Duplicated, stale, contradictory or incomplete content

| Issue | Where found | Decision | Owner |
| --- | --- | --- | --- |
| Old flyer says a different end time | TODO | Confirm and store once in event fields | TODO |
| Former venue still appears on old pages | TODO | Redirect to venues archive or remove | TODO |

## Crawled page inventory

| Page type | Pages fetched | Legacy addresses mapped |
| --- | ---: | ---: |
| Home/info pages | TODO | TODO |
| Event details | TODO | TODO |
| Event archive/month pages | TODO | TODO |
| Venue pages | TODO | TODO |
| Performer/teacher pages | TODO | TODO |
| Gallery/images | TODO | TODO |
| Feeds/search/member pages | TODO | TODO |

## Event archive by year

| Year | Entries | Notes |
| --- | ---: | --- |
| 2025 | 2 | Sample past events in starter. |
| 2026 | 13 | Sample current/past/future events in starter. |
| TODO | TODO | Fill from audit. |

## Venues

| Venue | Old address | Status |
| --- | --- | --- |
| Riverbend Community Hall | `/old-venue-main` | Migrated to `/venues/riverbend-community-hall/` (sample). |
| TODO | TODO | TODO |

## Bands, DJs and teachers

| Name | Old address | Status |
| --- | --- | --- |
| Maya Rivera | TODO | Sample instructor at `/performers/maya-rivera/`. |
| The Riverbend Syncopators | TODO | Sample band at `/performers/riverbend-syncopators/`. |
| TODO | TODO | TODO |

## Images

| Image group | Count | Rights status | Decision |
| --- | ---: | --- | --- |
| Starter sample CC BY photos | 10 | Known CC BY 2.0 | Keep with credit or replace. |
| Old site photos | TODO | TODO | Confirm before uploading. |
| Flyers/posters | TODO | Often text-only | Enter facts as events; avoid image-only schedules. |

## External links

| URL | Status | Decision |
| --- | --- | --- |
| `https://example.com/community-calendar` | Sample placeholder | Replace with real source. |
| TODO | TODO | TODO |

## Recommended migration decisions

| Old content | New destination | Reason |
| --- | --- | --- |
| Home page | `/` | Preserve main entry point. |
| Upcoming events | `/events/` | Primary visitor task. |
| Old gallery | `/gallery/` | Example redirect. |
| Old venue pages | `/venues/<slug>/` or `/venues/` | Preserve directions/parking value. |
| Old teacher/band pages | `/performers/<slug>/` or `/performers/` | Preserve search traffic. |

## Open questions for volunteers

- [ ] Confirm legal name.
- [ ] Confirm public phone/email.
- [ ] Confirm membership price and year.
- [ ] Confirm venue accessibility notes.
- [ ] Confirm photo permissions.
- [ ] Confirm which community organizers should be listed.
- [ ] Confirm old URLs that matter most.

## SEO and AI-answer improvements

- Unique page titles and descriptions.
- Clear event schema for dates, venue, prices and performers.
- FAQ structured data.
- Sitemap generated from current pages.
- `llms.txt` with public factual summary.
- Redirects from old URLs.

## Usability improvements

- Next event visible on homepage.
- Beginner promise visible early.
- Prices shown on cards/pages.
- Directions and calendar actions one click away.
- Community listings labeled.
- Map plus accessible list.
- No-JS event list.

## Sources to credit

| Source | What it supports | How credited |
| --- | --- | --- |
| Sample community listing | Sample community events | `sourceName` on event. |
| Wikimedia Commons photos | Sample gallery | Credits in gallery captions. |
| Google Maps listing | Venue photos/reviews link | Link only; do not copy reviews. |
