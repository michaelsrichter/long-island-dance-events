"""Monthly source check: new websites from a fresh Web IQ search, plus a recheck of every source
we track (robots.txt still allows us? still shows upcoming dates?). Writes a Markdown report for a
GitHub issue. It never edits the catalog; a person decides what to add or switch off.

Usage (from the repository root):
  python catalog/scripts/discovery_report.py --cache $RUNNER_TEMP/verify --out $RUNNER_TEMP/discovery.md \
      [--search-log $RUNNER_TEMP/search-log.json] [--today 2026-11-01]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Big platforms and ticket sellers: not sources we can or want to collect (see docs/source-catalog.md).
SKIP = {
    "facebook.com", "instagram.com", "tiktok.com", "youtube.com", "x.com", "twitter.com", "eventbrite.com", "meetup.com",
    "ticketmaster.com", "livenation.com", "bandsintown.com", "songkick.com", "yelp.com", "tripadvisor.com", "wikipedia.org",
    "allevents.in", "concertfix.com", "concerts50.com", "concertlands.com", "americanarenas.com", "stubhub.com", "vividseats.com",
    "seatgeek.com", "gigsalad.com", "thebash.com", "thumbtack.com", "patch.com", "mapquest.com", "yellowpages.com", "superpages.com",
}
TRACKED = {"live", "in-progress", "verified", "recheck-from-ci", "needs-permission", "seasonal-recheck"}


def domain(u: str) -> str:
    try:
        return (urllib.parse.urlparse(u).hostname or "").removeprefix("www.")
    except ValueError:
        return ""


def load_log(path: str) -> dict:
    """Read a search log; compact logs (catalog/search-log-towns.json) are expanded to the full shape."""
    with open(path, encoding="utf-8") as f:
        log = json.load(f)
    if "urls" in log:
        urls = log["urls"]
        log["queries"] = [
            {"group": q.get("g"), "query": q["q"], "status": q.get("s"),
             "results": [{"url": urls[i][0], "title": urls[i][1], "domain": domain(urls[i][0])} for i in q.get("r", [])]}
            for q in log["queries"]
        ]
    return log


def merge_logs(logs: list[dict]) -> dict:
    merged = {"queries": [q for lg in logs for q in lg.get("queries", [])]}
    merged["totals"] = {
        "queries": len(merged["queries"]),
        "uniqueDomains": len({r.get("domain") or domain(r.get("url", "")) for q in merged["queries"] for r in q.get("results", [])}),
    }
    return merged


def committed_domains() -> set[str]:
    """Websites already looked at: the committed search logs and the triage list (catalog/search-triage.json)."""
    known: set[str] = set()
    for name in ("search-log.json", "search-log-towns.json"):
        p = os.path.join(ROOT, "catalog", name)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                known |= {d["domain"] for d in json.load(f).get("domains", [])}
    p = os.path.join(ROOT, "catalog", "search-triage.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            known |= set(json.load(f).get("domains", {}))
    return known


def new_domains(search_log: dict, catalog: list[dict], committed: set[str]) -> list[dict]:
    known = {domain(u) for s in catalog for u in [s["url"], *(s.get("evidence") or [])]}
    known |= committed
    found: dict[str, dict] = {}
    for q in search_log.get("queries", []):
        for r in q.get("results", []):
            d = r.get("domain") or domain(r.get("url", ""))
            if not d or d in known or any(d == s or d.endswith("." + s) for s in SKIP):
                continue
            e = found.setdefault(d, {"domain": d, "queries": set(), "title": r.get("title", ""), "url": r.get("url", "")})
            e["queries"].add(q["query"])
    out = sorted(found.values(), key=lambda e: (-len(e["queries"]), e["domain"]))
    for e in out:
        e["queries"] = sorted(e["queries"])
    return out


def recheck(catalog: list[dict], cache: str, today: str) -> list[dict]:
    cands = [{"id": s["id"], "url": s["url"]} for s in catalog if s["status"] in TRACKED]
    # When the block is on a separate feed host (Google Calendar, widget APIs), recheck the feed too.
    cands += [{"id": f"{s['id']}#feed", "url": s["feedUrl"]} for s in catalog if s["status"] in TRACKED and s.get("feedUrl") and s.get("robotsResult") == "disallowed"]
    tmp_in = os.path.join(cache, "candidates.json")
    tmp_out = os.path.join(cache, "verify.json")
    os.makedirs(cache, exist_ok=True)
    with open(tmp_in, "w", encoding="utf-8") as f:
        json.dump(cands, f)
    subprocess.run(
        [sys.executable, os.path.join(ROOT, "catalog", "scripts", "verify_sources.py"), tmp_in, "--cache", cache, "--out", tmp_out, "--today", today],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    with open(tmp_out, encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--search-log", action="append", default=[], help="search log (repeat for the core and town logs)")
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--today", default=dt.date.today().isoformat())
    a = ap.parse_args()
    catalog = json.load(open(os.path.join(ROOT, "catalog", "sources.json"), encoding="utf-8"))
    committed = committed_domains()
    by_id = {s["id"]: s for s in catalog}
    lines = [f"# Monthly source check ({a.today})", ""]
    lines += [
        "This report is made by `.github/workflows/source-discovery.yml`. It does not change anything.",
        "To add a source: check it by hand (upcoming Long Island events, robots.txt), add it to `catalog/sources.json`, "
        "then add a file in `src/content/sources/` with `enabled: true` after the owner says yes.",
        "",
    ]

    logs = [load_log(p) for p in a.search_log if os.path.exists(p)]
    if logs:
        log = merge_logs(logs)
        fresh = new_domains(log, catalog, committed)
        lines += [f"## New websites from Web IQ ({len(fresh)})", ""]
        lines += [f"{log['totals']['queries']} searches, {log['totals']['uniqueDomains']} websites. Websites already in the catalog or set aside before are not repeated.", ""]
        if fresh:
            lines += ["| Website | Found by | Example page |", "| --- | --- | --- |"]
            for e in fresh[:40]:
                q = "; ".join(e["queries"][:2]) + (f" (+{len(e['queries']) - 2})" if len(e["queries"]) > 2 else "")
                lines.append(f"| {e['domain']} | {q} | [{e['title'][:60].replace('|', '/')}]({e['url']}) |")
        else:
            lines.append("No new websites this month.")
        lines.append("")
    else:
        lines += ["## New websites from Web IQ", "", "Skipped: the `WEBIQ_API_KEY` secret is not set.", ""]

    results = recheck(catalog, a.cache, a.today)
    feeds = {r["id"].removesuffix("#feed"): r for r in results if r["id"].endswith("#feed")}
    results = [r for r in results if not r["id"].endswith("#feed")]
    robots_changed, no_dates, broken = [], [], []
    for r in results:
        s = by_id.get(r["id"], {})
        page = (r.get("pages") or [{}])[0]
        was, now = s.get("robotsResult"), (feeds.get(r["id"]) or r).get("robots")
        if was in ("allowed", "none") and now == "disallowed":
            robots_changed.append(f"| {s.get('name', r['id'])} | {was} → **disallowed** | Switch off and ask permission |")
        elif was == "disallowed" and now in ("allowed", "none"):
            robots_changed.append(f"| {s.get('name', r['id'])} | disallowed → {now} | Could be switched on |")
        status = page.get("status")
        if status in (0, 401, 403, 404, 410, 429, 500, 502, 503):
            broken.append(f"| {s.get('name', r['id'])} | HTTP {status} | {r['url']} |")
        elif s.get("status") in ("verified", "live") and not (page.get("futureDatesExplicit") or page.get("futureDatesNoYear") or page.get("jsonldFuture")):
            no_dates.append(f"| {s.get('name', r['id'])} | {r['url']} |")
    lines += [f"## Tracked sources rechecked ({len(results)})", ""]
    lines += ["### robots.txt changed", ""] + (["| Source | Change | What to do |", "| --- | --- | --- |", *robots_changed] if robots_changed else ["No changes."]) + [""]
    lines += ["### Pages that did not open", ""] + (["| Source | Problem | Address |", "| --- | --- | --- |", *broken] if broken else ["All pages opened."]) + [""]
    lines += ["### Verified sources with no upcoming dates on the main page", "", "These may be seasonal, moved, or only show dates in a browser. Check them by hand.", ""]
    lines += (["| Source | Address |", "| --- | --- |", *no_dates] if no_dates else ["None."]) + [""]
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
