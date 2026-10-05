/** Review center (/moderate/): loads each section from /api/review/*, builds the To do tab, handles tabs and setup. */
import { loginUrl } from '../account-state';
import { ago, api, button, dateTimeLabel, dayLabel, el, emptyState, errorText, link, list, plural, say, setStatusElement, type ApiResult } from './core';
import { renderListings, type ListingsData } from './listings';
import { newEventCount, renderCollected, type Collected } from './publish';
import { renderSources, sourceTodoCount, type SourcesData } from './sources';
import type { OutreachSummary } from './compose';
import { messageTodoCount, renderMessages, type MessagesData } from './messages';

type GitHubStatus = { connected: boolean; installed: boolean; canSetUp: boolean; slug?: string; installUrl?: string };
type Status = { github: GitHubStatus; posts: { count: number; oldest: string }; today: string; you: string };

const root = document.querySelector<HTMLElement>('[data-review]');
const TABS = ['todo', 'listings', 'publish', 'sources', 'messages', 'posts', 'log'] as const;
type Tab = (typeof TABS)[number];

const counts: Partial<Record<Tab, number>> = {};
const loaded: { status?: Status; listings?: ListingsData | Error; collected?: Collected | Error; sources?: SourcesData | Error; messages?: MessagesData | Error; outreach?: OutreachSummary | null } = {};

function q<T extends HTMLElement>(sel: string): T {
  return root!.querySelector<T>(sel)!;
}

function setCount(tab: Tab, n: number) {
  counts[tab] = n;
  const badge = q<HTMLElement>(`[data-count="${tab}"]`);
  badge.textContent = n > 0 ? String(n) : '';
  badge.setAttribute('aria-label', n > 0 ? `${n} waiting` : '');
  const total = (['listings', 'publish', 'sources', 'messages', 'posts'] as Tab[]).reduce((s, t) => s + (counts[t] || 0), 0);
  const todo = q<HTMLElement>('[data-count="todo"]');
  todo.textContent = total > 0 ? String(total) : '';
  todo.setAttribute('aria-label', total > 0 ? `${total} waiting` : '');
  renderTodo();
}

/* ---------- tabs ---------- */

