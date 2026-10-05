// Tells Bing, Yandex, Seznam, Naver and others (through IndexNow) which pages are new or changed, so
// they show up in Bing, Copilot and ChatGPT search sooner. Compares the live site's sitemap state from
// before the deploy with the one just built. Never fails the deploy.
//   node scripts/indexnow.mjs --old old-state.json --new dist/sitemap-state.json --site https://longisland.dance [--dry-run]
// The key comes from INDEXNOW_KEY (also served as /<key>.txt by the site; see scripts/postbuild.mjs).
import { readFileSync } from 'node:fs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes('--dry-run');
const key = (process.env.INDEXNOW_KEY || '').trim();
const site = (arg('site') || process.env.SITE_URL || '').replace(/\/$/, '');

const read = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).urls ?? {};
  } catch {
    return {};
  }
};

/** Addresses that are new, or whose fingerprint changed. */
export function changedUrls(before, after, host) {
  return Object.entries(after)
    .filter(([url, [hash]]) => (!host || new URL(url).host === host) && before[url]?.[0] !== hash)
    .map(([url]) => url);
}

async function main() {
  if (!key || !site) {
    console.log('[indexnow] INDEXNOW_KEY or site address not set; nothing to do.');
    return;
  }
  const host = new URL(site).host;
  const urls = changedUrls(read(arg('old') || 'old-state.json'), read(arg('new') || 'dist/sitemap-state.json'), host);
  console.log(`[indexnow] ${urls.length} new or changed pages.`);
  if (!urls.length || dryRun) {
    if (dryRun) console.log(urls.slice(0, 20).join('\n'));
    return;
  }
  for (let i = 0; i < urls.length; i += 10000) {
    const urlList = urls.slice(i, i + 10000);
    try {
      const res = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation: `${site}/${key}.txt`, urlList }),
        signal: AbortSignal.timeout(30000),
      });
      // 200 = received, 202 = received and the key is being checked.
      console.log(`[indexnow] sent ${urlList.length} addresses: HTTP ${res.status}`);
    } catch (err) {
      console.log(`[indexnow] could not reach IndexNow: ${err?.message ?? err}`);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) await main();
