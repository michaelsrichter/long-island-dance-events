/** Messages from visitors (GitHub issues from the website's forms), with reply-and-close. */
import { ago, api, button, cmsUrl, dateTimeLabel, details, el, emptyState, errorText, field, link, list, plural, say, settle, sitePages, type Pages } from './core';
import { composer } from './compose';

export type Message = {
  number: number;
  title: string;
  kind: string;
  labels: string[];
  author: string;
  createdAt: string;
  ageDays: number;
  dueInDays: number | null;
  comments: number;
  url: string;
  body: string;
  sections: Record<string, string>;
  page: string;
  snoozedUntil: string;
};
export type MessagesData = { messages: Message[]; copilotTasks: { number: number; title: string; url: string; createdAt: string; assigned: boolean }[] };

const KIND: Record<string, { label: string; help: string; replies: { label: string; text: string; reason?: 'not_planned' }[] }> = {
  'remove-listing': {
    label: 'Remove a listing (answer within 7 days)',
    help: 'Check that the person speaks for the organizer, venue, band or DJ (you can ask a simple question). To stop all their events: open the organizer in the editor and turn on "Opted out". To remove one listing: hide it. Then reply and close.',
    replies: [
      { label: 'Done', text: "Done. We've removed it, and we won't list it again. Sorry for the trouble, and thank you for letting us know." },
      { label: 'Need to confirm', text: 'Thanks for writing. Before we remove it, can you confirm you speak for the organizer, venue, band or DJ? For example, reply from their official account, or tell us something only they would know. Please leave out private details here, since this page is public.' },
    ],
  },
  'listing-correction': {
    label: 'Fix for a listing',
    help: 'Check the facts on the organizer\'s own website. Fix the event in the editor and add the field you changed to "Locked fields" (so the weekly check won\'t change it back). Then reply and close.',
    replies: [
      { label: 'Fixed', text: 'Thank you! We fixed the listing. The change will show on the website in about 10 minutes.' },
      { label: 'Already right', text: "Thanks for writing! We checked, and the listing matches the organizer's own page, so we left it as it is. If the organizer changes it, please let us know.", reason: 'not_planned' },
    ],
  },
  'add-listing': {
    label: 'New event to add',
    help: 'Check that it is a real event in Nassau or Suffolk. Add it in the editor (Events, New Event), or ask Copilot to add their calendar as a source so new dates show up by themselves.',
    replies: [
      { label: 'Added', text: "Thank you! We added it. It will be on the website in about 10 minutes." },
      { label: 'Added their calendar', text: "Thank you! We added their calendar, so new dates will show up on the website by themselves each week." },
      { label: 'Outside our area', text: "Thanks for the tip! This one is outside Nassau and Suffolk counties, so it's outside the area we cover.", reason: 'not_planned' },
    ],
  },
  bug: {
    label: 'Problem with the website',
    help: 'Try it yourself. If you can see the problem, ask Copilot to fix it.',
    replies: [{ label: 'Fixed', text: 'Thanks for telling us! We fixed it.' }, { label: "Couldn't see it", text: "Thanks for telling us! We tried, but couldn't see the problem. If it happens again, please tell us which page and what device you were using.", reason: 'not_planned' }],
  },
  enhancement: {
    label: 'Idea for the website',
    help: 'Decide if you like it. If yes, ask Copilot to build it. If not, thank them and close it.',
    replies: [{ label: 'Thanks, added', text: "Thanks for the idea! We've added it to our list." }, { label: 'Thanks, not now', text: "Thanks for the idea! We're not going to do this one right now, but we appreciate you sharing it.", reason: 'not_planned' }],
  },
  other: {
    label: 'Other message',
    help: 'Read it and decide. Reply on GitHub if you need more room.',
    replies: [{ label: 'Thanks', text: 'Thank you for writing!' }],
  },
};

/** Map a page address on our site to its entry in the editor. */
function editorLink(page: string, pages: Pages): HTMLAnchorElement | null {
  let path = '';
  try {
    path = new URL(page).pathname;
  } catch {
    return null;
  }
  const m = /^\/(venues|organizers|instructors|performers|styles)\/([a-z0-9-]+)\/?$/.exec(path);
  if (m) return link(cmsUrl(m[1]!, m[2]!), 'Open it in the editor', { external: true });
  if (/^\/events\//.test(path)) {
    const key = Object.keys(pages.urls).find((k) => k.startsWith('event:') && pages.urls[k]!.replace(/\/?$/, '/') === path.replace(/\/?$/, '/'));
    if (key) return link(cmsUrl('events', key.slice(6)), 'Open the event in the editor', { external: true });
    const slug = /^\/events\/([a-z0-9-]+)\/?$/.exec(path)?.[1];
    if (slug) return link(cmsUrl('events', slug), 'Look for the event in the editor', { external: true });
  }
  return null;
}

export function messageTodoCount(d: MessagesData): number {
  return d.messages.filter((m) => !m.snoozedUntil).length;
}

export function renderMessages(root: HTMLElement, d: MessagesData, onCount: (n: number) => void) {
  return sitePages().then((pages) => draw(root, d, pages, onCount));
}

