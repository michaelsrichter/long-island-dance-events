/**
 * Tell Bing, Copilot, ChatGPT search and other IndexNow engines about changed pages within minutes
 * (decision P61; the static site does this once per deploy with scripts/indexnow.mjs).
 *
 * server/src/sitemap-state.js hands over every address whose facts changed (new fingerprint). They are
 * collected for a few minutes and sent together. Only when search engines are allowed in (ALLOW_INDEXING=true,
 * from switch day) and INDEXNOW_KEY is set; the key file /<key>.txt is part of the site build.
 */
const BATCH_MS = Number(process.env.INDEXNOW_BATCH_SECONDS || 300) * 1000;
const ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';

const queue = new Set();
/** Addresses already sent once without success: tried one more time, then dropped. */
const retried = new Set();
let timer = null;
const status = { queued: 0, sent: 0, lastSentAt: null, lastStatus: null };

export const indexNowStatus = () => ({ enabled: enabled(), ...status, queued: queue.size });

const key = (env = process.env) => String(env.INDEXNOW_KEY || '').trim();
export const enabled = (env = process.env) => env.ALLOW_INDEXING === 'true' && /^[a-zA-Z0-9-]{8,128}$/.test(key(env));
const site = () => new URL(process.env.SITE_URL || 'https://longisland.dance');

/** Queue addresses (full URLs on the site's own host); they go out together a few minutes later. */
export function announce(urls) {
  if (!enabled()) return 0;
  const host = site().host;
  let added = 0;
  for (const u of urls) {
    try {
      if (new URL(u).host === host && !queue.has(u)) {
        queue.add(u);
        added++;
      }
    } catch {
      /* not an address */
    }
  }
  if (queue.size && !timer) timer = setTimeout(flush, BATCH_MS).unref();
  return added;
}

function again(urls) {
  const once = urls.filter((u) => !retried.has(u));
  for (const u of once) retried.add(u);
  announce(once);
}

/** Send what is queued now (also used by tests). Failed batches are tried once more in the next round. */
export async function flush({ fetchImpl = fetch } = {}) {
  timer = null;
  if (!queue.size || !enabled()) return null;
  const urlList = [...queue].slice(0, 10_000);
  for (const u of urlList) queue.delete(u);
  const k = key();
  const body = { host: site().host, key: k, keyLocation: new URL(`/${k}.txt`, site()).toString(), urlList };
  try {
    const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    Object.assign(status, { lastSentAt: new Date().toISOString(), lastStatus: res.status });
    // 200 received, 202 received (key being checked); 403 key not found yet, 429 too many: try again later.
    if (res.status === 403 || res.status === 429 || res.status >= 500) again(urlList);
    else {
      status.sent += urlList.length;
      for (const u of urlList) retried.delete(u);
    }
    console.log(`[indexnow] sent ${urlList.length} changed addresses: HTTP ${res.status}`);
    return res.status;
  } catch (err) {
    console.warn(`[indexnow] could not reach IndexNow: ${err.message}`);
    again(urlList);
    return null;
  } finally {
    if (queue.size && !timer) timer = setTimeout(flush, BATCH_MS).unref();
  }
}
