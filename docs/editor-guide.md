# Editor guide

This guide is for people who update events, pages, venues, photos and announcements. The Riverbend content is fictional sample content. Replace it during rebranding, but keep the workflow.

## How editing works

1. Go to `/admin/` on the live or preview site.
2. Sign in with GitHub.
3. Edit content in Decap CMS.
4. Save. The CMS creates a draft/change in GitHub.
5. Automated checks run and a preview site is created.
6. Review the preview.
7. Publish/merge when ready.

Do not put private member data, volunteer phone lists or secrets in content. Everything in `src/content` is public.

## See what's coming up

Use these pages before editing:

- `/events/` for the full upcoming list.
- `/events/calendar/` for a month view.
- `/events/map/` for venue pins.
- `/events/past/` for archive checks.
- `/admin/` for CMS entries.

The homepage hero is the next confirmed `host: home` event. Community events can happen sooner but do not replace the home hero.

## Change one date of a series

Use this for a band night, guest teacher, theme, price change or cancellation in a recurring series.

1. In CMS, create a new **Event**.
2. Title it for that night, for example `Live Band Thursday`.
3. Set **Weekly series** to `Thursday Night Swing`.
4. Set **Series date being changed** to the date, for example `2026-10-22`.
5. Leave inherited fields blank unless they change.
6. Add changed band, teacher, price, summary or cancellation details.
7. Keep `published: true` if the public should see it.
8. Preview the generated URL. The URL remains based on the series slug: `/events/2026-10-22-thursday-night-swing/`.

Verify:

- Event card shows the override title/details.
- At-a-glance table shows the changed price/time/lineup.
- Calendar feed includes the override.

## Cancel an event

1. Create or edit the one-date override for the date.
2. Set `status: cancelled`.
3. Add `cancelledMessage` in plain language.
4. Keep `published: true` so visitors know not to come.
5. Do not delete the date unless it was never announced.

Good cancellation message:

> This sample cancellation keeps the date visible so visitors know not to come.

Verify:

- Upcoming cancelled events stay visible and show a red alert.
- Past cancelled events remain visible in the archive.
- The event page title/status says Cancelled.

## Postpone an event

1. Edit the original event or override.
2. Set `status: postponed`.
3. Add `cancelledMessage` explaining the change.
4. If you know the new page, set `postponedTo` to `/events/<new-date-slug>/`.
5. Create the new event if needed.

Verify the old page links to the new page.

## Create a one-time home event

Use a one-time event for workshops, Saturday dances, fundraisers or special concerts.

Required fields:

- `title`
- `published: true`
- `status: scheduled`
- `startDateTime`
- `endDateTime` when known
- `host: home`
- `venue` or address fields
- `summary`
- `eventTypes`
- `danceStyles`
- price fields or clear admission notes

Recommended fields:

- `lessonStartTime`
- `danceStartTime`
- `danceEndTime`
- `instructorNames`
- `bandName` or `djNames`
- `featuredImage` and `featuredImageAlt`

Verify the event appears in:

- `/events/`
- `/events/calendar/`
- `/events/map/` if it has coordinates
- `/events/club-events.ics`

## Duplicate an event safely

When copying a previous event:

1. Change the title if needed.
2. Change dates and times.
3. Remove old cancellation/postponement messages.
4. Confirm prices.
5. Confirm venue.
6. Confirm teacher/band/DJ.
7. Confirm image rights and alt text.
8. Preview the page.

Never copy an old event with `published: false` unless you intend to keep it hidden.

## Add a community event

Community listings are useful but must be clearly sourced.

Required:

- `host: community`
- `organizer` relation
- `sourceName`
- `sourceUrl` when available
- venue or address
- date/time
- contact method through the organizer

Good examples:

- `Beacon Blues Night` from `Beacon Blues Collective`.
- `Ballroom Sampler Social` from `Valley Ballroom Society`.

Verify:

- The event has a **Community event** badge.
- It appears after home events.
- The page shows a community-event warning.
- The page shows organizer, contact and source.
- The home hero still shows the next home event.

## Add or edit organizers

Collection: `src/content/organizers/`

Fields:

- `name`, `shortName`
- `active`
- `website`, `email`, `phone`, social links
- `town`
- `venue`
- `danceStyles`
- `tagline`
- `classes`
- `sourceName`, `sourceUrl`

Use organizer pages for other groups, not for the home organization. The home organization details live in settings.

Verify `/community/` after editing.

## Teacher, band and DJ links

Collections:

- `src/content/instructors/`
- `src/content/performers/`

Each profile can include:

- `website`
- `facebookUrl`
- `instagramUrl`
- `youtubeUrl`
- `moreLinks`
- `danceStyles`
- image fields if you have permission

The first available link is used wherever the person is mentioned on cards and event pages. Keep it official and current.

Verify:

- Event cards link teacher/band names to their website.
- Event page lineup links to the profile and external site.
- Performer page shows the website link.

## Dance styles

Collection: `src/content/styles/`

Fields:

- `name`
- `order`
- `family` (`swing` or `other`)
- `summary`
- `description`
- `tempo`

Use styles for filters and tags. Keep summaries short so cards stay readable.

## Venues and map

Collection: `src/content/venues/`

Required:

- `name`
- `address`
- `city`
- `state`

Recommended:

- `postalCode`
- `phone`
- `website`
- `latitude`, `longitude`
- `coordinatesSource`
- `directionsUrl`
- `googleMapsUrl`
- `parkingNotes`
- `accessibilityNotes`
- `factsSource`

