'use strict';
/**
 * Review center API (decision P51). Everything waiting on the owner, in one place: held listings,
 * the rolling "Collected events" pull request, sources, visitor messages (GitHub issues) and the log.
 * The route rule in staticwebapp.config.json requires the "admin" role for /api/review/*; every
 * handler checks it again. Writes need a same-origin JSON request (like the moderation API) and are
 * written to the ModLog table. Listing and source decisions become one commit on main per request
 * (git stays the master copy); the site rebuilds in a few minutes.
 *
 *   GET  /api/review/status                      GitHub connection, community queue count
 *   GET  /api/review/listings                    held listings (status pending-review on main)
 *   POST /api/review/listings  { decisions: [{ id, action: publish|fix|cancel|hide|undo, fields?, note?, commit? }] }
 *   POST /api/review/snooze    { kind, id, days | undo }
 *   GET  /api/review/collected                   the rolling ingest/updates pull request
 *   POST /api/review/collected { number, headSha }   merge it ("Publish now")
 *   GET  /api/review/sources                     sources by next step, failures, monthly checks, runs
 *   POST /api/review/sources   { decisions: [{ id, action: enable|disable|permission, status?, note?, feedUrl? }] }
 *   POST /api/review/run       { cadence? , source? }   start "Collect events" now
 *   POST /api/review/candidate { issue, domain, action: reject|copilot, note? }
 *   GET  /api/review/messages                    open visitor issues (+ Copilot tasks)
 *   POST /api/review/messages  { number, action: reply|close, body?, reason? }
 *   POST /api/review/copilot   { title, body }    an issue for Copilot (label copilot-task)
 *   GET  /api/review/outreach                    emails to website owners: conversations and send history
 *   GET  /api/review/outreach/draft?key=&kind=   a ready-made email (permission, followup, correction)
 *   POST /api/review/outreach/send { key, kind, to, subject, text, override?, saveContact? }  (AgentMail, production only)
 *   GET  /api/review/outreach/thread?id=         one conversation, with the answers
 *   GET  /api/review/log?month=YYYY-MM           decisions (review center and moderation)
 *   POST /api/review/github/start                one-time GitHub App setup (manifest flow)
 *   GET  /api/github-setup?code=&state=          GitHub's return address for that setup (no role needed;
 *                                                the single-use state proves an admin started it)
 */
const { serverEvent } = require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, readJson, cleanText } = require('../lib/http');
const { table, TABLES } = require('../lib/store');
const { readPrincipal } = require('../lib/principal');
const { audit, month } = require('../lib/audit');
const { publicHost, isAllowedHost } = require('../hosts');
const github = require('../lib/github');
const files = require('../lib/content-files');
const data = require('../lib/review-data');
const outreach = require('../lib/outreach');

const { REPO, OWNER } = github;
const INGEST_BRANCH = 'ingest/updates';
const INGEST_WORKFLOW = 'ingest-scheduled.yml';
const LIVE_MINUTES = 10;
const CADENCES = { daily: 'daily', 'twice-weekly': 'twice-weekly', weekly: 'weekly,monthly' };
const SNOOZE_KINDS = new Set(['listing', 'source', 'message', 'candidate']);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const actorOf = (p) => `admin:${p.details || p.userId.slice(0, 8)}`;
const short = (sha) => String(sha || '').slice(0, 7);

/* ---------- small caches (a warm Functions instance keeps them for a while) ---------- */

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const forget = (prefix) => {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
};

/* ---------- access ---------- */

function reviewer(request) {
  const principal = readPrincipal(request);
  if (!principal) return { response: error(401, 'sign_in', 'Please sign in first.') };
  if (!principal.roles.includes('admin')) return { response: error(403, 'not_admin', 'This page is for the site owner and editors only.') };
  return { principal };
}

