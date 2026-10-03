# Content model

All public editable content is under `src/content/`. Schemas live in `src/lib/schemas.ts`; CMS fields live in `cms/config.yml`.

## Shared conventions

| Convention | Details |
| --- | --- |
| Slugs | Lowercase letters, numbers and single hyphens. |
| Dates | `YYYY-MM-DD`. |
| Local datetimes | `YYYY-MM-DDTHH:mm`; no timezone offset. |
| Timezone | IANA name, default helper uses local site timezone. |
| Publish toggles | Use explicit `published: true` or `published: false`. |
| Images | Every image needs alt text. |
| Focus points | `x% y%`, for example `50% 30%`. |
| Links | Full `https://` URLs for external links. |

## `settings`

File: `src/content/settings/site.yml`

| Field | Type | Purpose |
| --- | --- | --- |
| `siteName` | string | Full public name. |
| `shortName` | string | Short label in badges/buttons. |
| `legalName` | string | Legal name for footer/schema. |
| `region` | string | Area served, used in copy/schema. |
| `tagline` | string | Short homepage/metadata statement. |
| `description` | string | Search/social description under 200 characters. |
| `mission` | text | Organization JSON-LD and About copy. |
| `hotlinePhone`, `hotlineLabel` | string | Public phone and label. |
| `email` | email | Public contact email. |
| `mailingAddress` | object | `line1`, `city`, `state`, `postalCode`. |
| `newsletterUrl` | URL | Email list signup. |
| `facebookUrl`, `instagramUrl`, `youtubeUrl` | URL | Social links. |
| `facebookLabel` | string | Header/footer social label. |
| `membershipFee`, `membershipYear` | number/string | Membership page and event page copy. |
| `standardPrices` | list | Standard member/student/non-member prices by night type. |
| `defaultVenue` | relation | Homepage venue. |
| `mapCenter` | object | `lat`, `lng` used by geocoding guardrails. |
| `maxDistanceKm` | number | Rejects distant geocoder matches. |
| `socialImage`, `socialImageAlt` | image/string | Default social card image. |

## `series`

Folder: `src/content/series/`

Series create recurring events automatically.

| Field | Type | Purpose |
| --- | --- | --- |
| `title` | string | Public event title. |
| `slug` | slug | Stable URL segment. |
| `published` | boolean | Hide/show whole series. |
| `recurrence.frequency` | `weekly`/`monthly` | Repeat type. |
| `recurrence.interval` | number | Every N weeks/months. |
| `recurrence.weekday` | weekday | Day generated. |
| `recurrence.weekOfMonth` | number | Monthly only: 1-4 or -1 for last. |
| `recurrence.startDate`, `endDate` | date | Generation range. |
| `recurrence.horizonWeeks` | number | How far ahead to publish occurrences. |
| `recurrence.exceptDates` | list | Dates to skip. |
| `startTime`, `endTime` | time | Default occurrence start/end. |
| event detail fields | mixed | Inherited by generated occurrences. |

Use an event override when one occurrence changes.

## `events`

Folder: `src/content/events/`

Events are one-time events or one-date overrides.

| Field | Type | Purpose |
| --- | --- | --- |
| `title` | string | Public title. |
| `slug` | optional slug | Custom URL piece for one-time events. |
| `status` | enum | `draft`, `scheduled`, `cancelled`, `postponed`, `soldOut`, `completed`. |
| `published` | boolean | Must be explicit. |
| `featured` | boolean | Optional homepage/card prominence. |
| `series` | relation | If set, this event overrides one generated occurrence. |
| `occurrenceDate` | date | Required for series overrides. |
| `startDateTime`, `endDateTime` | local datetime | Required for one-time event start; optional end. |
| `cancelledMessage` | text | Shown for cancelled/postponed events. |
| `postponedTo` | string | Link to replacement event. |
| event detail fields | mixed | Venue, prices, images, contacts, SEO. |

### Event detail fields

| Field | Type | Purpose |
| --- | --- | --- |
| `host` | `home`/`community` | Own organization or other organizer. Defaults to home. |
| `organizer` | relation | Required for community listings. |
| `infoUrl` | URL | Organizer page for event. |
| `sourceName`, `sourceUrl` | string/URL | Where listing came from. |
| `cadence` | string | Plain-language repeat note. |
| `summary` | short text | Cards/search/social. |
| `doorsTime`, `lessonStartTime`, `danceStartTime`, `danceEndTime` | time | Schedule details. |
| `timezone` | IANA string | Optional override. |
| `venue` | relation | Preferred location reference. |
| `address`, `city`, `state`, `postalCode` | strings | One-off location override. |
| `latitude`, `longitude` | numbers | One-off map pin override. |
| `directionsUrl` | URL | Optional custom directions. |
| `instructorNames` | relations/strings | Teachers. |
| `djNames` | relations/strings | DJs. |
| `bandName` | relation/string | Band. |
| `danceStyles` | relations | Tags and filters. |
| `eventTypes` | enum list | Weekly, live band, workshop, etc. |
| `experienceLevel` | enum | all-levels/beginner/intermediate/advanced. |
| `partnerRequired` | boolean | Drives no-partner-needed text. |
| `beginnerFriendly` | boolean | Drives reassurance text. |
| `admissionMember`, `admissionNonMember`, `admissionStudent` | money | Price table. |
| `admissionNotes` | string | Cash/card/member notes. |
| `registrationUrl`, `registrationRequired` | URL/boolean | Signup CTA. |
| `capacityNotes` | string | Room limits or waitlist. |
| `featuredImage`, `featuredImageAlt`, `featuredImageFocus` | image/string/focus | Hero/card image. |
| `gallery` | list | Event-specific images/videos. |
| `sponsor` | string | Optional sponsor. |
| `contactName`, `contactEmail`, `contactPhone` | strings | Event contact override. |
| `facebookEventUrl` | URL | Event social link. |
| `seoTitle`, `seoDescription` | strings | Metadata override. |
| `lastUpdated` | date | Editorial freshness note. |
| `editorialReview` | text | Internal-only note. |
| `legacyUrl` | string | Old URL mapping note. |

