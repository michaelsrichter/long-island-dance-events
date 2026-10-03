"""Write docs/source-catalog.md from catalog/sources.json and catalog/search-log.json.

Run from the repository root:  python catalog/scripts/catalog_report.py
The tables are generated; edit the words in this script, not in the Markdown file.
"""
import collections
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
cat = json.load(open(os.path.join(ROOT, "catalog", "sources.json"), encoding="utf-8"))
log = json.load(open(os.path.join(ROOT, "catalog", "search-log.json"), encoding="utf-8"))

PRI = {"High": 0, "Medium": 1, "Low": 2, "None": 3}
STATUS_HELP = [
    ("live", "Already collected by the website every week."),
    ("in-progress", "Being wired into the website right now (in another work session)."),
    ("verified", "We opened it, it lists upcoming Long Island events, and robots.txt lets our bot read it."),
    ("recheck-from-ci", "Looks good, but our office network blocks the site (bars, breweries, wineries). Check robots.txt from GitHub Actions before collecting."),
    ("needs-permission", "The site blocks bots (robots.txt says no, or it answered 403/429/bot check), or its rules forbid collecting. We ask the organizer first."),
    ("manual-intake", "Events are only on social media or in picture flyers. An editor or organizer adds them by hand (flyer upload)."),
    ("seasonal-recheck", "A real Long Island source with no upcoming dates right now (for example, summer concerts). Check again in spring."),
    ("set-aside", "Not useful: outside Nassau/Suffolk, out of date, no event list, private events only, or a copy of a better source."),
]
PUB_LABEL = {
    "venue": "Venue (bar, restaurant, hall, theater)", "organizer-club": "Organizer or club", "studio": "Dance studio",
    "band-dj": "Band or DJ", "instructor": "Teacher", "aggregator-calendar": "Event calendar that collects many events",
    "municipal-library": "Town, village or library", "media-newsletter": "News site or newsletter",
    "religious-civic": "Lodge, church, temple or civic group",
}
FMT_LABEL = {
    "jsonld": "Event data built into the page (schema.org JSON-LD)", "ical": "Calendar feed (.ics)",
    "google-calendar": "Public Google Calendar", "api-json": "Data feed (JSON)", "html": "Web page list (HTML)",
    "pdf": "PDF", "js-widget": "Calendar that only shows up in a browser (JavaScript)",
    "image-flyer": "Picture flyers", "social-only": "Social media only", "none": "No list found",
}
CONTENT_LABEL = {"partner-dancing": "Partner dancing", "line-dancing": "Line dancing",
                 "freestyle-club": "Freestyle / club dancing", "live-music": "Live music"}


def md_link(s):
    return f"[{s['name']}]({s['url']})"


def esc(t):
    return (t or "").replace("|", "/").replace("\n", " ")


def count_table(title, counter, labels=None, order=None):
    rows = [f"| {title} | Sources |", "| --- | ---: |"]
    keys = order or sorted(counter, key=lambda k: (-counter[k], k))
    for k in keys:
        if counter.get(k):
            rows.append(f"| {esc((labels or {}).get(k, k))} | {counter[k]} |")
    return "\n".join(rows)


active = [s for s in cat if s["status"] != "set-aside"]
by_status = collections.Counter(s["status"] for s in cat)
usable = [s for s in cat if s["status"] in ("live", "in-progress", "verified")]
t = log["totals"]

out = []
w = out.append
w("# Long Island Dance Events - source catalog")
w("")
w("> Generated from [`catalog/sources.json`](../catalog/sources.json) by `python catalog/scripts/catalog_report.py`. "
  "Checked on **October 3, 2026**. Area: **Nassau and Suffolk counties only**. Site: https://longisland.dance")
w("")
w("This is the list of websites that publish upcoming **dance events** and **live music** on Long Island, "
  "what each one covers, and whether we may collect it. It merges the earlier discovery pass "
  "([`docs/source-proposals.md`](source-proposals.md), 57 sites) with a new search using the Microsoft Web IQ search API.")
w("")
w("## The short version")
w("")
w(f"- We looked at **{len(cat)} websites**. **{len(usable)} are usable now** "
  f"({by_status['live']} live, {by_status['in-progress']} being built, {by_status['verified']} verified), "
  f"{by_status['recheck-from-ci']} need one more check from GitHub Actions, {by_status['needs-permission']} need the organizer's permission, "
  f"{by_status['manual-intake']} can only be added by hand, {by_status['seasonal-recheck']} are seasonal, and {by_status['set-aside']} were set aside.")
