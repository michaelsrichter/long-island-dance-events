"""Triage the town-by-town Web IQ search results into a short list of websites worth checking.

Reads a search log (compact or full) or a Web IQ cache folder, groups results by website, and sorts
every website into one decision:

  known          already a source, a catalog entry, or set aside before (catalog/sources.json,
                 src/content/sources/*.json, catalog/search-triage.json)
  platform       big platforms, ticket sellers, national directories, maps, reviews, social media,
                 classified ads and news networks (see SKIP); never collected
  social         social-media pages (manual intake only; counted, not checked)
  out-of-area    the result titles point outside Nassau and Suffolk
  low-signal     no sign of an event list (titles and addresses never mention events, shows, a
                 calendar, dancing or music) and found by only one search
  candidate      worth opening: sent to verify_sources.py

It writes the candidate list for verify_sources.py and a triage file (domain -> decision and reason)
so the same websites are not looked at again. Only titles and URLs are used; no page text.

Usage (from the repository root):
  python catalog/scripts/triage_search.py --log catalog/search-log-towns.json \
      --candidates %TEMP%\\lide-triage\\candidates.json --triage %TEMP%\\lide-triage\\triage.json
  python catalog/scripts/triage_search.py --cache %TEMP%\\lide-webiq-towns ...
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import urllib.parse
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Never collected: platforms, ticket sellers, directories, maps, reviews, listings and national sites.
SKIP = {
    # social media and video
    "facebook.com", "instagram.com", "tiktok.com", "youtube.com", "x.com", "twitter.com", "threads.net", "pinterest.com",
    "linkedin.com", "reddit.com", "nextdoor.com", "tumblr.com", "vimeo.com", "soundcloud.com", "spotify.com", "apple.com",
    "bandcamp.com", "reverbnation.com", "bandmix.com", "smule.com", "flickr.com", "quora.com",
    # ticket sellers and national event platforms
    "eventbrite.com", "meetup.com", "ticketmaster.com", "livenation.com", "bandsintown.com", "songkick.com", "stubhub.com",
    "vividseats.com", "seatgeek.com", "axs.com", "etix.com", "ticketweb.com", "dice.fm", "tixr.com", "showclix.com",
    "ticketleap.com", "brownpapertickets.com", "universe.com", "seated.com", "ticketsauce.com", "simpletix.com",
    "ticketnetwork.com", "gametime.co", "tickpick.com", "ticketsmarter.com", "eventticketscenter.com", "eventective.com",
    "allevents.in", "happeningnext.com", "concertfix.com", "concerts50.com", "concertlands.com", "americanarenas.com",
    "concerty.com", "wikido.com", "jambase.com", "eventful.com", "evvnt.com", "everfest.com", "concertarchives.org",
    "hypebot.com", "setlist.fm", "songkick.co", "feverup.com", "eventsfy.com", "stayhappening.com", "10times.com",
    "nyctourism.com", "timeout.com", "theskint.com", "secretnyc.co", "ohmyrockness.com", "do-not-use",
    # hire-a-band and wedding marketplaces
    "gigsalad.com", "thebash.com", "thumbtack.com", "weddingwire.com", "theknot.com", "zola.com", "bark.com",
    "partyslate.com", "gigmasters.com", "encore.co", "eventup.com", "peerspace.com", "tagvenue.com", "wedding-spot.com",
    # maps, reviews, directories, listings
    "yelp.com", "tripadvisor.com", "tripadvisor.co.uk", "mapquest.com", "yellowpages.com", "superpages.com", "local.yahoo.com",
    "findglocal.com", "chamberofcommerce.com", "manta.com", "bbb.org", "foursquare.com", "zomato.com", "restaurantguru.com",
    "opentable.com", "menupages.com", "grubhub.com", "doordash.com", "ubereats.com", "seamless.com", "allmenus.com",
    "menuism.com", "sirved.com", "zmenu.com", "loc8nearme.com", "cylex.us.com", "hotfrog.com", "brownbook.net",
    "alignable.com", "nearplace.com", "storeboard.com", "birdeye.com", "bizapedia.com", "dandb.com", "angi.com",
    "homeadvisor.com", "groupon.com", "livingsocial.com", "classpass.com", "mindbodyonline.com", "mindbody.io",
    "dance-directory.com", "danceus.org", "thedanceatlas.com", "dancefactorial.com", "where-to-dance-salsa.com",
    "salsavida.com", "latindancecalendar.com", "westiehub.dance", "swingplanit.com", "worldwcs.com", "tangoatlas.com",
    "dancefinder.com", "danceplace.com", "dance.net", "studiodirectory.com", "danceclass.com", "lessons.com",
    "takelessons.com", "activityhero.com", "sawyer.com", "care.com", "nanny.com", "niche.com", "greatschools.org",
    "zillow.com", "realtor.com", "trulia.com", "redfin.com", "apartments.com", "homes.com", "rent.com", "city-data.com",
    "wikipedia.org", "wikimedia.org", "fandom.com", "imdb.com", "amazon.com", "ebay.com", "etsy.com", "craigslist.org",
    "indeed.com", "glassdoor.com", "ziprecruiter.com", "simplyhired.com", "salary.com", "google.com", "bing.com",
    "msn.com", "yahoo.com", "aol.com", "wiktionary.org", "dictionary.com",
    # national and NYC news networks (not event calendars we may collect)
    "newsbreak.com", "nytimes.com", "nypost.com", "nydailynews.com", "cbsnews.com", "abc7ny.com", "nbcnewyork.com",
    "pix11.com", "fox5ny.com", "news12.com", "silive.com", "usatoday.com", "cnn.com", "foxnews.com", "patch.com",
    "broadwayworld.com", "playbill.com", "medium.com", "substack.com", "blogspot.com", "wordpress.com",
    # more national or out-of-area event and business directories seen in the town search
    "danceseekers.com", "shazam.com", "nightout.com", "tickettailor.com", "findtheconcert.com", "upstateconcerts.com",
    "concertful.com", "etickets.com", "entradasx.com", "aarp.org", "qlist.app", "ma.to", "eventeny.com", "mapdance.com",
    "cortera.com", "altairguide.com", "blackandbrownbusiness.com", "punchpass.com", "newyorkfamily.com", "radiokingston.org",
    "chronogram.com", "altusentertainment.com", "localwineevents.com", "iloveny.com", "sulekha.com", "nysmusic.com",
    "fourth-july.com",
}
# Every country version of these platforms (eventbrite.co.uk, eventbrite.ie, ...).
SKIP_PREFIXES = ("eventbrite.", "tripadvisor.", "yelp.", "meetup.", "ticketmaster.", "allevents.", "bandsintown.")
SOCIAL = {"facebook.com", "instagram.com", "tiktok.com", "x.com", "twitter.com", "threads.net"}
EVENT_PATH = re.compile(r"/(events?|calendar|shows?|live-?music|music|entertainment|schedule|gigs?|concerts?|happenings|whats-?on|upcoming|socials?|milongas?|dances?|dance-?(?:parties|nights?)|tour(?:-dates)?|performances?|lineup|nightlife|this-?week|bands?)(?:[/?#._-]|$)|[?&](?:ical|post_type=tribe_events)", re.I)
EVENT_TITLE = re.compile(r"\b(events?|calendar|schedule|upcoming|shows?|gigs?|concerts?|live music|live bands?|entertainment|happenings|what'?s on|this week|tonight|dance (?:party|parties|night|socials?)|socials?|milonga|line danc|salsa night|swing night|ballroom|dj night|music night|lineup|tour dates?)\b", re.I)
DANCE_OR_MUSIC = re.compile(r"\b(danc\w*|swing|lindy|salsa|bachata|ballroom|hustle|tango|milonga|line ?danc\w*|two[- ]step|country|band|bands|music|musicians?|dj|jazz|blues|rock|concert|singer|tribute)\b", re.I)
OUT_OF_AREA = re.compile(
    r"\b(new jersey|connecticut|pennsylvania|brooklyn|queens|manhattan|bronx|staten island|nyc|new york city|westchester|"
    r"yonkers|white plains|hoboken|jersey city|astoria|flushing|long island city|bayside|philadelphia|boston|california|florida|"
    r"texas|ohio|west virginia|indiana|huntington beach|virginia|maryland|massachusetts|georgia|illinois|chicago|los angeles|"
    r"san diego|las vegas|london|ontario|canada|australia)\b",
    re.I,
)
# Two-letter state codes only count after a comma and in capitals ("Levittown, PA"), so "in" is not a state.
OTHER_STATE = re.compile(r",\s*(?:NJ|CT|PA|CA|FL|TX|OH|WV|IN|VA|MD|MA|GA|IL|NC|SC|TN|AZ|CO|MI|UK)\b")


def domain(u: str) -> str:
    try:
        return (urllib.parse.urlparse(u).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def base_domain(d: str) -> str:
    parts = d.split(".")
    if len(parts) > 2 and parts[-2] in ("co", "com", "org", "net") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def is_skipped(d: str) -> bool:
    return any(d == s or d.endswith("." + s) for s in SKIP) or any(base_domain(d).startswith(p) for p in SKIP_PREFIXES)


LIST_SEGMENT = re.compile(r"^(events?|calendar|shows?|concerts?|gigs?|happenings|whats-?on|upcoming-events|live-?music|entertainment|music)$", re.I)


def listing_parent(url: str) -> str | None:
    """https://site/events/some-show/2026-10-16/ -> https://site/events/ (the list the event page sits in)."""
    p = urllib.parse.urlparse(url)
    parts = [s for s in p.path.split("/") if s]
    for i, seg in enumerate(parts):
        if LIST_SEGMENT.match(seg) and i < len(parts) - 1:
            return f"{p.scheme}://{p.netloc}/{'/'.join(parts[: i + 1])}/"
    return None


