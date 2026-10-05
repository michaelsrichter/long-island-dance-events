#!/usr/bin/env node
// Runs Web IQ discovery searches and writes a search log (query, result count, result URLs and titles)
// for the source catalog. Two query files exist:
//   catalog/search-queries.json  85 Long Island-wide queries (monthly)
//   catalog/search-matrix.json   town-by-town queries (catalog/scripts/build-search-matrix.mjs);
//                                the monthly workflow runs one twelfth of it (--slice), so every
//                                place is searched again once a year.
//
// The API key is read ONLY from the WEBIQ_API_KEY environment variable. It is never printed, logged or
// written to disk. Results are cached in --cache, which must be outside the repository; the cache keeps
// only titles, URLs and dates (no page text). Each cached file is one paid call, so the cache folder is
// also the record of how many calls were made.
//
// Usage: set the WEBIQ_API_KEY environment variable for this one command only (never in a file), then:
//   node catalog/scripts/webiq-search.mjs --cache $env:TEMP\webiq-cache
//   node catalog/scripts/webiq-search.mjs --queries catalog/search-matrix.json --max-results 30 \
//        --compact --log catalog/search-log-towns.json --max-calls 3100 --concurrency 3 --cache <dir>
//
// Options:
//   --queries <file>     query file with a "groups" object (default catalog/search-queries.json)
//   --cache <dir>        cache folder outside the repository (required)
//   --log <file>         where to write the log (default catalog/search-log.json)
//   --max-results <n>    results per search, 1-50 (default 20). Web IQ bills per call, not per result.
//   --max-calls <n>      stop making new paid calls after n (cached results are still used)
//   --slice <k>/<n>      only groups k, k+n, k+2n... (1-based), e.g. --slice 10/12 for October
//   --concurrency <n>    searches in flight at once (default 1)
//   --delay-ms <n>       pause after each paid call, per worker (default 1500)
//   --compact            write each URL and title once, with queries pointing to them (smaller log)
//   --dry-run            count queries and cached results only; no calls, no log
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ENDPOINT = 'https://api.microsoft.ai/v3/search/web';
/** List price checked 2026-10-03. */
const PRICE_PER_1000_CALLS_USD = 12.5;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const queriesFile = resolve(arg('queries', 'catalog/search-queries.json'));
const cacheDir = arg('cache', '');
const logFile = resolve(arg('log', 'catalog/search-log.json'));
const maxResults = Math.min(50, Math.max(1, Number(arg('max-results', '20'))));
const maxCalls = Number(arg('max-calls', 'Infinity'));
const concurrency = Math.max(1, Number(arg('concurrency', '1')));
const delayMs = Number(arg('delay-ms', '1500'));
const slice = arg('slice', '');
const compact = flag('compact');
const dryRun = flag('dry-run');

if (!cacheDir) {
  console.error('Pass --cache <dir> (a folder OUTSIDE the repository; raw results are never committed).');
  process.exit(2);
}
if (resolve(cacheDir).startsWith(resolve('.'))) {
  console.error('The cache folder must be outside the repository.');
  process.exit(2);
}
const apiKey = process.env.WEBIQ_API_KEY;
if (!apiKey && !dryRun) {
  console.error('WEBIQ_API_KEY is not set. Set it in the environment for this command only.');
  process.exit(2);
}
mkdirSync(cacheDir, { recursive: true });

let { groups } = JSON.parse(readFileSync(queriesFile, 'utf8'));
if (slice) {
  const m = /^(\d+)\/(\d+)$/.exec(slice);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) {
    console.error('--slice must look like 3/12 (part 3 of 12).');
    process.exit(2);
  }
  const [k, n] = [Number(m[1]), Number(m[2])];
  groups = Object.fromEntries(Object.entries(groups).filter((_, i) => i % n === k - 1));
}
const params = { maxResults, language: 'en', region: 'US', contentFormat: 'passage', maxLength: 800, safeSearch: 'strict' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let httpRequests = 0;
let rateLimited = 0;

async function search(query) {
  const body = JSON.stringify({ query, ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    httpRequests++;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { host: 'api.microsoft.ai', 'x-apikey': apiKey, 'content-type': 'application/json' },
        body,
      });
    } catch (e) {
      if (attempt === 4) return { status: 0, error: String(e).slice(0, 200), webResults: [] };
      await sleep(3000 * attempt);
      continue;
    }
    if (res.status === 429) {
      rateLimited++;
      let wait = 5000 * attempt;
      try {
        const j = await res.json();
        if (j?.retryAfter) wait = Math.max(wait, Number(j.retryAfter) * 1000);
      } catch {}
      console.error(`  429, waiting ${wait} ms`);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    if (!res.ok) return { status: res.status, error: text.slice(0, 300), webResults: [] };
    return { status: res.status, ...JSON.parse(text) };
  }
  return { status: 429, error: 'gave up after retries', webResults: [] };
}