function route(name, methods, path, fn, { write = false } = {}) {
  app.http(name, {
    methods,
    authLevel: 'anonymous',
    route: path,
    handler: async (request, context) => {
      if (write && !sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
      const a = reviewer(request);
      if (a.response) return a.response;
      try {
        return await fn(request, a.principal, context);
      } catch (e) {
        if (e instanceof files.DecisionError) return error(400, 'bad_decision', e.message);
        if (e instanceof outreach.OutreachError) {
          context.warn(`review ${name}: email ${e.status} ${e.message}`);
          return error(e.status, 'email', e.status >= 500 || e.status === 429 ? `The email service did not accept that (${e.message}). Nothing was sent. Please try again later.` : e.message);
        }
        if (e instanceof github.GitHubError) {
          if (e.status === 428) return error(428, 'github_setup', e.message);
          context.warn(`review ${name}: GitHub ${e.status} ${e.message}`);
          return error(502, 'github', `GitHub did not accept that (${e.status}: ${e.message}). Please try again in a minute.`);
        }
        context.warn(`review ${name}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
        return error(500, 'server', 'Something went wrong. Please try again.');
      }
    },
  });
}

async function note(event) {
  try {
    await serverEvent('review_decision', event);
  } catch {
    // Telemetry never blocks a decision.
  }
}

/* ---------- content at one commit ---------- */

async function content(sha) {
  return cached(`content:${sha}`, 30 * 60 * 1000, async () => {
    const f = await github.readFolders(sha, ['events', 'sources', 'venues', 'performers'], { withText: ['events', 'sources'] });
    const parse = (list) => {
      const m = new Map();
      for (const x of list) {
        try {
          m.set(x.id, JSON.parse(x.text));
        } catch {
          // A broken file is CI's problem; skip it here.
        }
      }
      return m;
    };
    return {
      events: parse(f.events),
      sources: parse(f.sources),
      venueIds: new Set(f.venues.map((x) => x.id)),
      performerIds: new Set(f.performers.map((x) => x.id)),
    };
  });
}

async function ids(sha) {
  return cached(`ids:${sha}`, 30 * 60 * 1000, async () => {
    const f = await github.readFolders(sha, ['venues', 'performers'], { withText: [] });
    return { venueIds: new Set(f.venues.map((x) => x.id)), performerIds: new Set(f.performers.map((x) => x.id)) };
  });
}

async function snoozed(kind) {
  const out = {};
  const now = Date.now();
  for (const r of await table(TABLES.review).list('snooze', { limit: 2000 })) {
    if (r.rowKey.startsWith(`${kind}~`) && Date.parse(r.until) > now) out[r.rowKey.slice(kind.length + 1)] = r.until;
  }
  return out;
}

/* ---------- status ---------- */

route('reviewStatus', ['GET'], 'review/status', async (request, principal) => {
  const [gh, queue] = await Promise.all([github.status(), table(TABLES.queue).list('pending', { limit: 500 })]);
  const oldest = queue.map((q) => q.at).sort()[0] || '';
  return json(200, { github: gh, posts: { count: queue.length, oldest }, today: today(), you: principal.details ? principal.details.replace(/@.*/, '') : '' });
});

/* ---------- held listings ---------- */

route('reviewListings', ['GET'], 'review/listings', async () => {
  const sha = await github.headSha();
  const c = await content(sha);
  const sourceNames = Object.fromEntries([...c.sources].map(([id, s]) => [id, s.name]));
  const snooze = await snoozed('listing');
  const t = today();
  const listings = [...c.events]
    .filter(([, e]) => e.status === 'pending-review')
    .map(([id, e]) => ({ ...data.listingCard(id, e, t, sourceNames), snoozedUntil: snooze[id] || '' }))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return json(200, { sha, today: t, listings, venueIds: [...c.venueIds].sort(), performerIds: [...c.performerIds].sort() });
});

route(
  'reviewListingsDecide',
  ['POST'],
  'review/listings',
  async (request, principal) => {
    const b = await readJson(request, 32 * 1024);
    if (!b.ok) return b.response;
    const decisions = Array.isArray(b.body.decisions) ? b.body.decisions.slice(0, 80) : [];
    if (!decisions.length || decisions.some((d) => !files.isId(d && d.id) || !['publish', 'fix', 'cancel', 'hide', 'undo'].includes(d.action))) {
      return error(400, 'bad_request', 'Choose at least one listing and an action.');
    }
    if (decisions.some((d) => d.action === 'undo' && !/^[0-9a-f]{40}$/.test(String(d.commit || '')))) return error(400, 'bad_request', 'Bad request.');
    const t = today();
    const done = [];
    const skipped = [];
    const commit = await github.commitFiles(async (base) => {
      done.length = 0;
      skipped.length = 0;
      const paths = decisions.map((d) => files.pathOf('events', d.id));
      const [texts, known] = await Promise.all([github.readFiles(base, paths), ids(base)]);
      const out = {};
      const lines = [];
      for (const d of decisions) {
        const path = files.pathOf('events', d.id);
        if (!texts[path]) {
          skipped.push({ id: d.id, why: 'not found' });
          continue;
        }
        const e = JSON.parse(texts[path]);
        if (d.action === 'undo') {
          // Put the file back exactly as it was before that decision, if nobody changed it since.
          const c = await github.gh('GET', `/repos/${REPO}/git/commits/${d.commit}`);
          const parent = c.parents && c.parents[0] && c.parents[0].sha;
          const then = parent && (await github.readFiles(d.commit, [path]))[path];
          const before = parent && (await github.readFiles(parent, [path]))[path];
          if (!then || !before || then === before) throw new files.DecisionError(`${e.title}: that decision cannot be undone here. Change it in the editor instead.`);
          if (then !== texts[path]) throw new files.DecisionError(`${e.title}: it changed after that decision. Change it in the editor instead.`);
          out[path] = before;
          lines.push(`- ${d.id}: undo ${short(d.commit)}`);
          done.push({ id: d.id, action: 'undo', status: JSON.parse(before).status, before: e.status, summary: `undo ${short(d.commit)}`, note: '' });
          continue;
        }
        if (e.status !== 'pending-review') {
          skipped.push({ id: d.id, why: `already ${e.status}` });
          continue;
        }
        let r;
        try {
          r = files.decideListing(e, { ...d, note: cleanText(d.note, 200) }, { today: t, ...known });
        } catch (err) {
          if (err instanceof files.DecisionError) throw new files.DecisionError(`${e.title}: ${err.message}`);
          throw err;
        }
        out[path] = files.serialize(r.event, files.EVENT_ORDER);
        lines.push(`- ${d.id}: ${r.summary}`);
        done.push({ id: d.id, action: d.action, status: r.event.status, before: 'pending-review', summary: r.summary, note: cleanText(d.note, 200) });
      }
      const n = lines.length;
      return { files: out, message: `Review center: ${n} listing decision${n === 1 ? '' : 's'}\n\n${lines.join('\n')}\n\nDecided in the review center (/moderate/). Changed fields are locked so the weekly run keeps them.` };
    });
    forget('content:');
    for (const d of done) {
      await audit({ actor: actorOf(principal), action: `listing.${d.action}`, targetType: 'event', targetId: d.id, reason: [d.summary, d.note, commit && `commit ${short(commit.sha)}`].filter(Boolean).join('; '), before: d.before, after: d.status });
    }
    if (done.length) await note({ area: 'listing', action: done.length > 1 ? 'bulk' : done[0].action, count: String(done.length) });
    return json(200, { ok: true, commit, done, skipped, liveInMinutes: LIVE_MINUTES });
  },
  { write: true },
);

route(
  'reviewSnooze',
  ['POST'],
  'review/snooze',
  async (request, principal) => {
    const b = await readJson(request, 2048);
    if (!b.ok) return b.response;
    const { kind, id } = b.body;
    if (!SNOOZE_KINDS.has(kind) || typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(id)) return error(400, 'bad_request', 'Bad request.');
    const rowKey = `${kind}~${id}`;
    if (b.body.undo === true) {
      await table(TABLES.review).remove('snooze', rowKey);
      await audit({ actor: actorOf(principal), action: `${kind}.unsnooze`, targetType: kind, targetId: id });
      return json(200, { ok: true, until: '' });
    }
    let until;
    if (typeof b.body.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.body.until)) until = new Date(`${b.body.until}T12:00:00Z`);
    else until = new Date(Date.now() + Math.max(1, Math.min(200, Number(b.body.days) || 7)) * 86400000);
    if (!(until.getTime() > Date.now())) return error(400, 'bad_request', 'Pick a day in the future.');
    await table(TABLES.review).upsert({ partitionKey: 'snooze', rowKey, until: until.toISOString(), at: new Date().toISOString(), actor: actorOf(principal) });
    await audit({ actor: actorOf(principal), action: `${kind}.snooze`, targetType: kind, targetId: id, reason: `until ${until.toISOString().slice(0, 10)}` });
    return json(200, { ok: true, until: until.toISOString() });
  },
  { write: true },
);

/* ---------- collected events (the rolling pull request) ---------- */

async function openIngestPr() {
  const open = await github.gh('GET', `/repos/${REPO}/pulls?state=open&head=${OWNER}:${encodeURIComponent(INGEST_BRANCH)}&per_page=5`);
  return open[0] || null;
}

route('reviewCollected', ['GET'], 'review/collected', async () => {
  const pr = await openIngestPr();
  if (!pr) {
    const closed = await github.gh('GET', `/repos/${REPO}/pulls?state=closed&head=${OWNER}:${encodeURIComponent(INGEST_BRANCH)}&per_page=1&sort=updated&direction=desc`);
    const last = closed[0];
    return json(200, { open: null, last: last ? { number: last.number, url: last.html_url, mergedAt: last.merged_at || '', closedAt: last.closed_at || '' } : null });
  }
  const [full, checks] = await Promise.all([
    github.gh('GET', `/repos/${REPO}/pulls/${pr.number}`),
    github.gh('GET', `/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`),
  ]);
  const runs = (checks.check_runs || []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion || '', url: r.html_url }));
  return json(200, {
    open: {
      number: full.number,
      url: full.html_url,
      title: full.title,
      createdAt: full.created_at,
      updatedAt: full.updated_at,
      headSha: full.head.sha,
      mergeable: full.mergeable,
      mergeableState: full.mergeable_state,
      commits: full.commits,
      changedFiles: full.changed_files,
      checks: data.checksState(runs),
      checkRuns: runs,
      report: data.parseReport(full.body),
      filesUrl: `${full.html_url}/files`,
      branchUrl: `https://github.com/${REPO}/tree/${INGEST_BRANCH}`,
    },
  });
});

route(
  'reviewCollectedPublish',
  ['POST'],
  'review/collected',
  async (request, principal) => {
    const b = await readJson(request, 1024);
    if (!b.ok) return b.response;
    const number = Number(b.body.number);
    const headSha = String(b.body.headSha || '');
    if (!Number.isInteger(number) || number < 1 || !/^[0-9a-f]{40}$/.test(headSha)) return error(400, 'bad_request', 'Bad request.');
    const pr = await github.gh('GET', `/repos/${REPO}/pulls/${number}`);
    if (pr.state !== 'open' || pr.head.ref !== INGEST_BRANCH) return error(409, 'not_open', 'This update was already published or closed. Refresh the page.');
    if (pr.head.sha !== headSha) return error(409, 'changed', 'A newer collection run just added changes. Refresh the page, then publish again.');
    const checks = await github.gh('GET', `/repos/${REPO}/commits/${headSha}/check-runs?per_page=100`);
    const state = data.checksState(checks.check_runs);
    if (state !== 'passed') return error(409, 'checks', state === 'running' ? 'The automatic checks are still running. Try again in a few minutes.' : state === 'failed' ? 'The automatic checks found a problem, so this update cannot be published yet.' : 'The automatic checks have not run yet.');
    if (pr.mergeable === false) return error(409, 'conflict', 'This update clashes with a recent change. The next collection run fixes that by itself.');
    const merged = await github.gh('PUT', `/repos/${REPO}/pulls/${number}/merge`, { merge_method: 'merge', sha: headSha });
    forget('content:');
    await audit({ actor: actorOf(principal), action: 'collected.publish', targetType: 'pull', targetId: String(number), reason: `merged ${short(merged.sha)}` });
    await note({ area: 'collected', action: 'publish', count: '1' });
    return json(200, { ok: true, sha: merged.sha, liveInMinutes: LIVE_MINUTES });
  },
  { write: true },
);

/* ---------- sources ---------- */

route('reviewSources', ['GET'], 'review/sources', async () => {
  const sha = await github.headSha();
  const [c, failures, discovery, runs, snooze, decided] = await Promise.all([
    content(sha),
    github.gh('GET', `/repos/${REPO}/issues?state=open&labels=ingest-failure&per_page=100`),
    github.gh('GET', `/repos/${REPO}/issues?state=open&labels=source-discovery&per_page=10`),
    github.gh('GET', `/repos/${REPO}/actions/workflows/${INGEST_WORKFLOW}/runs?per_page=15`),
    snoozed('source'),
    table(TABLES.review).list('candidate', { limit: 2000 }),
  ]);
  const done = new Set(decided.map((r) => r.rowKey));
  return json(200, {
    sha,
    today: today(),
    sources: [...c.sources].map(([id, s]) => ({ ...data.sourceCard(id, s), snoozedUntil: snooze[id] || '' })).sort((a, b) => a.name.localeCompare(b.name)),
    failures: failures
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at, comments: i.comments, sourceId: (/<!-- ingest-failure ([a-z0-9-]+) -->/.exec(i.body || '') || [])[1] || '' })),
    discovery: discovery
      .filter((i) => !i.pull_request)
      .map((i) => {
        const d = data.parseDiscovery(i.body);
        if (d) d.newSites = d.newSites.filter((s) => !done.has(String(s.domain)));
        return { number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at, data: d };
      }),
    runs: (runs.workflow_runs || []).map((r) => ({ id: r.id, title: r.display_title, event: r.event, status: r.status, conclusion: r.conclusion || '', createdAt: r.created_at, url: r.html_url })),
  });
});

