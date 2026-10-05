# Editor guide

This guide is for people who keep the listings correct. You do not need to know how to code.

## How editing works

- Go to **`/admin/`** on the website and sign in with GitHub.
- Every save becomes a change in the project's history on GitHub (a "commit"). The website rebuilds by itself in a few minutes.
- Nothing is ever lost. Any change can be undone (see [Fix a mistake](#fix-a-mistake)).
- Most events are collected **automatically every week** from public calendars. Your main jobs are to **check things the program was unsure about** and **fix mistakes**.

## Your review center

Everything that needs a person is in one place: **https://longisland.dance/moderate/**. Sign in with your editor email address (one of the addresses in the `ADMIN_EMAILS` setting). You get a one-time code by email. You almost never need to open GitHub.

This table lists each tab of the review center, what it shows, and what you can do there.

| Tab | What it shows | What you can do |
| --- | --- | --- |
| **To do** | How many things wait in each tab, the oldest one, and "You're all caught up" when nothing does. | Jump to each tab. One-time GitHub setup (see below). |
| **Held listings** | Events the weekly check wasn't sure about. They're hidden until you decide. Each card says why in plain words ("No start time", "The start time looks wrong", "No venue", "New band or DJ", "Missing from the source", "Listed twice") and suggests a next step. | **Publish**, **Fix…** (start time, venue, band or DJ, town), **Mark cancelled…** (shown as cancelled), **Hide** (never shown, never deleted), **Snooze a week**, **Undo**, choose several and publish or hide them at once, **Ask Copilot** to look up a band or venue. Links: the source page, the venue and band pages, and the editor. |
| **New events** | The "Collected events" update (everything the latest check found, waiting for you to publish): how many new and changed events, whether the automatic checks passed, new venues and bands to check, and what each source found. | **Publish now** (only when the checks passed), see every change on GitHub, **Ask Copilot** to look up new venues and bands or to fix failed checks. |
| **Sources** | Sources that stopped working, new websites the monthly search found, and switched-off sources grouped by what you can do. | **Try again now**, **Switch off…**, **Worth adding** / **Not useful** for new websites, **Review and send the email…** to ask for permission (sent from the site's address after you confirm), answers shown under each source, **They said yes: switch it on**, **They said no**, **No answer**, a follow-up after 14 days, **Switch on**, **Check sources now**, and **Ask Copilot**. |
| **Messages** | Messages from the website's forms: fixes, new events, requests to remove a listing (first, with a 7-day countdown), problems and ideas. | Reply with a ready-made answer (you can change it), **Send reply and close**, **Snooze a week**, open the page or the editor. |
| **Community posts** | Notes and photos waiting for a person (see [Moderate notes and photos](#moderate-notes-and-photos)). | Approve, reject, hide, ban. |
| **Log** | Every decision, newest first, by month. | |

**How changes reach the website.** Each button saves a small change to the website's files on GitHub (the master copy). The website rebuilds by itself, so changes show on the website **about 10 minutes** later. Every field you fix is added to **Locked fields**, so the weekly check never changes it back. Nothing is ever deleted: **Hide** sets the status to "Hidden by an editor".

**One-time setup.** The first time, the To do tab asks you to **Connect to GitHub**. Be signed in to GitHub as `michaelsrichter`. GitHub shows "Create GitHub App": press the green button. Then choose **Only select repositories** (a repository is a project on GitHub), pick **long-island-dance-events**, and press **Install**. That's all. The helper app can only work on this one website.

**Emailing a website for permission.** Some websites ask programs like ours to stay away, or their rules say to ask first. You can email them from the review center. In **Sources**, open "Ask for permission":

1. Press **Review and send the email…**. A ready-made, friendly email opens. It says who we are and that we use only dates, times, places and prices. It also says that we write our own short summary and link back, that we follow their robots.txt file (their rules for programs like ours), and how to say no.
2. Make sure the **To** address is right. If we already know a published address (from the organizer, venue or band page), it is filled in. If not, find it on their website (usually the Contact page) and type it. Never use a private address. To save it for next time, check the box "This address is published on their website".
3. Change anything you like. Press **See how it will look**, then **Send…**, and confirm. The email comes from the website's own address as "Long Island Dance Events". It is signed "Mike Richter"; another editor should change the name at the bottom before sending.
4. The source moves to **Waiting for an answer**. Their answer shows under the source ("Emails (1): new answer!"), and the To do tab counts new answers. Then press **They said yes: switch it on**, **They sent a calendar link…**, **They said no** or **No answer**.
5. If there is no answer after 14 days, the card offers one follow-up: **Review and send a follow-up…**. The review center sends at most one new request per website every 30 days, unless you check **Send anyway**.

Test copies of the website (pull-request previews) never send email: they show what would have been sent. Under a "Fix for a listing" message you can also email the organizer about the mistake, in the same way.

**Ask Copilot.** Some jobs need a developer: a new band or venue to look up, a source to fix, a website to add. **Ask Copilot** makes a GitHub issue (a task note, labeled `copilot-task`) with all the details. Open it on GitHub and choose **Assign to Copilot**. Copilot then opens a pull request (a suggested change) for you to check. Open tasks are listed at the bottom of the Messages tab.

### Your weekly 10-minute routine

1. **Sunday:** after the email from GitHub, open the **New events** tab in the review center. If the automatic checks passed, press **Publish now**.
2. **Held listings:** for each card, open the source page (where we found it). Then press the suggested button (Publish, Fix, Mark cancelled or Hide).
3. **Messages:** answer anything waiting. Answer requests to remove a listing first (within 7 days).
4. **Community posts:** approve or reject anything waiting.
5. **Sources:** look for anything under "Stopped working". Press **Try again now**, or **Ask Copilot to fix it**. If a website owner answered your email, it says **new answer!** under "Waiting for an answer". Read it, then press the button that matches what they said.

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

The quickest way is the **Held listings** tab of the [review center](#your-review-center). You can also do it in the editor:

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

## Logos, photos and contact details (venues, organizers, teachers, bands, DJs and dance styles)

Every card in the lists shows a picture on top: the first photo, or the logo, or (if there is neither) a dark band with the first letters of the name. Adding a picture makes the card and the page much more inviting.

**Add a logo**

1. Open the venue, organizer, band or teacher and expand **Logo**.
2. Under **Logo file**, choose **Upload** and pick the file. PNG or SVG with a see-through background is best; a square-ish logo at least 200 pixels wide works well. Logos show on a white box, so use the version made for white backgrounds.
3. Fill in **Alt text**: usually "<name> logo". If you forget, the site uses "<name> logo".
4. Fill in **Credit** ("Logo: The Nutty Irishman") and **Credit link** (the page where you found it).

**Add photos**

1. Expand **Photos** and click **Add photos**. You can add up to 6. The first one is used on the card and at the top of the page; the rest appear under "More photos".
2. **Photo**: upload a JPG, PNG or WebP at least 600 pixels wide. The editor resizes it to 1600 pixels wide and saves it as a JPG (removing hidden camera data such as location); the site then makes small copies for phones.
3. **Alt text** (required): say what the photo shows in plain words, for example "The brick front of the hall with a red awning" or "Couples swing dancing under string lights". Do not start with "Image of".
4. **Credit** (required) and **Credit link**: who took it or whose website it came from, for example "Photo: The Nutty Irishman (website)". For Creative Commons photos write the author and license ("Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons") and fill in **License link**.
5. **Focus point** (optional): photos are cropped to a wide box. If heads get cut off, type where the important part is, as two percentages across and down from the top-left. "50% 30%" keeps the upper middle. Then check the preview.

Credits show under each photo and in the **Pictures** line at the bottom of the details box. Owners who want a picture changed or removed can use the [corrections process](https://longisland.dance/sources/#corrections); remove it the same day.

**What not to post**

- Photos other people posted in reviews or check-ins (Google Maps, Yelp, TripAdvisor, Facebook). Link to them with **Google Maps link (photos and reviews)** instead.
- Photos from private groups, or anything you had to sign in to see.
- Photos where you can recognize children.
- Pictures from a site that says not to reuse them, watermarked stock photos, or flyers that are mostly text.
- Use logos and photos from the place's or act's **own** website or official page. The owner of this site has said we can use those unless a site says we may not.

**Contact details**

- **Phone** and **Email**: only public business details (the ones they publish for customers or bookings). Never a person's private cell number, private email or home address. Teachers, DJs and singers are people: add only what they publish for lessons or bookings.
- **Opening hours**: short and plain, for example "Tue-Sun 4 PM-midnight; closed Mon".
- **Booking page** (bands, DJs) and **Lessons or booking page** (teachers): their own page for booking or lessons.
- Add the pages that show these facts under **Sources for these details**, and update **Checked on (shown on the page)**, for example "Checked October 4, 2026. Sources: their website and Facebook page."

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

Event statuses: **Listed**, **Past**, **Cancelled** (shown with "Cancelled"), **Waiting for review** (hidden until someone decides) and **Hidden by an editor** (never shown, kept for the record; the weekly run leaves it hidden).

**How often** says when the program reads the source (every day, twice a week, weekly, monthly, only in season, or only by hand). **What it lists** tells the site whether everything in the source is a dance (a dance calendar) or whether each listing needs a dancing score (a live-music list).

New sources need a small program (an "adapter") written by a developer, and the owner's approval. Many calendars can share the general calendar-feed (`ical`) and event-page (`jsonld`) adapters: then you only fill in **Feed address**, **Facts to use when a listing leaves them out** and, if needed, the **Only keep** / **Skip** patterns. See the README.

## Writing tips

- Write for an average high-school student. Short sentences. Common words.
- Say what, when, where and how much first.
- Use our own words. **Never copy text** from a flyer or website.
- Use full names for places the first time ("Huntington Moose Lodge, Greenlawn").
- Times: "7:30 PM". Dates: "Tuesday, October 6".

## Corrections from the public

Visitors use the "Report a problem" button on each event, or the forms on the **Sources** page. These open issues on GitHub with a label. They all show in the **Messages** tab of the [review center](#your-review-center), with ready-made replies:

| Label | What to do |
| --- | --- |
| `listing-correction` | Check the facts, fix the event, lock the fields, close the issue with a thank-you. |
| `add-listing` | Check it is in Nassau or Suffolk and real; add it by hand, or ask a developer to add the calendar as a source. |
| `remove-listing` | Act within a week: turn on **Opted out** for the organizer, or remove the item. Reply when done. |

## Moderate notes and photos

Signed-in visitors can like pages, save events to their own private list, leave notes, send private corrections and post photos (see the [community rules](https://longisland.dance/community-rules/)). An AI checker reads every note first; anything it is unsure about, every private correction and **every photo** waits for a person.

1. Go to **https://longisland.dance/moderate/#posts** (the **Community posts** tab of the review center) and sign in with your moderator email (the owner adds it to the `ADMIN_EMAILS` app setting). You get a one-time code by email.
2. Each card shows the post, why it is waiting, the AI scores (0 = safe, 2 = unsure, 4 or more = harmful), any reports, and the poster's record.
3. Choose:
   - **Approve**: it follows the rules. It appears on the page within a minute.
   - **Reject**: it breaks the rules. For photos: reject if a child can be recognized, if it looks like people did not agree to be posted, or if it is not from a dance.
   - **Hide**: takes a public post down while you check.
   - **Done** (corrections): fix the listing in the CMS first (lock the fields you changed), then press Done.
   - **Ban this person…**: stops them posting for some days or for good, and can hide everything they posted.
4. Add a short reason; it goes into the log (**Show this month's log**).

Please check the queue at least every two days. Removal requests ("It shows me") hide the photo at once; reject it within 48 hours. If a photo might show child sexual abuse, do not download or share it: reject it and report it to the [NCMEC CyberTipline](https://report.cybertip.org/).

**Email alerts.** The owner gets an email (from the site's Outlook.com address) when something new waits for a person: a private correction, a note or photo the AI could not approve, a post hidden by reports, or an "It shows me" request. To avoid floods there is **at most one email every 15 minutes**. It says how many items wait and links to the queue. It never contains names or the post text, so always open the queue to see the details. If something has waited for more than 6 hours, one reminder email goes out each morning. To change who gets the emails, see "Email alerts for moderators" in `docs/deployment.md`.

To delete someone's sign-in account (after they deleted their data), open the Entra admin center → tenant **Long Island Dance** → **Users**, and delete the user named in the log entry.

## Fix a mistake

| Problem | What to do |
| --- | --- |
| I saved something wrong | Open the entry, change it back, save. |
| I deleted an entry by mistake | Ask a developer to restore it from the GitHub history (nothing is lost). |
| The weekly run keeps changing my fix | Add the field to **Locked fields**. |
| The site did not update | Wait 5 minutes. If it still did not change, check the "Actions" tab on GitHub for a red X and ask a developer. |

## Sign-in setup (for the site owner)

**Done on 2026-10-03.** The GitHub OAuth app is **"Long Island Dance Events CMS"** under the owner's GitHub account (Settings → Developer settings → OAuth Apps). Its sign-in return addresses are `https://longisland.dance/api/callback` and `https://www.longisland.dance/api/callback`, and "Expire user access tokens" is off. The Azure Static Web App `swa-li-dance-events-web` has the settings `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` and `ALLOWED_HOSTS` (longisland.dance, www.longisland.dance and the azurestaticapps.net address). The editor asks GitHub only for **public repositories** access (`auth_scope: public_repo` in `cms/config.yml`), so signing in never opens your private repositories.

To set it up again (new domain, or a lost secret):

1. GitHub → Settings → Developer settings → OAuth Apps → the app. Set Homepage `https://<domain>` and the return address `https://<domain>/api/callback`. Keep **"Expire user access tokens" unticked**.
2. Click **Generate a new client secret**. Copy it straight into the Azure setting `GITHUB_OAUTH_CLIENT_SECRET`. Never paste it in a file, chat or email.
3. Add the new domain to `ALLOWED_HOSTS`.
4. Check: `https://<domain>/api/auth` should send you to github.com. If it shows "CMS sign-in is not configured", a setting is missing.

Editors need write access to the repository (Settings → Collaborators). Work accounts managed by a company (Enterprise Managed Users) cannot be added to a personal repository; editors must use a personal GitHub account.
