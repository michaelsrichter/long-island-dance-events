'use strict';
/**
 * Which pages exist. The site build writes /community-pages.json (page keys for every event series,
 * venue, organizer, teacher, band/DJ and dance style). Likes and comments are only accepted for those.
 * If the list cannot be fetched, keys that match the pattern are accepted (rate limits still apply).
 */
const { publicHost, isAllowedHost } = require('../hosts');
const { isPageKey } = require('./http');

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, keys: null };

async function loadKeys(request, fetchImpl = fetch) {
  if (cache.keys && Date.now() - cache.at < TTL_MS) return cache.keys;
  const host = publicHost(request);
  if (!isAllowedHost(host)) return null;
  const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
  try {
    const res = await fetchImpl(`${proto}://${host}/community-pages.json`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.keys)) return null;
    cache = { at: Date.now(), keys: new Set(data.keys) };
    return cache.keys;
  } catch {
    return null;
  }
}

async function pageExists(request, key, fetchImpl) {
  if (!isPageKey(key)) return false;
  const keys = await loadKeys(request, fetchImpl);
  return keys ? keys.has(key) : true;
}

function resetCache() {
  cache = { at: 0, keys: null };
}

module.exports = { pageExists, resetCache };