route(
  'reviewSourcesDecide',
  ['POST'],
  'review/sources',
  async (request, principal) => {
    const b = await readJson(request, 16 * 1024);
    if (!b.ok) return b.response;
    const decisions = Array.isArray(b.body.decisions) ? b.body.decisions.slice(0, 40) : [];
    if (!decisions.length || decisions.some((d) => !files.isId(d && d.id) || !['enable', 'disable', 'permission'].includes(d.action))) return error(400, 'bad_request', 'Bad request.');
    const t = today();
    const done = [];
    const commit = await github.commitFiles(async (base) => {
      done.length = 0;
      const paths = decisions.map((d) => files.pathOf('sources', d.id));
      const texts = await github.readFiles(base, paths);
      const current = {};
      const out = {};
      const lines = [];
      for (const d of decisions) {
        const path = files.pathOf('sources', d.id);
        if (!texts[path]) throw new files.DecisionError(`Unknown source ${d.id}.`);
        // Several decisions on one source (for example "They said yes" and "Switch on") build on each other.
        const s = current[path] || JSON.parse(texts[path]);
        const r = files.decideSource(s, { ...d, note: cleanText(d.note, 200) }, { today: t });
        current[path] = r.source;
        out[path] = `${JSON.stringify(r.source, null, 2)}\n`;
        lines.push(`- ${d.id}: ${r.summary}`);
        done.push({ id: d.id, action: d.action, summary: r.summary, note: cleanText(d.note, 200) });
      }
      return { files: out, message: `Review center: ${lines.length} source decision${lines.length === 1 ? '' : 's'}\n\n${lines.join('\n')}\n\nDecided in the review center (/moderate/).` };
    });
    forget('content:');
    for (const d of done) await audit({ actor: actorOf(principal), action: `source.${d.action}`, targetType: 'source', targetId: d.id, reason: [d.summary, d.note, commit && `commit ${short(commit.sha)}`].filter(Boolean).join('; ') });
    if (done.length) await note({ area: 'source', action: done[0].action, count: String(done.length) });
    return json(200, { ok: true, commit, done, liveInMinutes: LIVE_MINUTES });
  },
  { write: true },
);

