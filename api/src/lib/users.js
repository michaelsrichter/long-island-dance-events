'use strict';
/** Visitor profiles (Users table) and the "may this person post?" check. */
const { table, TABLES } = require('./store');
const { readPrincipal } = require('./principal');
const { error } = require('./http');

const PROFILE = 'profile';

const getUser = (userId) => table(TABLES.users).get(userId, PROFILE);

function isBanned(user, now = Date.now()) {
  if (!user || user.status !== 'banned') return false;
  return !(user.bannedUntil && Date.parse(user.bannedUntil) <= now);
}

/**
 * Whole years since a birth month/year, rounded down and assuming the birthday is at the end
 * of the birth month (so we never over-count). Only the result is kept, never the birth date.
 */
function ageFrom(birthYear, birthMonth, now = new Date()) {
  const y = Number(birthYear);
  const m = Number(birthMonth);
  const nowY = now.getUTCFullYear();
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < nowY - 120 || y > nowY) return null;
  const nowM = now.getUTCMonth() + 1;
  return nowY - y - (nowM <= m ? 1 : 0);
}

function publicProfile(user, principal) {
  const needsProfile = !user || !user.age13 || !user.displayName || !user.rulesAcceptedAt;
  return {
    displayName: (user && user.displayName) || '',
    status: (user && (isBanned(user) ? 'banned' : user.status === 'banned' ? 'active' : user.status)) || 'active',
    needsProfile: user && user.status === 'under13' ? false : needsProfile,
    canPostPhotos: Boolean(user && user.age18 && user.photoTermsAt),
    adult: Boolean(user && user.age18),
    ageConfirmed: Boolean(user && user.age13),
    rulesAccepted: Boolean(user && user.rulesAcceptedAt),
    isAdmin: Boolean(principal && principal.roles.includes('admin')),
    since: (user && user.createdAt) || '',
  };
}

/** For writes: signed in, profile finished, not banned (and 18+ when needAdult). */
async function requireMember(request, { needAdult = false } = {}) {
  const principal = readPrincipal(request);
  if (!principal) return { response: error(401, 'sign_in', 'Please sign in first.') };
  let user = await getUser(principal.userId);
  if (!user) {
    user = { partitionKey: principal.userId, rowKey: PROFILE, status: 'active', displayName: '', createdAt: new Date().toISOString() };
    await table(TABLES.users).upsert(user);
  }
  if (user.status === 'banned' && !isBanned(user)) {
    user = { ...user, status: 'active', bannedUntil: '', banReason: '' };
    await table(TABLES.users).merge({ partitionKey: user.partitionKey, rowKey: PROFILE, status: 'active', bannedUntil: '', banReason: '' });
  }
  if (user.status === 'under13') return { response: error(403, 'age', 'Sorry, you must be 13 or older to take part.') };
  if (isBanned(user)) return { response: error(403, 'banned', 'Your account cannot post right now. Questions? See the community rules page.') };
  if (!user.age13 || !user.displayName || !user.rulesAcceptedAt) return { response: error(428, 'profile_required', 'Please finish your profile first.') };
  if (needAdult && !user.age18) return { response: error(403, 'adult_only', 'You must be 18 or older to post photos.') };
  return { principal, user };
}

function requireAdmin(request) {
  const principal = readPrincipal(request);
  if (!principal || !principal.roles.includes('admin')) return { response: error(403, 'not_admin', 'Moderators only.') };
  return { principal };
}

module.exports = { getUser, isBanned, ageFrom, publicProfile, requireMember, requireAdmin, PROFILE };
