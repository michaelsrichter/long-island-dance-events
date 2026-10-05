'use strict';
/**
 * The site's content files (src/content/**.json), read and written the way the weekly run does
 * (ingest/lib/store.ts: same key order, empty values dropped), plus the owner's review decisions.
 * tests/unit/review-content.test.ts checks this file against the TypeScript original.
 */

const EVENT_ORDER = [
  'title', 'summary', 'category', 'danceStyles', 'start', 'end', 'timezone', 'recurrence', 'cadence', 'lessonTime',
  'venueId', 'town', 'organizerId', 'performerIds', 'instructorIds', 'price', 'priceMax', 'isFree', 'priceNotes',
  'skillLevel', 'ageGroup', 'ticketUrl', 'infoUrl', 'contactPhone', 'contactEmail', 'status', 'cancelledNote',
  'sourceId', 'sourceUrl', 'sourceName', 'sourceRef', 'firstSeen', 'lastSeen', 'dancingCues', 'dancing', 'confidence', 'matchKey', 'mergedFrom',
  'lockedFields', 'reviewNotes', 'seoTitle', 'seoDescription',
];
const ENTITY_ORDER = ['name', 'type', 'aliases'];

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Drop empty values and order keys: known keys first in `order`, the rest alphabetically. */
function tidy(obj, order = []) {
  const out = {};
  const keys = [...order.filter((k) => k in obj), ...Object.keys(obj).filter((k) => !order.includes(k)).sort()];
  for (const k of keys) {
    let v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      v = tidy(v, ['rrule', 'rdates', 'exdates']);
      if (Object.keys(v).length === 0) continue;
    }
    if (!isEmpty(v)) out[k] = v;
  }
  return out;
}

function serialize(obj, order = []) {
  return `${JSON.stringify(tidy(obj, order), null, 2)}\n`;
}

const orderFor = (collection) => (collection === 'events' ? EVENT_ORDER : ENTITY_ORDER);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isId = (v) => typeof v === 'string' && v.length <= 120 && ID.test(v);
const pathOf = (collection, id) => `src/content/${collection}/${id}.json`;

const STATUSES = ['active', 'past', 'cancelled', 'pending-review', 'hidden'];
const LOCAL = /^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class DecisionError extends Error {}

function addLocks(e, fields) {
  e.lockedFields = [...new Set([...(e.lockedFields || []), ...fields])];
}
function appendNote(e, note) {
  e.reviewNotes = [e.reviewNotes, note].filter(Boolean).join(' ');
}

/**
 * One owner decision on a listing that waits for review. Returns the new event data and a short
 * description for the commit message. Every changed field is locked, so the weekly run never undoes it
 * (decision P9). Nothing is deleted: "hide" sets the status "hidden" (decision P51).
 *   publish  status active
 *   fix      new start time, venue, band or DJ, or town; then publish
 *   cancel   status cancelled (shown as cancelled), with a short note
 *   hide     status hidden (never shown)
 */