route(
  'reviewRun',
  ['POST'],
  'review/run',
  async (request, principal) => {
    const b = await readJson(request, 1024);
    if (!b.ok) return b.response;
    const source = typeof b.body.source === 'string' && b.body.source ? b.body.source : '';
    const cadence = CADENCES[b.body.cadence] || '';
    if (source ? !files.isId(source) : !cadence) return error(400, 'bad_request', 'Choose which sources to read.');
    if (source) {
      const c = await content(await github.headSha());
      if (!c.sources.has(source)) return error(404, 'not_found', 'Unknown source.');
    }
    await github.gh('POST', `/repos/${REPO}/actions/workflows/${INGEST_WORKFLOW}/dispatches`, { ref: github.BRANCH, inputs: { cadence: cadence || 'weekly,monthly', source } });
    await audit({ actor: actorOf(principal), action: 'run', targetType: source ? 'source' : 'cadence', targetId: source || cadence });
    await note({ area: 'run', action: source ? 'source' : 'cadence', count: '1' });
    return json(200, { ok: true, url: `https://github.com/${REPO}/actions/workflows/${INGEST_WORKFLOW}` });
  },
  { write: true },
);

/** Add a "the owner said no" line to catalog/search-triage.json (one domain per line, sorted). */
function triageWithNo(text, domain, why, today) {
  const doc = JSON.parse(text);
  if (doc.domains && doc.domains[domain]) return null;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^ {2}"domains": \{$/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^ {2}\}$/.test(l));
  if (start < 0 || end < 0) throw new Error('search-triage.json layout changed');
  const entry = `    ${JSON.stringify(domain)}: ${JSON.stringify({ decision: 'owner-no', note: `${why ? `${why} ` : ''}(review center, ${today})`.trim() })}`;
  let at = end;
  for (let i = start + 1; i < end; i++) {
    const k = /^ {4}"([^"]+)":/.exec(lines[i]);
    if (k && k[1] > domain) {
      at = i;
      break;
    }
  }
  if (at === end) lines[end - 1] = `${lines[end - 1]},`;
  lines.splice(at, 0, at === end ? entry : `${entry},`);
  let out = lines.join('\n');
  if (!/"owner-no":/.test(out.split('\n').find((l) => /^ {2}"decisions": /.test(l)) || '')) {
    out = out.replace(/^ {2}"decisions": \{/m, '  "decisions": {"owner-no": "the owner looked and said no (review center)", ');
  }
  const check = JSON.parse(out);
  if (Object.keys(check.domains).length !== Object.keys(doc.domains).length + 1) throw new Error('search-triage.json edit failed');
  return out;
}

