/**
 * Which code answers which address (decisions P58 and P60). Everything that is not /api/ is the website.
 *   /api/live, /api/health, /api/sync/*  the server's own (routes/)
 *   /api/session                         who is signed in, for the pages' scripts
 *   other /api/*                         the community code from api/ (api-adapter.js), with the same
 *                                        "moderators only" rules as staticwebapp.config.json
 */
import { health, live } from './routes/health.js';
import { syncDrill, syncExport, syncImport } from './routes/sync.js';
import { routeRule, site } from './site.js';
import { callApi, findRoute, principalOf } from './api-adapter.js';
import { json } from './lib/http.js';

const API = new Map([
  ['GET /api/live', live],
  ['GET /api/health', health],
  ['POST /api/sync/import', syncImport],
  ['GET /api/sync/export', syncExport],
  ['POST /api/sync/drill', syncDrill],
]);

/** GET /api/session: { signedIn, admin, name } (src/scripts/account-state.ts asks this on App Service). */
async function session(request) {
  const p = await principalOf(request);
  return json(request, 200, { signedIn: Boolean(p), admin: Boolean(p?.userRoles.includes('admin')), name: p?.userDetails ?? '' });
}

const allowed = (rule, roles) => !rule?.allowedRoles?.length || rule.allowedRoles.some((r) => roles.includes(r));

export async function route(request, options = {}) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const path = url.pathname.replace(/\/+$/, '');
    const handler = API.get(`${method} ${path}`);
    if (handler) return handler(request);
    if (path === '/api/session') return method === 'GET' ? session(request) : json(request, 405, { ok: false, error: 'Method not allowed.' });
    const community = findRoute(request.method, path.slice('/api/'.length));
    if (community && !community.known) {
      const principal = await principalOf(request);
      if (!allowed(routeRule(url.pathname), principal?.userRoles ?? ['anonymous'])) {
        return principal
          ? json(request, 403, { error: 'not_admin', message: 'This page is for the site owner and editors only.' })
          : json(request, 401, { error: 'sign_in', message: 'Please sign in first.' });
      }
      return callApi(community, request, principal);
    }
    const known = community?.known || [...API.keys()].some((k) => k.endsWith(` ${path}`));
    return json(request, known ? 405 : 404, { ok: false, error: known ? 'Method not allowed.' : 'Not found.' });
  }
  const rule = routeRule(url.pathname);
  const roles = rule?.allowedRoles?.length ? ((await principalOf(request))?.userRoles ?? ['anonymous']) : ['anonymous'];
  return site(request, { ...options, roles });
}