Run geocoding after address edits:

```powershell
npm run geocode -- --dry
npm run geocode -- --force
```

Use `--center=lat,lng` and `--max-distance-km=80` for a new region. The settings file also has `mapCenter` and `maxDistanceKm`.

Verify:

- `/venues/<slug>/` shows parking and accessibility.
- `/events/map/` has a pin.
- Directions links open maps.

## Homepage slideshow

Collection: `src/content/gallery/`

Set `homepageSlideshow: true` on one or more albums. Each image needs:

- `image`
- `alt`
- optional `caption`
- optional `credit`
- optional `creditUrl`
- optional `focus`

Use only images you have permission to publish. The starter's sample album uses CC BY 2.0 photos and must keep credits.

Verify:

- Homepage slideshow has meaningful alt text.
- The counter and controls work.
- Credits show where required.

## Announcement banner

Collection: `src/content/announcements/`

Fields:

- `message`
- `linkUrl`
- `linkText`
- `level` (`info` or `important`)
- `startDate`
- `endDate`
- `published`

Use banners sparingly for cancellations, venue changes or launch notices. Do not use a permanent sample banner.

Verify the banner is visible only in the intended date range.

## Archive and past events

Past events are generated automatically when their end time is before `BUILD_NOW` or the real current time.

Use `/events/past/` and `/events/past/<year>/` to check archives. Cancelled past events should remain visible if they were announced.

For old sites with a large archive, keep a year summary in `src/data/legacy-history.json` or a plain content page instead of migrating every old event.

## Photos and focus points

Focus point format: `50% 30%`.

Guidance:

- Use `50% 30%` for faces near the top center.
- Use `45% 40%` when the action is slightly left.
- Use `62% 40%` when the dancer/action is right of center.
- Avoid important text in images.
- Do not upscale tiny photos.

Verify:

```powershell
npm test -- tests/unit/photos-map.test.ts
npx playwright test tests/e2e/journeys.spec.ts -g "photos"
```

## Pages and prices

Editable pages live in `src/content/pages/`.

Settings prices live in `src/content/settings/site.yml` under `standardPrices`. Event-specific prices override the standard prices.

When prices change:

1. Update settings for standard prices.
2. Update upcoming event overrides that have special prices.
3. Update membership page copy if needed.
4. Run tests and preview event cards.

## Checking a change before it goes live

For content-only changes:

```powershell
npm test -- tests/unit/schemas.test.ts
$env:BUILD_NOW='2026-10-01T22:00:00-04:00'; npm run build
npm run test:links
```

For layout, scripts, schema or behavior changes:

```powershell
npx astro check
npx vitest run
npm test --prefix api
npx playwright test
```

In GitHub, review the pull request preview before merging.

## Rollback from an editor mistake

| Mistake | Fast fix | Longer fix |
| --- | --- | --- |
| Wrong date/time | Edit the event and publish a fix | Add a note if visitors may have seen it. |
| Accidental publish | Set `published: false` | Revert the pull request if needed. |
| Wrong image | Remove image fields | Replace with a licensed image and alt text. |
| Bad venue coordinate | Correct latitude/longitude manually | Re-run geocoding after fixing address. |
| CMS field broken | Edit file in GitHub | Fix CMS config/schema if it is a repeated problem. |
| Bad deployment | Re-run previous workflow | Revert commit and redeploy. |

## CMS sign-in setup

Create a GitHub OAuth app:

- Homepage URL: `https://<domain>`
- Authorization callback URL: `https://<domain>/api/callback`
- Uncheck **Expire user access tokens**.

Set Azure app settings:

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `ALLOWED_HOSTS=<domain>,<azure-host>`

When a custom domain is added, update the callback URL. Enterprise Managed User accounts cannot be collaborators on personal repositories; use an organization repository if editors use EMU accounts.

## Alternatives if sign-in breaks

| Problem | What editors see | Fix |
| --- | --- | --- |
| Missing OAuth settings | "CMS sign-in is not configured" | Add client id/secret app settings. |
| Wrong callback | GitHub OAuth error | Update OAuth app callback. |
| Host not allowed | 503 or unknown host | Add domain to `ALLOWED_HOSTS`. |
| EMU collaborator issue | GitHub cannot add editor | Move repo to an organization that supports the account. |
| CMS config error | Config Errors panel | Run `npm run cms:config`, fix `cms/config.yml`. |
| GitHub outage | Sign-in fails | Edit files directly in GitHub and retry later. |

## Recovering from mistakes

| Scenario | Steps |
| --- | --- |
| Published an incorrect event | Edit event, add correction note if needed, publish. |
| Deleted an entry | Restore from Git history or revert the CMS commit. |
| Broke the build | Read CI log, fix first schema/type error, rerun. |
| Uploaded unlicensed photo | Remove immediately, replace with permitted image, document source. |
| Wrong redirect | Fix `src/data/legacy-redirects.json` or `staticwebapp.config.json`, rebuild. |
| Analytics configured before privacy review | Remove IDs/variables and redeploy. |

## Plain-language writing tips

- Use short sentences.
- Put time, place and price near the top.
- Spell out who runs the event.
- Say when beginners are welcome.
- Avoid inside jokes and unexplained acronyms.
- Keep cancellation messages direct.
- Prefer text over flyers for schedules.