const DOMAIN = /^(?=.{3,120}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

route(
  'reviewCandidate',
  ['POST'],
  'review/candidate',
  async (request, principal) => {
    const b = await readJson(request, 4096);
    if (!b.ok) return b.response;
    const domain = String(b.body.domain || '').toLowerCase();
    const issue = Number(b.body.issue) || 0;
    const why = cleanText(b.body.note, 200);
    if (!DOMAIN.test(domain) || !['reject', 'copilot'].includes(b.body.action)) return error(400, 'bad_request', 'Bad request.');
    let result = {};
    if (b.body.action === 'reject') {
      const commit = await github.commitFiles(async (base) => {
        const path = 'catalog/search-triage.json';
        const texts = await github.readFiles(base, [path]);
        const next = triageWithNo(texts[path], domain, why, today());
        return next ? { files: { [path]: next }, message: `Review center: not a source: ${domain}\n\nThe owner looked at it from the monthly source check${issue ? ` (#${issue})` : ''} and said no.` } : null;
      });
      result = { commit };
    } else {
      const url = typeof b.body.url === 'string' && /^https?:\/\//.test(b.body.url) ? b.body.url.slice(0, 300) : `https://${domain}/`;
      const created = await copilotIssue(
        `Check a possible new source: ${domain}`,
        [
          `The owner thinks **${domain}** may be worth adding as a source (found by the monthly source check${issue ? ` #${issue}` : ''}).`,
          '',
          `Example page: ${url}`,
          ...(why ? ['', `Owner's note: ${why}`] : []),
          '',
          'Please follow "How new sources are found and switched on" in docs/how-weekly-updates-work.md:',
          '- [ ] Does it list several upcoming dance or live-music events on Long Island (Nassau or Suffolk)?',
          '- [ ] Is it allowed (robots.txt and the site\'s terms)? Never work around a block.',
          '- [ ] Add it to catalog/sources.json and a source file in src/content/sources/ (use a generic adapter if you can).',
          '- [ ] Add any venues, bands or organizers it needs, with addresses and dancing research.',
          '- [ ] Open a pull request. Merging it is the owner\'s approval.',
        ].join('\n'),
      );
      result = { issue: created };
    }
    await table(TABLES.review).upsert({ partitionKey: 'candidate', rowKey: domain, decision: b.body.action, at: new Date().toISOString(), actor: actorOf(principal) });
    await audit({ actor: actorOf(principal), action: `candidate.${b.body.action}`, targetType: 'domain', targetId: domain, reason: why });
    await note({ area: 'candidate', action: b.body.action, count: '1' });
    return json(200, { ok: true, ...result });
  },
  { write: true },
);

/* ---------- visitor messages ---------- */

route('reviewMessages', ['GET'], 'review/messages', async () => {
  const [issues, tasks, snooze] = await Promise.all([
    github.gh('GET', `/repos/${REPO}/issues?state=open&per_page=100&sort=created&direction=asc`),
    github.gh('GET', `/repos/${REPO}/issues?state=open&labels=copilot-task&per_page=50`),
    snoozed('message'),
  ]);
  const now = Date.now();
  return json(200, {
    messages: issues.filter(data.isMessage).map((i) => ({ ...data.messageCard(i, now), snoozedUntil: snooze[String(i.number)] || '' })),
    copilotTasks: tasks.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at, assigned: (i.assignees || []).some((a) => /^copilot/i.test(a.login || '')) })),
  });
});