const jobs = Object.entries(groups).flatMap(([group, queries]) => queries.map((query) => ({ group, query })));
const entries = new Array(jobs.length);
let calls = 0; // searches sent (one per query; retries are not counted)
let paidCalls = 0; // searches that returned results (status 200), which is what Web IQ bills
let skippedForBudget = 0;
let next = 0;

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function runJob(i) {
  const { group, query } = jobs[i];
  const key = createHash('sha1').update(JSON.stringify({ query, ...params })).digest('hex').slice(0, 16);
  const file = join(cacheDir, `${key}.json`);
  let data;
  let cached = false;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
    cached = true;
  } catch {
    // Not cached yet.
  }
  if (!data && (dryRun || calls >= maxCalls)) {
    if (!dryRun) skippedForBudget++;
    data = { status: dryRun ? 0 : -1, webResults: [] };
  } else if (!data) {
    calls++;
    data = await search(query);
    data.fetchedAt = new Date().toISOString();
    // Keep only the fields this script reads (no page text), in a cache outside the repository.
    const keep = (data.webResults || []).map((r) => ({ title: String(r.title ?? '').slice(0, 300), url: String(r.url ?? ''), lastUpdatedAt: r.lastUpdatedAt }));
    if (data.status === 200) {
      paidCalls++;
      try {
        writeFileSync(file, JSON.stringify({ query, params, status: 200, fetchedAt: data.fetchedAt, webResults: keep }, null, 1), { flag: 'wx' });
      } catch {}
    }
    await sleep(delayMs);
  }
  const results = (data.webResults || []).map((r, rank) => ({
    rank: rank + 1,
    title: (r.title || '').slice(0, 140),
    url: r.url,
    domain: domainOf(r.url),
    lastUpdatedAt: r.lastUpdatedAt || undefined,
  }));
  entries[i] = { group, query, status: data.status, resultCount: results.length, fetchedAt: data.fetchedAt, cached, results };
  const note = data.status === -1 ? '  SKIPPED (call budget reached)' : data.error ? `  ERROR ${data.status}` : '';
  console.log(`${String(i + 1).padStart(5)}/${jobs.length} ${String(results.length).padStart(3)}  ${cached ? '(cache) ' : ''}${query}${note}`);
}

async function worker() {
  while (next < jobs.length) await runJob(next++);
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, worker));

const domainHits = {};
for (const e of entries) for (const r of e.results) {
  domainHits[r.domain] ??= { domain: r.domain, queries: 0, results: 0 };
  domainHits[r.domain].results++;
}
for (const e of entries) for (const d of new Set(e.results.map((r) => r.domain))) domainHits[d].queries++;

const uniqueUrls = new Set(entries.flatMap((e) => e.results.map((r) => r.url)));
const totals = {
  queries: entries.length,
  apiCallsThisRun: paidCalls,
  estimatedCostUsd: Math.round((paidCalls * PRICE_PER_1000_CALLS_USD) / 10) / 100,
  httpRequestsThisRun: httpRequests,
  rateLimitedRequests: rateLimited,
  pricePer1000CallsUsd: PRICE_PER_1000_CALLS_USD,
  skippedForBudget,
  failed: entries.filter((e) => e.status !== 200 && e.status !== -1 && e.status !== 0).length,
  results: entries.reduce((n, e) => n + e.resultCount, 0),
  uniqueUrls: uniqueUrls.size,
  uniqueDomains: Object.keys(domainHits).length,
};
const domains = Object.values(domainHits).sort((a, b) => b.queries - a.queries || a.domain.localeCompare(b.domain));
const about =
  'Web IQ Web Search discovery log for Long Island Dance Events. Each query with its result count and result URLs (titles shortened). Page text is not stored here.';

let log;
if (compact) {
  // Each URL (with its title) is stored once; each query lists its results as positions in "urls".
  const index = new Map();
  const urls = [];
  for (const e of entries) for (const r of e.results) if (!index.has(r.url)) {
    index.set(r.url, urls.length);
    urls.push([r.url, r.title]);
  }
  log = {
    about: `${about} Compact form: "urls" holds [url, title] once; each query's "r" lists positions in "urls", best result first.`,
    endpoint: ENDPOINT,
    params,
    queryFile: queriesFile.replace(resolve('.'), '').replace(/^[\\/]/, '').replace(/\\/g, '/'),
    slice: slice || undefined,
    runAt: new Date().toISOString().slice(0, 10),
    totals,
    queries: entries.map((e) => ({ g: e.group, q: e.query, s: e.status, r: e.results.map((r) => index.get(r.url)) })),
    urls,
    domains,
  };
} else {
  log = { about, endpoint: ENDPOINT, params, runAt: new Date().toISOString().slice(0, 10), totals, queries: entries, domains };
}
/** Compact logs: one query, URL or domain per line, so the file stays readable and diffs stay small. */
function compactJson(obj) {
  const lines = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v) && v.length) return `  ${JSON.stringify(k)}: [\n${v.map((x) => '    ' + JSON.stringify(x)).join(',\n')}\n  ]`;
      return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    });
  return `{\n${lines.join(',\n')}\n}`;
}
if (!dryRun) writeFileSync(logFile, (compact ? compactJson(log) : JSON.stringify(log, null, 2)) + '\n');
const cachedCount = entries.filter((e) => e.cached).length;
console.log(
  `\n${entries.length} queries (${cachedCount} from cache), ${paidCalls} successful (billable) API calls this run (about $${totals.estimatedCostUsd.toFixed(2)}),` +
    ` ${httpRequests} HTTP requests (${rateLimited} rate-limited), ${skippedForBudget} skipped for the call budget, ${totals.failed} failed, ${totals.uniqueUrls} unique URLs, ${totals.uniqueDomains} domains.`,
);