def load_results(log_path: str | None, cache: str | None) -> list[dict]:
    """[{query, group, results: [{url, title}]}]"""
    out = []
    if log_path:
        with open(log_path, encoding="utf-8") as f:
            log = json.load(f)
        if "urls" in log:
            urls = log["urls"]
            for q in log["queries"]:
                out.append({"query": q["q"], "group": q.get("g"), "results": [{"url": urls[i][0], "title": urls[i][1]} for i in q.get("r", [])]})
        else:
            for q in log["queries"]:
                out.append({"query": q["query"], "group": q.get("group"), "results": [{"url": r["url"], "title": r.get("title", "")} for r in q["results"]]})
    if cache:
        for p in glob.glob(os.path.join(cache, "*.json")):
            with open(p, encoding="utf-8") as f:
                j = json.load(f)
            q = j.get("query", "")
            out.append({"query": q, "group": q.split(" NY ")[0], "results": [{"url": r["url"], "title": r.get("title", "")} for r in j.get("webResults", [])]})
    return out


def known_domains() -> dict[str, str]:
    known: dict[str, str] = {}
    with open(os.path.join(ROOT, "catalog", "sources.json"), encoding="utf-8") as f:
        for s in json.load(f):
            for u in [s.get("url", ""), s.get("feedUrl", ""), *(s.get("evidence") or [])]:
                d = domain(u)
                if d and not is_skipped(d):
                    known.setdefault(d, f"catalog:{s['id']} ({s.get('status')})")
    for p in glob.glob(os.path.join(ROOT, "src", "content", "sources", "*.json")):
        with open(p, encoding="utf-8") as f:
            s = json.load(f)
        sid = os.path.basename(p)[:-5]
        for u in [s.get("url", ""), s.get("feedUrl", ""), *(s.get("pageUrls") or [])]:
            d = domain(u)
            if d and not is_skipped(d):
                known[d] = f"source:{sid}"
    tri = os.path.join(ROOT, "catalog", "search-triage.json")
    if os.path.exists(tri):
        with open(tri, encoding="utf-8") as f:
            for d, e in json.load(f).get("domains", {}).items():
                known.setdefault(d, f"triaged:{e.get('decision')}")
    return known