route(
  'reviewMessagesAct',
  ['POST'],
  'review/messages',
  async (request, principal) => {
    const b = await readJson(request, 8 * 1024);
    if (!b.ok) return b.response;
    const number = Number(b.body.number);
    const action = b.body.action;
    const text = cleanText(b.body.body, 3000);
    if (!Number.isInteger(number) || number < 1 || !['reply', 'close'].includes(action)) return error(400, 'bad_request', 'Bad request.');
    if (action === 'reply' && !text) return error(400, 'bad_request', 'Write a reply first.');
    const issue = await github.gh('GET', `/repos/${REPO}/issues/${number}`);
    if (issue.pull_request || !data.isMessage(issue)) return error(404, 'not_found', 'That is not a visitor message.');
    if (text) await github.gh('POST', `/repos/${REPO}/issues/${number}/comments`, { body: text });
    if (action === 'close') await github.gh('PATCH', `/repos/${REPO}/issues/${number}`, { state: 'closed', state_reason: b.body.reason === 'not_planned' ? 'not_planned' : 'completed' });
    await audit({ actor: actorOf(principal), action: `message.${action}`, targetType: 'issue', targetId: String(number), reason: text ? text.slice(0, 120) : '' });
    await note({ area: 'message', action, count: '1' });
    return json(200, { ok: true });
  },
  { write: true },
);

/* ---------- "Ask Copilot" ---------- */

async function copilotIssue(title, text) {
  try {
    await github.gh('POST', `/repos/${REPO}/labels`, { name: 'copilot-task', color: '6F42C1', description: 'Work the owner asked Copilot to do (from the review center)' });
  } catch {
    // The label already exists.
  }
  const issue = await github.gh('POST', `/repos/${REPO}/issues`, {
    title: title.slice(0, 200),
    labels: ['copilot-task'],
    body: `${text}\n\n---\n_Made in the review center (/moderate/). Copilot does not start this by itself. To get it done, start a Copilot session and give it this link; Copilot then opens a pull request for you to check. Choosing **Assign to Copilot** on GitHub can also start it, but if Copilot replies with an error, nothing more happens until you assign it again._`,
  });
  return { number: issue.number, url: issue.html_url };
}

route(
  'reviewCopilot',
  ['POST'],
  'review/copilot',
  async (request, principal) => {
    const b = await readJson(request, 12 * 1024);
    if (!b.ok) return b.response;
    const title = cleanText(b.body.title, 150);
    const text = cleanText(b.body.body, 6000);
    if (title.length < 5 || text.length < 10) return error(400, 'bad_request', 'Say what Copilot should do.');
    const created = await copilotIssue(title, text);
    await audit({ actor: actorOf(principal), action: 'copilot.ask', targetType: 'issue', targetId: String(created.number), reason: title });
    await note({ area: 'copilot', action: 'ask', count: '1' });
    return json(200, { ok: true, issue: created });
  },
  { write: true },
);

/* ---------- emails to website owners (AgentMail, decision P53) ---------- */

const outreachRow = (key) => key.replace(':', '~');
const OUTREACH_KINDS = new Set(['permission', 'followup', 'correction', 'test']);

/** What we know about a source for a permission email: its file and a published contact address. */
async function sourceForEmail(id) {
  if (!files.isId(id)) return null;
  const path = files.pathOf('sources', id);
  const s = (await github.readMainFiles([path]))[path];
  if (!s) return null;
  const source = JSON.parse(s);
  let to = source.contactEmail || '';
  let from = to ? 'the source' : '';
  if (!to && source.defaults) {
    const d = source.defaults;
    const refs = [d.organizerId && ['organizers', d.organizerId], d.venueId && ['venues', d.venueId], ...(d.performerIds || []).map((p) => ['performers', p])].filter((x) => x && files.isId(x[1]));
    const texts = await github.readMainFiles(refs.map(([c, i]) => files.pathOf(c, i)));
    for (const [c, i] of refs) {
      const t = texts[files.pathOf(c, i)];
      const e = t && JSON.parse(t).email;
      if (e && outreach.isEmail(e)) {
        to = e;
        from = { organizers: 'the organizer', venues: 'the venue', performers: 'the band or DJ' }[c];
        break;
      }
    }
  }
  return { source, to, toFrom: from };
}

