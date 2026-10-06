/**
 * Who is signed in, on the live server (decision P60).
 *
 * App Service's built-in sign-in (Microsoft Entra External ID, provider "extid") puts the person's claims in
 * the X-MS-CLIENT-PRINCIPAL header. Browsers can't set that header while built-in sign-in is on, so it is
 * trusted only then (App Service sets WEBSITE_AUTH_ENABLED).
 *
 * The community /api code files likes, notes and photos under the user id Static Web Apps gave each person.
 * /api/roles has always saved the person's Microsoft account id next to it (Users table, idpUserId), so:
 *   1. look the account id up in the IdpLinks table (account id -> user id),
 *   2. otherwise find the Users row with that idpUserId (once; then a link is saved),
 *   3. otherwise (someone new) make a new user id.
 * Roles come from the same function Static Web Apps called after each sign-in (rolesFor in roles.js):
 * "member" unless banned or under 13, "admin" for the emails in ADMIN_EMAILS. They are remembered for a minute.
 */
import { randomBytes } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** Built-in sign-in is on (only then is X-MS-CLIENT-PRINCIPAL from App Service). */
export const builtInSignIn = (env = process.env) => /^true$/i.test(String(env.WEBSITE_AUTH_ENABLED || ''));

/** The claims App Service gives the app, or null when nobody is signed in. */
export function signedInClaims(request, env = process.env) {
  if (!builtInSignIn(env)) return null;
  const raw = request.headers.get('x-ms-client-principal');
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!p || !Array.isArray(p.claims)) return null;
    const claims = p.claims.filter((c) => c && typeof c.typ === 'string' && typeof c.val === 'string');
    const idp = String(request.headers.get('x-ms-client-principal-idp') || p.auth_typ || 'extid');
    return claims.length ? { claims, idp } : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {(claims: object[], kind: string) => string} deps.claim  claim lookup (api/src/lib/principal.js)
 * @param {(payload: object) => Promise<string[]>} deps.rolesFor  roles.js: also creates or refreshes the profile
 * @param {object} deps.links  { get(accountId), findUser(accountIds), create(accountId, userId) }
 */
export function createIdentity({ claim, rolesFor, links, ttlMs = 60_000, now = () => Date.now() }) {
  const remembered = new Map();
  const inFlight = new Map();

  async function userIdFor(accountIds) {
    for (const id of accountIds) {
      const linked = await links.get(id);
      if (linked && ID_RE.test(linked)) return linked;
    }
    const found = await links.findUser(accountIds);
    const userId = found && ID_RE.test(found) ? found : randomBytes(16).toString('hex');
    // Someone else may have just linked the same account: then theirs wins.
    if (!(await links.create(accountIds[0], userId))) return (await links.get(accountIds[0])) || userId;
    return userId;
  }

  async function lookUp(claims, idp) {
    const oid = claim(claims, 'oid');
    const sub = (claims.find((c) => c.typ === 'sub' || c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier') || {}).val || '';
    // Static Web Apps kept the first of oid / sub it found; check both.
    const accountIds = [...new Set([oid, sub].filter(Boolean))];
    if (!accountIds.length) return null;
    const userId = await userIdFor(accountIds);
    const roles = await rolesFor({ userId, claims, identityProvider: idp });
    const name = claim(claims, 'name');
    return { key: accountIds[0], userId, roles, name, at: now() };
  }

  /** The signed-in person as the /api code expects it (Static Web Apps' principal), or null. */
  async function principal(request) {
    const signed = signedInClaims(request);
    if (!signed) return null;
    const key = claim(signed.claims, 'oid') || claim(signed.claims, 'email');
    const hit = key && remembered.get(key);
    let person = hit && now() - hit.at < ttlMs ? hit : null;
    if (!person) {
      if (!inFlight.has(key)) {
        inFlight.set(
          key,
          lookUp(signed.claims, signed.idp).finally(() => inFlight.delete(key)),
        );
      }
      person = await inFlight.get(key);
      if (!person) return null;
      if (key) remembered.set(key, person);
    }
    return {
      identityProvider: signed.idp,
      userId: person.userId,
      userDetails: person.name,
      userRoles: ['anonymous', 'authenticated', ...person.roles],
      claims: signed.claims,
    };
  }

  return { principal, forget: () => remembered.clear() };
}

/** Static Web Apps' x-ms-client-principal header value for a principal. */
export const principalHeader = (p) => Buffer.from(JSON.stringify(p)).toString('base64');

/** Account id -> user id links in Azure Table Storage (COMMUNITY_STORAGE), plus the Users table search. */
export function tableLinks({ TableClient, connectionString, linksTable = 'IdpLinks', usersTable = 'Users' }) {
  const links = TableClient.fromConnectionString(connectionString, linksTable);
  const users = TableClient.fromConnectionString(connectionString, usersTable);
  let created;
  const ensureTable = () => (created ??= links.createTable().catch((e) => (e && e.statusCode === 409 ? undefined : Promise.reject(e))));
  const esc = (s) => String(s).replace(/'/g, "''");
  return {
    async get(accountId) {
      await ensureTable();
      try {
        return (await links.getEntity('extid', accountId)).userId;
      } catch (e) {
        if (e && e.statusCode === 404) return null;
        throw e;
      }
    },
    async findUser(accountIds) {
      const filter = `RowKey eq 'profile' and (${accountIds.map((id) => `idpUserId eq '${esc(id)}'`).join(' or ')})`;
      const found = [];
      for await (const e of users.listEntities({ queryOptions: { filter } })) found.push(e);
      // More than one (should not happen): the oldest account keeps its likes and notes.
      found.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      return found[0]?.partitionKey || null;
    },
    async create(accountId, userId) {
      await ensureTable();
      try {
        await links.createEntity({ partitionKey: 'extid', rowKey: accountId, userId, createdAt: new Date().toISOString() });
        return true;
      } catch (e) {
        if (e && e.statusCode === 409) return false;
        throw e;
      }
    },
  };
}