function decideListing(event, decision, { today, venueIds, performerIds }) {
  const e = JSON.parse(JSON.stringify(event));
  const note = typeof decision.note === 'string' ? decision.note.trim().slice(0, 200) : '';
  const when = `in the review center on ${today}`;
  const changed = [];
  if (decision.action === 'fix') {
    const f = decision.fields || {};
    if (f.time !== undefined && f.time !== '') {
      if (!TIME.test(f.time)) throw new DecisionError('Use a time like 19:30.');
      const oldTime = String(e.start).length > 10 ? String(e.start).slice(11, 16) : '';
      e.start = `${String(e.start).slice(0, 10)}T${f.time}`;
      changed.push('start');
      // An end time that no longer fits (8:00-17:00 moved to start at 20:00) is dropped; the site then shows about 3 hours.
      const end = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(e.end || ''));
      if (end && end[1] === e.start.slice(0, 10) && end[2] <= f.time && (!oldTime || end[2] > oldTime)) {
        delete e.end;
        changed.push('end');
      }
    }
    if (f.venueId) {
      if (!isId(f.venueId) || !venueIds.has(f.venueId)) throw new DecisionError('Pick a venue from the list.');
      e.venueId = f.venueId;
      changed.push('venueId');
    }
    if (f.performerId) {
      if (!isId(f.performerId) || !performerIds.has(f.performerId)) throw new DecisionError('Pick a band or DJ from the list.');
      e.performerIds = [f.performerId];
      changed.push('performerIds');
    }
    if (f.town) {
      const town = String(f.town).trim().slice(0, 60);
      if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(town)) throw new DecisionError('Type the town name, for example Huntington.');
      e.town = town;
      changed.push('town');
    }
    if (!changed.length) throw new DecisionError('Change at least one thing, or press Publish instead.');
  }
  let summary;
  if (decision.action === 'publish' || decision.action === 'fix') {
    e.status = 'active';
    addLocks(e, ['status', ...changed]);
    appendNote(e, `Published ${when}${changed.length ? ` after fixing ${changed.join(', ')}` : ''}${note ? `: ${note}` : '.'}`);
    summary = changed.length ? `fix ${changed.join(', ')} and publish` : 'publish';
  } else if (decision.action === 'cancel') {
    e.status = 'cancelled';
    e.cancelledNote = (note || 'Cancelled.').slice(0, 200);
    addLocks(e, ['status']);
    appendNote(e, `Marked cancelled ${when}.`);
    summary = 'mark cancelled';
  } else if (decision.action === 'hide') {
    e.status = 'hidden';
    addLocks(e, ['status']);
    appendNote(e, `Hidden ${when}${note ? `: ${note}` : '.'}`);
    summary = 'hide';
  } else {
    throw new DecisionError('Unknown action.');
  }
  checkEvent(e);
  return { event: e, summary };
}

/** The checks from src/lib/schemas.ts that a review decision could break. CI checks everything else. */
function checkEvent(e) {
  if (!STATUSES.includes(e.status)) throw new DecisionError('Unknown status.');
  if (!LOCAL.test(String(e.start || ''))) throw new DecisionError('The start date or time is not valid.');
  if (e.end && String(e.end).slice(0, 10) < String(e.start).slice(0, 10)) throw new DecisionError('The end is before the start.');
  if (!e.venueId && !e.town) throw new DecisionError('Pick a venue, or at least type the town.');
}

const PERMISSION = ['needed', 'requested', 'granted', 'denied'];

/**
 * One owner decision on a source.
 *   enable / disable        switch collecting on or off
 *   permission              record "asked", "said yes" or "said no" (with the date)
 */
function decideSource(source, decision, { today }) {
  const s = JSON.parse(JSON.stringify(source));
  const note = typeof decision.note === 'string' ? decision.note.trim().slice(0, 200) : '';
  const when = `in the review center on ${today}`;
  let summary;
  if (decision.action === 'enable') {
    if (s.enabled !== false) throw new DecisionError('This source is already switched on.');
    s.enabled = true;
    appendNote(s, `Switched on ${when}${note ? `: ${note}` : '.'}`);
    summary = 'switch on';
  } else if (decision.action === 'disable') {
    if (s.enabled === false) throw new DecisionError('This source is already switched off.');
    s.enabled = false;
    appendNote(s, `Switched off ${when}${note ? `: ${note}` : '.'}`);
    summary = 'switch off';
  } else if (decision.action === 'permission') {
    if (!PERMISSION.includes(decision.status)) throw new DecisionError('Unknown permission answer.');
    const p = { ...(s.permission || {}), status: decision.status };
    if (decision.status === 'requested') p.requestedAt = today;
    if (decision.status === 'granted' || decision.status === 'denied') p.decidedAt = today;
    if (note) p.note = `${note} (${today})`.slice(0, 300);
    if (decision.feedUrl) {
      try {
        const u = new URL(decision.feedUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
        p.feedUrl = u.toString();
      } catch {
        throw new DecisionError('The feed address is not a web address.');
      }
    }
    s.permission = p;
    summary = { requested: 'asked for permission', granted: 'permission granted', denied: 'permission refused', needed: 'permission needed' }[decision.status];
  } else {
    throw new DecisionError('Unknown action.');
  }
  return { source: s, summary };
}

module.exports = { EVENT_ORDER, ENTITY_ORDER, tidy, serialize, orderFor, isId, pathOf, decideListing, decideSource, checkEvent, DecisionError };
