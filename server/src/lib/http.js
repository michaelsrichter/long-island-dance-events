/** Small helpers for HTTP answers: JSON (gzip when the caller accepts it) and gzip request bodies. */
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const MAX_BODY = 64 * 1024 * 1024;

export function json(request, status, body) {
  const text = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (text.length > 2048 && /\bgzip\b/.test(request?.headers?.get('accept-encoding') || '')) {
    return { status, headers: { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }, body: gzipSync(text) };
  }
  return { status, headers, body: text };
}

/** The request body as parsed JSON; accepts gzip (Content-Encoding: gzip). */
export async function readJson(request) {
  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length > MAX_BODY) throw new Error('Request body is too large.');
  const gz = /\bgzip\b/.test(request.headers.get('content-encoding') || '') || (buf[0] === 0x1f && buf[1] === 0x8b);
  const text = (gz ? gunzipSync(buf, { maxOutputLength: MAX_BODY * 4 }) : buf).toString('utf8');
  return JSON.parse(text);
}

let version;
/** The deployed commit (server/version.json, written by the deploy workflow). */
export function appVersion() {
  if (version !== undefined) return version;
  try {
    version = JSON.parse(readFileSync(new URL('../../version.json', import.meta.url), 'utf8'));
  } catch {
    version = { commit: 'local', deployedAt: null };
  }
  return version;
}
