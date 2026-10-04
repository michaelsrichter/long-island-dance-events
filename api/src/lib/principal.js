'use strict';
/**
 * Signed-in user from Azure Static Web Apps.
 * SWA adds the x-ms-client-principal header (Base64 JSON) to /api requests after sign-in.
 * Managed Functions are reachable only through SWA, so the header cannot come from the browser.
 */
function readPrincipal(request) {
  const raw = request.headers.get('x-ms-client-principal');
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!p || typeof p.userId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(p.userId)) return null;
    const roles = Array.isArray(p.userRoles) ? p.userRoles.filter((r) => typeof r === 'string') : [];
    if (!roles.includes('authenticated')) return null;
    return { userId: p.userId, provider: String(p.identityProvider || ''), details: String(p.userDetails || ''), roles };
  } catch {
    return null;
  }
}

/** Claim lookup for the rolesSource payload (claim types can be short names or long URIs). */
const CLAIM_ALIASES = {
  email: ['email', 'emails', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'preferred_username'],
  name: ['name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
  oid: ['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier', 'sub', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'],
};
function claim(claims, kind) {
  if (!Array.isArray(claims)) return '';
  for (const typ of CLAIM_ALIASES[kind]) {
    const c = claims.find((x) => x && x.typ === typ && typeof x.val === 'string' && x.val.trim());
    if (c) return c.val.trim();
  }
  return '';
}

function adminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

module.exports = { readPrincipal, claim, adminEmails };
