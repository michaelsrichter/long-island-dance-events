/** Event update log: the rolling "Collected events" pull request, with a manual fallback. */
import { ago, api, button, cmsUrl, copilotButton, dateTimeLabel, details, el, emptyState, errorText, link, list, LIVE, plural, say, settle } from './core';

type SourceRow = { name: string; result: string; found: number; kept: number; new: number; updated: number; unchanged: number; ended: number; missing: number; hidden: number };
type Report = { latest: string; totals: string; sources: SourceRow[]; created: { kind: string; id: string }[]; hidden: number; notes: { source: string; message: string }[] };
export type Collected = {
  open: null | {
    number: number;
    url: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    headSha: string;
    mergeable: boolean | null;
    mergeableState: string;
    commits: number;
    changedFiles: number;
    checks: 'passed' | 'running' | 'failed' | 'none';
    checkRuns: { name: string; status: string; conclusion: string; url: string }[];
    report: Report;
    filesUrl: string;
    branchUrl: string;
  };
  last: null | { number: number; url: string; mergedAt: string; closedAt: string };
};

const KINDS: Record<string, [string, string]> = { venues: ['venue', 'venues'], performers: ['band or DJ', 'performers'], instructors: ['teacher', 'instructors'], organizers: ['organizer', 'organizers'] };
const CHECKS: Record<string, [string, string]> = {
  passed: ['Checks passed', 'ok'],
  running: ['Checks are still running (usually 15 to 25 minutes)', 'warn'],
  failed: ['Checks found a problem', 'bad'],
  none: ['Checks have not started yet', 'warn'],
};

export function newEventCount(c: Collected): number {
  return c.open ? c.open.report.sources.reduce((n, s) => n + s.new, 0) : 0;
}

