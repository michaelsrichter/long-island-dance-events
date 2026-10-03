# Editor guide

This guide is for people who keep the listings correct. You do not need to know how to code.

## How editing works

- Go to **`/admin/`** on the website and sign in with GitHub.
- Every save becomes a change in the project's history on GitHub (a "commit"). The website rebuilds by itself in a few minutes.
- Nothing is ever lost. Any change can be undone (see [Fix a mistake](#fix-a-mistake)).
- Most events are collected **automatically every week** from public calendars. Your main jobs are to **check things the program was unsure about** and **fix mistakes**.

## What you will see in the editor

| Section | What it holds |
| --- | --- |
| Events | One entry per event. A repeating event (like "every Tuesday") is one entry with a repeat rule. |
| Venues | Places: address, town, map location, parking and accessibility. |
| Organizers | Studios, clubs and people who run events. |
| Teachers | Dance teachers. |
| Bands and DJs | Musicians and DJs. |
| Sources | The calendars we collect from, and how the last run went. |
| Dance styles | The style list (Swing, Hustle, Salsa...) and other names for each style. |
| Frequently Asked Questions, Pages, Photos, Site settings | Help text and site-wide settings. |

## Check events that are waiting for review

Some events are hidden until a person checks them. This happens when the program was unsure, or when a listing disappeared from a calendar it still covers.

1. Open **Events** and choose the **Waiting for review** filter.
2. Open an event. Read **Notes for editors** at the bottom; it says why.
3. Check the facts on the organizer's own website or the original listing (the **Source link** field).
4. Fix anything wrong. Then set **Status** to **Listed** (or **Cancelled** if it is not happening).
5. In **Locked fields**, add the fields you changed, and add **status**. The weekly run will then leave them alone.
6. Save.

## Fix a wrong date, time, price or place

1. Open the event and change the field.
2. Add that field to **Locked fields**. Without this, next week's run may change it back to what the source says.
3. Save.

If the source itself is wrong, please also tell the organizer, so next month's calendar is right.

## Cancel one date of a repeating event

1. Open the event.
2. Under **Repeats**, add the date to **Skipped dates**.
3. Add **recurrence** to **Locked fields**. Save.

To cancel the whole event, set **Status** to **Cancelled** and write a short **Cancellation note** ("Cancelled for the season"). Add **status** to **Locked fields**.

## Add an event by hand

Use this for events that are not in any calendar we collect.

1. **Events → New Event.**
2. Fill in **Title** ("Salsa social at ..."), **Summary (in our own words)**, **Type of event**, **Dance styles**, **Starts**, and the **Venue** (or at least the **Town**).
3. **Source**: choose the closest source, and put the organizer's web page in **Source link**.
4. Set **Status** to **Listed**. Add **status** to **Locked fields**. Save.

Only add events in **Nassau or Suffolk** counties.

## Venues and the map

- Add a venue with its full street address. Leave **Latitude** and **Longitude** empty: a robot fills them in after you save (the "Venue map locations" workflow).
- If a pin lands in the wrong place, look the place up on [openstreetmap.org](https://www.openstreetmap.org), right-click it, choose "Show address", and copy the two numbers into Latitude and Longitude.
- **Other names used in listings** helps the program recognize the venue in listings (for example "Moose Lodge, Greenlawn").

## Organizers, teachers, bands and DJs

- Add their own website and social pages only if **they** run them. Do not guess.
- **Other names used in listings** helps matching (for example "DJ Neil" and "DJ Neil Wrangler").
- **Opt out**: if an organizer asks us to stop listing their events, open the organizer and turn on **Opted out (do not list their events)**. The weekly run then skips their events. Set any of their current events to **Cancelled** with the note "Removed at the organizer's request".

## Can you dance there? (the dancing score)

Listings from dance calendars are always dance events. Live-music listings (bands and DJs at bars, restaurants, parks and theaters) get a **dancing score** from 0 to 10, worked out from:

1. **The venue:** open the venue and fill in **Dancing here** (room to dance, whether dancing is welcome, the kinds of dancing, what you found and the web pages that show it).
2. **The band or DJ:** open them and fill in **Dancing at their shows** (dance band, party band, mixed or mostly listening).
3. **Clues in the listing** the weekly run spots, such as "DJ", "dance party", "theater", "library", "acoustic" or "brunch".

To fix one event, open it and fill in **Can you dance here? (your answer)**: a chance from 0 (no dancing) to 1 (sure), the kinds of dancing, and a short reason visitors will see. Leave it empty to let the site work it out.

Kinds of dancing: **Partner** (swing, salsa, ballroom, hustle, tango…), **Line** and **Party dancing** (freestyle, like at a club or wedding). Only write what a public page shows; add that page under **How we know (sources)**. Never use private group posts or people's personal photos.
## Sources

You can turn a source off by unticking **Turned on**. The **Last result** fields are filled in by the weekly run:

| Last result | Meaning |
| --- | --- |
| ok | Worked normally. |
| empty | Found no events. The website may have changed. |
| invalid | Found events, but some failed the checks. |
| error | Could not download or read the source. |
| skipped | The source is turned off, or its robots.txt does not allow it. |

**How often** says when the program reads the source (every day, twice a week, weekly, monthly, only in season, or only by hand). **What it lists** tells the site whether everything in the source is a dance (a dance calendar) or whether each listing needs a dancing score (a live-music list).

New sources need a small program (an "adapter") written by a developer, and the owner's approval. Many calendars can share the general calendar-feed (`ical`) and event-page (`jsonld`) adapters: then you only fill in **Feed address**, **Facts to use when a listing leaves them out** and, if needed, the **Only keep** / **Skip** patterns. See the README.

## Writing tips

- Write for an average high-school student. Short sentences. Common words.
- Say what, when, where and how much first.
- Use our own words. **Never copy text** from a flyer or website.
- Use full names for places the first time ("Huntington Moose Lodge, Greenlawn").
- Times: "7:30 PM". Dates: "Tuesday, October 6".

## Corrections from the public

Visitors use the "Report a problem" button on each event, or the forms on the **Sources** page. These open issues on GitHub with a label:

| Label | What to do |
| --- | --- |
| `listing-correction` | Check the facts, fix the event, lock the fields, close the issue with a thank-you. |
| `add-listing` | Check it is in Nassau or Suffolk and real; add it by hand, or ask a developer to add the calendar as a source. |
| `remove-listing` | Act within a week: turn on **Opted out** for the organizer, or remove the item. Reply when done. |

## Fix a mistake

| Problem | What to do |
| --- | --- |
| I saved something wrong | Open the entry, change it back, save. |
| I deleted an entry by mistake | Ask a developer to restore it from the GitHub history (nothing is lost). |
| The weekly run keeps changing my fix | Add the field to **Locked fields**. |
| The site did not update | Wait 5 minutes. If it still did not change, check the "Actions" tab on GitHub for a red X and ask a developer. |

## Sign-in setup (for the site owner)

Create a GitHub OAuth app: Homepage `https://<domain>`, callback `https://<domain>/api/callback`, and **untick "Expire user access tokens"**. Then add these Azure Static Web Apps settings: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `ALLOWED_HOSTS=<domain>,<azure-host>`. Update the callback when the domain changes. Editors need write access to the repository. Work accounts managed by a company (Enterprise Managed Users) cannot be added to a personal repository.
