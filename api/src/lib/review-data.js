'use strict';
/**
 * What the review center shows: held listings with their reasons in plain words, the rolling
 * "Collected events" pull request, sources grouped by what a person can do, and visitor messages.
 * Pure functions here (tested in api/test/review.test.js); GitHub calls are in functions/review.js.
 */

/* ---------- held listings ---------- */

/** Why a listing waits, from its reviewNotes (written by ingest/lib/merge.ts and the adapters). */
function reasonsOf(e) {
  const notes = String(e.reviewNotes || '');
  const out = [];
  const held = (e.lockedFields || []).includes('status');
  if (held) out.push({ code: 'held' });
  let m;
  if ((m = /own calendar now lists this \(([a-z0-9-]+)\)/i.exec(notes))) out.push({ code: 'copy', of: m[1] });
  if ((m = /Not found in the latest (\S+) run on (\d{4}-\d{2}-\d{2})/i.exec(notes))) out.push({ code: 'gone', source: m[1], on: m[2] });
  if ((m = /Start time looks wrong \(([^)]*)\)/i.exec(notes))) out.push({ code: 'odd-time', said: m[1], suggest: eveningTime(e.start) });
  if (/No start time found/i.test(notes)) out.push({ code: 'no-time' });
  if (/Venue not found in the listing/i.test(notes) || (!e.venueId && !held)) out.push({ code: 'no-venue' });
  if ((m = /Band or DJ not researched yet: (.+?)\.(?=\s*(?:$|No start time|Not found in the latest|The organizer's|Venue not found|Start time looks wrong|Published|Hidden|Marked|Held))/i.exec(notes))) out.push({ code: 'new-act', name: m[1].trim() });
  if (!out.length) out.push({ code: 'unsure' });
  return out;
}

/** "06:30" in the morning is almost always 6:30 PM: suggest the evening time. */
function eveningTime(start) {
  const t = /T(\d{2}):(\d{2})/.exec(String(start || ''));
  if (!t) return '';
  const h = Number(t[1]);
  return h >= 1 && h <= 11 ? `${String(h + 12).padStart(2, '0')}:${t[2]}` : '';
}

/** The best next step for the card's main button. */
function suggestion(reasons) {
  const codes = reasons.map((r) => r.code);
  if (codes.includes('copy')) return 'hide';
  if (codes.includes('odd-time')) return 'fix-time';
  if (codes.includes('no-venue')) return 'fix-venue';
  if (codes.includes('no-time')) return 'fix-time';
  if (codes.includes('gone')) return 'check';
  return 'publish';
}

/** Last date of a listing (one-time, UNTIL rule or extra dates). Open-ended repeats have none. */
function lastDateOf(e) {
  const start = String(e.start || '').slice(0, 10);
  const r = e.recurrence;
  if (!r) return String(e.end || e.start || '').slice(0, 10) || start;
  const until = r.rrule && /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(r.rrule);
  if (r.rrule && !until) return '';
  const dates = [start, ...(r.rdates || [])];
  if (until) dates.push(`${until[1]}-${until[2]}-${until[3]}`);
  return dates.sort().at(-1);
}

function listingCard(id, e, today, sourceNames = {}) {
  const reasons = reasonsOf(e);
  const last = lastDateOf(e);
  return {
    id,
    title: e.title,
    summary: e.summary,
    category: e.category,
    start: e.start,
    end: e.end || '',
    recurring: Boolean(e.recurrence),
    rule: (e.recurrence && e.recurrence.rrule) || '',
    cadence: e.cadence || '',
    venueId: e.venueId || '',
    town: e.town || '',
    organizerId: e.organizerId || '',
    performerIds: e.performerIds || [],
    sourceId: e.sourceId,
    sourceName: sourceNames[e.sourceId] || e.sourceName || e.sourceId,
    sourceUrl: e.sourceUrl,
    infoUrl: e.infoUrl || '',
    ticketUrl: e.ticketUrl || '',
    notes: e.reviewNotes || '',
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    confidence: e.confidence,
    reasons,
    suggest: suggestion(reasons),
    ended: Boolean(last && last < today),
  };
}

/* ---------- sources ---------- */

const BROKEN = new Set(['error', 'empty', 'invalid']);

/** What a person can do about a switched-off source. */
function sourceGroup(s) {
  if (s.enabled !== false) return BROKEN.has(s.lastStatus) ? 'broken' : 'on';
  const notes = `${s.reviewNotes || ''} ${(s.permission && s.permission.note) || ''}`;
  const perm = s.permission && s.permission.status;
  if (s.adapter === 'agentmail') return 'newsletter';
  if (perm === 'granted') return 'granted';
  if (perm === 'requested') return 'asked';
  if (perm === 'denied') return 'refused';
  if (perm === 'needed' || s.catalogStatus === 'needs-permission') return 'permission';
  if (s.catalogStatus === 'seasonal-recheck' || /check again in (april|spring)|once-a-year|recheck in (spring|season)|before summer/i.test(notes)) return 'seasonal';
  if (/venues? we have (not )?researched|unnamed place|venue files?|add a venue|none of its upcoming listings could be used/i.test(notes)) return 'venues';
  if (s.catalogStatus === 'manual-intake' || /flyer|social posts/i.test(notes)) return 'flyers';
  if (/written in words|timetable|undated|without dates|no dates|weekly schedule|weekly dances/i.test(notes)) return 'schedule';
  if (/ask (the|for|them|its)\b[^.]*(\.ics|ical|calendar link|feed|permission)/i.test(notes)) return 'permission';
  if (/needs a reader|adapter|cannot match|cannot pair|list reader|room name/i.test(notes)) return 'developer';
  if (s.catalogStatus === 'recheck-from-ci') return 'recheck';
  return 'other';
}

function sourceCard(id, s) {
  return {
    id,
    name: s.name,
    url: s.url,
    feedUrl: s.feedUrl || '',
    enabled: s.enabled !== false,
    cadence: s.cadence || 'weekly',
    adapter: s.adapter,
    focus: s.focus || 'dance',
    catalogStatus: s.catalogStatus || '',
    permission: s.permission || null,
    lastScraped: s.lastScraped || '',
    lastStatus: s.lastStatus || 'never',
    lastMessage: s.lastMessage || '',
    lastCounts: s.lastCounts || null,
    notes: s.reviewNotes || '',
    group: sourceGroup(s),
  };
}

/* ---------- the rolling "Collected events" pull request ---------- */

/** Facts from the run report in the pull request's description (ingest/run.ts reportMarkdown). */
function parseReport(body) {
  const text = String(body || '');
  const out = { latest: '', totals: '', sources: [], created: [], waiting: 0, notes: [] };
  const latest = /Latest run: \*\*([^*]+)\*\* on (\d{4}-\d{2}-\d{2})/.exec(text);
  if (latest) out.latest = `${latest[1]} on ${latest[2]}`;
  const totals = /Totals: ([^\n]+)/.exec(text);
  if (totals) out.totals = totals[1].trim();
  for (const line of text.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 10 && !/^-+:?$/.test(cells[2]) && cells[0] !== 'Source') {
      const n = (i) => Number(cells[i]) || 0;
      out.sources.push({ name: cells[0], result: cells[1].replace(/\*/g, ''), found: n(2), kept: n(3), new: n(4), updated: n(5), unchanged: n(6), ended: n(7), missing: n(8), review: n(9) });
    }
  }
  const created = /## New records added automatically \(please check\)\n+([\s\S]*?)(?:\n## |\nTotals:|$)/.exec(text);
  if (created) {
    for (const m of created[1].matchAll(/^- (\w+): (.+)$/gm)) {
      for (const id of m[2].matchAll(/`([a-z0-9-]+)`/g)) out.created.push({ kind: m[1], id: id[1] });
    }
  }
  const waiting = /## Waiting for review \((\d+)\)/.exec(text);
  if (waiting) out.waiting = Number(waiting[1]);
  for (const m of text.matchAll(/^- \*\*([^*]+):\*\* (.+)$/gm)) out.notes.push({ source: m[1], message: m[2].slice(0, 300) });
  return out;
}

/** CI result for one commit from its check runs: passed, running, failed or none. */
function checksState(runs) {
  const list = (runs || []).filter((r) => r && r.name);
  if (!list.length) return 'none';
  if (list.some((r) => r.status !== 'completed')) return 'running';
  if (list.some((r) => !['success', 'skipped', 'neutral'].includes(r.conclusion))) return 'failed';
  return 'passed';
}

/* ---------- source-discovery issues ---------- */

/** The machine-readable part of the monthly source check (catalog/scripts/discovery_report.py). */
function parseDiscovery(body) {
  const m = /<!-- review-data (\{[\s\S]*?\}) -->/.exec(String(body || ''));
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    return {
      newSites: Array.isArray(d.newSites) ? d.newSites.slice(0, 60) : [],
      robotsChanged: Array.isArray(d.robotsChanged) ? d.robotsChanged : [],
      broken: Array.isArray(d.broken) ? d.broken : [],
      noDates: Array.isArray(d.noDates) ? d.noDates : [],
    };
  } catch {
    return null;
  }
}

/* ---------- visitor messages (GitHub issues) ---------- */

const MESSAGE_KINDS = ['remove-listing', 'listing-correction', 'add-listing', 'bug', 'enhancement'];
const AUTOMATION_LABELS = new Set(['ingest-failure', 'source-discovery', 'copilot-task', 'dependencies']);

function messageCard(issue, now = Date.now()) {
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const kind = MESSAGE_KINDS.find((k) => labels.includes(k)) || 'other';
  const created = Date.parse(issue.created_at);
  const ageDays = Math.floor((now - created) / 86400000);
  const sections = {};
  for (const m of String(issue.body || '').matchAll(/^### (.+)\n+([\s\S]*?)(?=\n### |$)/gm)) sections[m[1].trim()] = m[2].trim().replace(/^_No response_$/, '');
  const pageUrl = /https?:\/\/[^\s)]+/.exec(sections['Page address'] || '');
  return {
    number: issue.number,
    title: issue.title,
    kind,
    labels,
    author: (issue.user && issue.user.login) || '',
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    ageDays,
    dueInDays: kind === 'remove-listing' ? 7 - ageDays : null,
    comments: issue.comments || 0,
    url: issue.html_url,
    body: String(issue.body || '').slice(0, 4000),
    sections,
    page: pageUrl ? pageUrl[0] : '',
  };
}

const isMessage = (issue) => !issue.pull_request && !(issue.labels || []).some((l) => AUTOMATION_LABELS.has(typeof l === 'string' ? l : l.name));

module.exports = { reasonsOf, eveningTime, suggestion, lastDateOf, listingCard, sourceGroup, sourceCard, parseReport, checksState, parseDiscovery, messageCard, isMessage, MESSAGE_KINDS };