pri = collections.Counter(s["priority"] for s in usable)
w(f"- Usable sources by priority: **{pri['High']} High, {pri['Medium']} Medium, {pri['Low']} Low.**")
foc = collections.Counter(s["focus"] for s in active)
w(f"- Of the {len(active)} sources we keep, **{foc['dance']} are mainly about dancing** (clubs, studios, teachers, dance calendars) and "
  f"**{foc['music']} are mainly about live music** (bars, venues, bands). Music sources matter because many people dance to cover bands and DJs.")
w("- **Best new finds:** bar and beach-club calendars with event data built in (Daisy's in Miller Place, Mulcahy's in Wantagh), "
  "a country line-dance venue (89 North in Patchogue), the Mayor of Montauk and Webtunes music calendars, and dance-band gig lists "
  "(Pour Some 80s On Me, Radio Active, Decadia, Beernutz, Audawind).")
w("- **Ask first:** LongIsland.com (events and nightlife), Triple Step Swing, Lourdes Cruz's Google Calendar and others block bots. "
  "We will ask the organizers for permission or for a calendar feed. We never get around a block.")
w("")
w("## How we searched")
w("")
w(f"- **{t['queries']} Web IQ searches** (dance styles, line dancing, cover bands, DJs, \"live music\" plus 25 towns, and venue types such as breweries, VFW halls and libraries). "
  f"They returned {t['results']:,} results: **{t['uniqueUrls']:,} different pages on {t['uniqueDomains']} websites**. Every query and its result count is in [`catalog/search-log.json`](../catalog/search-log.json).")
w("- Web IQ cost: $12.50 per 1,000 calls at list price (checked October 3, 2026). Our 85 searches plus 14 page reads (\"Browse\") would cost about **$1.24**; "
  "evaluation traffic is free.")
w(f"- {t['domainsInCatalog']} of the {t['uniqueDomains']} websites made it into this catalog. The rest were ticket resellers, national directories, "
  "how-to articles, wedding-band ads or places outside Long Island.")
w("")
w("## How we checked each source")
w("")
w("1. A script ([`catalog/scripts/verify_sources.py`](../catalog/scripts/verify_sources.py)) read each site's **robots.txt**, then opened the page as "
  "`LongIslandDanceEventsBot/1.0` (our own name, never a browser disguise), one request at a time with a pause between requests.")
w("2. It looked for event data built into the page, calendar feeds and dates after October 3, 2026, and counted Nassau/Suffolk town names.")
w("3. A person (with AI help) then read each page and wrote the notes in our own words. Nothing was copied from the sites, and no private "
  "people's details were recorded.")
w("4. Our office network blocks some bar, brewery and winery sites. For those we read Microsoft's saved copy through Web IQ Browse and marked them "
  "**recheck-from-ci**: GitHub Actions must read their robots.txt before we collect anything.")
w("")
w("**Screenshots are not a way around a block.** A program that takes screenshots or reads text from images is still a robot, so robots.txt and the "
  "site's rules still apply. Blocked sites are asked for permission. Social-media-only and flyer-only events come in through the hand-entry "
  "(flyer upload) path described in [`docs/database-plan.md`](database-plan.md).")
w("")
w("## What the status words mean")
w("")
w("| Status | Meaning | Sources |")
w("| --- | --- | ---: |")
for k, v in STATUS_HELP:
    w(f"| **{k}** | {v} | {by_status.get(k, 0)} |")
w("")
w("## Counts")
w("")
w("Counts below include every source we keep (everything except set-aside).")
w("")
w(count_table("Who publishes it", collections.Counter(s["category"]["publisher"] for s in active), PUB_LABEL))
w("")
cc = collections.Counter(c for s in active for c in s["category"]["content"])
w(count_table("What it covers (a source can count more than once)", cc, CONTENT_LABEL))
w("")
w(count_table("Best format we can read", collections.Counter(s["category"]["format"] for s in active), FMT_LABEL))
w("")
w(count_table("County", collections.Counter(s["county"] for s in active)))
w("")
w(count_table("Priority (usable sources only)", pri, order=["High", "Medium", "Low"]))
w("")
w("```mermaid")
w("pie showData title Sources we keep, by status")
for k, _ in STATUS_HELP:
    if k != "set-aside" and by_status.get(k):
        w(f'  "{k}" : {by_status[k]}')
w("```")
w("")
w("## Top recommendations (High priority)")
w("")
w("| Source | Status | Kind of dancing | Towns | Format | Events per month | Effort |")
w("| --- | --- | --- | --- | --- | ---: | --- |")
for s in sorted([s for s in active if s["priority"] == "High"], key=lambda s: (s["status"] != "live", s["status"], s["id"])):
    kinds = ", ".join(s["kindsOfDancing"]) or "listening"
    towns = ", ".join(s["towns"][:3]) + (" +" if len(s["towns"]) > 3 else "")
    w(f"| {md_link(s)} | {s['status']} | {kinds} | {esc(towns)} | {FMT_LABEL.get(s['category']['format'], s['category']['format'])} | {s['eventsPerMonth'] or '?'} | {s['effort']} |")