function draw(root: HTMLElement, d: MessagesData, pages: Pages, onCount: (n: number) => void) {
  root.replaceChildren();
  const waiting = d.messages.filter((m) => !m.snoozedUntil).sort((a, b) => (a.kind === 'remove-listing' ? 0 : 1) - (b.kind === 'remove-listing' ? 0 : 1) || a.createdAt.localeCompare(b.createdAt));
  let open = waiting.length;
  onCount(open);
  if (!waiting.length) root.append(emptyState('No messages from visitors right now.'));
  const ol = el('ol', null, 'review-grid');
  for (const m of waiting) {
    const k = KIND[m.kind] || KIND.other!;
    const li = el('li', null, `review-card${m.kind === 'remove-listing' ? ' review-card--urgent' : ''}`);
    li.append(el('p', k.label, 'review-state review-state--warn'));
    li.append(el('h3', m.title));
    li.append(
      list(
        [
          `Sent ${ago(m.createdAt)} (${dateTimeLabel(m.createdAt)})`,
          m.dueInDays !== null ? (m.dueInDays > 0 ? `${plural(m.dueInDays, 'day')} left to answer` : 'Overdue: please answer today') : null,
          m.comments ? `${plural(m.comments, 'reply', 'replies')} so far` : null,
        ],
        'review-meta',
      ),
    );
    const sections = Object.entries(m.sections).filter(([, v]) => v);
    if (sections.length) {
      const dl = el('dl', null, 'review-dl');
      for (const [q, a] of sections) dl.append(el('dt', q), el('dd', a));
      li.append(dl);
    } else if (m.body) {
      const quote = el('blockquote', m.body, 'review-quote');
      quote.tabIndex = 0;
      li.append(quote);
    }
    const edit = m.page ? editorLink(m.page, pages) : null;
    li.append(list([m.page ? link(m.page, 'Open the page they mean') : null, edit, link(m.url, 'Open on GitHub')], 'review-links'));
    const help = details('What should I do?', '');
    help.body.append(el('p', k.help));
    li.append(help.box);

    if (m.kind === 'listing-correction') {
      const tell = details('Tell the organizer too (optional)', 'review-hint');
      tell.body.append(el('p', "If the organizer's own calendar has the same mistake, a short email helps everyone. You can read and change the email before it goes out.", 'review-hint'));
      tell.body.append(composer({ key: `issue:${m.number}`, kind: 'correction', label: 'Email the organizer…' }));
      li.append(tell.box);
    }    const form = el('form', null, 'review-form');
    const text = el('textarea');
    text.rows = 4;
    text.maxLength = 3000;
    text.value = k.replies[0]!.text;
    let reason: 'completed' | 'not_planned' = k.replies[0]!.reason || 'completed';
    const picks = el('div', null, 'review-actions');
    for (const r of k.replies) {
      picks.append(
        button(`Use "${r.label}"`, 'btn--secondary', () => {
          text.value = r.text;
          reason = r.reason || 'completed';
          text.focus();
        }),
      );
    }
    form.append(picks, field('Your reply (public on GitHub)', text, 'Never include private details like phone numbers or home addresses.'));
    const send = async (action: 'reply' | 'close', withText: boolean) => {
      const r = await api('/api/review/messages', { number: m.number, action, body: withText ? text.value : '', reason });
      if (r.status !== 200) return say(errorText(r));
      if (action === 'close') {
        settle(li, withText ? 'Replied and closed.' : 'Closed.');
        onCount(--open);
      } else say('Reply sent. The message stays open.');
    };
    const row = el('div', null, 'review-actions');
    row.append(
      button('Send reply and close', 'btn--primary', () => send('close', true)),
      button('Send reply only', 'btn--secondary', () => send('reply', true)),
      button('Close without a reply', 'btn--secondary', async () => {
        if (confirm('Close this message without replying?')) await send('close', false);
      }),
      button('Snooze a week', 'btn--secondary', async () => {
        const r = await api('/api/review/snooze', { kind: 'message', id: String(m.number), days: 7 });
        if (r.status !== 200) return say(errorText(r));
        settle(li, 'Snoozed for a week.');
        onCount(--open);
      }),
    );
    form.append(row);
    form.addEventListener('submit', (e) => e.preventDefault());
    li.append(form);
    ol.append(li);
  }
  if (waiting.length) root.append(ol);

  const snoozed = d.messages.filter((m) => m.snoozedUntil);
  if (snoozed.length) {
    const box = details(`Snoozed (${snoozed.length})`, 'review-details panel');
    box.body.append(list(snoozed.map((m) => link(m.url, `#${m.number}: ${m.title}`)), 'review-log'));
    root.append(box.box);
  }
  if (d.copilotTasks.length) {
    const box = details(`Tasks you gave Copilot (${d.copilotTasks.length} open)`, 'review-details panel');
    box.body.append(el('p', 'To start one: open it on GitHub and choose "Assign to Copilot". Copilot then opens a pull request (a suggested change) for you to check.', 'review-hint'));
    box.body.append(list(d.copilotTasks.map((t) => {
      const s = el('span');
      s.append(link(t.url, `#${t.number}: ${t.title}`), t.assigned ? ' (Copilot is on it)' : ' (not started)');
      return s;
    }), 'review-log'));
    root.append(box.box);
  }
}
