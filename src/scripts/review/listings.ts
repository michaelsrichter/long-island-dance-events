/** Held listings: events with status "pending-review" on main, with one-click decisions. */
import { api, button, cmsUrl, copilotButton, details, el, emptyState, errorText, field, link, list, LIVE, plural, say, settle, sitePages, timeLabel, whenLabel, dayLabel, type Pages } from './core';

type Reason = { code: string; of?: string; source?: string; on?: string; said?: string; suggest?: string; name?: string };
export type Listing = {
  id: string;
  title: string;
  summary: string;
  category: string;
  start: string;
  end: string;
  recurring: boolean;
  rule: string;
  cadence: string;
  venueId: string;
  town: string;
  performerIds: string[];
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  infoUrl: string;
  ticketUrl: string;
  notes: string;
  firstSeen: string;
  reasons: Reason[];
  suggest: string;
  ended: boolean;
  snoozedUntil: string;
};
export type ListingsData = { sha: string; today: string; listings: Listing[]; venueIds: string[]; performerIds: string[] };

const REASONS: Record<string, { title: (r: Reason) => string; help: string }> = {
  'no-time': { title: () => 'No start time', help: 'The listing gave a date but no time. Check the source page. Add the time, or publish it without one (the website then says "time not listed").' },
  'odd-time': {
    title: (r) => `The start time looks wrong (${r.said || 'early morning'})`,
    help: 'Dances and live music almost never start early in the morning. This is usually a mistake on the source website, and the real time is in the evening. Check the source page, then fix the time.',
  },
  'no-venue': { title: () => 'No venue', help: 'The listing did not say where it is. Check the source page and pick the venue. If the venue is new to us, ask Copilot to add it.' },
  'new-act': {
    title: (r) => `New band or DJ: ${r.name || 'not known yet'}`,
    help: 'We have no page for this band or DJ yet, so we cannot guess if people dance at their shows. You can publish it anyway, pick a band or DJ we already know, or ask Copilot to look them up.',
  },
  gone: {
    title: (r) => `Missing from the source${r.on ? ` since ${dayLabel(r.on)}` : ''}`,
    help: 'This was on the source website before, but the latest check did not find it. It may be cancelled or moved. Check the source page. If it is still happening, publish it. If not, mark it cancelled or hide it.',
  },
  copy: { title: () => 'Listed twice', help: "The organizer's or band's own calendar lists the same event, so the website shows that one. Hiding this copy is almost always right." },
  held: { title: () => 'Held on purpose by an editor', help: 'An editor held this one on purpose. Read the note below before you decide.' },
  unsure: { title: () => "The computer wasn't sure", help: 'Compare it with the source page. Then publish it or hide it.' },
};

const occurrencePath = (id: string, date: string) => `/events/${id.startsWith(`${date}-`) ? id : `${date}-${id.replace(/^\d{4}-\d{2}-\d{2}-/, '')}`}/`;

export function renderListings(root: HTMLElement, d: ListingsData, onCount: (n: number) => void) {
  return sitePages().then((pages) => draw(root, d, pages, onCount));
}

