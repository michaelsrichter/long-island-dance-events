# Content model

Every listing is a small file in `src/content/`. Files link to each other by **id** (the file name without `.json`/`.yml`). The rules live in [`src/lib/schemas.ts`](../src/lib/schemas.ts) (Zod). `npx astro check` and every build validate every file, so a bad file fails CI before it can go live.

```mermaid
erDiagram
  EVENT }o--|| VENUE : "venueId"
  EVENT }o--o| ORGANIZER : "organizerId"
  EVENT }o--o{ PERFORMER : "performerIds"
  EVENT }o--o{ INSTRUCTOR : "instructorIds"
  EVENT }o--o{ STYLE : "danceStyles"
  EVENT }o--|| SOURCE : "sourceId"
  ORGANIZER }o--o| VENUE : "homeVenueId"
  INSTRUCTOR }o--o{ ORGANIZER : "affiliatedOrganizerIds"
  INSTRUCTOR }o--o{ STYLE : "styles"
```

## Shared conventions

- **Ids** are lowercase words joined by dashes (`huntington-moose-lodge`). Renaming a file changes its id; update links in other files too.
- **Dates** are `YYYY-MM-DD`. **Local date-times** are `YYYY-MM-DDTHH:mm` in the event's `timezone` (default `America/New_York`). Never store UTC offsets; the build handles summer/winter time.
- **Our own words:** `title`, `summary` and `description` are written by us (or generated from facts by the ingest program). Never paste text from a source.
- **`reviewNotes`** are private notes for editors. They are never shown on the site.
- **Links** (`website`, `facebookUrl`, `instagramUrl`, `youtubeUrl`, `ticketUrl`, `infoUrl`, `sourceUrl`) must be full `https://` addresses.

## `events/*.json`

One file per listing. A repeating listing ("every Tuesday") is one file with a `recurrence` rule.

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Short name, e.g. "Hustle class at JLR Dance Unlimited" (max 120). |
| `summary` | yes | One or two plain sentences in our own words (10-320 characters). |
| `category` | yes | `social-dance`, `class-lesson`, `lesson-party` (lesson then dance), `live-music`, `festival`. |
| `danceStyles` | | Style ids from `styles/`. |
| `start` | yes | First date and time (`2026-10-06T19:30`), or just a date if no time is known. |
| `end` | | End date and time. |
| `timezone` | | Default `America/New_York`. |
| `recurrence.rrule` | | Repeat rule, e.g. `FREQ=WEEKLY;BYDAY=TU` or `FREQ=MONTHLY;BYDAY=1FR,3FR`. Supported: `FREQ` (WEEKLY, MONTHLY), `INTERVAL`, `BYDAY` (with 1-4 or -1 for monthly), `UNTIL`, `COUNT`. |
| `recurrence.rdates` | | Extra dates, or the full list when there is no rule. |
| `recurrence.exdates` | | Dates that are skipped ("no class Oct 19"). |
| `cadence` | | The pattern as the source wrote it, e.g. "1st and 3rd Fridays". |
| `lessonTime` | | Time of the lesson before a dance (`19:30`). |
| `venueId` | one of these | Venue id. |
| `town` | one of these | Town when the venue is unknown (used for the Nassau/Suffolk check). |
| `organizerId` | | Organizer id. |
| `performerIds`, `instructorIds` | | Band/DJ and teacher ids. |
| `price`, `priceMax`, `isFree`, `priceNotes` | | Lowest and highest price per person in dollars; `isFree` for free events; notes such as "includes buffet". |
| `skillLevel` | | `all-levels` (default), `beginner`, `intermediate`, `advanced`, `mixed`. |
| `ageGroup` | | `adults`, `kids`, `teens`, `all-ages`. |
| `ticketUrl`, `infoUrl`, `contactPhone`, `contactEmail` | | Public contact details from the listing. |
| `sourceId`, `sourceUrl` | yes | Which source and the exact page/PDF it came from (attribution). |
| `sourceName`, `sourceRef` | | e.g. "The Dance Calendar, October 2026", "page 17". |
| `firstSeen`, `lastSeen` | yes | First and latest collection dates. |
| `status` | | `active`, `past`, `cancelled`, `pending-review` (hidden). |
| `cancelledNote` | | Shown on cancelled events. |
| `confidence` | | 0-1. Below 0.6 the ingest sets `pending-review`. |
| `lockedFields` | | Field names an editor fixed by hand. The weekly run never changes them. |
| `matchKey` | | Internal key that recognizes the same listing next week. Do not edit. |
| `mergedFrom`, `embedding` | | Reserved for duplicate detection (phase 3). |
| `seoTitle`, `seoDescription` | | Optional search-result overrides. |

How the site uses it: each date of a repeating event becomes its own page (`/events/<date>-<id>/`) for the next 120 days. Ended events move to "Past events" by themselves, even before the next rebuild.

## `venues/*.json`

`name`, `address`, `town`, `county` (`Nassau` or `Suffolk`), `state`, `postalCode`, `website`, `phone`, `latitude`/`longitude` (filled by `npm run geocode` or the "Venue map locations" workflow), `coordinatesSource`, `googleMapsUrl`, `facebookUrl`, `parkingNotes`, `accessibilityNotes`, `factsSource`, `description`, `aliases` (other names used in listings, for matching), `reviewNotes`.

## `organizers/*.json`

`name`, `type` (`studio`, `club`, `nonprofit`, `promoter`, `venue`, `school`, `dj`, `instructor`, `other`), `website`, social links and `moreLinks`, `phone`, `email`, `town`, `homeVenueId`, `danceStyles`, `description`, `aliases`, `optOut` (true = stop listing their events), `reviewNotes`.

## `instructors/*.json` (teachers)

`name`, `styles`, `affiliatedOrganizerIds`, `website`, social links and `moreLinks`, `description`, `aliases`, `reviewNotes`.

## `performers/*.json` (bands and DJs)

`name`, `type` (`band`, `dj`, `solo`), `genres`, `website`, social links and `moreLinks`, `description`, `aliases`, `reviewNotes`.

## `styles/*.yml` (dance styles)

`name`, `family` (`swing`, `ballroom`, `latin`, `tango`, `country`, `other`), `order`, `aliases` (words that mean this style in listings, e.g. "WCS"), `summary` (one plain sentence), `description`, `music`.

## `sources/*.json`

`name`, `url`, `type` (`jsonld`, `ical`, `html`, `pdf`, `api`), `adapter` (file name in `ingest/adapters/`), `cadence`, `enabled`, `attribution` (shown on the Sources page), `description`, `rateLimitSeconds`, and run results written by the ingest: `lastScraped`, `lastStatus`, `lastMessage`, `lastCounts` (found, kept, outOfArea, needsReview).

## Other content

- `faqs/*.yml`: `question`, `answer` (short Markdown), `category`, `order`, `published`.
- `pages/*.md`: About and Privacy text.
- `gallery/*.yml`: openly licensed photos with `credit` and `creditUrl`.
- `settings/site.yml`: site name, region, `repoUrl`, counties, map center, `maxDistanceKm` for geocoding, optional contact `email`.
- `src/data/long-island-places.json`: every Nassau and Suffolk town, village and hamlet (with common alternative names). Used to keep the site on Long Island.
