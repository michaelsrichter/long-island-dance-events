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
- **Links** (`website`, `facebookUrl`, `instagramUrl`, `youtubeUrl`, `tiktokUrl`, `xUrl`, `spotifyUrl`, `bandcampUrl`, `bookingUrl`, `ticketUrl`, `infoUrl`, `sourceUrl`) must be full web addresses (`https://` whenever the site has it).

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
| `dancingCues` | | Clues the ingest found in the listing: `dj`, `dance-party`, `theater`, `library`, `acoustic`, `brunch`, `jam`, `afternoon`, `outdoor`, `festival`, `tribute`. They nudge the dancing score. |
| `dancing` | | Editor override of the dancing score: `likelihood` (0-1), `kinds` (`partner`, `line`, `freestyle`), `notes`. |
| `mergedFrom`, `embedding` | | Reserved for duplicate detection (phase 3). |
| `seoTitle`, `seoDescription` | | Optional search-result overrides. |

How the site uses it: each date of a repeating event becomes its own page (`/events/<date>-<id>/`) for the next 120 days. Ended events move to "Past events" by themselves, even before the next rebuild.

## Directory pictures, links and contacts (venues, organizers, teachers, bands and DJs, styles)

These fields are shared by the directory entities. They are all optional, so older files and new files from the weekly run stay valid.

| Field | Who has it | Meaning |
| --- | --- | --- |
| `website`, `facebookUrl`, `instagramUrl`, `youtubeUrl`, `tiktokUrl`, `xUrl`, `moreLinks` | venues, organizers, teachers, bands/DJs (styles: `moreLinks` only, e.g. Wikipedia) | Their own pages. Shown as round icon buttons on cards and as labelled buttons on their page. |
| `spotifyUrl`, `bandcampUrl` | bands/DJs | Music pages. |
| `bookingUrl` | bands/DJs, teachers | Their own booking or lessons page. |
| `phone`, `email` | all but styles | Public business contact only. Teachers, DJs and solo acts: only what they publish for bookings. Never a private number, private email or home address. Phone shows as a tap-to-call link, email as a mail link. |
| `hours` | venues, organizers | Plain text, e.g. "Tue-Sun 4 PM-midnight; closed Mon" (max 300). |
| `address`, `postalCode`, `county` | organizers (venues already have them) | Only for an organizer's own studio or office. |
| `town` | bands/DJs, teachers | Home base, town only. |
| `logo` | venues, organizers, bands/DJs, teachers who run a school | One image: `image`, `alt` (required when there is an image), `credit`, `creditUrl` (page it came from), `imageSource` (original file address, not shown). An empty logo box saved by the CMS counts as "no logo". |
| `photos` | all five | Up to 6 images: `image`, `alt` (required), `credit`, `creditUrl`, `licenseUrl` (Creative Commons photos), `imageSource`, `caption`, `focus` ("x% y%", what to keep in view when cropped). The first photo is the card picture and the page-top picture. |
| `evidence` | all five | Sources for these details: list of `url` + `note` (our own words, max 240). |
| `factsSource` | venues, organizers, teachers, bands/DJs | One public line, e.g. "Checked October 4, 2026. Sources: example.com, facebook.com." |

**Image files** live in `src/assets/entities/<collection>/` (for example `src/assets/entities/venues/the-nutty-irishman-farmingdale-1.webp`) and content files point to them with a relative path (`../../assets/entities/venues/...`). Astro makes small WebP copies at build time: photos are cropped to 16:9 around `focus` at 400 and 800 pixels wide; logos keep their shape at 160 and 320 pixels. Originals are kept at most 1200 pixels wide (logos 400), with EXIF data removed. The cards, page tops, galleries and JSON-LD all use the same copies.

## `venues/*.json`

