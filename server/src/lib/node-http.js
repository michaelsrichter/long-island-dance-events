/** Node HTTP <-> standard Request/Response, with compression of text answers (brotli or gzip). */
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

/** App Service passes the visitor's address and the original scheme in X-Forwarded-* headers. */
export function toRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const url = new URL(req.url || '/', `${proto}://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k.startsWith(':')) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: hasBody ? 'half' : undefined });
}

export function clientAddress(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  // App Service adds the port ("203.0.113.5:51234"); IPv6 addresses come in brackets.
  const ip = fwd.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1');
  return ip || req.socket.remoteAddress || undefined;
}

const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript|manifest\+json|rss\+xml|ld\+json)|image\/svg\+xml)/;

function encodingFor(acceptEncoding) {
  const a = String(acceptEncoding || '');
  if (/\bbr\b/.test(a)) return 'br';
  if (/\bgzip\b/.test(a)) return 'gzip';
  return null;
}

/** Sends the body; a visitor who leaves before the end (closed tab, timeout) is normal, not an error. */
async function stream(res, ...steps) {
  try {
    await pipeline(...steps, res);
  } catch (err) {
    if (err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || res.destroyed) return;
    throw err;
  }
}

export async function sendResponse(req, res, response, { startedAt } = {}) {
  res.statusCode = response.status;
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const [k, v] of response.headers) if (k !== 'set-cookie') res.setHeader(k, v);
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (startedAt !== undefined) res.setHeader('Server-Timing', `app;dur=${(performance.now() - startedAt).toFixed(1)}`);
  if (req.method === 'HEAD' || !response.body || response.status === 204 || response.status === 304) {
    res.end();
    return;
  }
  const type = response.headers.get('content-type') || '';
  const enc = !response.headers.has('content-encoding') && COMPRESSIBLE.test(type) ? encodingFor(req.headers['accept-encoding']) : null;
  const body = Readable.fromWeb(response.body);
  if (!enc) {
    await stream(res, body);
    return;
  }
  res.removeHeader('content-length');
  res.setHeader('Content-Encoding', enc);
  const vary = res.getHeader('vary');
  res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  const z = enc === 'br' ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : createGzip({ level: 6 });
  await stream(res, body, z);
}
