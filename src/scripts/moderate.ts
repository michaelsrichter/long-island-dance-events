/** Moderation page: lists the queue and sends decisions. All user text is inserted with textContent. */
export {};
const root = document.querySelector<HTMLElement>('[data-moderate]');

type Item = {
  queueId: string;
  itemType: 'comment' | 'correction' | 'photo';
  key: string;
  itemId: string;
  reason: string;
  ai: Record<string, number> | null;
  at: string;
  status: string;
  text?: string;
  caption?: string;
  alt?: string;
  preview?: string;
  githubIssue?: string;
  date: string;
  user: { id: string; name: string; status: string; approved: number; rejected: number };
  flags: { reason: string; note: string }[];
};

const REASONS: Record<string, string> = {
  ai_gray: 'The AI was not sure',
  ai_unavailable: 'The AI check was not available',
  photo: 'Every photo needs a person',
  correction: 'Private correction for editors',
  rule_link: 'Has a link',
  rule_email: 'Has an email address',
  rule_phone: 'Has a phone number',
  rule_shouting: 'Mostly capital letters',
  rule_repeated: 'Repeated characters',
};

async function api(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

let pageUrls: Record<string, string> = {};
async function loadPageUrls() {
  try {
    const r = await fetch('/community-pages.json');
    if (r.ok) pageUrls = (await r.json()).urls || {};
  } catch {
    pageUrls = {};
  }
}

if (root) {
  const list = root.querySelector<HTMLOListElement>('[data-mod-list]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const say = (t: string) => (status.textContent = t);

  const button = (label: string, cls: string, onClick: () => void) => {
    const b = el('button', label, `btn btn--small ${cls}`);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  function card(it: Item): HTMLLIElement {
    const li = el('li', undefined, 'panel moderate__item');
    const isCorrection = it.itemType === 'correction';
    const head = el('p', undefined, 'moderate__meta');
    const kind = it.itemType === 'photo' ? 'Photo' : isCorrection ? 'Correction' : 'Note';
    head.append(el('strong', `${kind}`), document.createTextNode(` · ${REASONS[it.reason] || it.reason.replace(/^reports:/, 'Reported: ')} · ${new Date(it.at).toLocaleString()}`));
    li.appendChild(head);
    const page = el('p');
    const url = pageUrls[it.key];
    if (url) {
      const a = el('a', it.key);
      a.href = url;
      page.append(document.createTextNode('Page: '), a);
    } else page.textContent = `Page: ${it.key}`;
    if (it.date) page.append(document.createTextNode(` · about the ${it.date} event`));
    li.appendChild(page);
    if (it.itemType === 'photo' && it.preview) {
      const img = el('img', undefined, 'moderate__photo');
      img.src = it.preview;
      img.alt = it.alt || 'Photo waiting for review';
      img.loading = 'lazy';
      li.append(img, el('p', `Description: ${it.alt || '(none)'}`), ...(it.caption ? [el('p', `Caption: ${it.caption}`)] : []));
    } else {
      const quote = el('blockquote', it.text || '', 'moderate__text');
      li.appendChild(quote);
    }
    if (it.githubIssue) {
      const a = el('a', 'GitHub issue');
      a.href = it.githubIssue;
      a.rel = 'noopener';
      li.appendChild(el('p')).appendChild(a);
    }
    if (it.ai) li.appendChild(el('p', `AI scores (0 safe, 2 unsure, 4+ harmful): ${Object.entries(it.ai).map(([k, v]) => `${k} ${v}`).join(', ')}`, 'muted'));
    if (it.flags.length) li.appendChild(el('p', `Reports: ${it.flags.map((f) => f.reason + (f.note ? ` ("${f.note}")` : '')).join('; ')}`, 'muted'));
    li.appendChild(el('p', `By ${it.user.name || 'unknown'} · ${it.user.status} · ${it.user.approved} approved, ${it.user.rejected} rejected before`, 'muted'));

    const reasonId = `why-${it.queueId.replace(/[^A-Za-z0-9_-]/g, '')}`;
    const field = el('div', undefined, 'field');
    const lab = el('label', 'Reason (optional, kept in the log)');
    lab.htmlFor = reasonId;
    const reason = el('input');
    reason.id = reasonId;
    reason.type = 'text';
    reason.maxLength = 200;
    field.append(lab, reason);
    li.appendChild(field);

    const decide = async (decision: string) => {
      const r = await api('/api/admin/decide', { key: it.key, itemType: it.itemType, itemId: it.itemId, decision, reason: reason.value });
      if (r.status === 200) {
        say(`${kind} ${r.data.status}.`);
        li.remove();
      } else say(r.data?.message || 'Could not save that decision.');
    };
    const row = el('p', undefined, 'btn-row');
    if (isCorrection) row.append(button('Done', 'btn--primary', () => decide('resolve')));
    else {
      if (it.status !== 'published') row.append(button('Approve', 'btn--primary', () => decide('approve')));
      row.append(button('Reject', 'btn--secondary', () => decide('reject')));
      if (it.status === 'published') row.append(button('Hide', 'btn--secondary', () => decide('hide')));
    }
    row.append(
      button('Ban this person…', 'btn--secondary', async () => {
        const days = prompt('Ban for how many days? (0 = for good)', '30');
        if (days === null) return;
        const why = prompt('Why? (kept in the log)', reason.value || 'Broke the community rules') || '';
        const removeContent = confirm('Also hide everything this person has posted?');
        const r = await api('/api/admin/ban', { userId: it.user.id, days: Number(days) || 0, reason: why, removeContent });
        say(r.status === 200 ? `Banned. ${r.data.hidden} posts hidden.` : r.data?.message || 'Could not ban.');
        if (r.status === 200) load();
      }),
    );
    li.appendChild(row);
    return li;
  }

  async function load() {
    say('Loading…');
    const r = await api('/api/admin/queue');
    const tools = root!.querySelector<HTMLElement>('[data-mod-tools]')!;
    const signin = root!.querySelector<HTMLElement>('[data-mod-signin]')!;
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      signin.hidden = false;
      tools.hidden = true;
      say('');
      return;
    }
    signin.hidden = true;
    tools.hidden = false;
    const items: Item[] = r.data?.items || [];
    list.replaceChildren(...items.map(card));
    say(items.length ? `${items.length} waiting.` : 'Nothing is waiting. Nice!');
  }

  root.querySelector('[data-mod-refresh]')!.addEventListener('click', load);
  root.querySelector('[data-mod-log]')!.addEventListener('click', async () => {
    const panel = root.querySelector<HTMLElement>('[data-mod-log-panel]')!;
    const ol = root.querySelector<HTMLOListElement>('[data-mod-log-list]')!;
    const r = await api('/api/admin/log');
    ol.replaceChildren(
      ...((r.data?.entries || []) as any[]).map((e) => el('li', `${new Date(e.at).toLocaleString()} · ${e.actor} · ${e.action} ${e.targetType} ${e.key || ''} ${e.reason ? `· ${e.reason}` : ''}`)),
    );
    panel.hidden = false;
  });

  loadPageUrls().then(load);
}
