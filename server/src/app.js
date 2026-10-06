/** Which code answers which address (decision P58). Everything that is not /api/ is the website. */
import { health, live } from './routes/health.js';
import { syncDrill, syncExport, syncImport } from './routes/sync.js';
import { site } from './site.js';
import { json } from './lib/http.js';

const API = new Map([
  ['GET /api/live', live],
  ['GET /api/health', health],
  ['POST /api/sync/import', syncImport],
  ['GET /api/sync/export', syncExport],
  ['POST /api/sync/drill', syncDrill],
]);

export async function route(request, options = {}) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const handler = API.get(`${method} ${url.pathname.replace(/\/+$/, '')}`);
    if (handler) return handler(request);
    const known = [...API.keys()].some((k) => k.endsWith(` ${url.pathname.replace(/\/+$/, '')}`));
    return json(request, known ? 405 : 404, { ok: false, error: known ? 'Method not allowed.' : 'Not found.' });
  }
  return site(request, options);
}
