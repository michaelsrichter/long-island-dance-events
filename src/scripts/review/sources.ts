/** Sources: what stopped working, new websites found, and switched-off sources grouped by what you can do. */
import { ago, api, button, cmsUrl, copilotButton, dateTimeLabel, dayLabel, details, el, emptyState, errorText, link, list, LIVE, plural, say, settle } from './core';
import { composer, conversations, type OutreachSummary } from './compose';

export type Source = {
  id: string;
  name: string;
  url: string;
  feedUrl: string;
  enabled: boolean;
  cadence: string;
  adapter: string;
  catalogStatus: string;
  permission: null | { status: string; note?: string; requestedAt?: string; decidedAt?: string };
  lastScraped: string;
  lastStatus: string;
  lastMessage: string;
  lastCounts: null | { found: number; kept: number; outOfArea: number; needsReview: number };
  notes: string;
  group: string;
  snoozedUntil: string;
};
type Site = { domain: string; url: string; title: string; queries: string[] };
export type SourcesData = {
  today: string;
  sources: Source[];
  failures: { number: number; title: string; url: string; createdAt: string; sourceId: string }[];
  discovery: { number: number; title: string; url: string; createdAt: string; data: null | { newSites: Site[]; robotsChanged: unknown[]; broken: unknown[]; noDates: unknown[] } }[];
  runs: { id: number; title: string; event: string; status: string; conclusion: string; createdAt: string; url: string }[];
};

const GROUPS: { id: string; title: string; help: string; closed?: boolean }[] = [
  { id: 'broken', title: 'Stopped working', help: 'The last check of these sources failed. Often the website changed its layout. Press "Try again now". If it still fails, press "Ask Copilot to fix it", or switch it off.' },
  { id: 'granted', title: 'They said yes: switch it on', help: 'The owner of the website said we may list their events. Switch the source on, or ask Copilot to set it up if they sent a calendar link.' },
  { id: 'asked', title: 'Waiting for an answer', help: 'You asked these websites for permission. Their answers show under each one. When they answer, press "They said yes: switch it on" or "They said no". If there is no answer after 14 days, you can send one short follow-up.' },
  { id: 'permission', title: 'Ask for permission', help: 'These websites ask programs like ours to stay away, or their rules say to ask first. We never work around that. A short, friendly email often works. Press "Review and send the email…". If you asked another way (like a contact form), press "I asked another way".' },
  { id: 'venues', title: 'Needs venue research', help: 'These list events at places we have no page for yet, so their events are not shown. Ask Copilot to research the venues (address and dance floor). Then switch the source on.' },
  { id: 'schedule', title: 'Add a weekly schedule by hand', help: 'These show a regular schedule in words (like "every Tuesday at 7 PM") with no dates a computer can read. Add it once in the editor as a repeating event, then look at their page now and then.' },
  { id: 'flyers', title: 'Add events from flyers or social posts', help: 'These only post picture flyers or social media posts. We never read text from pictures automatically. When you see a flyer, add the event by hand in the editor.' },
  { id: 'newsletter', title: 'Newsletters waiting for a first issue', help: 'We signed up for these newsletters. When a real issue arrives, check a few of its events, then switch the source on.' },
  { id: 'recheck', title: 'Try a test run', help: "Our office network could not open these websites, but GitHub's computers might. Press \"Try it now\". If the test finds events, switch the source on." },
  { id: 'developer', title: 'Needs a small program change', help: 'We need to change how we read these. Ask Copilot to do it.' },
  { id: 'seasonal', title: 'Check again in spring', help: 'Summer series and seasonal places with nothing coming up now. There is nothing to do until April.', closed: true },
  { id: 'refused', title: 'They said no', help: 'We will not list these.', closed: true },
  { id: 'noreply', title: 'Asked, no answer', help: 'We asked, but they never answered. You can ask again after a while.', closed: true },
  { id: 'other', title: 'Other switched-off sources', help: 'Set aside for now (for example, not updated lately). The monthly check keeps an eye on them.', closed: true },
];
const ACTION_GROUPS = new Set(['broken', 'granted', 'asked']);

