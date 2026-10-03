# Legacy site migration template

Use this document to explain how an old website moved into the starter. Replace TODOs with real findings.

## At a glance

| | Old site | New site |
| --- | --- | --- |
| Technology | TODO | Astro static site, Decap CMS, Azure Static Web Apps |
| Secure connection | TODO | Automatic HTTPS through Azure |
| "When is the next event?" | TODO | Homepage next-dance card with time, venue, price and actions |
| Phone layout | TODO | Next event and actions visible near top |
| Page titles | TODO | Unique titles/descriptions |
| Image descriptions | TODO | Alt text required by schema/CMS |
| Event archive | TODO | Recent events as pages; older archive summarized or redirected |
| Other community events | TODO | Separate community listings with badges and sources |
| Editing | TODO | Decap CMS with pull requests and previews |

## 1. What the old pages were like

### Homepage

Describe the old homepage: main message, schedule visibility, calls to action, photos, mobile behavior and stale content.

Example: Riverbend sample homepage now puts `Thursday Night Swing` first with lesson time, dancing time, venue, price, directions, calendar and share buttons.

### Event details and weekly listing

Record how recurring events were represented. Note whether the old site used one placeholder, repeated manual pages, flyers or a database.

### Individual event archive entries

Record fields available: date, title, venue, teacher, band, price, description, photos and old URL.

### Calendar

Record whether the old calendar has crawlable pages, endless future months, feeds or dead links.

### Join/contact/membership pages

Record phone, email, mailing address, membership details, newsletter, volunteer info and contradictions.

### Venues

Record address, parking, accessibility, map links, photos/reviews and whether venues are current or historical.

### Links, bands, teachers and community pages

Record current useful links, stale links and personal information that should not migrate.

## 2. Problems found on the old site

| # | Problem | Why it matters | What we did |
| ---: | --- | --- | --- |
| 1 | TODO duplicate titles | Search snippets are poor | Add unique titles/descriptions. |
| 2 | TODO old event placeholder | Visitors cannot trust schedule | Generate events from current series. |
| 3 | TODO images without alt text | Accessibility failure | Require alt text in schemas/CMS. |
| 4 | TODO old map API | Broken directions | Use venue links and Leaflet/OpenStreetMap. |
| 5 | TODO stale links | Dead ends | Check links in CI. |
| 6 | TODO public member pages | Privacy risk | Do not migrate private/personally sensitive pages. |

## 3. How information was reorganized

| Old place | New place |
| --- | --- |
| Home | `/` |
| Events | `/events/` |
| Calendar | `/events/calendar/` |
| Event archive | `/events/past/` and event detail pages |
| Membership | `/membership/` |
| Contact | `/contact/` |
| Venues | `/venues/` and `/venues/<slug>/` |
| Bands/teachers | `/performers/` and `/performers/<slug>/` |
| Links/community | `/community/` and `/about/` |
| RSS/Atom | `/events/rss.xml`, `/events/club-events.ics`, `/events/community-events.ics` |
| New beginner guide | `/new-to-swing/`, `/lessons/`, `/faq/` |

### How old links keep working

- High-value URLs go into `public/staticwebapp.config.json` as 301 redirects.
- Long-tail URLs go into `src/data/legacy-redirects.json` and become generated redirect pages.
- Unknown pages show the custom 404 with helpful links.

## 4. Before and after

Replace these examples with screenshots after the real migration.

| Old | New |
| --- | --- |
| TODO old homepage screenshot | `docs/images/starter/home-desktop-light.png` |
| TODO old events screenshot | `docs/images/starter/events-desktop-light.png` |

## 5. What still needs a volunteer to confirm

| Topic | Question | Owner | Status |
| --- | --- | --- | --- |
| Legal name | Is the legal suffix correct? | TODO | TODO |
| Prices | Are member/student/general prices current? | TODO | TODO |
| Venue | Are parking/accessibility notes correct? | TODO | TODO |
| Photos | Do we have permission? | TODO | TODO |
| Community listings | Which organizers should be listed? | TODO | TODO |

## 6. What other community websites do well

Use this section to compare reusable ideas, not to copy content.

| Site or source | What it does well | What this site should do |
| --- | --- | --- |
| Local dance calendar | Shows organizer and price | Community events show organizer/contact/source. |
| Regional community site | Filters by style/date | Events page filters by date, host, style, venue, lesson and search. |
| Venue site | Clear parking/accessibility | Venue pages include practical notes. |
| Safety/code-of-conduct examples | Clear expectations | Add a code of conduct page if the organization has one. |

## 7. Search engine improvements

- Unique page titles and descriptions.
- Canonical URLs from `SITE_URL`.
- Sitemap and robots output.
- Event, FAQ, organization, website and place JSON-LD.
- Redirects from old URLs.

## 8. AI answer engine improvements

- `llms.txt` summary.
- Plain-language pages.
- Structured event facts.
- FAQ content in text.
- Stable contact details in settings.

## 9. Usability improvements

- Next event at top of homepage.
- Beginner reassurance near event actions.
- Prices and venue on cards.
- Calendar/directions/share buttons.
- Community badges and legends.
- No-JS fallback.
- 320 px no-scroll checks.

## 10. Where community information comes from

| Source | What we used | How it is credited |
| --- | --- | --- |
| Sample community listing | Beacon Blues Night and other examples | `sourceName: Sample community listing` |
| Real future source | TODO | Event source line and link |
| Organizer website | Contact, class and venue details | Organizer card links |
| Venue listing | Directions/photos/reviews | Link only, do not copy reviews |