w("")
w("Effort: **S** = a day or less (feed or tidy page), **M** = a few days (free text, several pages, filtering), **L** = a week or more (browser-only pages, many platforms).")
w("")
w("Kind of dancing: **partner** (swing, ballroom, salsa, hustle, tango, two-step, contra), **line** (line dancing), **freestyle** "
  "(dancing on your own to a band or DJ), **listening** (seated concerts).")
w("")


def section(title, intro, rows, cols):
    w(f"## {title}")
    w("")
    if intro:
        w(intro)
        w("")
    w("| " + " | ".join(c[0] for c in cols) + " |")
    w("| " + " | ".join("---" for _ in cols) + " |")
    for s in rows:
        w("| " + " | ".join(esc(str(c[1](s))) for c in cols) + " |")
    w("")


base_cols = [
    ("Priority", lambda s: s["priority"]),
    ("Source", md_link),
    ("Covers", lambda s: ", ".join(s["styles"][:4])),
    ("Towns", lambda s: ", ".join(s["towns"][:3]) + (" +" if len(s["towns"]) > 3 else "")),
    ("Format", lambda s: s["category"]["format"]),
    ("robots.txt", lambda s: s["robotsResult"]),
    ("Per month", lambda s: s["eventsPerMonth"] if s["eventsPerMonth"] is not None else "?"),
    ("Check", lambda s: s["checkCadence"]),
]
srt = lambda xs: sorted(xs, key=lambda s: (PRI[s["priority"]], s["id"]))
section("Usable sources (live, being built, verified)",
        "Owner decision (October 3, 2026): every source in this table and every source in the earlier proposals is accepted. "
        "\"Accepted\" never overrides robots.txt, site rules or bot protection.",
        srt([s for s in cat if s["status"] in ("live", "in-progress", "verified")]), base_cols)
section("Recheck from GitHub Actions",
        "Our office network blocks these sites, so robots.txt could not be read from here. The page content was confirmed from Microsoft's saved copy.",
        srt([s for s in cat if s["status"] == "recheck-from-ci"]), base_cols + [("Why", lambda s: s["reason"])])
section("Needs permission",
        "We will not collect these until the organizer says yes or shares a calendar feed (see the permission flow in the database plan).",
        srt([s for s in cat if s["status"] == "needs-permission"]),
        [("Priority", lambda s: s["priority"]), ("Source", md_link), ("What blocks us", lambda s: s["robots"]),
         ("Rules / notes", lambda s: s["terms"]), ("What to ask for", lambda s: "an .ics feed or written OK to read the events page weekly")])
section("Add by hand (manual intake)", "Events exist but only as social posts or picture flyers.",
        srt([s for s in cat if s["status"] == "manual-intake"]),
        [("Source", md_link), ("Why", lambda s: s["reason"])])
section("Seasonal: check again in spring", None, srt([s for s in cat if s["status"] == "seasonal-recheck"]),
        [("Priority", lambda s: s["priority"]), ("Source", md_link), ("Towns", lambda s: ", ".join(s["towns"][:3])), ("Note", lambda s: s["freshness"])])
section("Set aside", "Looked at and not kept. The reason is in our own words.",
        sorted([s for s in cat if s["status"] == "set-aside"], key=lambda s: s["id"]),
        [("Source", md_link), ("Reason", lambda s: s["reason"])])
w("## Files")
w("")
w("- [`catalog/sources.json`](../catalog/sources.json): one record per source with every field (styles, towns, format, robots.txt, terms, freshness, overlap, evidence links).")
w("- [`catalog/search-log.json`](../catalog/search-log.json): every Web IQ query, its result count and result links.")
w("- [`catalog/search-queries.json`](../catalog/search-queries.json) and [`catalog/scripts/webiq-search.mjs`](../catalog/scripts/webiq-search.mjs): rerun the search (the key comes only from the `WEBIQ_API_KEY` environment variable).")
w("- [`catalog/scripts/verify_sources.py`](../catalog/scripts/verify_sources.py): the polite checker used for robots.txt, dates and formats.")
w("")
open(os.path.join(ROOT, "docs", "source-catalog.md"), "w", encoding="utf-8", newline="\n").write("\n".join(out))
print("wrote docs/source-catalog.md", len(out), "lines")
