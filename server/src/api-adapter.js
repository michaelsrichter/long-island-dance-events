/**
 * The community /api code (api/src/functions/*.js, written for Azure Functions on Static Web Apps) running
 * inside the live server, unchanged (decision P60).
 *
 * - '@azure/functions' is replaced by a stand-in that only writes down each app.http(...) route
 *   (functions-shim.cjs), so loading the files gives the route table.
 * - Each request gets the signed-in person in Static Web Apps' own format (identity.js), so the code that
 *   checks members and moderators works as before. Headers a browser could send to pretend are removed.
 * - Answers ({ status, headers, body | jsonBody }) become standard Responses.
 *
 * Where the /api code is: server/api/ in the deployed package (the deploy workflow copies it there), or
 * api/ next to server/ in the repository. Without it, the community addresses answer 404.
 */
import { readdirSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createIdentity, principalHeader, tableLinks } from './identity.js';
import { apiDir } from './lib/api-dir.js';

const SHIM = pathToFileURL(fileURLToPath(new URL('./functions-shim.cjs', import.meta.url))).href;

export { apiDir };

/** Addresses the live server answers itself, or that only made sense on Static Web Apps. */
const NOT_HERE = new Set(['roles']);

let hooked = false;
let loaded;

/** Load the /api files once: { routes: Map('GET me' -> route), rolesFor, claim, store } or null. */
export function loadApi() {
  if (loaded !== undefined) return loaded;
  const dir = apiDir();
  if (!dir) {
    loaded = null;
    return loaded;
  }
  if (!hooked) {
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier === '@azure/functions') return { url: SHIM, format: 'commonjs', shortCircuit: true };
        return next(specifier, context);
      },
    });
    hooked = true;
  }
  try {
    const require = createRequire(join(dir, 'package.json'));
    const fnDir = join(dir, 'src', 'functions');
    for (const f of readdirSync(fnDir).filter((n) => n.endsWith('.js')).sort()) require(join(fnDir, f));
    const routes = new Map();
    for (const r of globalThis.__liApiRoutes ?? []) {
      if (NOT_HERE.has(r.route)) continue;
      for (const m of r.methods ?? ['GET']) routes.set(`${m.toUpperCase()} ${r.route}`, r);
    }
    loaded = {
      routes,
      rolesFor: require(join(fnDir, 'roles.js')).rolesFor,
      claim: require(join(dir, 'src', 'lib', 'principal.js')).claim,
      store: require(join(dir, 'src', 'lib', 'store.js')),
      tables: () => require('@azure/data-tables'),
    };
    console.log(`[api] ${routes.size} community addresses from ${dir}`);
  } catch (err) {
    // The pages never depend on this: without it, sign-in shows "signed out" and community addresses answer 404.
    console.error(`[api] could not load the community code from ${dir}: ${err.message}`);
    loaded = null;
  }
  return loaded;
}

let identity;
/** The identity resolver; tests can pass their own links table. */
export function getIdentity({ links } = {}) {
  if (identity && !links) return identity;
  const api = loadApi();
  if (!api) return null;
  const linkStore =
    links ??
    (process.env.COMMUNITY_STORAGE
      ? tableLinks({ TableClient: api.tables().TableClient, connectionString: process.env.COMMUNITY_STORAGE })
      : { get: async () => null, findUser: async () => null, create: async () => true });
  identity = createIdentity({ claim: api.claim, rolesFor: api.rolesFor, links: linkStore });
  return identity;
}

/** The signed-in person (Static Web Apps format) or null. Never throws: sign-in trouble means "signed out". */
export async function principalOf(request) {
  const id = getIdentity();
  if (!id) return null;
  try {
    return await id.principal(request);
  } catch (err) {
    console.warn(`[api] could not work out who is signed in: ${err.message}`);
    return null;
  }
}

/** The route for "/api/<path>", or { known: true } when only the method is wrong, or null. */
export function findRoute(method, path) {
  const api = loadApi();
  if (!api) return null;
  const m = method === 'HEAD' ? 'GET' : method;
  const hit = api.routes.get(`${m} ${path}`);
  if (hit) return hit;
  for (const key of api.routes.keys()) if (key.endsWith(` ${path}`)) return { known: true };
  return null;
}

function toResponse(result) {
  if (result instanceof Response) return result;
  const r = result ?? {};
  const headers = new Headers(r.headers ?? {});
  let body = r.body ?? null;
  if (r.jsonBody !== undefined) {
    body = JSON.stringify(r.jsonBody);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  }
  for (const c of r.cookies ?? []) {
    const parts = [`${c.name}=${c.value}`, c.path && `Path=${c.path}`, c.maxAge !== undefined && `Max-Age=${c.maxAge}`, c.secure && 'Secure', c.httpOnly && 'HttpOnly', c.sameSite && `SameSite=${c.sameSite}`];
    headers.append('set-cookie', parts.filter(Boolean).join('; '));
  }
  const status = r.status ?? 200;
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

/** Run one /api handler for the request, as Azure Functions would. */
export async function callApi(route, request, principal) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  // Only the server says who is signed in and which address was asked for.
  for (const h of [...headers.keys()]) if (h.startsWith('x-ms-client-principal') || h.startsWith('x-ms-token-')) headers.delete(h);
  headers.set('x-ms-original-url', url.toString());
  if (principal) headers.set('x-ms-client-principal', principalHeader(principal));
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const req = new Request(url, { method: request.method, headers, body: hasBody ? request.body : undefined, duplex: hasBody ? 'half' : undefined });
  const tag = `[api ${route.name}]`;
  const context = {
    invocationId: randomUUID(),
    functionName: route.name,
    log: (...a) => console.log(tag, ...a),
    info: (...a) => console.log(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),
    error: (...a) => console.error(tag, ...a),
    debug: () => {},
    trace: () => {},
  };
  return toResponse(await route.handler(req, context));
}