function draw(root: HTMLElement, d: ListingsData, pages: Pages, onCount: (n: number) => void) {
  const name = (type: string, id: string) => pages.names[`${type}:${id}`] || id;
  const venues = [...d.venueIds].map((id) => ({ id, name: name('venue', id) })).sort((a, b) => a.name.localeCompare(b.name));
  const acts = [...d.performerIds].map((id) => ({ id, name: name('performer', id) })).sort((a, b) => a.name.localeCompare(b.name));
  const waiting = d.listings.filter((l) => !l.ended && !l.snoozedUntil);
  const snoozed = d.listings.filter((l) => !l.ended && l.snoozedUntil);
  const ended = d.listings.filter((l) => l.ended);
  let open = waiting.length;
  onCount(open);
  const decided = () => onCount(--open);

  root.replaceChildren();
  if (!waiting.length) root.append(emptyState('Nothing is held right now. Every listing is either on the website or hidden on purpose.'));

  /* ---- filter by reason ---- */
  const counts = new Map<string, number>();
  for (const l of waiting) for (const r of l.reasons) counts.set(r.code, (counts.get(r.code) || 0) + 1);
  const ol = el('ol', null, 'review-grid');
  ol.setAttribute('aria-label', 'Held listings');
  const selected = new Set<string>();
  const cards = new Map<string, HTMLLIElement>();
  if (waiting.length > 1) {
    const fs = el('fieldset', null, 'review-filters');
    fs.append(el('legend', 'Show'));
    const opt = (code: string, label: string) => {
      const lab = el('label', null, 'chip');
      const input = el('input');
      input.type = 'radio';
      input.name = 'listing-filter';
      input.value = code;
      input.checked = code === 'all';
      input.addEventListener('change', () => {
        for (const [id, li] of cards) {
          const l = waiting.find((x) => x.id === id)!;
          li.hidden = code !== 'all' && !l.reasons.some((r) => r.code === code);
        }
      });
      lab.append(input, el('span', label));
      fs.append(lab);
    };
    opt('all', `All (${waiting.length})`);
    for (const [code, n] of [...counts].sort((a, b) => b[1] - a[1])) opt(code, `${REASONS[code]?.title({ code }).replace(/:.*$/, '').replace(/ \(.*$/, '') || code} (${n})`);
    root.append(fs);
  }

  /* ---- bulk bar ---- */
  const bulk = el('div', null, 'review-bulk');
  bulk.hidden = true;
  bulk.setAttribute('role', 'region');
  bulk.setAttribute('aria-label', 'Chosen listings');
  const bulkLabel = el('span', '');
  const updateBulk = () => {
    bulk.hidden = selected.size === 0;
    bulkLabel.textContent = `${plural(selected.size, 'listing')} chosen`;
  };
  const decideMany = async (action: 'publish' | 'hide') => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`${action === 'publish' ? 'Publish' : 'Hide'} ${plural(ids.length, 'listing')}?`)) return;
    const r = await api('/api/review/listings', { decisions: ids.map((id) => ({ id, action })) });
    if (r.status !== 200) return say(errorText(r));
    for (const x of r.data.done) {
      const li = cards.get(x.id);
      if (li) settled(li, x.id, action === 'publish' ? `Published. ${LIVE}` : "Hidden. It won't show on the website.", r.data.commit?.sha);
      selected.delete(x.id);
      decided();
    }
    updateBulk();
    say(`${plural(r.data.done.length, 'listing')} saved. ${LIVE}`);
  };
  bulk.append(
    bulkLabel,
    button('Publish chosen', 'btn--primary', () => decideMany('publish')),
    button('Hide chosen', 'btn--secondary', () => decideMany('hide')),
    button('Clear choices', 'btn--secondary', () => {
      selected.clear();
      for (const li of cards.values()) {
        const cb = li.querySelector<HTMLInputElement>('.review-card__head > input');
        if (cb) cb.checked = false;
      }
      updateBulk();
    }),
  );
  if (waiting.length > 1) {
    const all = el('label', null, 'review-choose-all');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => {
      for (const [id, li] of cards) {
        const box = li.querySelector<HTMLInputElement>('.review-card__head > input');
        if (!box || li.hidden) continue;
        box.checked = cb.checked;
        if (cb.checked) selected.add(id);
        else selected.delete(id);
      }
      updateBulk();
    });
    all.append(cb, document.createTextNode(' Choose all shown (to publish or hide many at once)'));
    root.append(all);
  }

  /* ---- one card ---- */
  function settled(li: HTMLElement, id: string, message: string, commit?: string) {
    const extra: Node[] = [];
    if (commit) {
      const undo = button('Undo', 'btn--secondary', async () => {
        const r = await api('/api/review/listings', { decisions: [{ id, action: 'undo', commit }] });
        if (r.status !== 200) return say(errorText(r));
        undo.replaceWith(el('p', 'Undone. It is held again. Refresh the page to decide again.', 'review-hint'));
        onCount(++open);
        say('Undone.');
      });
      extra.push(undo);
    }
    settle(li, message, extra);
  }

  function card(l: Listing, compact = false): HTMLLIElement {
    const li = el('li', null, 'review-card');
    li.dataset.id = l.id;
    const head = el('div', null, 'review-card__head');
    const text = el('div');
    if (!compact) {
      const cb = el('input');
      cb.type = 'checkbox';
      cb.setAttribute('aria-label', `Choose: ${l.title}`);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(l.id);
        else selected.delete(l.id);
        updateBulk();
      });
      head.append(cb);
    }
    text.append(el('h3', l.title));
    const where = l.venueId ? name('venue', l.venueId) : l.town ? `${l.town} (no venue)` : 'No venue';
    text.append(
      list(
        [
          whenLabel(l.start) + (l.recurring ? ` and more dates${l.cadence ? ` (${l.cadence})` : ''}` : ''),
          where,
          l.performerIds.length ? l.performerIds.map((p) => name('performer', p)).join(', ') : null,
          `From ${l.sourceName}`,
        ],
        'review-meta',
      ),
    );
    head.append(text);
    li.append(head);

    const reasons = el('ul', null, 'review-reasons');
    for (const r of l.reasons) {
      const info = REASONS[r.code] || REASONS.unsure!;
      const item = el('li', null, 'review-reason');
      item.append(el('strong', info.title(r)));
      const why = details('Why was this held? What should I do?', '');
      why.body.append(el('p', info.help));
      item.append(why.box);
      reasons.append(item);
    }
    li.append(reasons);
    if (l.notes) {
      const n = details('Full note from the weekly check', 'review-hint');
      n.body.append(el('p', l.notes, 'review-note'));
      li.append(n.box);
    }

    const links: (Node | null)[] = [
      l.sourceUrl ? link(l.sourceUrl, 'Open the source page') : null,
      l.infoUrl && l.infoUrl !== l.sourceUrl ? link(l.infoUrl, 'More information') : null,
      l.venueId ? link(`/venues/${l.venueId}/`, 'Venue page', { external: true }) : null,
      ...l.performerIds.map((p) => link(`/performers/${p}/`, `${name('performer', p)} page`, { external: true })),
      ...l.reasons.filter((r) => r.code === 'copy' && r.of).map((r) => link(pages.urls[`event:${r.of}`] || '/events/', 'The listing shown instead', { external: true })),
      link(cmsUrl('events', l.id), 'Edit all details in the editor', { external: true }),
    ];
    li.append(list(links, 'review-links'));
    if (compact) return li;

    const decide = async (decision: Record<string, unknown>, message: string) => {
      const r = await api('/api/review/listings', { decisions: [{ id: l.id, ...decision }] });
      if (r.status !== 200) return say(errorText(r));
      if (r.data.skipped?.length) {
        settle(li, `Someone already decided this (${r.data.skipped[0].why}). Refresh the page.`);
        decided();
        return;
      }
      settled(li, l.id, message, r.data.commit?.sha);
      if (decision.action === 'publish' || decision.action === 'fix') {
        const p = el('p', null, 'review-hint');
        p.append(link(occurrencePath(l.id, l.start.slice(0, 10)), 'See it on the website (after about 10 minutes)', { external: true }));
        li.append(p);
      }
      selected.delete(l.id);
      updateBulk();
      decided();
      say(message);
    };

    /* forms */
    const fixForm = el('form', null, 'review-form');
    fixForm.hidden = true;
    const time = el('input');
    time.type = 'time';
    const oddTime = l.reasons.find((r) => r.code === 'odd-time');
    time.value = oddTime?.suggest || (l.start.length > 10 ? l.start.slice(11, 16) : '');
    fixForm.append(field('Start time', time, `The date stays the same: ${dayLabel(l.start.slice(0, 10))}.`));
    const venue = el('select');
    venue.append(new Option(l.venueId ? `Keep: ${name('venue', l.venueId)}` : 'Choose a venue…', ''));
    for (const v of venues) if (v.id !== l.venueId) venue.append(new Option(v.name, v.id));
    fixForm.append(field('Venue', venue, 'If the venue is not in the list, ask Copilot to add it.'));
    const town = el('input');
    town.type = 'text';
    town.autocomplete = 'off';
    if (!l.venueId) fixForm.append(field('Town (only if there is no venue)', town, 'For example: Huntington'));
    const act = el('select');
    act.append(new Option(l.performerIds.length ? `Keep: ${l.performerIds.map((p) => name('performer', p)).join(', ')}` : 'Keep as is (no band or DJ)', ''));
    for (const p of acts) act.append(new Option(p.name, p.id));
    fixForm.append(field('Band or DJ', act));
    const why = el('input');
    why.type = 'text';
    why.maxLength = 200;
    fixForm.append(field('Note for the history (optional)', why, 'For example: "Checked the venue website."'));
    const save = el('button', 'Save and publish', 'btn btn--primary btn--small');
    save.type = 'submit';
    const fixRow = el('div', null, 'review-actions');
    fixRow.append(save);
    fixForm.append(fixRow);
    fixForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fields: Record<string, string> = {};
      const current = l.start.length > 10 ? l.start.slice(11, 16) : '';
      if (time.value && time.value !== current) fields.time = time.value;
      if (venue.value) fields.venueId = venue.value;
      if (act.value) fields.performerId = act.value;
      if (town.value.trim()) fields.town = town.value.trim();
      if (!Object.keys(fields).length) return say('Nothing was changed. Change something, or press Publish instead.');
      save.disabled = true;
      await decide({ action: 'fix', fields, note: why.value }, `Fixed and published. ${LIVE}`);
      save.disabled = false;
    });

    const cancelForm = el('form', null, 'review-form');
    cancelForm.hidden = true;
    const cancelNote = el('input');
    cancelNote.type = 'text';
    cancelNote.maxLength = 200;
    cancelNote.value = 'Cancelled.';
    cancelForm.append(field('Short note visitors will see', cancelNote, 'For example: "Cancelled by the venue."'));
    const cancelBtn = el('button', 'Show it as cancelled', 'btn btn--primary btn--small');
    cancelBtn.type = 'submit';
    const cancelRow = el('div', null, 'review-actions');
    cancelRow.append(cancelBtn);
    cancelForm.append(cancelRow);
    cancelForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      cancelBtn.disabled = true;
      await decide({ action: 'cancel', note: cancelNote.value }, `Marked cancelled. ${LIVE}`);
      cancelBtn.disabled = false;
    });

    const toggle = (form: HTMLFormElement, other: HTMLFormElement) => () => {
      form.hidden = !form.hidden;
      other.hidden = true;
      if (!form.hidden) form.querySelector<HTMLElement>('input, select')?.focus();
    };

    /* buttons, the suggested one first */
    const actions = el('div', null, 'review-actions');
    if (oddTime?.suggest) actions.append(button(`Change to ${timeLabel(oddTime.suggest)} and publish`, 'btn--primary', () => decide({ action: 'fix', fields: { time: oddTime.suggest } }, `Fixed and published. ${LIVE}`)));
    if (l.suggest === 'hide') actions.append(button('Hide this copy', 'btn--primary', () => decide({ action: 'hide', note: 'A copy of another listing' }, 'Hidden. The other listing stays on the website.')));
    actions.append(button('Publish', l.suggest === 'publish' || l.suggest === 'check' ? 'btn--primary' : 'btn--secondary', () => decide({ action: 'publish' }, `Published. ${LIVE}`)));
    const fixLabel = l.suggest === 'fix-venue' ? 'Pick the venue…' : l.suggest === 'fix-time' && !oddTime ? 'Add the time…' : 'Fix…';
    const fixPrimary = l.suggest === 'fix-venue' || (l.suggest === 'fix-time' && !oddTime);
    actions.append(button(fixLabel, fixPrimary ? 'btn--primary' : 'btn--secondary', toggle(fixForm, cancelForm)));
    actions.append(button('Mark cancelled…', 'btn--secondary', toggle(cancelForm, fixForm)));
    if (l.suggest !== 'hide') actions.append(button('Hide', 'btn--secondary', () => decide({ action: 'hide' }, "Hidden. It won't show on the website.")));
    actions.append(
      button('Snooze a week', 'btn--secondary', async () => {
        const r = await api('/api/review/snooze', { kind: 'listing', id: l.id, days: 7 });
        if (r.status !== 200) return say(errorText(r));
        settle(li, 'Snoozed for a week. It stays hidden until you decide.');
        decided();
      }),
    );
    const newAct = l.reasons.find((r) => r.code === 'new-act');
    if (newAct || l.reasons.some((r) => r.code === 'no-venue')) {
      actions.append(
        copilotButton(
          newAct ? 'Ask Copilot to look them up' : 'Ask Copilot to find the venue',
          () => (newAct ? `Research a band or DJ: ${newAct.name}` : `Find the venue for: ${l.title} (${dayLabel(l.start.slice(0, 10))})`),
          () =>
            [
              `The held listing **${l.title}** on ${whenLabel(l.start)} (file \`src/content/events/${l.id}.json\`, source ${l.sourceName}: ${l.sourceUrl}) needs a person:`,
              '',
              newAct
                ? `- It names **${newAct.name}**, but we have no page for them. Add a file in \`src/content/performers/\` with their own website and social pages and the dancing research (see "How we learn about bands, DJs and venues" in docs/how-weekly-updates-work.md). Add it to the event's \`performerIds\`.`
                : `- The listing does not say where it is${l.town ? ` (town: ${l.town})` : ''}. Find the venue on the source page; add a venue file in \`src/content/venues/\` if it is new (address and dance-floor research), and set the event's \`venueId\`.`,
              '- Then set the event\'s status to "active" and add "status" to its lockedFields, so it is published.',
            ].join('\n'),
        ),
      );
    }
    li.append(actions, fixForm, cancelForm);
    return li;
  }

  for (const l of waiting) {
    const li = card(l);
    cards.set(l.id, li);
    ol.append(li);
  }
  if (waiting.length) root.append(ol, bulk);

  if (snoozed.length) {
    const box = details(`Snoozed (${snoozed.length})`, 'review-details panel');
    const sl = el('ul', null, 'review-grid');
    for (const l of snoozed) {
      const li = card(l, true);
      li.append(el('p', `Snoozed until ${dayLabel(l.snoozedUntil.slice(0, 10))}.`, 'review-hint'));
      li.append(
        button('Bring it back now', 'btn--secondary', async () => {
          const r = await api('/api/review/snooze', { kind: 'listing', id: l.id, undo: true });
          say(r.status === 200 ? 'It is back in the list. Refresh the page to see it.' : errorText(r));
        }),
      );
      sl.append(li);
    }
    box.body.append(sl);
    root.append(box.box);
  }
  if (ended.length) {
    const box = details(`Already over (${ended.length}): nothing to do`, 'review-details panel');
    box.body.append(el('p', 'These dates have passed, so they will never show on the website. You can leave them as they are.', 'review-hint'));
    const el2 = el('ul', null, 'review-grid');
    for (const l of ended) el2.append(card(l, true));
    box.body.append(el2);
    root.append(box.box);
  }
}