## `venues`

Folder: `src/content/venues/`

| Field | Purpose |
| --- | --- |
| `name`, `shortName` | Public names. |
| `active` | Hide from active lists when false. |
| `address`, `city`, `state`, `postalCode` | Address. |
| `phone`, `website`, `facebookUrl` | Public venue links. |
| `latitude`, `longitude`, `coordinatesSource` | Map. |
| `directionsUrl`, `googleMapsUrl` | Directions and photos/reviews. |
| `parkingNotes`, `accessibilityNotes`, `factsSource` | Visitor practical info. |
| `image`, `imageAlt` | Optional venue image. |
| SEO/editorial fields | Metadata and internal notes. |

## `organizers`

Folder: `src/content/organizers/`

Community organizers run `host: community` listings.

| Field | Purpose |
| --- | --- |
| `name`, `shortName`, `active` | Public identity. |
| `website`, `email`, `phone`, `phoneAlt`, social links | Contact. |
| `moreLinks` | Additional labeled links. |
| `town`, `venue` | Location. |
| `danceStyles` | Tags/categories. |
| `tagline` | One-line description. |
| `classes` | Class summary for community page. |
| `sourceName`, `sourceUrl` | Default listing source. |
| `editorialReview` | Internal note. |

## `instructors` and `performers`

Folders: `src/content/instructors/`, `src/content/performers/`

Both use the same schema.

| Field | Purpose |
| --- | --- |
| `name` | Public name. |
| `kind` | `instructor`, `dj`, or `band`. |
| `role` | Short role label. |
| Website/social/more links | External links used wherever the person is mentioned. |
| `organizer` | Related organizer if they run one. |
| `members` | Band member list. |
| `danceStyles` | Style tags. |
| `image`, `imageAlt`, `imageFocus`, `imageCredit` | Optional profile image. |
| SEO/editorial fields | Metadata and internal notes. |

## `styles`

Folder: `src/content/styles/`

| Field | Purpose |
| --- | --- |
| `name` | Public style name. |
| `order` | Sort order. |
| `family` | `swing` or `other`. |
| `summary` | Short card/tag explanation. |
| `description` | Long page text. |
| `tempo` | Typical music. |

## `pages`

Folder: `src/content/pages/`

| Field | Purpose |
| --- | --- |
| `title` | CMS/title label. |
| `heading` | Page h1 when used by route. |
| `lede` | Intro paragraph. |
| `seoTitle`, `seoDescription` | Metadata override. |
| `image`, `imageAlt` | Optional page image. |
| `highlights` | Cards/lists on some pages. |
| `editorialReview` | Internal note. |

## `announcements`

Folder: `src/content/announcements/`

| Field | Purpose |
| --- | --- |
| `message` | Banner text. |
| `linkUrl`, `linkText` | Optional CTA. |
| `level` | `info` or `important`. |
| `startDate`, `endDate` | Optional date window. |
| `published` | Must be explicit. |

## `gallery`

Folder: `src/content/gallery/`

| Field | Purpose |
| --- | --- |
| `title`, `date`, `description` | Album metadata. |
| `order` | Sort order. |
| `published` | Must be explicit. |
| `homepageSlideshow` | Include album images in homepage carousel. |
| `images` | List of image objects. |
| `source`, `rightsNote` | Photo provenance and rights. |

Gallery image object fields:

| Field | Purpose |
| --- | --- |
| `image` | Image file. |
| `alt` | Required description. |
| `caption` | Optional visible caption. |
| `credit`, `creditUrl` | Attribution. |
| `focus` | Crop point. |
| `video` | Optional `/media/videos/*.mp4` clip. |

## `faqs`

Folder: `src/content/faqs/`

| Field | Purpose |
| --- | --- |
| `question` | Public question. |
| `answer` | Markdown answer. |
| `category` | first-visit/dancing/admission/venue/membership/volunteering. |
| `order` | Sort order. |
| `published` | Must be explicit. |
| `editorialReview` | Internal note. |

## `src/data/legacy-redirects.json`

Array of `{ from, to }` mappings used by postbuild to create redirect pages. Keep `from` as an old path and `to` as an internal path.

Example:

```json
{ "from": "/old-gallery.php", "to": "/gallery/" }
```

## `src/data/legacy-history.json`

Optional summary data for old archives that are not migrated one-by-one. Keep this valid even when empty:

```json
{ "pastPerformers": [], "pastVenues": [], "years": {} }
```
