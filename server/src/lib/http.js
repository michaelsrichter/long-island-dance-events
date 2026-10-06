/** Small helpers for HTTP answers (standard Request/Response): JSON, gzip request bodies, the deployed version. */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const MAX_BODY = 64 * 1024 * 1024;

export function json(_request, status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
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