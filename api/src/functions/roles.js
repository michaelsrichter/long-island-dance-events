'use strict';
/**
 * POST /api/roles — Static Web Apps "rolesSource". SWA calls it after every successful sign-in with the
 * user's claims and gives the person the roles we return. It cannot be called from the internet once
 * rolesSource is configured in staticwebapp.config.json.
 *
 *   member -> may like, comment and post (unless banned)
 *   admin  -> may moderate (emails listed in the ADMIN_EMAILS app setting)
 *
 * The email address is used only to decide "admin"; it is not stored.
 */
require('../telemetry-setup');
const { app } = require('@azure/functions');
const { claim, adminEmails } = require('../lib/principal');
const { table, TABLES } = require('../lib/store');
const { getUser, isBanned, PROFILE } = require('../lib/users');
const { cleanText } = require('../lib/http');

async function rolesFor(payload) {
  const userId = payload && typeof payload.userId === 'string' ? payload.userId : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(userId)) return [];
  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  const email = claim(claims, 'email').toLowerCase();
  // External ID no longer asks for a name at sign-up (the welcome step does), so the claim may be
  // missing or a placeholder like "unknown". Never suggest a placeholder or an email address.
  const rawName = cleanText(claim(claims, 'name'), 40);
  const name = /^unknown$/i.test(rawName) || rawName.includes('@') ? '' : rawName;
  const oid = claim(claims, 'oid');
  const now = new Date().toISOString();

  let user = await getUser(userId);
  if (!user) {
    user = { partitionKey: userId, rowKey: PROFILE, status: 'active', displayName: '', suggestedName: name, idpUserId: oid, createdAt: now, lastSeenAt: now };
    await table(TABLES.users).upsert(user);
  } else {
    await table(TABLES.users).merge({ partitionKey: userId, rowKey: PROFILE, lastSeenAt: now, idpUserId: oid || user.idpUserId || '', suggestedName: user.suggestedName || name });
  }
  const roles = [];
  if (user.status !== 'under13' && !isBanned(user)) roles.push('member');
  if (email && adminEmails().has(email)) roles.push('admin');
  return roles;
}

app.http('roles', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'roles',
  handler: async (request, context) => {
    try {
      const payload = await request.json();
      const roles = await rolesFor(payload);
      // No personal data in logs: only whether an email claim arrived and which roles were given.
      const claims = Array.isArray(payload && payload.claims) ? payload.claims : [];
      context.log(`roles: emailClaim=${Boolean(claim(claims, 'email'))} roles=${roles.join(',') || 'none'}`);
      return { status: 200, jsonBody: { roles } };
    } catch (err) {
      context.warn(`roles: ${err && err.message}`);
      // Fail closed: signed in, but no extra roles.
      return { status: 200, jsonBody: { roles: [] } };
    }
  },
});

module.exports = { rolesFor };
