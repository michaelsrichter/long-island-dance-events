# Long Island Dance Events - candidate event sources (discovery pass)

> **Status: proposals only. Nothing here is collected yet.** Each source needs the owner's approval before an adapter is written (see the README, "Add a new source"). Our collector always identifies itself with its own User-Agent and follows robots.txt; sources whose feed host blocks robots need the organizer's permission or a shared feed first.


Researched October 3, 2026. Scope: Nassau and Suffolk counties only. Already covered and not repeated here: The Dance Calendar (monthly PDF) and Ira's List (planned).

## Summary

We opened more than 100 pages on about 70 websites and found **24 sources worth adding**: 4 High, 6 Medium and 14 Low priority. Another 33 were looked at and set aside.

- **Best new finds:** a monthly contra dance in Smithtown (from the Country Dance & Song Society calendar), a monthly Latin social at Ballroom Legacy in Sea Cliff, and several swing nights the October Dance Calendar does not list (Amityville, East Northport, Farmingdale, Syosset, Huntington).
- **Easy wins:** all four High-priority sources need only a small adapter: a calendar feed, event data built into the page, or a tidy list.
- **Organizers' own pages** (SDLI, Brumidi Lodge, JLR) overlap with the Dance Calendar, but they are updated more often and list bands, themes and closures.
- **Ask first:** two great calendars (Triple Step Swing and Lourdes Cruz's Google Calendar) sit on services whose robots.txt says "no robots." We should get the organizer's OK, or ask them to share a feed, before we automate them.
- **Skipped:** social-media-only groups, sites outside Long Island (several "Long Island" results were really in Queens, Ohio, Indiana, New Jersey, Florida or South Carolina), sites whose rules forbid scraping (Patch, Eventbrite), and stale pages.
- Twisted Cow Distillery's site would not open from our network, so its robots.txt is still unchecked.

## Recommended sources

| Priority | Source | Covers | Format | robots.txt | Overlap with Dance Calendar | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| High | [LITMA Contradances (on the CDSS community calendar)](https://cdss.org/organizer/long-island-traditional-music-association/) | contra dance - Smithtown (Suffolk) | iCal feed | allowed | no | S |
| High | [Swing Dance Long Island (SDLI) - Upcoming Events](http://www.sdli.org/index.php/sdli/events/) | East Coast Swing, Lindy Hop, West Coast Swing - Greenlawn (Suffolk) | clean HTML list | none | yes | S |
| High | [Ballroom Legacy Dance Studio (Sea Cliff) - Wix Events](https://www.ballroomlegacy.us/) | Latin social, ballroom - Sea Cliff (Nassau) | schema.org Event JSON-LD on each Wix event page | allowed | no | S |
| High | [Club Brumidi / Constantino Brumidi Lodge, Sons of Italy (Deer Park)](https://sonsofitalyli.com/events/) | social dance mix (tango, West Coast Swing, hustle, ballroom/Latin), dinner dances, classes - Deer Park (Suffolk) | clean HTML list | allowed | yes | S |
| Medium | [JLR Dance Unlimited (Bay Shore) - Wix Events](https://www.jlrdanceunlimited.com/events-2) | ballroom, Latin, hustle - Bay Shore (Suffolk) | schema.org Event JSON-LD on each event page | allowed | yes | S |
| Medium | [Gene Casey & the Lone Sharks (band) - show calendar](https://genecasey.com/events/) | swing / rockabilly / roots band for dancing - Amityville, Greenlawn, Bayport (Suffolk) | iCal + schema.org Event JSON-LD | allowed | partly | S |
| Medium | [Twisted Cow Distillery - Barrelhouse Boogie Lindy Hop night](https://twistedcowdistillery.net/Events?Page=1) | Lindy Hop (lesson + DJ social) - East Northport (Suffolk) | clean HTML list + event detail pages | unverified | no | M |
| Medium | [Dance Manhattan - 'LI Recommended Swing Dances on Long Island'](http://dancemanhattan.com/calendar/event/113) | swing, Lindy Hop, blues - Farmingdale, Greenlawn, Amityville (Nassau + Suffolk) | HTML | none | partly | M |
| Medium | [Triple Step Swing (Long Island Lindy Hop) - calendar](https://triplestepswing.com/calendar) | Lindy Hop, swing, blues - Syosset, Huntington, Greenlawn (Nassau + Suffolk) | JSON from an eventscalendar.co widget | site: none; feed host: disallowed | partly | M |
| Medium | [DiVa Ballroom / Dance with Lourdes Cruz - Long Island Google Calendar](https://divaballroomdancing.com/long-island/) | ballroom, Latin, salsa - Deer Park, Great Neck, Merrick (Nassau + Suffolk) | public Google Calendar | disallowed (Google feed host) | partly | S |
| Low | [Huntington Arts Council - events calendar, Dance category](https://www.huntingtonarts.org/events/category/dance/) | swing (SDLI), dance performances - Greenlawn, Roslyn Harbor (Suffolk; some Nassau) | iCal + JSON-LD + REST | allowed | yes | S |
| Low | [Out on the Town - Long Island event calendar](https://outonthetownli.com/) | country nights, Latin nights, bar dance parties - Farmingdale, Patchogue, Rockville Centre (Nassau + Suffolk) | iCal + JSON-LD + REST | allowed | partly | M |
| Low | [The Haymakers (band) - shows](https://www.haymakersmusic.com/shows) | rock & roll / swing-friendly band night - Farmingdale, Lindenhurst (Nassau + Suffolk) | clean HTML list | allowed | no | S |
| Low | [Line Dance With Ray (Ray Swartz)](https://www.linedancewithray.com/) | line dancing - Massapequa, Island Park, Bay Shore (Nassau + Suffolk) | clean HTML | allowed | partly | S |
| Low | [DJ Neil Wrangler - Long Island's Country DJ](https://dj-neil.com/) | country line dancing - Farmingdale, Port Washington, Lindenhurst (Nassau + Suffolk) | HTML text | none | partly | M |
| Low | [Long Island Country Music Association (LICMA)](https://licma.org/) | country, line dancing - Deer Park (Suffolk) | HTML | allowed | yes | S |
| Low | [The Waterfalls (Lake Ronkonkoma) - community event calendar](https://waterfallsapartments.com/event-calendar/) | ballroom - Lake Ronkonkoma (Suffolk) | HTML calendar | allowed | yes | S |
| Low | [DJ Scott (Purple Penguin Entertainment) - social dance calendar](https://www.purplepenguinentertainment.com/events) | social dance / ballroom mix - Patchogue (Suffolk) | JavaScript-rendered text | allowed | yes | M |
| Low | [Town of Hempstead adult classes (Line Dancing, Ballroom, Salsa & Latin)](https://hempsteadny.gov/297/Line-Dancing) | line dancing, ballroom, salsa/Latin - Hicksville (Nassau) | HTML | allowed | no | S |
| Low | [Salsa Sensation Latin Dance Studio (Levittown) - class schedule](https://www.salsasensation.com/schedule) | salsa, bachata - Levittown (Nassau) | HTML page | allowed | unverified | M |
| Low | [Ballroom Factory Dance Studio (Patchogue) - group classes](https://ballroomfactory.com/group-classes-workshop/) | cha cha, foxtrot, Lindy - Patchogue (Suffolk) | clean HTML list of monthly class series | allowed | unverified | S |
| Low | [Long Island public library calendars (e.g., Amityville, Hicksville)](https://www.amityvillepubliclibrary.org/event/intermediate-line-dancing-person-vfw-hall-10186) | line dancing, ballroom - Amityville, Hicksville (Nassau + Suffolk) | JSON-LD per event page | allowed | no | L |
| Low | [sabaki.dance (Latin dance aggregator) - city pages](https://sabaki.dance/events/Sea-Cliff) | salsa, bachata, kizomba - Sea Cliff, Levittown (Nassau) | schema.org Event JSON-LD | allowed | no | M |
| Low | [Polish American Cultural Association (Port Washington) - upcoming events](https://portwashingtonpolishclub.com/upcoming-events) | country night, dinner dances - Port Washington (Nassau) | clean HTML list | allowed | partly | S |

Effort: S = a day or less (feed or tidy HTML), M = a few days (free text, filtering or a headless browser), L = a week or more (many platforms).

## Details

### LITMA Contradances (on the CDSS community calendar)

- **Priority:** High - Clean iCal with per-event UIDs and links; adds a style (contra) not in the October Dance Calendar. LITMA's own site (litma.org) has no fall dates, so CDSS is the better source.
- **Listing page:** https://cdss.org/organizer/long-island-traditional-music-association/
- **Feed URL:** https://cdss.org/organizer/long-island-traditional-music-association/?ical=1
- **What it covers:** Long Island Traditional Music Association contra dance with live band and caller, Brush Barn, 211 E Main St, Smithtown. About 1 per month (3rd Sunday, 2-5 pm, Sept-June).
- **Styles:** contra dance
- **Towns / county:** Smithtown - Suffolk
- **Best format:** iCal feed (WordPress The Events Calendar) + schema.org Event JSON-LD on the page
- **robots.txt:** allowed (User-agent * Allow /; Content-Signal: search=yes, ai-train=no, use=reference). AI-training bots are blocked; our use is listing with a link back.
- **Terms / notes:** robots.txt content signals ask for reference-style use only (link back, no AI training). A plain script got HTTP 403 (bot protection). Test from GitHub Actions with our own User-Agent; if it is blocked, ask CDSS/LITMA for permission. We never disguise the collector as a browser.
- **Overlap with The Dance Calendar:** no (not in the Oct 2026 Dance Calendar data)
- **Freshness:** 12 events: Oct 18, Nov 15, Dec 20 2026 and monthly into mid-2027.
- **Effort:** S
- **Evidence (fetched):** https://cdss.org/organizer/long-island-traditional-music-association/; https://cdss.org/organizer/long-island-traditional-music-association/?ical=1; https://cdss.org/robots.txt; https://litma.org/; https://litma.org/calendar-2/

### Swing Dance Long Island (SDLI) - Upcoming Events

- **Priority:** High - The organizer's own weekly schedule with the band for each date; fresher and more detailed than a monthly PDF.
- **Listing page:** http://www.sdli.org/index.php/sdli/events/
- **Feed URL:** none found
- **What it covers:** Every Tuesday at Huntington Moose Lodge, 631 Pulaski Rd, Greenlawn: lesson 7:30 pm, then social dancing. Each date names the band or DJ and theme (Pizza Night, Halloween party). About 4-5 per month.
- **Styles:** East Coast Swing, Lindy Hop, West Coast Swing, Balboa, Collegiate Shag, some ballroom
- **Towns / county:** Greenlawn - Suffolk
- **Best format:** clean HTML list (ExpressionEngine); month grid at /index.php/sdli/calendar/YYYY/MM/. No JSON-LD or iCal found.
- **robots.txt:** none (robots.txt returns 404)
- **Terms / notes:** No terms found. Event pages show 'Posted by <first name>'; do not store poster names.
- **Overlap with The Dance Calendar:** yes (SDLI is in the Dance Calendar)
- **Freshness:** Dated listings through Dec 29, 2026, plus Jan 26, 2027.
- **Effort:** S
- **Evidence (fetched):** https://www.sdli.org/; http://www.sdli.org/index.php/sdli/events/; http://www.sdli.org/index.php/sdli/calendar/; https://www.sdli.org/robots.txt

### Ballroom Legacy Dance Studio (Sea Cliff) - Wix Events

- **Priority:** High - New Nassau organizer with structured data and correct addresses; sitemap makes discovery trivial.
- **Listing page:** https://www.ballroomlegacy.us/
- **Feed URL:** https://www.ballroomlegacy.us/event-pages-sitemap.xml
- **What it covers:** 'Friday Night Latin Dance Fever' socials at 185 Glen Cove Ave Suite A, Sea Cliff, about 1 per month (first Friday). JSON-LD has the correct street address. Sabaki also lists a Monday 'Salsa on two with Jojo' at this address (not on the studio's event pages).
- **Styles:** Latin social, ballroom
- **Towns / county:** Sea Cliff - Nassau
- **Best format:** schema.org Event JSON-LD on each Wix event page; the event sitemap lists every event page
- **robots.txt:** allowed
- **Terms / notes:** No scraping terms seen on the pages fetched.
- **Overlap with The Dance Calendar:** no (not in the Oct 2026 Dance Calendar data)
- **Freshness:** Event pages for Oct 2 and Dec 4, 2026, Jan 1 and Apr 2, 2027.
- **Effort:** S
- **Evidence (fetched):** https://www.ballroomlegacy.us/sitemap.xml; https://www.ballroomlegacy.us/event-pages-sitemap.xml; https://www.ballroomlegacy.us/event-details-registration/friday-night-latin-dance-fever-2026-10-02-19-30; https://visitglencove.com/event/legacy-night-latin-social-dance-presented-by-ballroom-legacy/

### Club Brumidi / Constantino Brumidi Lodge, Sons of Italy (Deer Park)

- **Priority:** High - Large weekly social; the lodge's own list adds one-off dances and closures (e.g., 'no class Oct 18').
- **Listing page:** https://sonsofitalyli.com/events/
- **Feed URL:** https://sonsofitalyli.com/wp-json/wp/v2/event
- **What it covers:** Wednesday Night Dance Social (6-10 pm, weekly), Monday group classes with Lourdes Cruz, and one-off dinner dances (Halloween Spooktacular Oct 31). About 5-8 per month.
- **Styles:** social dance mix (tango, West Coast Swing, hustle, ballroom/Latin), dinner dances, classes
- **Towns / county:** Deer Park - Suffolk
- **Best format:** clean HTML list (Very Simple Event List plugin) with 'Date:/Time:/Location:' lines; WordPress REST gives titles and text but not dates
- **robots.txt:** allowed
- **Terms / notes:** No terms found. Pages list reservation contacts by first name; do not store them.
- **Overlap with The Dance Calendar:** yes (Club Brumidi is in the Dance Calendar)
- **Freshness:** Listings for Oct 7, Oct 9-10 and Oct 31, 2026.
- **Effort:** S
- **Evidence (fetched):** https://sonsofitalyli.com/events/; https://sonsofitalyli.com/event/wednesday-night-dance-social/; https://sonsofitalyli.com/wp-json/wp/v2/event?per_page=5; https://sonsofitalyli.com/robots.txt

### JLR Dance Unlimited (Bay Shore) - Wix Events

- **Priority:** Medium - Structured, but few events, and the Wix venue address is wrong (geocoded to Lagos, Nigeria) so the adapter must pin the known venue (5 5th Ave, Bay Shore).
- **Listing page:** https://www.jlrdanceunlimited.com/events-2
- **Feed URL:** https://www.jlrdanceunlimited.com/event-pages-sitemap.xml
- **What it covers:** Studio dance socials (Sunday Night Dance Social Oct 11, Halloween Dance Social Oct 31, $20). About 1-3 per month.
- **Styles:** ballroom, Latin, hustle
- **Towns / county:** Bay Shore - Suffolk
- **Best format:** schema.org Event JSON-LD on each event page (Wix Events); list page links are in the server HTML
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** yes (JLR is in the Dance Calendar)
- **Freshness:** Upcoming: Oct 11 and Oct 31, 2026.
- **Effort:** S
- **Evidence (fetched):** https://www.jlrdanceunlimited.com/events-2; https://www.jlrdanceunlimited.com/events/halloween-dance-social; https://www.jlrdanceunlimited.com/event-pages-sitemap.xml; https://www.jlrdanceunlimited.com/robots.txt

### Gene Casey & the Lone Sharks (band) - show calendar

- **Priority:** Medium - Clean feed; Dance Manhattan lists Sharks' Night as a recommended LI swing dance. Needs a venue allowlist (Liam's Landing, SDLI).
- **Listing page:** https://genecasey.com/events/
- **Feed URL:** https://genecasey.com/events/list/?ical=1
- **What it covers:** 'Sharks' Night' every 2nd Friday at Liam's Landing, 248 S Ketcham Ave, Amityville (no cover), plus SDLI band night Nov 17. The feed also has radio shows and solo winery sets that must be filtered out. 1-2 dance-relevant gigs per month.
- **Styles:** swing / rockabilly / roots band for dancing
- **Towns / county:** Amityville, Greenlawn, Bayport, Greenport, Cutchogue - Suffolk
- **Best format:** iCal + schema.org Event JSON-LD (WordPress The Events Calendar)
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** partly (SDLI band night; Liam's Landing nights are not in the Oct 2026 Dance Calendar data)
- **Freshness:** Gigs through Feb 14, 2027.
- **Effort:** S
- **Evidence (fetched):** https://genecasey.com/events/; https://genecasey.com/events/list/?ical=1; https://genecasey.com/event/sharks-night-at-liams-in-amityville-ny/; https://genecasey.com/robots.txt

### Twisted Cow Distillery - Barrelhouse Boogie Lindy Hop night

- **Priority:** Medium - Only first-party listing for this monthly Lindy night; confirm robots.txt and access from GitHub Actions before building.
- **Listing page:** https://twistedcowdistillery.net/Events?Page=1
- **Feed URL:** none found
- **What it covers:** Every 2nd Wednesday, 7:30-10:30 pm, lesson then DJ social, $10 suggested donation, 13 Hewitt Sq, East Northport. 1 per month among many non-dance venue events.
- **Styles:** Lindy Hop (lesson + DJ social)
- **Towns / county:** East Northport - Suffolk
- **Best format:** clean HTML list + event detail pages (a 'Download Info' link exists; type unverified)
- **robots.txt:** unverified - the site closed connections from the research network (Python, curl and browser all failed); content was read through the WebIQ crawler instead
- **Terms / notes:** unverified
- **Overlap with The Dance Calendar:** no (not in the Oct 2026 Dance Calendar data)
- **Freshness:** Listing for Wed Oct 14, 2026.
- **Effort:** M
- **Evidence (fetched):** https://twistedcowdistillery.net/Events?Page=1; https://twistedcowdistillery.net/Events/Detail/EventId/1317/barrelhouse-boogie-swing-dancing-lessons-returns; https://twistedcowdistillery.net/robots.txt (could not be fetched)

### Dance Manhattan - 'LI Recommended Swing Dances on Long Island'

- **Priority:** Medium - Best single list of LI swing nights, including some that are otherwise Instagram-only; free text, so parse defensively or use as a cross-check.
- **Listing page:** http://dancemanhattan.com/calendar/event/113
- **Feed URL:** none found
- **What it covers:** Curated list: The Haymakers at Charlotte's Speakeasy (Farmingdale), SDLI (Greenlawn), Sharks' Night (Amityville), Barrelhouse Boogie (East Northport), The Burrows Blues Night at The Great Hall (Huntington), Triple Step Swing monthly dance (Syosset). About 6-8 dates per month.
- **Styles:** swing, Lindy Hop, blues
- **Towns / county:** Farmingdale, Greenlawn, Amityville, East Northport, Huntington, Syosset - Nassau + Suffolk
- **Best format:** HTML (one free-text block, updated in place); https has a self-signed certificate, http works
- **robots.txt:** none (robots.txt URL returns an HTML page with no rules)
- **Terms / notes:** unverified (no terms page checked)
- **Overlap with The Dance Calendar:** partly (SDLI)
- **Freshness:** Page dated Sat Oct 3, 2026; lists dates through Dec 5, 2026.
- **Effort:** M
- **Evidence (fetched):** http://dancemanhattan.com/calendar/event/113; http://dancemanhattan.com/calendar/event/241; http://www.dancemanhattan.com/calendar/event/39; http://dancemanhattan.com/robots.txt

### Triple Step Swing (Long Island Lindy Hop) - calendar

- **Priority:** Medium - Richest LI swing community calendar, but only usable with permission: ask Triple Step Swing to share a Google Calendar/ICS or give a written OK.
- **Listing page:** https://triplestepswing.com/calendar
- **Feed URL:** https://inffuse.eventscalendar.co/api/v0.1/projects/proj_LH4Z9iBCTJ3nnZsI92ePw/data/public/events?user=user_jkYMxufQ75hxoRD01us4U&app=calendar
- **What it covers:** TSS Monthly Swing Dance (20 Queens St, Syosset), The Burrows swing/blues nights at The Great Hall (12 Prospect St, Huntington), fall lesson series, and big-band park concerts. About 3-5 per month.
- **Styles:** Lindy Hop, swing, blues, big band concerts
- **Towns / county:** Syosset, Huntington, Greenlawn, East Meadow, Glen Cove, Brookville, West Sayville - Nassau + Suffolk
- **Best format:** JSON from an eventscalendar.co widget (no ICS offered); Meetup group iCal exists but is empty
- **robots.txt:** triplestepswing.com: none (404). Feed host inffuse.eventscalendar.co: Disallow / (only .js files and /js/*/*/data allowed) - the events API is disallowed.
- **Terms / notes:** Meetup terms forbid commercial scraping (Meetup iCal for group 'triplestepswing-longisland' is allowed by robots but had 0 events).
- **Overlap with The Dance Calendar:** partly (SDLI items)
- **Freshness:** Events through Nov 13, 2026.
- **Effort:** M
- **Evidence (fetched):** https://triplestepswing.com/calendar; https://inffuse.eventscalendar.co/robots.txt; https://embed.eventscalendar.co/iframely/calendar/proj_LH4Z9iBCTJ3nnZsI92ePw; https://www.meetup.com/triplestepswing-longisland/events/ical/

### DiVa Ballroom / Dance with Lourdes Cruz - Long Island Google Calendar

- **Priority:** Medium - Broad Nassau class and practice-social coverage in a clean ICS, but needs the organizer's OK because Google's robots.txt disallows bots.
- **Listing page:** https://divaballroomdancing.com/long-island/
- **Feed URL:** https://calendar.google.com/calendar/ical/0q5vgpcdjbs2ioqoebrgv8bn0s%40group.calendar.google.com/public/basic.ics
- **What it covers:** Lourdes Cruz's classes and practice socials: Brumidi Lodge (Deer Park), Great Neck Ballroom practice social, Merrick Golf Course and Levittown Hall (Town of Hempstead residents-only classes), Knights of Columbus Lynbrook salsa, YMCA Glen Cove. Also Queens entries (Spotlight Ballroom, Little Neck) to drop. About 10-15 per month, many recurring (RRULE).
- **Styles:** ballroom, Latin, salsa, West Coast Swing, Argentine tango, line dance, country two-step
- **Towns / county:** Deer Park, Great Neck, Merrick, Hicksville, Lynbrook, Glen Cove - Nassau + Suffolk
- **Best format:** public Google Calendar (iCal) embedded on the page
- **robots.txt:** calendar.google.com robots.txt: 'Allow: /$, Disallow: /' - automated fetching of the ICS path is disallowed. divaballroomdancing.com itself: allowed.
- **Terms / notes:** Ask Lourdes/DiVa for permission before automating.
- **Overlap with The Dance Calendar:** partly (Lourdes and Brumidi classes are in the Dance Calendar)
- **Freshness:** 70 VEVENTs; dates through Dec 19, 2026.
- **Effort:** S
- **Evidence (fetched):** https://divaballroomdancing.com/long-island/; https://calendar.google.com/calendar/ical/0q5vgpcdjbs2ioqoebrgv8bn0s%40group.calendar.google.com/public/basic.ics; https://calendar.google.com/robots.txt

### Huntington Arts Council - events calendar, Dance category

- **Priority:** Low - Very clean feed but mostly duplicates SDLI; keep as a fallback if SDLI's site breaks.
- **Listing page:** https://www.huntingtonarts.org/events/category/dance/
- **Feed URL:** https://www.huntingtonarts.org/events/category/dance/?ical=1
- **What it covers:** 19 Dance-category events Oct 2026-Mar 2027; nearly all are SDLI Tuesday nights.
- **Styles:** swing (SDLI), dance performances
- **Towns / county:** Greenlawn, Roslyn Harbor - Suffolk; some Nassau
- **Best format:** iCal + JSON-LD + REST (/wp-json/tribe/events/v1/events?categories=dance)
- **robots.txt:** allowed
- **Terms / notes:** No terms page found.
- **Overlap with The Dance Calendar:** yes (SDLI)
- **Freshness:** Through Mar 2027.
- **Effort:** S
- **Evidence (fetched):** https://www.huntingtonarts.org/events/; https://www.huntingtonarts.org/events/category/dance/?ical=1; https://www.huntingtonarts.org/wp-json/tribe/events/v1/events?start_date=2026-10-01&end_date=2026-12-31&per_page=50&search=dance; https://www.huntingtonarts.org/wp-json/tribe/events/v1/categories?per_page=100&hide_empty=1

### Out on the Town - Long Island event calendar

- **Priority:** Low - Good feed, but dance content is mixed with nightlife; needs a keyword allowlist and manual review.
- **Listing page:** https://outonthetownli.com/
- **Feed URL:** https://outonthetownli.com/?post_type=tribe_events&ical=1&eventDisplay=list
- **What it covers:** Weekly Country Night at The Nutty Irishman (Farmingdale), Country Wednesdays at 89 North (Patchogue), Latin Vibes at Kasey's (Rockville Centre); most other 'dance party' items are bar nightlife. About 8-12 possibly relevant per month.
- **Styles:** country nights, Latin nights, bar dance parties
- **Towns / county:** Farmingdale, Patchogue, Rockville Centre, Manorville - Nassau + Suffolk
- **Best format:** iCal + JSON-LD + REST (The Events Calendar); no dance category
- **robots.txt:** allowed
- **Terms / notes:** No terms page found.
- **Overlap with The Dance Calendar:** partly (DJ Neil's Nutty Irishman night appears in Dance Calendar notes)
- **Freshness:** Oct-Dec 2026.
- **Effort:** M
- **Evidence (fetched):** https://outonthetownli.com/; https://outonthetownli.com/event/country-night/2026-09-01/; https://outonthetownli.com/wp-json/tribe/events/v1/events?start_date=2026-10-01&end_date=2026-12-31&per_page=50&search=country; https://outonthetownli.com/wp-json/tribe/events/v1/categories?per_page=100&hide_empty=1

### The Haymakers (band) - shows

- **Priority:** Low - Listed by Dance Manhattan as a LI swing night, but the band bills itself as rock & roll; dance focus unverified.
- **Listing page:** https://www.haymakersmusic.com/shows
- **Feed URL:** none found
- **What it covers:** Monthly Saturday night at Charlotte's Speakeasy, 294 Main St, Farmingdale ($5 cover; password on the venue's site). 1-2 per month.
- **Styles:** rock & roll / swing-friendly band night
- **Towns / county:** Farmingdale, Lindenhurst - Nassau + Suffolk
- **Best format:** clean HTML list (Wix, server-rendered)
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** no
- **Freshness:** Oct 3, Oct 11, Nov 7, Dec 5, 2026.
- **Effort:** S
- **Evidence (fetched):** https://www.haymakersmusic.com/shows; https://www.haymakersmusic.com/robots.txt

### Line Dance With Ray (Ray Swartz)

- **Priority:** Low - Useful for a Classes page; the event list is not updated often.
- **Listing page:** https://www.linedancewithray.com/
- **Feed URL:** none found
- **What it covers:** Tue/Wed classes at Massapequa Elks Lodge, Thu classes at 4060 Austin Blvd, Island Park, monthly dance at 5 Fifth Ave, Bay Shore, LICMA dances. About 12 classes + 1-2 dances per month.
- **Styles:** line dancing
- **Towns / county:** Massapequa, Island Park, Bay Shore, Deer Park - Nassau + Suffolk
- **Best format:** clean HTML (Wix): weekly schedule + 'Upcoming events'
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** partly (Massapequa Elks and LICMA appear in the Dance Calendar)
- **Freshness:** Weekly schedule current; 'Upcoming events' still shows September dates.
- **Effort:** S
- **Evidence (fetched):** https://www.linedancewithray.com/; https://www.linedancewithray.com/sitemap.xml

### DJ Neil Wrangler - Long Island's Country DJ

- **Priority:** Low - Real weekly dances, but text-only with no dates; best used to confirm recurring series.
- **Listing page:** https://dj-neil.com/
- **Feed URL:** none found
- **What it covers:** Nutty Country Tuesdays (line dancing, lesson at 8 pm), nights at Port Washington Polish Hall and Lindenhurst Moose Lodge, seasonal outdoor events. About 4-6 per month.
- **Styles:** country line dancing
- **Towns / county:** Farmingdale, Port Washington, Lindenhurst, Ronkonkoma, Wantagh - Nassau + Suffolk
- **Best format:** HTML text (Nuxt); weekly items have no dates
- **robots.txt:** none (robots.txt 404)
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** partly (in Dance Calendar notes)
- **Freshness:** Special events ended Sept 2026; weekly items undated.
- **Effort:** M
- **Evidence (fetched):** https://dj-neil.com/

### Long Island Country Music Association (LICMA)

- **Priority:** Low - One dance a month and already in the Dance Calendar; handy to settle date conflicts (Nov date differs between sources).
- **Listing page:** https://licma.org/
- **Feed URL:** none found
- **What it covers:** One monthly dance at the Sons of Italy hall, 2075 Deer Park Ave (DJ + instructor, $20/$15).
- **Styles:** country, line dancing
- **Towns / county:** Deer Park - Suffolk
- **Best format:** HTML ('Next LICMA Dance is Saturday, October 24, 2026')
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** yes
- **Freshness:** Next dance Oct 24, 2026.
- **Effort:** S
- **Evidence (fetched):** https://licma.org/; https://licma.org/dance-schedule

### The Waterfalls (Lake Ronkonkoma) - community event calendar

- **Priority:** Low - Reliable but only two dances a month, already in the Dance Calendar.
- **Listing page:** https://waterfallsapartments.com/event-calendar/
- **Feed URL:** none found
- **What it covers:** Ballroom Dancing with DJ Valerie, 2nd and 4th Saturdays, 7-11 pm, walk-ins welcome.
- **Styles:** ballroom
- **Towns / county:** Lake Ronkonkoma - Suffolk
- **Best format:** HTML calendar (WordPress 'Event Calendar WD' plugin; iCal export unverified)
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** yes
- **Freshness:** Oct 10 and Oct 24, 2026.
- **Effort:** S
- **Evidence (fetched):** https://waterfallsapartments.com/event-calendar/

### DJ Scott (Purple Penguin Entertainment) - social dance calendar

- **Priority:** Low - Already in the Dance Calendar; needs a browser and year inference.
- **Listing page:** https://www.purplepenguinentertainment.com/events
- **Feed URL:** none found
- **What it covers:** Social dances at Knights of Columbus, 38 West 1st St, Patchogue, 1st and 3rd Fridays, $20.
- **Styles:** social dance / ballroom mix
- **Towns / county:** Patchogue - Suffolk
- **Best format:** JavaScript-rendered text (needs a headless browser); dates have no year
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** yes
- **Freshness:** Listed through Oct 16, 2026.
- **Effort:** M
- **Evidence (fetched):** https://www.purplepenguinentertainment.com/; https://www.purplepenguinentertainment.com/events

### Town of Hempstead adult classes (Line Dancing, Ballroom, Salsa & Latin)

- **Priority:** Low - Seasonal, registration-based classes for town residents; fits a Classes page, not the events list.
- **Listing page:** https://hempsteadny.gov/297/Line-Dancing
- **Feed URL:** none found
- **What it covers:** Fall session classes at Levittown Hall, e.g., Line Dancing Thursdays Oct 1-Dec 10, 2026 ($72; online registration).
- **Styles:** line dancing, ballroom, salsa/Latin
- **Towns / county:** Hicksville - Nassau
- **Best format:** HTML (CivicPlus program pages)
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** no (but the same classes appear on the DiVa/Lourdes calendar)
- **Freshness:** Fall 2026 session dates.
- **Effort:** S
- **Evidence (fetched):** https://hempsteadny.gov/297/Line-Dancing

### Salsa Sensation Latin Dance Studio (Levittown) - class schedule

- **Priority:** Low - Classes only; the grid is free text.
- **Listing page:** https://www.salsasensation.com/schedule
- **Feed URL:** none found
- **What it covers:** Weekly salsa and bachata classes by level, 3000 Hempstead Tpke, Levittown. Socials not listed on this page.
- **Styles:** salsa, bachata
- **Towns / county:** Levittown - Nassau
- **Best format:** HTML page (Squarespace) with a monthly class grid; no events collection
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** unverified
- **Freshness:** October 2026 schedule posted.
- **Effort:** M
- **Evidence (fetched):** https://www.salsasensation.com/schedule; https://www.salsasensation.com/?format=json

### Ballroom Factory Dance Studio (Patchogue) - group classes

- **Priority:** Low - Good data for a Classes page; no socials listed.
- **Listing page:** https://ballroomfactory.com/group-classes-workshop/
- **Feed URL:** none found
- **What it covers:** About 5 four-week class series per month with teacher, day, time and price, 620 Waverly Ave, Patchogue.
- **Styles:** cha cha, foxtrot, Lindy, salsa/bachata, West Coast Swing, hustle, rumba, tango
- **Towns / county:** Patchogue - Suffolk
- **Best format:** clean HTML list of monthly class series
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** unverified
- **Freshness:** October and November 2026 classes listed.
- **Effort:** S
- **Evidence (fetched):** https://ballroomfactory.com/group-classes-workshop/; https://ballroomfactory.com/contact/

### Long Island public library calendars (e.g., Amityville, Hicksville)

- **Priority:** Low - Often residents-only classes; many platforms to support for few events.
- **Listing page:** https://www.amityvillepubliclibrary.org/event/intermediate-line-dancing-person-vfw-hall-10186
- **Feed URL:** https://hicksvillelibrary.libcal.com/event/16949892/ical
- **What it covers:** Library dance classes (Amityville Intermediate Line Dancing, Thursdays Oct 22-Nov 26, 2026). Each library uses a different platform.
- **Styles:** line dancing, ballroom
- **Towns / county:** Amityville, Hicksville - Nassau + Suffolk
- **Best format:** JSON-LD per event page (Amityville); LibCal per-event iCal and calendar subscribe feeds (Hicksville)
- **robots.txt:** allowed (Hicksville LibCal sets Crawl-delay: 10)
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** no
- **Freshness:** Amityville: Oct-Nov 2026; Hicksville ballroom class was summer 2026.
- **Effort:** L
- **Evidence (fetched):** https://www.amityvillepubliclibrary.org/event/intermediate-line-dancing-person-vfw-hall-10186; https://hicksvillelibrary.libcal.com/event/16949892; https://hicksvillelibrary.libcal.com/robots.txt

### sabaki.dance (Latin dance aggregator) - city pages

- **Priority:** Low - Few Nassau/Suffolk events and second-hand provenance ('we read the group chats'); filter hard by address.
- **Listing page:** https://sabaki.dance/events/Sea-Cliff
- **Feed URL:** none found
- **What it covers:** Mostly NYC listings; LI items found: Salsa On2 with Jojo (Sea Cliff, Mondays) and a bachata class at Salsa Sensation (Levittown).
- **Styles:** salsa, bachata, kizomba
- **Towns / county:** Sea Cliff, Levittown - Nassau
- **Best format:** schema.org Event JSON-LD
- **robots.txt:** allowed (Crawl-delay: 1)
- **Terms / notes:** unverified
- **Overlap with The Dance Calendar:** no
- **Freshness:** October 2026.
- **Effort:** M
- **Evidence (fetched):** https://sabaki.dance/events/Sea-Cliff; https://sabaki.dance/robots.txt

### Polish American Cultural Association (Port Washington) - upcoming events

- **Priority:** Low - Few dance events among parades and parties.
- **Listing page:** https://portwashingtonpolishclub.com/upcoming-events
- **Feed URL:** none found
- **What it covers:** Country Night with DJ Neil in the Starlight Ballroom (5 Pulaski Pl) and other hall events. About 1 dance per month.
- **Styles:** country night, dinner dances
- **Towns / county:** Port Washington - Nassau
- **Best format:** clean HTML list (GoDaddy)
- **robots.txt:** allowed
- **Terms / notes:** None seen.
- **Overlap with The Dance Calendar:** partly (DJ Neil)
- **Freshness:** Events dated 10/04, 10/11, 10/31 and 11/21/2026.
- **Effort:** S
- **Evidence (fetched):** https://portwashingtonpolishclub.com/upcoming-events

## Considered but not recommended

- **dancecalendar.info - Long Island area** (https://www.dancecalendar.info/event.aspx?idarea=49) - robots.txt disallows this path. Evidence: https://www.dancecalendar.info/event.aspx?idarea=49; https://www.dancecalendar.info/robots.txt
- **Patch town calendars (e.g., Israeli Dancing, Plainview)** (https://patch.com/new-york/plainview/calendar/event/20260908/5d3cfa39-097a-4ec8-ac79-1b74ffbbc7ee/israeli-dancing) - Patch terms forbid spiders/robots/data mining to catalog content. Has JSON-LD, but user-submitted and mostly duplicates. Evidence: https://patch.com/terms; https://patch.com/robots.txt
- **Eventbrite event pages** (https://www.eventbrite.com/d/ny--central-islip/salsa/) - Terms of Service prohibit web scraping (section 'Prohibition of web scraping'); use the official API with a token per organizer if ever needed. Sampled items were outside the region (SalSwing Thursdays is in Latham, NY) or gone (Gouye Wednesday Long Island: 404). Evidence: https://www.eventbrite.com/help/en-us/articles/251210/eventbrite-terms-of-service/; https://www.eventbrite.com/robots.txt; https://www.eventbrite.com/e/salswing-thursdays-swing-salsa-bachata-lesson-social-tickets-1996819378514
- **Meetup groups (Triple Step Swing; Long Island Swing Syndicate)** (https://www.meetup.com/triplestepswing-longisland/) - Group iCal feeds are allowed by robots.txt but have 0 upcoming events; Meetup terms forbid commercial scraping. Evidence: https://www.meetup.com/triplestepswing-longisland/events/ical/; https://www.meetup.com/long-island-swing-syndicate/events/ical/; https://www.meetup.com/robots.txt; https://help.meetup.com/hc/en-us/articles/49237910563341-Terms-of-Service-1-1-2026
- **Salsa Vida - 'Long Island' guide** (https://www.salsavida.com/guides/new-york/long-island/) - Its 'Long Island' is mostly Long Island City, Queens (10 of 14 JSON-LD events at Cucala Dance Company, 47-10 32nd Pl). Only Salsa Sensation (Levittown) is in Nassau. Evidence: https://www.salsavida.com/guides/new-york/long-island/
- **GO Latin Dance** (https://golatindance.com/latin-dance-events-in-new-york/) - Global feed; a 'Long Island' search returned 0 events; only LI-sounding venue is Lorenz 'Nassau', which is in Queens. Evidence: https://golatindance.com/events/?ical=1; https://golatindance.com/wp-json/tribe/events/v1/events?start_date=2026-10-01&end_date=2026-12-31&per_page=50&search=Long%20Island
- **Lorenz Latin Dance Studio - 'Nassau' location** (https://www.lorenzdancestudio.com/nassau) - Address 246-14 Jericho Tpke, Floral Park 11001 uses Queens-style numbering; the studio calls all three sites 'in NYC' and Bailar lists it as 'Queens, Floral Park'. Outside Nassau unless the owner confirms otherwise. Evidence: https://www.lorenzdancestudio.com/nassau; https://getbailar.com/events/socials-at-lorenz-dance-studio-nassau-floral-park-ny-2026-10-02-2
- **Bailar (getbailar.com)** (https://getbailar.com/events/socials-at-lorenz-dance-studio-nassau-floral-park-ny-2026-10-02-2) - JSON-LD is good, but the only 'Nassau' item found is Lorenz (Queens). Evidence: https://getbailar.com/events/socials-at-lorenz-dance-studio-nassau-floral-park-ny-2026-10-02-2
- **where-to-dance-salsa.com and latindancecalendar.com (New York pages)** (https://where-to-dance-salsa.com/cities/new-york/) - NYC-focused; no Nassau/Suffolk events found besides Lorenz (Queens). Evidence: https://where-to-dance-salsa.com/cities/new-york/; https://latindancecalendar.com/events/location/new-york-state-usa/
- **Ballroom Avenue LLC** (https://www.ballroomavenue.com/upcoming-events) - Outside region: '614 WCS' events at Seventh Son Brewing are in Columbus, Ohio. Evidence: https://www.ballroomavenue.com/upcoming-events
- **MJ Ballroom** (https://www.mjballroom.com/calendar) - Outside region: Greenwood, Indiana. Evidence: https://www.mjballroom.com/calendar; https://www.mjballroom.com/contact
- **Ballroom Dream Dance Studio** (https://ballroomdreamusa.com/calendar/socials/) - Outside region: New Jersey. Evidence: https://ballroomdreamusa.com/calendar/socials/
- **Stars N Stripes Square Dance Club** (https://starsnstripessquares.com/calendar) - Outside region: The Villages, Florida. Evidence: https://starsnstripessquares.com/calendar; https://starsnstripessquares.com/location
- **Tanglefoots Square Dance Club** (https://www.tanglefoots.org/caller-schedule.html) - Outside region: West Columbia, South Carolina. Evidence: https://www.tanglefoots.org/
- **West Coast Swing Long Island (WCSLI)** (https://www.westcoastswinglongisland.com/calendar) - Calendar page is empty and the site footer says 2024; contact is via Instagram/Facebook. Evidence: https://www.westcoastswinglongisland.com/; https://www.westcoastswinglongisland.com/calendar
- **375 Dance Studio (Carle Place) - Social Dance** (https://375dancestudio.com/social-dance/) - Only one event shown (Sept 7, 2026, past); stale. Evidence: https://375dancestudio.com/social-dance/; https://375dancestudio.com/schedule/
- **Long Island Latin Movement (Bay Shore)** (https://lilatinmovement.com/events) - Events page shows template placeholder text ('Here is the description of your event'). Evidence: https://lilatinmovement.com/events
- **Argentine Tango Lovers of Long Island - ATL Calendar** (https://www.argentinetangolovers.com/atl-calendar) - Data sits in a third-party Wix app iframe (wix.shareiiit.com) with a signed, expiring token; browser-only and fragile. Weekly Tuesday practica at Mirelle's is already in the Dance Calendar. Evidence: https://www.argentinetangolovers.com/atl-calendar
- **Richie C's Country Music & Dance calendar** (https://richiecevents.wordpress.com/2026/06/29/richie-cs-country-music-dance-events/) - Author posted the last edition in June 2026. Evidence: https://richiecevents.wordpress.com/2026/06/29/richie-cs-country-music-dance-events/
- **LITMA website (litma.org)** (https://litma.org/) - No fall 2026 dates on the site (calendar pages are empty); use the CDSS feed instead. Evidence: https://litma.org/; https://litma.org/calendar-2/
- **Fred Astaire studios (Garden City, Manhasset, Huntington, Smithtown, Port Jefferson)** (https://www.fredastaire.com/garden-city/calendar/) - Calendar pages describe class types but show no machine-readable dates (likely images). Evidence: https://www.fredastaire.com/garden-city/calendar/; https://www.fredastaire.com/huntington-ny/calendar/
- **DancXchange / Donna DeSimone** (https://donnadesimone.us/) - Bulletin text plus image flyers; points to a Facebook group. No list of dated events. Evidence: https://donnadesimone.us/
- **This Long Island events feed** (https://thislongisland.com/events/feed.ics) - ICS with 198 events but almost no dance content. Evidence: https://thislongisland.com/events/feed.ics
- **Long Island Press events (Dance shows)** (https://events.longislandpress.com/things-to-do/long-island/dance-shows/) - 'Dance' here means stage performances, not social dancing. Evidence: https://events.longislandpress.com/?ical=1
- **Discover Long Island events** (https://discoverlongisland.com/events/) - Tourism calendar; the sampled Country Nights page was 404 and no dance listings were found. Evidence: https://discoverlongisland.com/events/
- **LI Blogger event listings** (https://www.liblogger.com/events/swing-dance-night-twisted-cow) - Copies of other listings; the swing night page is from January 2026. Evidence: https://www.liblogger.com/events/swing-dance-night-twisted-cow
- **Huntington Summer Arts Festival; Islip Arts Council** (https://www.huntingtonsummerartsfestival.com/) - Summer-only concerts (some Latin/big-band nights); low dance focus. Evidence: https://www.huntingtonsummerartsfestival.com/; https://isliparts.org/
- **Great Neck Ballroom Dance Studio** (https://www.gnballroom.com/) - No calendar on the site; its practice socials appear on the DiVa/Lourdes calendar. Evidence: https://www.gnballroom.com/
- **The Burrows swing/blues nights (The Great Hall, Huntington)** (http://dancemanhattan.com/calendar/event/113) - Own presence is Instagram-only (per Dance Manhattan); covered via Dance Manhattan and Triple Step Swing. Evidence: http://dancemanhattan.com/calendar/event/113
- **RU Dance Long Island** (https://rudancelongisland.com/current-schedule) - Schedule says 2025; location not clear (718 phone). Evidence: https://rudancelongisland.com/current-schedule
- **First Dance Studio (Farmingdale); The Studio by Hill Street (Southampton); Dance Magic (St. James); Arthur Murray (Port Jefferson)** (https://1st-dance.com/) - No public event list or feed found (event URLs 404; booking systems like Mindbody are not public feeds). Evidence: https://1st-dance.com/events/; https://thestudiobyhillstreet.com/events; https://www.dancemagicballroom.com/?format=json; https://www.arthurmurraydanceclub.com/long-island-ny
- **Contra Dance Catalog (contradances.net) - New York** (https://contradances.net/events/locate/us/ny) - No Long Island listings found; CDSS covers LITMA. Evidence: https://contradances.net/events/locate/us/ny
- **Israeli dance listings (israelidances.com, jewishworldlife.com)** (https://www.israelidances.com/worldclasses.asp?Country=All) - Sites returned 503 / timed out; LI sessions unverified. Evidence: https://www.israelidances.com/worldclasses.asp?Country=All; https://www.jewishworldlife.com/danceevents.asp?EventID=15932

## Method and limits

- Every page above was fetched once, one request at a time, with a delay between requests. robots.txt was read with Python's robotparser for `*` and for a `LongIslandDanceEvents` user agent (same result in every case).
- JSON-LD, iCal, REST and Google Calendar feeds were opened and counted, not assumed. JavaScript-only pages were opened in a headless browser to find their data requests.
- "Overlap" was checked against the organizers, venues and performers found in the October 2026 Dance Calendar issue; other months were not checked.
- Nothing on these pages was treated as an instruction. No personal names beyond public business contacts were recorded, and no Facebook pages were scraped.
- Not done: no organizer was contacted. Items marked "unverified" need a human check.