const CADENCE: Record<string, string> = { daily: 'every morning', 'twice-weekly': 'Mondays and Thursdays', weekly: 'Sundays', monthly: 'Sundays', seasonal: 'in season', manual: 'by hand only' };
const RESULT: Record<string, string> = { ok: 'worked', empty: 'found nothing', invalid: 'found broken data', error: 'could not be read', skipped: 'skipped', never: 'not checked yet' };

/** A source emailed from the review center counts as "asked" even before its file says so. */
function effectiveGroup(s: Source, o: OutreachSummary | null): string {
  if (s.group === 'permission' && o?.sent.some((x) => x.key === `source:${s.id}`)) return 'asked';
  return s.group;
}
const newAnswers = (s: Source, o: OutreachSummary | null) => Boolean(o?.threads.some((t) => t.key === `source:${s.id}` && t.unread));
function followupIsDue(s: Source, o: OutreachSummary | null, now = Date.now()): boolean {
  const sent = o?.sent.find((x) => x.key === `source:${s.id}`);
  if (!o || !sent || sent.followups > 0 || effectiveGroup(s, o) !== 'asked') return false;
  if (o.threads.some((t) => t.key === `source:${s.id}` && t.hasReply)) return false;
  return now - Date.parse(sent.lastSentAt) >= o.rules.followupAfterDays * 86400000;
}

export function sourceTodoCount(d: SourcesData, o: OutreachSummary | null = null): number {
  const actions = d.sources.filter((s) => !s.snoozedUntil && (['broken', 'granted'].includes(effectiveGroup(s, o)) || newAnswers(s, o) || followupIsDue(s, o))).length;
  return actions + d.discovery.reduce((n, i) => n + (i.data?.newSites.length || 0), 0);
}

