# Content audit

What the site holds after the first collection run, where it came from, and what a person should check. Written for the site owner and future editors.

## First run (October 3, 2026)

| Step | Count |
| --- | ---: |
| Listings in The Dance Calendar, October 2026 issue | 185 |
| Outside Nassau and Suffolk (skipped): Queens, Brooklyn, Little Neck, Elmhurst and others | 73 |
| Kept (Long Island) | 112 |
| Event files after combining repeating dates | 41 |
| Repeating events (weekly or monthly rule) | 24 |
| Upcoming dates shown on the site (next 120 days) | 103 |
| Hidden for review | 0 |

Events by type: 15 classes, 13 social dances, 10 lesson + dance parties, 3 live-music nights.
Most common styles: ballroom (25 events), Latin ballroom (21), hustle (9), West Coast Swing (8), East Coast Swing (6), country two-step (5).

Directory pages created: 13 venues (all on the map), 14 organizers, 10 teachers, 9 bands and DJs, 15 dance styles.

Venue, organizer, teacher, band and DJ details were checked against each group's own website, venue pages and Google Maps (public view). Every recorded fact has a source link in the research notes. Personal names of club officers and private contacts were not recorded.

## Please check (owner or organizers)

These are the open questions. None blocks the launch; each listing already tells visitors to confirm with the organizer.

| Topic | What we found | Suggested action |
| --- | --- | --- |
| Argentine Tango Lovers (Mirelle's, Tuesdays) | The newsletter says "every other Tuesday"; the club's own calendar shows every Tuesday in October. | Ask the club; set the rule and lock it (`lockedFields`). |
| LICMA November dance | licma.org says Sat Nov 28; the lodge site says Nov 14. | Ask LICMA before November. |
| The Studio by Hill Street phone | Three numbers appear (website header, website FAQ, Google). We show the website header number. | Ask the studio. |
| DJ Ray (Massapequa Elks) | No website. May or may not be Ray Swartz ("Line Dance With Ray"), who teaches at the same lodge. Not linked. | Ask the organizer. |
| DJ Scott (Patchogue) | His own site and the newsletter list different phone numbers. We show his site's number. | None needed. |
| Val & Neda (Southampton) | Probably the pro couple Valentyn Isaiev & Neda Andriekute, but nothing ties them to Southampton. Not linked. | Ask the studio. |
| DJ Omar H (tango) | Could not be identified online. Name only. | Ask Argentine Tango Lovers. |
| KL Dance | Website (kldance.net) no longer works; no official social page found. | Ask the teachers for a current link. |
| Waterfalls Halloween dance | The newsletter ad says "Saturday, Oct. 26", but Oct 26, 2026 is a Monday. The venue calendar shows Oct 10 and Oct 24. | We follow the calendar dates. |
| Dance styles inherited from the organizer | 6 listings did not name styles, so the organizer's usual styles were used (noted on each file). | Spot-check after the first week. |
| No start time | Adelphi classes and one tango social have no time in the source. Pages say "time not listed". | Ask the organizers. |

Source details: `reviewNotes` on each file in `src/content/**`, plus the research notes kept outside the repo.

## Ira's List import (October 3, 2026)

The first run read 51 gigs from the home-page weekly list. 48 are on Long Island at venues we researched, 1 is held for review, and 3 were skipped (theater, comedy and drag shows are not dance or band nights). 44 venues and 45 bands/DJs were added, each with public evidence links (venue and band sites, news, reviews, public photo pages). No partner dancing was found at any Ira's List venue. Line dancing is a regular thing at The Nutty Irishman, 89 North, Daisy's (Miller Place), Eleanor's and Lucky Strike.

| Topic | What we found | Suggested action |
| --- | --- | --- |
| Leonid & Friends (Boulton Center, Oct 3) | The band's tour page and Live Nation show Skokie, Illinois that night, and the Boulton Center lists a different show. Held for review (status locked). | Ask the venue, then publish or cancel. |
| Revel (Garden City) | Not sure which "Revel" the list means; scored as a DJ night from the listing only. | Confirm the venue. |
| Serve The Servants (Oct 3) | Ira's List says The Warehouse (shown); the band's own site says Katie's that night. | Check with the band. |
| The Byrne Unit at Salt Shack (Babylon, Oct 4) | Ira's List says "3pm?"; the venue says 5pm. Any time Ira's List marks with "?" is not shown ("time not listed"). | Ask the venue, then set the time and lock it. |
| In The Groove at Black Pearl (Port Jefferson, Oct 4) | Ira's List says 3-8 PM (shown); the venue says 3-6. | Ask the venue. |
| New York Ska-Jazz Ensemble, Tres Palms Oyster Fest | Could not confirm on the venues' own pages. | Spot-check. |
| CarTunes, SqueezePlay, Lefty, For The Love Of Freestyle, We Are Live Fall Fest | Acts we could not identify. Their gigs are scored on the venue and the listing only. | Add the band if someone knows them. |
## Photos

No photos were supplied. The site reuses two openly licensed swing-dance photos from the starter (Thomas Quine, CC BY 2.0, Wikimedia Commons), credited on the page and captioned "not a Long Island event". Organizer photos can be added later with written permission.

## Source proposals (discovery pass)

New sources are **proposed here and added only after the owner approves them**. See [source-proposals.md](source-proposals.md): 24 candidates (4 high, 6 medium, 14 low priority) and 33 set aside, with robots.txt and format checks for each. Machine-readable copy: [source-proposals.json](source-proposals.json).