function current(): Tab {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.includes(h) ? h : 'todo';
}
function showTab(focus = false) {
  const tab = current();
  for (const t of TABS) {
    q<HTMLElement>(`[data-panel="${t}"]`).hidden = t !== tab;
    const a = q<HTMLAnchorElement>(`[data-tab="${t}"]`);
    if (t === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (tab === 'log') loadLog();
  if (focus) q<HTMLElement>(`#${tab}-h`).focus();
}

/* ---------- one-time setup ---------- */

async function connectGitHub() {
  const r = await api('/api/review/github/start', {});
  if (r.status !== 200) return say(errorText(r));
  const form = el('form');
  form.method = 'post';
  form.action = r.data.action;
  form.hidden = true;
  const input = el('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = JSON.stringify(r.data.manifest);
  form.append(input);
  document.body.append(form);
  form.submit();
}

function renderSetup(gh: GitHubStatus) {
  const box = q<HTMLElement>('[data-setup]');
  box.replaceChildren();
  const params = new URLSearchParams(location.search);
  const back = params.get('github');
  if (back) history.replaceState(null, '', location.pathname + location.hash);
  if (gh.connected && gh.installed) {
    if (back === 'installed') say('GitHub is connected. You are all set.');
    return;
  }
  const card = el('section', null, 'review-card review-card--urgent');
  if (back === 'failed') card.append(el('p', `Setup did not finish (${params.get('reason') || 'unknown reason'}). Please try again.`, 'review-state review-state--bad'));
  if (!gh.connected) {
    card.append(el('h3', 'One-time setup: connect to GitHub'));
    card.append(el('p', 'Your choices here update the website through GitHub, where the listings are stored. For that, GitHub needs a small helper app that can only work on this website. You set it up once. It takes about a minute.'));
    const steps = el('ol', null, 'review-steps');
    for (const s of [
      'Make sure you are signed in to GitHub as michaelsrichter (the account that owns the website).',
      'Press "Connect to GitHub" below. GitHub opens a page called "Create GitHub App". Press the green "Create GitHub App" button at the bottom.',
      'GitHub then asks where to install it. Choose "Only select repositories" (a repository is a project on GitHub), pick "long-island-dance-events", and press "Install".',
      'GitHub sends you back here. You are done.',
    ])
      steps.append(el('li', s));
    card.append(steps);
    if (gh.canSetUp) {
      const row = el('div', null, 'review-actions');
      row.append(button('Connect to GitHub', 'btn--primary', connectGitHub));
      card.append(row);
    } else card.append(el('p', "You can't set this up yet. A setting called REVIEW_SECRET_KEY is missing in Azure (the service that runs the website). Ask a developer to add it (see docs/deployment.md).", 'review-state review-state--bad'));
  } else {
    card.append(el('h3', 'Last step: install the GitHub helper app'));
    card.append(el('p', 'The helper app is ready, but it is not installed on the website yet. Press the button below. Choose "Only select repositories", pick "long-island-dance-events", and press "Install".'));
    const row = el('div', null, 'review-actions');
    if (gh.installUrl) row.append(link(gh.installUrl, 'Install the app on GitHub', { external: false, cls: 'btn btn--small btn--primary' }));
    row.append(button('Start over', 'btn--secondary', connectGitHub));
    card.append(row);
  }
  box.append(card);
}

/* ---------- To do ---------- */

function todoCard(title: string, big: string, lines: (string | Node | null)[], go: Tab, goLabel: string, urgent = false, extra: Node[] = []) {
  const c = el('section', null, `review-card${urgent ? ' review-card--urgent' : ''}`);
  c.append(el('h3', title), el('p', big, 'review-card__big'));
  const ls = lines.filter(Boolean) as (string | Node)[];
  if (ls.length) c.append(list(ls, 'review-meta'));
  const row = el('div', null, 'review-actions');
  row.append(link(`#${go}`, goLabel, { external: false, cls: 'btn btn--small btn--primary' }), ...extra);
  c.append(row);
  return c;
}

function renderTodo() {
  const box = q<HTMLElement>('[data-todo]');
  if (!loaded.status) return;
  const cards: HTMLElement[] = [];
  let waiting = 0;
  let pending = 0;
  const failed: string[] = [];

  const c = loaded.collected;
  if (c instanceof Error) failed.push('new events');
  else if (!c) pending++;
  else if (c.open) {
    waiting++;
    const n = newEventCount(c);
    const checks = c.open.checks === 'passed' ? 'Checks passed: ready to publish.' : c.open.checks === 'failed' ? 'Checks found a problem.' : 'Checks are still running.';
    cards.push(todoCard('New events to publish', String(n), [`${plural(n, 'new event')} and other changes from the latest check.`, checks, `Updated ${ago(c.open.updatedAt)}.`], 'publish', c.open.checks === 'passed' ? 'Review and publish' : 'See details', c.open.checks === 'failed'));
  }

  const l = loaded.listings;
  if (l instanceof Error) failed.push('held listings');
  else if (!l) pending++;
  else {
    const open = l.listings.filter((x) => !x.ended && !x.snoozedUntil);
    const n = counts.listings ?? open.length;
    if (n > 0) {
      waiting++;
      const oldest = open.map((x) => x.firstSeen).sort()[0];
      cards.push(todoCard('Held listings', String(n), ['Hidden until you check them.', oldest ? `Oldest waiting since ${dayLabel(oldest)}.` : null], 'listings', 'Start checking'));
    }
  }

  const m = loaded.messages;
  if (m instanceof Error) failed.push('messages');
  else if (!m) pending++;
  else {
    const n = counts.messages ?? messageTodoCount(m);
    if (n > 0) {
      waiting++;
      const urgent = m.messages.filter((x) => x.kind === 'remove-listing' && !x.snoozedUntil);
      const soonest = urgent.map((x) => x.dueInDays ?? 7).sort((a, b) => a - b)[0];
      cards.push(todoCard('Messages from visitors', String(n), [urgent.length ? `${plural(urgent.length, 'request')} to remove a listing: ${soonest !== undefined && soonest <= 0 ? 'overdue' : `${plural(soonest ?? 7, 'day')} left`}.` : null], 'messages', 'Answer them', urgent.length > 0));
    }
  }

  const posts = counts.posts ?? loaded.status.posts.count;
  if (posts > 0) {
    waiting++;
    cards.push(todoCard('Community posts', String(posts), [loaded.status.posts.oldest ? `Oldest waiting since ${dateTimeLabel(loaded.status.posts.oldest)}.` : null], 'posts', 'Check the posts'));
  }

  const s = loaded.sources;
  if (s instanceof Error) failed.push('sources');
  else if (!s) pending++;
  else {
    const n = counts.sources ?? sourceTodoCount(s, loaded.outreach ?? null);
    const answers = (loaded.outreach?.threads || []).filter((t) => t.unread && t.key.startsWith('source:')).length;
    const broken = s.sources.filter((x) => x.group === 'broken' && !x.snoozedUntil).length;
    const asked = s.sources.filter((x) => (x.group === 'asked' || x.group === 'granted') && !x.snoozedUntil).length;
    const sites = s.discovery.reduce((k, i) => k + (i.data?.newSites.length || 0), 0);
    const optional = s.sources.filter((x) => ['permission', 'venues', 'schedule', 'recheck'].includes(x.group) && !x.snoozedUntil).length;
    if (n > 0) {
      waiting++;
      cards.push(todoCard('Sources', String(n), [answers ? `${plural(answers, 'new answer')} to your permission emails.` : null, broken ? `${plural(broken, 'source')} stopped working.` : null, asked ? `${plural(asked, 'permission request')} to follow up.` : null, sites ? `${plural(sites, 'new website')} found.` : null], 'sources', 'Open sources', broken > 0 || answers > 0));
    } else if (optional) {
      const extra = el('section', null, 'review-card');
      extra.append(el('h3', 'When you have time'), el('p', `${plural(optional, 'switched-off source')} could add more events if someone asks for permission, looks up venues, or adds a schedule. Nothing urgent.`));
      const row = el('div', null, 'review-actions');
      row.append(link('#sources', 'See what you could do', { external: false, cls: 'btn btn--small btn--secondary' }));
      extra.append(row);
      cards.push(extra);
    }
  }

  const gh = loaded.status.github;
  if (!pending && !waiting && !failed.length && gh.connected && gh.installed) {
    const done = emptyState("You're all caught up. Nothing needs you right now.");
    done.append(el('p', 'The next check runs tomorrow morning. You get an email on Sundays.', 'review-hint'));
    cards.unshift(done);
  }
  if (failed.length) cards.push(el('p', `Could not load: ${failed.join(', ')}. Refresh the page to try again.`, 'review-state review-state--bad'));
  if (pending) cards.push(el('p', 'Still checking…', 'spinner'));
  box.replaceChildren(...cards);
}

/* ---------- sections ---------- */

function failedPanel(panel: HTMLElement, r: ApiResult) {
  panel.replaceChildren(
    el('p', r.status === 428 ? 'Connect the review center to GitHub first (see the To do tab). Then this section will fill in.' : errorText(r, 'Could not load this section. Refresh the page to try again.'), r.status === 428 ? 'alert alert--info' : 'alert alert--warn'),
  );
}

async function loadListings() {
  const panel = q<HTMLElement>('[data-listings]');
  const r = await api<ListingsData>('/api/review/listings');
  if (r.status !== 200) {
    // 428 = GitHub is not connected yet; the setup card on the To do tab covers that.
    loaded.listings = r.status === 428 ? { sha: '', today: '', listings: [], venueIds: [], performerIds: [] } : new Error(String(r.status));
    failedPanel(panel, r);
    return renderTodo();
  }
  loaded.listings = r.data;
  await renderListings(panel, r.data, (n) => setCount('listings', n));
  renderTodo();
}

async function loadCollected() {
  const panel = q<HTMLElement>('[data-publish]');
  const r = await api<Collected>('/api/review/collected');
  if (r.status !== 200) {
    loaded.collected = new Error(String(r.status));
    failedPanel(panel, r);
    return renderTodo();
  }
  loaded.collected = r.data;
  setCount('publish', r.data.open ? 1 : 0);
  renderCollected(panel, r.data, () => {
    setCount('publish', 0);
    loaded.collected = { open: null, last: null };
    window.setTimeout(loadListings, 3000);
  });
}

async function loadSources() {
  const panel = q<HTMLElement>('[data-sources]');
  const [r, o] = await Promise.all([api<SourcesData>('/api/review/sources'), api<OutreachSummary>('/api/review/outreach')]);
  loaded.outreach = o.status === 200 && Array.isArray(o.data?.threads) && Array.isArray(o.data?.sent) ? o.data : null;
  if (r.status !== 200) {
    loaded.sources = r.status === 428 ? { today: '', sources: [], failures: [], discovery: [], runs: [] } : new Error(String(r.status));
    failedPanel(panel, r);
    return renderTodo();
  }
  loaded.sources = r.data;
  renderSources(panel, r.data, loaded.outreach ?? null, (n) => setCount('sources', n));
}

async function loadMessages() {
  const panel = q<HTMLElement>('[data-messages]');
  const r = await api<MessagesData>('/api/review/messages');
  if (r.status !== 200) {
    loaded.messages = new Error(String(r.status));
    failedPanel(panel, r);
    return renderTodo();
  }
  loaded.messages = r.data;
  await renderMessages(panel, r.data, (n) => setCount('messages', n));
}

/* ---------- log ---------- */

const ACTIONS: Record<string, string> = {
  'listing.publish': 'Published a listing',
  'listing.fix': 'Fixed and published a listing',
  'listing.cancel': 'Marked a listing cancelled',
  'listing.hide': 'Hid a listing',
  'listing.undo': 'Undid a listing decision',
  'listing.snooze': 'Snoozed a listing',
  'listing.unsnooze': 'Brought back a listing',
  'collected.publish': 'Published new events',
  'source.enable': 'Switched a source on',
  'source.disable': 'Switched a source off',
  'source.permission': 'Updated a permission request',
  'source.snooze': 'Snoozed a source',
  run: 'Started a source check',
  'candidate.reject': 'Said no to a new website',
  'candidate.copilot': 'Asked Copilot to add a website',
  'message.reply': 'Replied to a message',
  'message.close': 'Closed a message',
  'message.snooze': 'Snoozed a message',
  'copilot.ask': 'Asked Copilot',
  'outreach.permission': 'Emailed a website for permission',
  'outreach.followup': 'Sent a follow-up email',
  'outreach.correction': 'Emailed an organizer about a listing',
  'outreach.test': 'Sent a test email to the site inbox',
  'outreach.dryrun': 'Tried an email on a test copy (not sent)',
  'github.connect': 'Connected GitHub',
  approve: 'Approved a post',
  reject: 'Rejected a post',
  hide: 'Hid a post',
  resolve: 'Finished a correction',
  ban: 'Banned someone',
  unban: 'Ended a ban',
};

let logMonth = '';
async function loadLog() {
  const box = q<HTMLElement>('[data-log]');
  if (!box.firstChild) {
    const select = el('select');
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const v = d.toISOString().slice(0, 7);
      select.append(new Option(d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), v));
    }
    select.addEventListener('change', () => {
      logMonth = select.value;
      loadLog();
    });
    const wrap = el('div', null, 'field');
    const lab = el('label', 'Month');
    select.id = 'review-log-month';
    lab.htmlFor = select.id;
    wrap.append(lab, select);
    box.append(wrap, el('ol', null, 'review-log'));
    logMonth = select.value;
  }
  const ol = box.querySelector('ol')!;
  const r = await api(`/api/review/log?month=${encodeURIComponent(logMonth)}`);
  if (r.status !== 200) return ol.replaceChildren(el('li', errorText(r)));
  const entries = (r.data.entries || []) as { at: string; actor: string; action: string; targetType: string; targetId: string; key: string; reason: string }[];
  if (!entries.length) return ol.replaceChildren(el('li', 'Nothing this month.'));
  ol.replaceChildren(
    ...entries.map((e) => {
      const li = el('li');
      li.append(el('strong', `${dateTimeLabel(e.at)}: ${ACTIONS[e.action] || e.action}`));
      li.append(` (${[e.targetId || e.key, e.reason].filter(Boolean).join(' · ')}) by ${e.actor.replace(/^admin:/, '').replace(/@.*/, '')}`);
      return li;
    }),
  );
}

/* ---------- start ---------- */

async function init() {
  setStatusElement(q('[data-review-status]'));
  const r = await api<Status>('/api/review/status');
  q<HTMLElement>('[data-review-loading]').hidden = true;
  if (r.status === 401 || r.status === 404) {
    q<HTMLAnchorElement>('[data-review-signin-link]').href = loginUrl('/moderate/');
    q<HTMLElement>('[data-review-signin]').hidden = false;
    return;
  }
  if (r.status === 403) {
    q<HTMLElement>('[data-review-notadmin]').hidden = false;
    return;
  }
  q<HTMLElement>('[data-review-app]').hidden = false;
  if (r.status !== 200) {
    q<HTMLElement>('[data-todo]').replaceChildren(el('p', errorText(r, 'Could not load the review center. Refresh the page to try again.'), 'alert alert--warn'));
    return;
  }
  loaded.status = r.data;
  renderSetup(r.data.github);
  setCount('posts', r.data.posts.count);
  window.addEventListener('review:posts', (e) => setCount('posts', Number((e as CustomEvent).detail) || 0));
  showTab();
  window.addEventListener('hashchange', () => showTab(true));
  renderTodo();
  await Promise.all([loadCollected(), loadListings(), loadSources(), loadMessages()]);
  renderTodo();
}

if (root) init();