export function renderSources(root: HTMLElement, d: SourcesData, o: OutreachSummary | null, onCount: (n: number) => void) {
  root.replaceChildren();
  let open = sourceTodoCount(d, o);
  d = { ...d, sources: d.sources.map((s) => ({ ...s, group: effectiveGroup(s, o) })) };
  const sentFor = new Map((o?.sent || []).filter((x) => x.key.startsWith('source:')).map((x) => [x.key, x]));
  const followupDue = (id: string) => followupIsDue(d.sources.find((x) => x.id === id)!, o);
  onCount(open);
  const decided = () => onCount(Math.max(0, --open));
  const failureFor = new Map(d.failures.map((f) => [f.sourceId, f]));

  const commit = async (decision: Record<string, unknown>, card: HTMLElement, message: string) => {
    const r = await api('/api/review/sources', { decisions: [decision] });
    if (r.status !== 200) return say(errorText(r));
    settle(card, message);
    say(message);
    decided();
  };
  const run = async (body: Record<string, string>, b: HTMLButtonElement, what: string) => {
    const r = await api('/api/review/run', body);
    if (r.status !== 200) return say(errorText(r));
    b.replaceWith(el('p', `Started: ${what}. It takes 5 to 30 minutes. New events then wait under "New events".`, 'review-state review-state--ok'));
    say(`Started: ${what}.`);
  };

  function sourceCard(s: Source): HTMLLIElement {
    const li = el('li', null, 'review-card');
    li.append(el('h4', s.name));
    li.append(
      list(
        [
          s.enabled ? `Checked ${CADENCE[s.cadence] || s.cadence}` : 'Switched off',
          s.lastScraped ? `Last check ${ago(s.lastScraped)}: ${RESULT[s.lastStatus] || s.lastStatus}` : 'Not checked yet',
          s.lastCounts ? `${plural(s.lastCounts.kept, 'event')} kept` : null,
          s.permission?.requestedAt && s.group === 'asked' ? `You asked on ${dayLabel(s.permission.requestedAt)}` : null,
        ],
        'review-meta',
      ),
    );
    if (s.group === 'broken' && s.lastMessage) li.append(el('p', `What went wrong: ${s.lastMessage}`, 'review-note'));
    if (s.notes || s.permission?.note) {
      const n = details(s.enabled ? 'Notes' : 'Why it is switched off', 'review-hint');
      if (s.notes) n.body.append(el('p', s.notes, 'review-note'));
      if (s.permission?.note) n.body.append(el('p', `Permission: ${s.permission.note}`, 'review-note'));
      li.append(n.box);
    }
    const f = failureFor.get(s.id);
    li.append(list([link(s.url, 'Open their website'), f ? link(f.url, `Problem report #${f.number}`) : null, link(cmsUrl('sources', s.id), 'Edit in the editor', { external: true })], 'review-links'));

    if (!['permission', 'asked', 'noreply'].includes(s.group)) {
      const conv = conversations(`source:${s.id}`, o);
      if (conv) li.append(conv);
    }
    if (newAnswers(s, o)) li.classList.add('review-card--urgent');
    const actions = el('div', null, 'review-actions');
    const switchOn = (label = 'Switch on', confirmText = `Switch on "${s.name}"? The next check will read it.`) =>
      button(label, 'btn--secondary', async () => {
        if (!confirm(confirmText)) return;
        await commit({ id: s.id, action: 'enable' }, li, `Switched on. The next check will read it. ${LIVE}`);
      });
    const fixBody = () =>
      `The source **${s.name}** (\`src/content/sources/${s.id}.json\`, ${s.url}) ${s.group === 'broken' ? `stopped working: ${s.lastMessage || s.lastStatus}` : 'needs a change before it can be switched on'}.${f ? ` Problem report: ${f.url}.` : ''}\n\nNotes: ${s.notes || 'none'}\n\nPlease find out why and fix it (adapter settings, address or a small adapter change), with a test. Never work around a robots.txt block or a bot check. Open a pull request.`;

    switch (s.group) {
      case 'broken':
        actions.append(button('Try again now', 'btn--primary', (b) => run({ source: s.id }, b, `a new check of ${s.name}`)));
        actions.append(copilotButton('Ask Copilot to fix it', () => `Fix the source: ${s.name}`, fixBody));
        actions.append(
          button('Switch off…', 'btn--secondary', async () => {
            const why = prompt('Why switch it off? (saved in the history)', 'Stopped working');
            if (why === null) return;
            await commit({ id: s.id, action: 'disable', note: why }, li, `Switched off. ${LIVE}`);
          }),
        );
        break;
      case 'permission':
      case 'asked':
      case 'noreply': {
        const sent = sentFor.get(`source:${s.id}`);
        const conv = conversations(`source:${s.id}`, o);
        if (conv) li.append(conv);
        const answered = o?.threads.some((t) => t.key === `source:${s.id}` && t.hasReply);
        if (s.group === 'permission' && !sent) {
          actions.append(composer({ key: `source:${s.id}`, kind: 'permission', label: 'Review and send the email…', primary: true, saveContact: true, onSent: () => decided() }));
          actions.append(
            button('I asked another way', 'btn--secondary', async () => {
              const note = prompt('Who did you ask, and how? This is saved in the history, so leave out private details.', 'Asked through their contact form');
              if (note === null) return;
              await commit({ id: s.id, action: 'permission', status: 'requested', note }, li, 'Saved. It moves to "Waiting for an answer".');
            }),
          );
        } else {
          if (sent) li.append(el('p', `You emailed them on ${dayLabel(sent.lastSentAt.slice(0, 10))}${sent.followups ? ` (plus ${plural(sent.followups, 'follow-up')})` : ''}.`, 'review-hint'));
          if (followupDue(s.id)) {
            li.classList.add('review-card--urgent');
            li.append(el('p', `No answer after ${o!.rules.followupAfterDays} days. Send a short follow-up?`, 'review-state review-state--warn'));
            actions.append(composer({ key: `source:${s.id}`, kind: 'followup', label: 'Review and send a follow-up…', primary: true }));
          }
          const yes = async (enable: boolean) => {
            const note = prompt('Anything to remember? (This is saved in the history.)', 'They said yes by email');
            if (note === null) return;
            const decisions: Record<string, unknown>[] = [{ id: s.id, action: 'permission', status: 'granted', note }];
            if (enable && !s.enabled) decisions.push({ id: s.id, action: 'enable', note: 'Permission granted' });
            const r = await api('/api/review/sources', { decisions });
            if (r.status !== 200) return say(errorText(r));
            settle(li, enable ? `Saved and switched on. The next check will read it. ${LIVE}` : 'Saved. When it is ready, switch it on under "They said yes: switch it on".');
            decided();
          };
          actions.append(
            button('They said yes: switch it on', answered ? 'btn--primary' : 'btn--secondary', () => yes(true)),
            button('They sent a calendar link…', 'btn--secondary', async () => {
              const feed = prompt('Paste the calendar link they sent (an .ics link or feed address):', 'https://');
              if (!feed || !/^https?:\/\/\S+\.\S+/.test(feed)) return;
              await commit({ id: s.id, action: 'permission', status: 'granted', note: 'They sent a calendar link', feedUrl: feed.trim() }, li, 'Saved. Next, ask Copilot to set it up under "They said yes: switch it on".');
            }),
            button('They said no', 'btn--secondary', async () => {
              if (!confirm(`Save that ${s.name} said no? We won't list them or ask again.`)) return;
              await commit({ id: s.id, action: 'permission', status: 'denied', note: 'They said no' }, li, "Saved. We won't list them.");
            }),
          );
          if (s.group !== 'noreply') {
            actions.append(
              button('No answer', 'btn--secondary', async () => {
                if (!confirm('Save that they never answered? You can ask again later.')) return;
                await commit({ id: s.id, action: 'permission', status: 'no-reply', note: 'No answer' }, li, 'Saved. It moves to "Asked, no answer".');
              }),
            );
          } else actions.append(composer({ key: `source:${s.id}`, kind: 'permission', label: 'Ask again by email…', saveContact: true }));
        }
        break;
      }      case 'granted':
        actions.append(switchOn('Switch on'));
        actions.append(copilotButton('Ask Copilot to set it up', () => `Set up the source: ${s.name}`, () => `${s.name} said we may list their events (\`src/content/sources/${s.id}.json\`). Permission note: ${s.permission?.note || 'none'}.\n\nPlease set the source up (use their calendar link if they sent one), test it, switch it on and open a pull request.`));
        break;
      case 'venues':
        actions.append(
          copilotButton(
            'Ask Copilot to research the venues',
            () => `Research the venues for the source: ${s.name}`,
            () => `The source **${s.name}** (\`src/content/sources/${s.id}.json\`, ${s.url}) is switched off because its events are at places we have no venue file for.\n\nNotes: ${s.notes}\n\nPlease add the venue files in src/content/venues/ (address and dance-floor research; see docs/how-weekly-updates-work.md), run a test collection for this source, switch it on and open a pull request.`,
          ),
        );
        actions.append(switchOn('Switch on (venues are done)'));
        break;
      case 'schedule':
      case 'flyers':
        actions.append(link(cmsUrl('events'), 'Add an event in the editor', { cls: 'btn btn--small btn--primary' }));
        if (s.group === 'schedule') actions.append(copilotButton('Ask Copilot to add the schedule', () => `Add the weekly schedule of ${s.name} as repeating events`, () => `${s.name} (${s.url}) shows a regular schedule in words, with no dates we can read automatically (\`src/content/sources/${s.id}.json\`).\n\nNotes: ${s.notes}\n\nPlease read their page and add each regular event once as a repeating event in src/content/events/ (in our own words, with the venue, styles and price, and "status" in lockedFields). Open a pull request.`));
        break;
      case 'newsletter':
        actions.append(switchOn('Switch on (a real issue arrived)', 'Did a real newsletter issue arrive, and do a few of its events look right? If yes, press OK to switch it on.'));
        break;
      case 'recheck':
        actions.append(button('Try it now', 'btn--primary', (b) => run({ source: s.id }, b, `a test of ${s.name}`)));
        actions.append(switchOn());
        break;
      case 'developer':
        actions.append(copilotButton('Ask Copilot to do it', () => `Change how we read the source: ${s.name}`, fixBody));
        break;
      default:
        actions.append(switchOn());
    }
    if (!s.enabled && !['seasonal', 'refused', 'other'].includes(s.group)) {
      actions.append(
        button('Snooze a month', 'btn--secondary', async () => {
          const r = await api('/api/review/snooze', { kind: 'source', id: s.id, days: 30 });
          if (r.status !== 200) return say(errorText(r));
          settle(li, 'Snoozed for a month.');
          if (ACTION_GROUPS.has(s.group)) decided();
        }),
      );
    }
    li.append(actions);
    return li;
  }

  /* ---- run collection now ---- */
  const runBox = el('section', null, 'review-card');
  runBox.append(el('h3', 'Check sources now'));
  runBox.append(el('p', 'Checks run by themselves every day. Use these buttons only if you want new events sooner. They then wait under "New events".', 'review-hint'));
  const runRow = el('div', null, 'review-actions');
  runRow.append(
    button('Check the daily sources', 'btn--secondary', (b) => run({ cadence: 'daily' }, b, 'the daily sources')),
    button('Check the Monday and Thursday sources', 'btn--secondary', (b) => run({ cadence: 'twice-weekly' }, b, 'the Monday and Thursday sources')),
    button('Check the Sunday sources', 'btn--secondary', (b) => run({ cadence: 'weekly' }, b, 'the Sunday sources')),
  );
  runBox.append(runRow);
  if (d.runs.length) {
    const recent = details(`Recent checks (${d.runs.length})`, 'review-hint');
    recent.body.append(
      list(
        d.runs.slice(0, 10).map((r) => {
          const span = el('span');
          const result = r.status !== 'completed' ? 'running now' : r.conclusion === 'success' ? 'worked' : `did not finish (${r.conclusion})`;
          span.append(`${dateTimeLabel(r.createdAt)}: ${r.event === 'schedule' ? 'ran on schedule' : 'started by hand'}, ${result}. `, link(r.url, 'Details'));
          return span;
        }),
        'review-log',
      ),
    );
    runBox.append(recent.box);
  }

  /* ---- monthly source check (new websites) ---- */
  const discovery = d.discovery.filter((i) => i.data);
  let newSitesSection: HTMLElement | null = null;
  const newSites = discovery.flatMap((i) => i.data!.newSites.map((s) => ({ ...s, issue: i.number })));
  if (newSites.length) {
    const sec = el('section', null, 'review-sub');
    sec.append(el('h3', `New websites found (${newSites.length})`));
    sec.append(el('p', 'The monthly search found these websites. Open each one. If it lists several upcoming dances or live music on Long Island, press "Worth adding". Copilot will then check it and add it. If not, press "Not useful", and we won\'t show it again.', 'review-hint'));
    const ul = el('ul', null, 'review-grid');
    for (const site of newSites) {
      const li = el('li', null, 'review-card');
      li.append(el('h4', site.domain));
      if (site.title) li.append(el('p', site.title, 'review-hint'));
      li.append(list([link(site.url, 'Open the page'), site.queries?.length ? `Found by searching: ${site.queries.slice(0, 2).join('; ')}` : null], 'review-links'));
      const row = el('div', null, 'review-actions');
      const decide = async (action: 'copilot' | 'reject', note = '') => {
        const r = await api('/api/review/candidate', { issue: site.issue, domain: site.domain, url: site.url, action, note });
        if (r.status !== 200) return say(errorText(r));
        settle(li, action === 'copilot' ? 'Copilot has a task to check and add it.' : 'Saved. It will not be suggested again.', r.data.issue ? [link(r.data.issue.url, 'Open the Copilot task')] : []);
        decided();
      };
      row.append(
        button('Worth adding', 'btn--primary', () => decide('copilot')),
        button('Not useful', 'btn--secondary', async () => {
          const why = prompt('Why not? (optional, saved in the history)', '');
          if (why === null) return;
          await decide('reject', why);
        }),
      );
      li.append(row);
      ul.append(li);
    }
    sec.append(ul);
    const reports = el('p', null, 'review-hint');
    reports.append('Full monthly reports: ');
    discovery.forEach((i, n) => {
      if (n) reports.append(', ');
      reports.append(link(i.url, i.title));
    });
    sec.append(reports);
    newSitesSection = sec;
  }

  /* ---- groups ---- */
  const visible = d.sources.filter((s) => s.group !== 'on' && !s.snoozedUntil);
  if (!visible.some((s) => ACTION_GROUPS.has(s.group)) && !newSites.length) root.append(emptyState('All switched-on sources are working, and nothing waits for an answer.'));
  for (const g of GROUPS) {
    if (g.id !== 'broken' && newSitesSection) {
      root.append(newSitesSection);
      newSitesSection = null;
    }
    const items = visible.filter((s) => s.group === g.id);
    if (!items.length) continue;
    const ul = el('ul', null, 'review-grid');
    for (const s of items) ul.append(sourceCard(s));
    if (g.closed || !ACTION_GROUPS.has(g.id)) {
      const box = details(`${g.title} (${items.length})`, 'review-details panel');
      box.body.append(el('p', g.help, 'review-hint'), ul);
      root.append(box.box);
    } else {
      const sec = el('section', null, 'review-sub');
      sec.append(el('h3', `${g.title} (${items.length})`), el('p', g.help, 'review-hint'), ul);
      root.append(sec);
    }
  }
  const leftover = d.failures.filter((f) => !d.sources.some((s) => s.id === f.sourceId && s.group === 'broken'));
  if (leftover.length) {
    const box = details(`Problem reports still open (${leftover.length})`, 'review-details panel');
    box.body.append(el('p', 'A report closes by itself when its source works again. Close the rest on GitHub when they are no longer needed.', 'review-hint'));
    box.body.append(list(leftover.map((f) => link(f.url, `#${f.number}: ${f.title}`)), 'review-log'));
    root.append(box.box);
  }
  const snoozed = d.sources.filter((s) => s.snoozedUntil);
  if (snoozed.length) {
    const box = details(`Snoozed (${snoozed.length})`, 'review-details panel');
    box.body.append(list(snoozed.map((s) => `${s.name}: until ${dayLabel(s.snoozedUntil.slice(0, 10))}`), 'review-log'));
    root.append(box.box);
  }
  root.append(runBox);

  /* ---- working sources ---- */
  const on = d.sources.filter((s) => s.group === 'on');
  const table = details(`Working sources (${on.length})`, 'review-details panel');
  const wrap = el('div', null, 'review-table-wrap');
  const t = el('table', null, 'review-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Source', 'Checked', 'Last check', 'Events kept']) {
    const th = el('th', h);
    th.scope = 'col';
    if (h === 'Events kept') th.className = 'num';
    hr.append(th);
  }
  thead.append(hr);
  const tbody = el('tbody');
  for (const s of on) {
    const tr = el('tr');
    const th = el('th');
    th.scope = 'row';
    th.append(link(s.url, s.name));
    tr.append(th, el('td', CADENCE[s.cadence] || s.cadence), el('td', s.lastScraped ? `${ago(s.lastScraped)}, ${RESULT[s.lastStatus] || s.lastStatus}` : 'not yet'), el('td', s.lastCounts ? String(s.lastCounts.kept) : '', 'num'));
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.append(t);
  table.body.append(wrap);
  root.append(table.box);
}
