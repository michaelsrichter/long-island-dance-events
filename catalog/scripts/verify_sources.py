"""Verify candidate event sources politely and report what each page offers.

For every candidate URL this script:
  * reads robots.txt and checks whether OUR bot may fetch the path (longest-match rule,
    wildcards supported); records Content-Signal lines;
  * fetches the page with our identifying User-Agent (never a browser User-Agent), one request
    at a time per host with a delay; a 401/403/429 or bot-challenge page is recorded, never bypassed;
  * finds schema.org Event JSON-LD, iCal / Google Calendar links and the site platform;
  * pulls dates out of the page and counts the ones after --today;
  * counts Nassau/Suffolk place names (src/data/long-island-places.json) and out-of-area words.

Raw pages are cached in --cache (must be OUTSIDE the repository). The JSON report contains only
facts (counts, dates, platform, robots result), never page text, so it is safe to keep.

Usage:
  python catalog/scripts/verify_sources.py candidates.json --cache %TEMP%\\lide-verify --out report.json
candidates.json: [{"id": "...", "url": "...", "also": ["..."]}]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import hashlib
import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = (
    "LongIslandDanceEventsBot/1.0 (+https://github.com/michaelsrichter/long-island-dance-events; "
    "source discovery, polite)"
)
BOT_TOKEN = "longislanddanceeventsbot"
HOST_DELAY = 3.0
MONTHS = {m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october november december".split())}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
MONTHS["sept"] = 9
OUT_OF_AREA = ["queens", "brooklyn", "manhattan", "bronx", "staten island", "new jersey", " nj ",
               "connecticut", "astoria", "long island city", "westchester", "jersey city", "hoboken"]
EVENT_TYPES = {"event", "musicevent", "danceevent", "socialevent", "festival", "theaterevent",
               "educationevent", "comedyevent", "childrensevent", "exhibitionevent"}

_host_locks: dict[str, threading.Lock] = {}
_host_last: dict[str, float] = {}
_glock = threading.Lock()


def _polite_get(url: str, cache_dir: str, accept: str = "text/html,*/*") -> dict:
    host = urllib.parse.urlparse(url).netloc.lower()
    key = hashlib.sha1(url.encode()).hexdigest()[:20]
    path = os.path.join(cache_dir, key + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    with _glock:
        lock = _host_locks.setdefault(host, threading.Lock())
    with lock:
        wait = HOST_DELAY - (time.time() - _host_last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
        rec: dict = {"url": url, "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                body = r.read(3_000_000)
                rec.update(status=r.status, finalUrl=r.geturl(), contentType=r.headers.get("content-type", ""),
                           etag=r.headers.get("etag"), lastModified=r.headers.get("last-modified"))
        except urllib.error.HTTPError as e:
            body = e.read(200_000) if hasattr(e, "read") else b""
            rec.update(status=e.code, finalUrl=url, contentType=e.headers.get("content-type", "") if e.headers else "")
        except Exception as e:  # network errors, TLS, timeouts
            body = b""
            rec.update(status=0, error=type(e).__name__ + ": " + str(e)[:160], finalUrl=url, contentType="")
        _host_last[host] = time.time()
    text = body.decode("utf-8", errors="replace")
    rec["sha256"] = hashlib.sha256(body).hexdigest() if body else None
    rec["bytes"] = len(body)
    rec["body"] = text
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rec, f)
    return rec


def _robots_rules(text: str) -> tuple[list[str], list[str], str]:
    groups, cur, last_agent = [], None, False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = (s.strip() for s in line.split(":", 1))
        k = k.lower()
        if k == "user-agent":
            if cur is None or not last_agent:
                cur = {"agents": [], "allow": [], "disallow": []}
                groups.append(cur)
            cur["agents"].append(v.lower())
            last_agent = True
            continue
        last_agent = False
        if cur is None:
            continue
        if k in ("allow", "disallow") and v:
            cur[k].append(v)
    mine = next((g for g in groups if any(a != "*" and a in BOT_TOKEN for a in g["agents"])), None)
    which = "our bot" if mine else "*"
    g = mine or next((g for g in groups if "*" in g["agents"]), None)
    return (g["allow"], g["disallow"], which) if g else ([], [], "none")


def _rule_match(rule: str, path: str) -> int:
    pat = re.escape(rule).replace(r"\*", ".*")
    if pat.endswith(r"\$"):
        pat = pat[:-2] + "$"
    return len(rule) if re.match(pat, path) else -1


def robots_check(url: str, cache_dir: str) -> dict:
    p = urllib.parse.urlparse(url)
    rurl = f"{p.scheme}://{p.netloc}/robots.txt"
    rec = _polite_get(rurl, cache_dir, accept="text/plain,*/*")
    status = rec.get("status")
    body = rec.get("body", "")
    signals = [ln.strip() for ln in body.splitlines() if ln.lower().startswith("content-signal")][:3]
    if status in (404, 410):
        return {"robots": "none", "robotsUrl": rurl, "robotsStatus": status}
    if status != 200 or "<html" in body[:500].lower():
        return {"robots": "unknown", "robotsUrl": rurl, "robotsStatus": status,
                "robotsNote": "robots.txt not readable (" + str(status) + ")"}
    allow, disallow, which = _robots_rules(body)
    path = p.path or "/"
    if p.query:
        path += "?" + p.query
    best_allow = max([_rule_match(r, path) for r in allow] + [-1])
    best_dis = max([_rule_match(r, path) for r in disallow] + [-1])
    verdict = "disallowed" if best_dis > best_allow else "allowed"
    return {"robots": verdict, "robotsUrl": rurl, "robotsStatus": status, "robotsGroup": which,
            "contentSignal": signals or None}


def _walk_jsonld(node, out):
    if isinstance(node, list):
        for n in node:
            _walk_jsonld(n, out)
    elif isinstance(node, dict):
        t = node.get("@type")
        types = [t] if isinstance(t, str) else (t or [])
        if any(str(x).lower() in EVENT_TYPES for x in types):
            loc = node.get("location") or {}
            if isinstance(loc, list):
                loc = loc[0] if loc else {}
            addr = loc.get("address") if isinstance(loc, dict) else None
            if isinstance(addr, dict):
                addr = ", ".join(str(addr.get(k, "")) for k in ("addressLocality", "addressRegion") if addr.get(k))
            out.append({"startDate": node.get("startDate"), "type": types[0] if types else None,
                        "locality": addr if isinstance(addr, str) else None})
        for v in node.values():
            if isinstance(v, (dict, list)):
                _walk_jsonld(v, out)


DATE_RES = [
    re.compile(r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b", re.I),
    re.compile(r"\b(\d{1,2})/(\d{1,2})/(20\d\d|\d\d)\b"),
    re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)"),
]


def extract_dates(text: str, today: dt.date) -> dict:
    explicit, inferred = set(), set()
    for m in DATE_RES[0].finditer(text):
        mon = MONTHS.get(m.group(1).lower().rstrip("."), MONTHS.get(m.group(1).lower()[:3]))
        day = int(m.group(2))
        try:
            if m.group(3):
                explicit.add(dt.date(int(m.group(3)), mon, day))
            else:
                d = dt.date(today.year, mon, day)
                if d < today - dt.timedelta(days=60):
                    d = dt.date(today.year + 1, mon, day)
                inferred.add(d)
        except (ValueError, TypeError):
            pass
    for m in DATE_RES[1].finditer(text):
        try:
            y = int(m.group(3))
            explicit.add(dt.date(y if y > 99 else 2000 + y, int(m.group(1)), int(m.group(2))))
        except ValueError:
            pass
    for m in DATE_RES[2].finditer(text):
        try:
            explicit.add(dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass
    horizon = today + dt.timedelta(days=550)
    fut_exp = sorted(d for d in explicit if today <= d <= horizon)
    fut_inf = sorted(d for d in inferred if today <= d <= today + dt.timedelta(days=300))
    return {
        "futureDatesExplicit": len(fut_exp),
        "futureDatesNoYear": len(fut_inf),
        "next90Days": len([d for d in fut_exp + fut_inf if d <= today + dt.timedelta(days=90)]),
        "latestFutureDate": max(fut_exp).isoformat() if fut_exp else (max(fut_inf).isoformat() + "?" if fut_inf else None),
        "sampleFuture": [d.isoformat() for d in (fut_exp or fut_inf)[:6]],
        "latestPastDateExplicit": max([d for d in explicit if d < today], default=None).isoformat()
        if any(d < today for d in explicit) else None,
    }


def platform_of(body: str) -> list[str]:
    b = body[:400_000].lower()
    marks = {
        "wix": ["static.wixstatic.com", "wix-warmup-data", "_wixcssimports", "wix.com website builder"],
        "squarespace": ["squarespace.com", "static1.squarespace"],
        "wordpress": ["wp-content/", "wp-json"],
        "the-events-calendar": ["tribe-events", "tribe_events", "/wp-json/tribe/"],
        "godaddy": ["img1.wsimg.com"],
        "weebly": ["weebly.com"],
        "civicplus": ["civicplus", "civicengage", "/calendar.aspx"],
        "libcal": ["libcal"],
        "libnet": ["libnet.info"],
        "webflow": ["webflow"],
        "shopify": ["cdn.shopify.com"],
        "next/nuxt (JS app)": ["__next_data__", "__nuxt"],
        "eventscalendar.co": ["eventscalendar.co"],
        "elfsight": ["elfsight"],
        "google-calendar-embed": ["calendar.google.com/calendar/embed"],
        "bandsintown-widget": ["widget.bandsintown.com", "bandsintown"],
        "seated/songkick widget": ["widget.seated.com", "songkick.com/widget"],
        "joomla": ["/media/jui/", "joomla"],
        "duda": ["dudamobile", "multiscreensite"],
        "cloudflare-challenge": ["cf-chl", "challenge-platform", "just a moment..."],
    }
    return [k for k, v in marks.items() if any(x in b for x in v)]


def visible_text(body: str) -> str:
    b = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", body)
    b = re.sub(r"(?s)<[^>]+>", " ", b)
    return re.sub(r"\s+", " ", html.unescape(b))


def load_places(repo_root: str) -> list[str]:
    with open(os.path.join(repo_root, "src", "data", "long-island-places.json"), encoding="utf-8") as f:
        data = json.load(f)
    names = []
    places = data.get("places", [])
    for p in places:
        n = p.get("name") if isinstance(p, dict) else p
        if n and len(n) > 3:
            names.append(n)
    names += [a for a in data.get("aliases", {}) if len(a) > 3]
    return sorted(set(names), key=len, reverse=True)


def verify(cand: dict, cache_dir: str, today: dt.date, places: list[str]) -> dict:
    out = {"id": cand["id"], "url": cand["url"], "checkedAt": today.isoformat(), "pages": []}
    out.update(robots_check(cand["url"], cache_dir))
    urls = [cand["url"]] + cand.get("also", [])
    all_text = ""
    for u in urls:
        r = robots_check(u, cache_dir) if u != cand["url"] else {"robots": out["robots"]}
        if r["robots"] == "disallowed":
            out["pages"].append({"url": u, "skipped": "robots.txt disallows our bot"})
            continue
        rec = _polite_get(u, cache_dir)
        body = rec.get("body", "")
        jl = []
        for m in re.finditer(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', body):
            try:
                _walk_jsonld(json.loads(m.group(1).strip()), jl)
            except Exception:
                pass
        ical = sorted(set(re.findall(r'''(?i)(?:href|src)=["']([^"']*(?:\.ics\b|[?&]ical=1|webcal:|/calendar/ical/|calendar\.google\.com/calendar/embed)[^"']*)''', body)))[:5]
        text = visible_text(body)
        all_text += " " + text
        jl_dates = []
        for e in jl:
            try:
                jl_dates.append(dt.date.fromisoformat(str(e["startDate"])[:10]))
            except Exception:
                pass
        challenge = rec.get("status") in (401, 403, 429, 503) or "cloudflare-challenge" in platform_of(body)
        out["pages"].append({
            "url": u, "status": rec.get("status"), "finalUrl": rec.get("finalUrl"), "error": rec.get("error"),
            "bytes": rec.get("bytes"), "sha256": rec.get("sha256"), "etag": bool(rec.get("etag")),
            "lastModified": rec.get("lastModified"), "platform": platform_of(body),
            "blocked": bool(challenge),
            "jsonldEvents": len(jl), "jsonldFuture": len([d for d in jl_dates if d >= today]),
            "jsonldLatest": max(jl_dates).isoformat() if jl_dates else None,
            "jsonldLocalities": sorted({e["locality"] for e in jl if e.get("locality")})[:6],
            "icalLinks": ical, "textChars": len(text),
            **extract_dates(text + " " + (body if "wix" in platform_of(body) else ""), today),
        })
    low = " " + all_text.lower() + " "
    out["liPlaces"] = sorted({p for p in places if re.search(r"\b" + re.escape(p.lower()) + r"\b", low)})[:15]
    out["outOfArea"] = sorted({w.strip() for w in OUT_OF_AREA if w in low})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("candidates")
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--today", default=dt.date.today().isoformat())
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if os.path.abspath(a.cache).startswith(repo):
        raise SystemExit("--cache must be outside the repository")
    os.makedirs(a.cache, exist_ok=True)
    today = dt.date.fromisoformat(a.today)
    places = load_places(repo)
    with open(a.candidates, encoding="utf-8") as f:
        cands = json.load(f)
    results = []
    with cf.ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(verify, c, a.cache, today, places): c for c in cands}
        for fu in cf.as_completed(futs):
            try:
                r = fu.result()
            except Exception as e:
                r = {"id": futs[fu]["id"], "url": futs[fu]["url"], "error": repr(e)[:200]}
            results.append(r)
            p0 = (r.get("pages") or [{}])[0]
            print(f'{r["id"][:34]:34} robots={r.get("robots","?"):10} http={p0.get("status")} '
                  f'jsonld={p0.get("jsonldFuture")}/{p0.get("jsonldEvents")} ical={len(p0.get("icalLinks") or [])} '
                  f'fut={p0.get("futureDatesExplicit")}+{p0.get("futureDatesNoYear")} latest={p0.get("latestFutureDate")} '
                  f'plat={",".join(p0.get("platform") or [])}', flush=True)
    results.sort(key=lambda r: r["id"])
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