export function renderCollected(root: HTMLElement, c: Collected, onPublished: () => void) {
  root.replaceChildren();
  const pr = c.open;
  if (!pr) {
    const box = emptyState('No event update is in progress. Scheduled checks publish automatically after CI passes.');
    if (c.last) {
      const p = el('p', null, 'review-hint');
      p.append(`Last published ${c.last.mergedAt ? dateTimeLabel(c.last.mergedAt) : 'earlier'}: `, link(c.last.url, `update #${c.last.number}`));
      box.append(p);
    }
    root.append(box);
    return;
  }
  const r = pr.report;
  const added = r.sources.reduce((n, s) => n + s.new, 0);
  const changed = r.sources.reduce((n, s) => n + s.updated, 0);
  const ended = r.sources.reduce((n, s) => n + s.ended, 0);
  const problems = r.sources.filter((s) => s.result !== 'OK' && s.result !== 'SKIPPED');

  const card = el('article', null, 'review-card');
  card.append(el('h3', 'Scheduled event update'));
  card.append(
    list(
      [
        `Last check: ${r.latest || 'not known'} (updated ${ago(pr.updatedAt)})`,
        `${plural(added, 'new event')}, ${plural(changed, 'changed event')}, ${plural(ended, 'event')} ended`,
        r.totals ? `Update totals: ${r.totals}` : null,
      ],
      'review-meta',
    ),
  );
  const [label, tone] = CHECKS[pr.checks] || CHECKS.none!;
  const state = el('p', `${label}.${pr.checks === 'passed' ? ' Automatic publishing is next; no action is needed.' : ''}`, `review-state review-state--${tone}`);
  card.append(state);
  if (pr.mergeable === false) card.append(el('p', 'This update clashes with a recent change. The next check (tomorrow morning) fixes that by itself. You can also use "Check sources now" under Sources.', 'review-state review-state--warn'));

  const actions = el('div', null, 'review-actions');
  const canPublish = pr.checks === 'passed' && pr.mergeable !== false;
  const publish = button('Publish manually now', 'btn--secondary', async () => {
    if (!canPublish) return say(pr.checks === 'running' ? 'The checks are still running. Try again in a few minutes.' : "You can't publish this update yet. See the note above.");
    if (!confirm(`Publish ${plural(added, 'new event')} and ${plural(changed, 'change')} to the website?`)) return;
    const res = await api('/api/review/collected', { number: pr.number, headSha: pr.headSha });
    if (res.status !== 200) return say(errorText(res));
    settle(card, `Published. ${LIVE}`);
    say(`Published. ${LIVE}`);
    onPublished();
  });
  if (!canPublish) publish.setAttribute('aria-describedby', 'publish-why');
  state.id = 'publish-why';
  actions.append(publish);
  actions.append(link(pr.filesUrl, 'See every change on GitHub', { cls: 'btn btn--small btn--secondary' }));
  if (pr.checks === 'failed') {
    const failed = pr.checkRuns.find((x) => x.conclusion && x.conclusion !== 'success' && x.conclusion !== 'skipped');
    if (failed) actions.append(link(failed.url, 'What failed?', { cls: 'btn btn--small btn--secondary' }));
    actions.append(
      copilotButton(
        'Ask Copilot to fix the checks',
        () => `Fix the failed checks on the collected events update #${pr.number}`,
        () => `The automatic checks failed on the rolling "Collected events" pull request #${pr.number} (${pr.url}).${failed ? ` Failed check: ${failed.name} (${failed.url}).` : ''}\n\nPlease find out why and fix it (usually a source file or event file that does not pass \`npm run check\`). Do not push to the ingest/updates branch; fix main or the adapter instead, and the next run picks it up.`,
      ),
    );
  }
  card.append(actions);
  root.append(card);

  if (r.hidden) {
    root.append(el('p', `${plural(r.hidden, 'uncertain listing')} from this check stayed hidden automatically. No review task was created.`, 'review-hint'));
  }

  if (r.created.length) {
    const box = el('section', null, 'review-card');
    box.append(el('h3', 'New venues, bands and DJs (optional research)'));
    box.append(el('p', 'The check added these by itself. They do not block publishing. You can open them in the editor or ask Copilot to research the dance floor, website and photos.', 'review-hint'));
    const items = r.created.map((x) => {
      const [kind, collection] = KINDS[x.kind] || [x.kind, x.kind];
      const li = el('span');
      li.append(`${kind}: `, link(cmsUrl(collection, x.id), x.id, { external: true }));
      return li;
    });
    box.append(list(items, 'review-links'));
    const row = el('div', null, 'review-actions');
    row.append(
      copilotButton(
        'Ask Copilot to research them',
        () => `Research new venues, bands and DJs from the collected events update #${pr.number}`,
        () =>
          `The weekly check added these records by itself in #${pr.number} (${pr.url}):\n\n${r.created.map((x) => `- ${x.kind}: \`${x.id}\``).join('\n')}\n\nFor each one, check the name, add the address (venues), their own website and social pages, and the dancing research (see "How we learn about bands, DJs and venues" in docs/how-weekly-updates-work.md). Open a pull request.`,
      ),
    );
    box.append(row);
    root.append(box);
  }

  if (problems.length || r.notes.length) {
    const box = details(`Sources with problems in this check (${problems.length})`, 'review-details panel');
    box.body.append(el('p', 'You can also find these under Sources, with "Try again now" and "Ask Copilot to fix it" buttons.', 'review-hint'));
    box.body.append(list(r.notes.map((n) => `${n.source}: ${n.message}`), 'review-sub'));
    root.append(box.box);
  }

  const tableBox = details(`What each source found (${r.sources.length})`, 'review-details panel');
  const wrap = el('div', null, 'review-table-wrap');
  const t = el('table', null, 'review-table');
  const head = el('tr');
  for (const h of ['Source', 'Result', 'New', 'Changed', 'Ended', 'Missing', 'Hidden']) {
    const th = el('th', h);
    th.scope = 'col';
    if (h !== 'Source' && h !== 'Result') th.className = 'num';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const s of r.sources) {
    const tr = el('tr');
    const th = el('th', s.name);
    th.scope = 'row';
    tr.append(th, el('td', s.result === 'OK' ? 'OK' : s.result.toLowerCase()));
    for (const n of [s.new, s.updated, s.ended, s.missing, s.hidden]) tr.append(el('td', String(n), 'num'));
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.append(t);
  tableBox.body.append(wrap);
  tableBox.body.append(el('p', 'This table shows how many events each source found in the latest check. New: events we had not seen before. Changed: details changed. Ended: the last date passed. Missing: gone from current source coverage. Hidden: uncertain, missing or duplicate listings kept in history but not shown.', 'review-hint'));
  root.append(tableBox.box);
}