route('reviewOutreach', ['GET'], 'review/outreach', async (request) => {
  const cfg = outreach.config(publicHost(request));
  let threads = [];
  let problem = '';
  try {
    threads = await outreach.listThreads(cfg);
  } catch {
    problem = 'Could not read the email inbox right now.';
  }
  const rows = await table(TABLES.review).list('outreach', { limit: 2000 });
  return json(200, {
    canSend: cfg.live,
    reason: cfg.reason,
    inbox: cfg.configured ? cfg.inbox : '',
    problem,
    rules: { newRequestDays: outreach.NEW_REQUEST_DAYS, followupAfterDays: outreach.FOLLOWUP_AFTER_DAYS },
    threads,
    sent: rows.map((r) => ({ key: r.rowKey.replace('~', ':'), lastSentAt: r.lastSentAt, firstSentAt: r.firstSentAt || r.lastSentAt, followups: Number(r.followups || 0), count: Number(r.count || 0), threadId: r.threadId || '' })),
  });
});

route('reviewOutreachDraft', ['GET'], 'review/outreach/draft', async (request) => {
  const p = new URL(request.url).searchParams;
  const key = p.get('key') || '';
  const kind = p.get('kind') || 'permission';
  const cfg = outreach.config(publicHost(request));
  if (!/^(source|issue):/.test(key) || !outreach.keyLabel(key) || !OUTREACH_KINDS.has(kind) || kind === 'test') return error(400, 'bad_request', 'Bad request.');
  const state = await table(TABLES.review).get('outreach', outreachRow(key));
  const rule = outreach.sendRule(kind, state);
  let draft;
  let to = '';
  let toFrom = '';
  if (key.startsWith('source:')) {
    const info = await sourceForEmail(key.slice(7));
    if (!info) return error(404, 'not_found', 'Unknown source.');
    draft = kind === 'followup' ? outreach.followupDraft(info.source, state && state.lastSentAt) : outreach.permissionDraft(info.source);
    to = (kind === 'followup' && state && state.to) || info.to;
    toFrom = kind === 'followup' && state && state.to ? 'your first email' : info.toFrom;
  } else {
    const issue = await github.gh('GET', `/repos/${REPO}/issues/${Number(key.slice(6))}`);
    if (issue.pull_request || !data.isMessage(issue)) return error(404, 'not_found', 'That is not a visitor message.');
    draft = outreach.correctionDraft(data.messageCard(issue));
    to = (state && state.to) || '';
  }
  return json(200, { key, kind, to, toFrom, ...draft, rule, canSend: cfg.live, reason: cfg.reason, inbox: cfg.configured ? cfg.inbox : '', lastSentAt: (state && state.lastSentAt) || '' });
});

