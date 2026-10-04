'use strict';
/** Small HTTP helpers shared by the community Functions. */
const { publicHost, isAllowedHost } = require('../hosts');

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(status, body, headers = {}) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...headers }, body: JSON.stringify(body) };
}

function error(status, code, message) {
  return json(status, { error: code, message });
}

/** Writes must come from our own pages. Browsers send Origin on every POST, so a missing Origin is refused. */
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const o = new URL(origin).host.toLowerCase();
    return o === publicHost(request) || isAllowedHost(o);
  } catch {
    return false;
  }
}

/** Read a JSON body with a size cap. Returns { ok, body } or { ok: false, response }. */
async function readJson(request, maxBytes = 8192) {
  const len = Number(request.headers.get('content-length') || '0');
  if (len > maxBytes) return { ok: false, response: error(413, 'too_large', 'That is too long.') };
  const type = request.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(type)) return { ok: false, response: error(415, 'bad_type', 'Expected JSON.') };
  const raw = await request.text();
  if (Buffer.byteLength(raw) > maxBytes) return { ok: false, response: error(413, 'too_large', 'That is too long.') };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
    return { ok: true, body };
  } catch {
    return { ok: false, response: error(400, 'bad_json', 'Could not read the request.') };
  }
}

/** Collapse spaces, strip control and direction-override characters, trim, cap the length. */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const s = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

const PAGE_KEY = /^(event|venue|organizer|instructor|performer|style):[a-z0-9][a-z0-9-]{0,99}$/;
function isPageKey(value) {
  return typeof value === 'string' && PAGE_KEY.test(value);
}
function splitKey(key) {
  const i = key.indexOf(':');
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}

module.exports = { json, error, sameOrigin, readJson, cleanText, isPageKey, splitKey, NO_STORE };