`name`, `address`, `town`, `county` (`Nassau` or `Suffolk`), `state`, `postalCode`, `phone`, `email`, `hours`, website and social links (above), `latitude`/`longitude` (filled by `npm run geocode` or the "Venue map locations" workflow), `coordinatesSource`, `googleMapsUrl`, `parkingNotes`, `accessibilityNotes`, `factsSource`, `evidence`, `description`, `logo`, `photos`, `aliases` (other names used in listings, for matching), `kind` (`bar`, `restaurant`, `nightclub`, `brewery`, `winery`, `distillery`, `theater`, `concert-hall`, `park`, `beach`, `library`, `lodge-hall`, `dance-studio`, `school`, `festival`, `marina-club`, `other`), `dancing` (research: `floor` = `dance-floor`, `open-space`, `small`, `seated` or `unknown`; `policy` = `encouraged`, `allowed`, `discouraged` or `unknown`; `kinds`; `notes`; `confidence` high/medium/low; `checked` date; `evidence` = list of `url` + `note`), `reviewNotes`.

## `organizers/*.json`

`name`, `type` (`studio`, `club`, `nonprofit`, `promoter`, `venue`, `school`, `dj`, `instructor`, `other`), website and social links (above), `phone`, `email`, `address`, `town`, `postalCode`, `county`, `hours`, `homeVenueId`, `danceStyles`, `description`, `logo`, `photos`, `evidence`, `factsSource`, `aliases`, `optOut` (true = stop listing their events), `reviewNotes`.

## `instructors/*.json` (teachers)

`name`, `styles`, `affiliatedOrganizerIds`, `town`, website and social links, `bookingUrl`, `email`, `phone`, `description`, `logo` (only if they run their own school), `photos`, `evidence`, `factsSource`, `aliases`, `reviewNotes`.

## `performers/*.json` (bands and DJs)

`name`, `type` (`band`, `dj`, `solo`), `genres`, `town`, website and social links, `spotifyUrl`, `bandcampUrl`, `bookingUrl`, `email`, `phone`, `description`, `logo`, `photos`, `evidence`, `factsSource`, `aliases`, `dancing` (research: `rating` = `dance-band`, `party`, `mixed`, `listening` or `unknown`; `kinds`; `styles` people do at their shows; `notes`; `confidence`; `checked`; `evidence`), `reviewNotes`.

## `styles/*.yml` (dance styles)

`name`, `family` (`swing`, `ballroom`, `latin`, `tango`, `country`, `other`), `order`, `aliases` (words that mean this style in listings, e.g. "WCS"), `summary` (one plain sentence), `description`, `music`, `danceType` (`partner`, `line` or `freestyle`; default `partner`), `photos` (openly licensed photos of adults dancing the style, with credits), `moreLinks` (learn-more links), `evidence`.
## `sources/*.json`

`name`, `url`, `type` (`jsonld`, `ical`, `html`, `pdf`, `api`), `adapter` (file name in `ingest/adapters/`), `cadence` (`daily`, `twice-weekly`, `weekly`, `monthly`, `seasonal`, `manual`), `focus` (`dance` = a dance calendar, everything is a dance or class; `music` = a live-music list, each listing gets a dancing score), `enabled`, `feedUrl` and `pageUrls` (what generic adapters read), `defaults` (venue, town, organizer, performers, styles, category to use when a listing leaves them out), `include` / `exclude` (patterns), `catalogStatus` and `permission` (status, note, dates, feed the owner gave us), `attribution` (shown on the Sources page), `description`, `rateLimitSeconds`, and run results written by the ingest: `lastScraped`, `lastStatus`, `lastMessage`, `lastCounts` (found, kept, outOfArea, needsReview).

## Other content

- `faqs/*.yml`: `question`, `answer` (short Markdown), `category`, `order`, `published`.
- `pages/*.md`: About and Privacy text.
- `gallery/*.yml`: openly licensed photos with `credit` and `creditUrl`.
- `settings/site.yml`: site name, region, `repoUrl`, counties, map center, `maxDistanceKm` for geocoding, optional contact `email`.
- `src/data/long-island-places.json`: every Nassau and Suffolk town, village and hamlet (with common alternative names). Used to keep the site on Long Island.
