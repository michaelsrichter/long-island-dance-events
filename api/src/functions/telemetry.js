'use strict';
const telemetry = require('../telemetry-setup');
const { app } = require('@azure/functions');
const { createHash, randomBytes } = require('node:crypto');
const { validate, createRateLimiter } = require('../telemetry-validate');
const { publicHost, isAllowedHost } = require('../hosts');

const allow = createRateLimiter({ limit: 120, windowMs: 60000 });
const salt = randomBytes(16).toString('hex');
const { instruments, customEvent, flush } = telemetry;

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // some browsers omit Origin on same-origin sendBeacon requests
  try {
    const o = new URL(origin).host.toLowerCase();
    return o === publicHost(request) || isAllowedHost(o);
  } catch {
    return false;
  }
}

app.http('telemetry', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'telemetry',
  handler: async (request) => {
    const reject = async (status, reason) => {
      instruments.rejected.add(1, { reason });
      await flush(500);
      return { status, headers: { 'Cache-Control': 'no-store' } };
    };
    if (!sameOrigin(request)) return reject(403, 'origin');
    const len = Number(request.headers.get('content-length') || '0');
    if (len > 8192) return reject(413, 'too_large');
    // Hash the client address with a per-instance salt; the address itself is never stored or logged.
    const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const key = createHash('sha256').update(salt + ip).digest('base64url').slice(0, 16);
    const raw = await request.text();
    const result = validate(raw);
    if (!result.ok) return reject(400, result.reason);
    if (!allow(key, result.batch.items.length)) return reject(429, 'rate_limited');

    const { page, pageType, release, items } = result.batch;
    for (const it of items) {
      const base = { page_type: it.props.page_type || pageType, release };
      switch (it.name) {
        case 'page_view':
          instruments.pageViews.add(1, base);
          break;
        case 'view_event':
          instruments.eventViews.add(1, { ...base, event_status: it.props.event_status || 'unknown' });
          break;
        case 'web_vital':
          instruments.vitals[it.props.metric].record(it.value, { ...base, rating: it.props.rating || 'unknown' });
          continue; // Core Web Vitals are recorded as metrics only
        case 'consent_update':
          instruments.consent.add(1, { value: it.props.value || 'unknown', mode: it.props.mode || 'unknown' });
          break;
        default:
          instruments.interactions.add(1, { ...base, action: it.name, method: it.props.method || 'none', location: it.props.location || 'none' });
      }
      customEvent(it.name, { ...it.props, page, page_type: base.page_type, release });
    }
    await flush();
    return { status: 204, headers: { 'Cache-Control': 'no-store' } };
  },
});
