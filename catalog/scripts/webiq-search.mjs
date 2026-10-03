#!/usr/bin/env node
// Runs the Web IQ discovery searches listed in catalog/search-queries.json and
// writes a search log (query, result count, result URLs) for the source catalog.
//
// The API key is read ONLY from the WEBIQ_API_KEY environment variable. It is
// never printed, logged or written to disk. Raw responses (with page passages)
// are cached in --cache, which must be outside the repository.
//
// Usage: set the WEBIQ_API_KEY environment variable for this one command only (never in a file), then:
//   node catalog/scripts/webiq-search.mjs --cache $env:TEMP\webiq-cache
//
// Options: --queries <file> --cache <dir> --log <file> --max-results <n> --delay-ms <n> --dry-run
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ENDPOINT = 'https://api.microsoft.ai/v3/search/web';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const queriesFile = resolve(arg('queries', 'catalog/search-queries.json'));
const cacheDir = arg('cache', '');
const logFile = resolve(arg('log', 'catalog/search-log.json'));
const maxResults = Number(arg('max-results', '20'));
const delayMs = Number(arg('delay-ms', '1500'));
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

const { groups } = JSON.parse(readFileSync(queriesFile, 'utf8'));
const params = { maxResults, language: 'en', region: 'US', contentFormat: 'passage', maxLength: 800, safeSearch: 'strict' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(query) {
  const body = JSON.stringify({ query, ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { host: 'api.microsoft.ai', 'x-apikey': apiKey, 'content-type': 'application/json' },
      body,
    });
    if (res.status === 429) {
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

const entries = [];
let calls = 0;
for (const [group, queries] of Object.entries(groups)) {
  for (const query of queries) {
    const key = createHash('sha1').update(JSON.stringify({ query, ...params })).digest('hex').slice(0, 16);
    const file = join(cacheDir, `${key}.json`);
    let data;
    let cached = false;
    if (existsSync(file)) {
      data = JSON.parse(readFileSync(file, 'utf8'));
      cached = true;
    } else if (dryRun) {
      data = { status: 0, webResults: [] };
    } else {
      data = await search(query);
      data.fetchedAt = new Date().toISOString();
      calls++;
      if (data.status === 200) writeFileSync(file, JSON.stringify({ query, params, ...data }, null, 1));
      await sleep(delayMs);
    }
    const results = (data.webResults || []).map((r, i) => {
      let domain = '';
      try { domain = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
      return { rank: i + 1, title: (r.title || '').slice(0, 140), url: r.url, domain, lastUpdatedAt: r.lastUpdatedAt || undefined };
    });
    entries.push({ group, query, status: data.status, resultCount: results.length, fetchedAt: data.fetchedAt, cached, results });
    console.log(`${String(results.length).padStart(3)}  ${cached ? '(cache) ' : ''}${query}${data.error ? '  ERROR ' + data.status : ''}`);
  }
}

const domainHits = {};
for (const e of entries) for (const r of e.results) {
  domainHits[r.domain] ??= { domain: r.domain, queries: 0, results: 0 };
  domainHits[r.domain].results++;
}
for (const e of entries) for (const d of new Set(e.results.map((r) => r.domain))) domainHits[d].queries++;

const log = {
  about: 'Web IQ Web Search discovery log for Long Island Dance Events. Each query with its result count and result URLs (titles shortened). Page text is not stored here.',
  endpoint: ENDPOINT,
  params,
  runAt: new Date().toISOString().slice(0, 10),
  totals: {
    queries: entries.length,
    apiCallsThisRun: calls,
    results: entries.reduce((n, e) => n + e.resultCount, 0),
    uniqueUrls: new Set(entries.flatMap((e) => e.results.map((r) => r.url))).size,
    uniqueDomains: Object.keys(domainHits).length,
  },
  queries: entries,
  domains: Object.values(domainHits).sort((a, b) => b.queries - a.queries || a.domain.localeCompare(b.domain)),
};
if (!dryRun) writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n');
console.log(`\n${entries.length} queries, ${calls} API calls, ${log.totals.uniqueUrls} unique URLs, ${log.totals.uniqueDomains} domains.`);
