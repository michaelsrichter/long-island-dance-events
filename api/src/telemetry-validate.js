'use strict';
/** Pure validation for /api/telemetry payloads (unit tested in api/test). */

const EVENT_NAMES = new Set([
  'page_view',
  'view_event',
  'select_event',
  'add_to_calendar',
  'share',
  'share_open',
  'copy_failed',
  'get_directions',
  'outbound_click',
  'click_hotline',
  'click_email',
  'newsletter_click',
  'filter_events',
  'view_calendar_month',
  'show_more',
  'theme_change',
  'faq_open',
  'empty_state',
  'consent_update',
  'web_vital',
]);
const PROP_KEYS = new Set([
  'method',
  'location',
  'page_type',
  'event_slug',
  'event_status',
  'days_until',
  'filter',
  'value',
  'results',
  'question',
  'metric',
  'rating',
  'nav',
  'mode',
  'target',
]);
const VITALS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
const SAFE = /^[\w\-.,:/ #()&']{0,100}$/;

const MAX_BYTES = 8 * 1024;
const MAX_ITEMS = 25;

function cleanProps(props) {
  const out = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  for (const [k, v] of Object.entries(props)) {
    if (!PROP_KEYS.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && SAFE.test(v)) out[k] = v;
  }
  return out;
}

/**
 * Returns { ok: true, batch } or { ok: false, reason }.
 * batch = { page, pageType, release, items: [{ name, props, value? }] }
 */
function validate(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'empty' };
  if (Buffer.byteLength(raw) > MAX_BYTES) return { ok: false, reason: 'too_large' };
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  if (!body || body.v !== 1 || !Array.isArray(body.items)) return { ok: false, reason: 'bad_shape' };
  if (body.items.length === 0 || body.items.length > MAX_ITEMS) return { ok: false, reason: 'bad_count' };
  const page =
    typeof body.page === 'string' && body.page.startsWith('/') && body.page.length <= 200 && SAFE.test(body.page.slice(0, 100)) ? body.page : '/';
  const pageType = typeof body.pageType === 'string' && /^[a-z0-9_-]{1,30}$/.test(body.pageType) ? body.pageType : 'unknown';
  const release = typeof body.release === 'string' && /^[\w.-]{1,40}$/.test(body.release) ? body.release : 'unknown';
  const items = [];
  for (const it of body.items) {
    if (!it || typeof it.name !== 'string' || !EVENT_NAMES.has(it.name)) continue;
    const item = { name: it.name, props: cleanProps(it.props) };
    if (it.name === 'web_vital') {
      if (!VITALS.has(item.props.metric) || typeof it.value !== 'number' || !Number.isFinite(it.value) || it.value < 0 || it.value > 600000) continue;
      item.value = it.value;
    }
    items.push(item);
  }
  if (items.length === 0) return { ok: false, reason: 'no_valid_items' };
  return { ok: true, batch: { page, pageType, release, items } };
}

/** Simple fixed-window rate limiter keyed by an opaque client key. Best effort, per instance. */
function createRateLimiter({ limit = 120, windowMs = 60000, maxKeys = 5000 } = {}) {
  const buckets = new Map();
  return function allow(key, cost = 1, now = Date.now()) {
    let b = buckets.get(key);
    if (!b || now - b.start >= windowMs) {
      if (buckets.size >= maxKeys) buckets.clear();
      b = { start: now, count: 0 };
      buckets.set(key, b);
    }
    b.count += cost;
    return b.count <= limit;
  };
}

module.exports = { validate, createRateLimiter, EVENT_NAMES, PROP_KEYS, MAX_BYTES, MAX_ITEMS };