route(
  'reviewOutreachSend',
  ['POST'],
  'review/outreach/send',
  async (request, principal) => {
    const b = await readJson(request, 16 * 1024);
    if (!b.ok) return b.response;
    const cfg = outreach.config(publicHost(request));
    const key = String(b.body.key || '');
    const kind = String(b.body.kind || '');
    const to = String(b.body.to || '').trim();
    const subject = cleanText(b.body.subject, 150);
    const text = typeof b.body.text === 'string' ? b.body.text.replace(/\r\n?/g, '\n').trim().slice(0, 6000) : '';
    if (!/^(source|issue):/.test(key) || !outreach.keyLabel(key) || !OUTREACH_KINDS.has(kind)) return error(400, 'bad_request', 'Bad request.');
    if (key.startsWith('issue:') && kind !== 'correction') return error(400, 'bad_request', 'Bad request.');
    if (!outreach.isEmail(to)) return error(400, 'bad_email', 'Type one email address, like info@example.com.');
    if (subject.length < 3 || text.length < 20) return error(400, 'bad_request', 'Write a subject and a message first.');
    // A test goes only to the site's own inbox (to see the real email without bothering anyone).
    if (kind === 'test' && (!key.startsWith('source:') || to.toLowerCase() !== String(cfg.inbox).toLowerCase())) return error(400, 'bad_request', 'A test email goes only to the site inbox.');
    if (key.startsWith('source:') && !(await sourceForEmail(key.slice(7)))) return error(404, 'not_found', 'Unknown source.');
    const rowKey = kind === 'test' ? `test~${key.slice(7)}` : outreachRow(key);
    const state = await table(TABLES.review).get('outreach', rowKey);
    const rule = kind === 'test' ? { ok: true } : outreach.sendRule(kind, state, Date.now(), b.body.override === true);
    if (!rule.ok) return error(409, 'too_soon', rule.reason);
    const r = await outreach.send(cfg, { kind, key: kind === 'test' ? `test:${key.slice(7)}` : key, to, subject, text, replyToMessageId: kind === 'followup' ? state.messageId : undefined });
    if (r.dryRun) {
      await audit({ actor: actorOf(principal), action: 'outreach.dryrun', targetType: key.split(':')[0], targetId: key.split(':')[1], reason: `${kind}; would send to an address at ${outreach.domainOf(to)} (${r.reason})` });
      return json(200, r);
    }
    const now = new Date().toISOString();
    await table(TABLES.review).upsert({
      partitionKey: 'outreach',
      rowKey,
      to,
      kind,
      firstSentAt: (state && state.firstSentAt) || now,
      lastSentAt: now,
      messageId: r.messageId,
      threadId: r.threadId || (state && state.threadId) || '',
      count: Number((state && state.count) || 0) + 1,
      followups: Number((state && state.followups) || 0) + (kind === 'followup' ? 1 : 0),
      actor: actorOf(principal),
    });
    let recorded = false;
    let commit = null;
    if (key.startsWith('source:') && (kind === 'permission' || kind === 'followup')) {
      try {
        commit = await github.commitFiles(async (base) => {
          const path = files.pathOf('sources', key.slice(7));
          const texts = await github.readFiles(base, [path]);
          if (!texts[path]) return null;
          const out = files.recordOutreach(JSON.parse(texts[path]), { kind, to, today: today(), saveContact: b.body.saveContact === true });
          return { files: { [path]: `${JSON.stringify(out.source, null, 2)}\n` }, message: `Review center: ${out.summary} (${key.slice(7)})\n\nSent from the review center (/moderate/).` };
        });
        recorded = Boolean(commit);
        forget('content:');
      } catch (e) {
        if (!(e instanceof github.GitHubError)) throw e;
      }
    }
    await audit({ actor: actorOf(principal), action: `outreach.${kind}`, targetType: key.split(':')[0], targetId: key.split(':')[1], reason: `emailed an address at ${outreach.domainOf(to)}; ${subject.slice(0, 80)}${commit ? `; commit ${short(commit.sha)}` : ''}` });
    await note({ area: 'outreach', action: kind, count: '1' });
    return json(200, { sent: true, threadId: r.threadId, messageId: r.messageId, recorded, commit });
  },
  { write: true },
);

route('reviewOutreachThread', ['GET'], 'review/outreach/thread', async (request) => {
  const cfg = outreach.config(publicHost(request));
  if (!cfg.configured) return error(404, 'not_configured', 'The email inbox is not set up here.');
  const t = await outreach.getThread(cfg, new URL(request.url).searchParams.get('id') || '');
  // Opening a conversation marks the answers read (only on the live site).
  if (cfg.live) {
    try {
      await outreach.markRead(cfg, t);
    } catch {
      // Still shown as new next time.
    }
  }
  return json(200, t);
});

/* ---------- log ---------- */

route('reviewLog', ['GET'], 'review/log', async (request) => {
  const m = new URL(request.url).searchParams.get('month');
  const rows = await table(TABLES.log).list(/^\d{4}-\d{2}$/.test(m || '') ? m : month(), { limit: 300 });
  return json(200, { entries: rows.map((e) => ({ at: e.at, actor: e.actor, action: e.action, targetType: e.targetType, targetId: e.targetId, key: e.key, reason: e.reason, before: e.before, after: e.after })) });
});

/* ---------- one-time GitHub setup ---------- */

function publicOrigin(request) {
  const host = publicHost(request);
  if (!isAllowedHost(host)) return null;
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https'}://${host}`;
}

route(
  'reviewGithubStart',
  ['POST'],
  'review/github/start',
  async (request, principal) => {
    const origin = publicOrigin(request);
    if (!origin) return error(400, 'bad_host', 'Unknown address.');
    if (!(process.env.REVIEW_SECRET_KEY || '').trim()) return error(503, 'not_configured', 'The REVIEW_SECRET_KEY app setting is missing. See docs/deployment.md.');
    const s = await github.startSetup(origin, actorOf(principal));
    return json(200, s);
  },
  { write: true },
);

app.http('githubSetup', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'github-setup',
  handler: async (request, context) => {
    const origin = publicOrigin(request);
    if (!origin) return { status: 400, body: 'Unknown host' };
    const back = (q) => ({ status: 302, headers: { Location: `${origin}/moderate/?github=${q}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    const p = new URL(request.url).searchParams;
    if (!p.get('code')) return back('cancelled');
    try {
      const r = await github.finishSetup(p.get('state') || '', p.get('code') || '');
      if (!r.ok) {
        context.warn(`github-setup: ${r.reason}`);
        return back(`failed&reason=${encodeURIComponent(r.reason)}`);
      }
      await audit({ actor: r.actor || 'admin', action: 'github.connect', targetType: 'app', targetId: r.slug, reason: `GitHub App ${r.appId} created` });
      await note({ area: 'setup', action: 'connect', count: '1' });
      return { status: 302, headers: { Location: `https://github.com/apps/${r.slug}/installations/new`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } };
    } catch (e) {
      context.warn(`github-setup: ${e && e.message}`);
      return back('failed&reason=error');
    }
  },
});

module.exports = { triageWithNo };