def venue_sites() -> dict[str, str]:
    """Websites of venues, bands and organizers we already have files for (useful hints, not sources)."""
    out = {}
    for kind in ("venues", "performers", "organizers", "instructors"):
        for p in glob.glob(os.path.join(ROOT, "src", "content", kind, "*.json")):
            with open(p, encoding="utf-8") as f:
                e = json.load(f)
            d = domain(e.get("website") or "")
            if d and not is_skipped(d):
                out[d] = f"{kind[:-1]}:{os.path.basename(p)[:-5]}"
    return out


def load_place_names() -> list[str]:
    with open(os.path.join(ROOT, "src", "data", "long-island-places.json"), encoding="utf-8") as f:
        data = json.load(f)
    names = [p["name"] for p in data["places"]] + list(data["aliases"])
    return sorted({n.lower() for n in names if len(n) > 4}, key=len, reverse=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log")
    ap.add_argument("--cache")
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--triage", required=True)
    ap.add_argument("--max-candidates", type=int, default=900)
    a = ap.parse_args()
    queries = load_results(a.log, a.cache)
    known = known_domains()
    entities = venue_sites()
    places = load_place_names()
    li_re = re.compile(r"\b(" + "|".join(re.escape(p) for p in places) + r"|long island|nassau|suffolk|hamptons|north fork|south fork)\b", re.I)

    by: dict[str, dict] = defaultdict(lambda: {"queries": set(), "places": set(), "urls": {}, "titles": set()})
    for q in queries:
        for rank, r in enumerate(q["results"], 1):
            d = domain(r["url"])
            if not d:
                continue
            e = by[d]
            e["queries"].add(q["query"])
            e["places"].add(q.get("group") or "")
            u = e["urls"].setdefault(r["url"], {"url": r["url"], "title": r.get("title", ""), "hits": 0, "best": rank})
            u["hits"] += 1
            u["best"] = min(u["best"], rank)
            e["titles"].add(r.get("title", ""))

    triage: dict[str, dict] = {}
    cands = []
    for d, e in by.items():
        urls = sorted(e["urls"].values(), key=lambda u: (-bool(EVENT_PATH.search(urllib.parse.urlparse(u["url"]).path + "?" + urllib.parse.urlparse(u["url"]).query)), -u["hits"], u["best"]))
        sample = urls[0]
        text = " ".join(e["titles"]) + " " + " ".join(u["url"] for u in urls)
        rec = {"queries": len(e["queries"]), "places": len(e["places"]), "sample": sample["url"], "title": sample["title"][:100]}
        if is_skipped(d):
            rec.update(decision="social" if any(d == s or d.endswith("." + s) for s in SOCIAL) else "platform", reason="platform, ticket seller, directory or social media")
        elif d in known:
            rec.update(decision="known", reason=known[d])
        else:
            li = len(li_re.findall(text))
            titles = " ".join(e["titles"])
            ooa = len(OUT_OF_AREA.findall(titles + " " + d)) + len(OTHER_STATE.findall(titles))
            event_urls = [u for u in urls if EVENT_PATH.search(urllib.parse.urlparse(u["url"]).path + "?" + urllib.parse.urlparse(u["url"]).query)]
            event_titles = [t for t in e["titles"] if EVENT_TITLE.search(t)]
            dm = bool(DANCE_OR_MUSIC.search(text))
            score = 3 * len(event_urls[:3]) + 2 * len(event_titles[:3]) + min(len(e["queries"]), 10) + (4 if li else 0) + (2 if dm else 0) - 3 * min(ooa, 3)
            rec["score"] = score
            if d in entities:
                rec["entity"] = entities[d]
                score += 3
            if ooa >= 2 and not li:
                rec.update(decision="out-of-area", reason="result titles point outside Nassau and Suffolk")
            elif not event_urls and not event_titles and len(e["queries"]) < 2 and d not in entities:
                rec.update(decision="low-signal", reason="no event page, calendar, dance or music words; found once")
            elif not dm and not event_urls:
                rec.update(decision="low-signal", reason="no dance or music words and no event page")
            else:
                rec.update(decision="candidate", reason="")
                pick = [u["url"] for u in (event_urls[:2] or urls[:1])]
                # A single event page (/events/some-show) is a clue; the list page above it (/events/) is the calendar.
                parents = [p for p in (listing_parent(u) for u in pick) if p and p not in pick]
                pick = list(dict.fromkeys(parents[:1] + pick))[:3]
                root = f"{urllib.parse.urlparse(sample['url']).scheme}://{urllib.parse.urlparse(sample['url']).netloc}/"
                cands.append({"id": d, "url": pick[0], "also": pick[1:] + ([root] if root not in pick else []), "score": score, "queries": len(e["queries"])})
        triage[d] = rec

    cands.sort(key=lambda c: (-c["score"], -c["queries"], c["id"]))
    overflow = cands[a.max_candidates:]
    for c in overflow:
        triage[c["id"]].update(decision="low-signal", reason="ranked below the candidate cut-off")
    cands = cands[: a.max_candidates]
    os.makedirs(os.path.dirname(os.path.abspath(a.candidates)), exist_ok=True)
    with open(a.candidates, "w", encoding="utf-8") as f:
        json.dump(cands, f, indent=1)
    with open(a.triage, "w", encoding="utf-8") as f:
        json.dump(triage, f, indent=1)
    counts: dict[str, int] = defaultdict(int)
    for r in triage.values():
        counts[r["decision"]] += 1
    print(f"{len(queries)} queries, {len(by)} websites: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
