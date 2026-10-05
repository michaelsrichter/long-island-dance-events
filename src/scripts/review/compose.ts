/**
 * "Review and send": an email to a website owner or organizer, sent through the site's AgentMail inbox
 * (decision P53). The owner sees and can change everything (To, Subject, Message), and confirms before
 * it is sent. Previews of the site never send; they show what would have been sent.
 */
import { api, button, el, errorText, field, link, say } from './core';

export type OutreachSummary = {
  canSend: boolean;
  reason: string;
  inbox: string;
  problem: string;
  rules: { newRequestDays: number; followupAfterDays: number };
  threads: { threadId: string; key: string; subject: string; updatedAt: string; hasReply: boolean; unread: boolean; messages: number }[];
  sent: { key: string; lastSentAt: string; firstSentAt: string; followups: number; count: number; threadId: string }[];
};

type Draft = { key: string; kind: string; to: string; toFrom: string; subject: string; text: string; rule: { ok: boolean; reason?: string }; canSend: boolean; reason: string; inbox: string; lastSentAt: string };
type Kind = 'permission' | 'followup' | 'correction';

const NOT_LIVE: Record<string, string> = {
  preview: 'This is a test copy of the website, so no email will go out. Press Send to see what would be sent.',
  'not-configured': 'Sending email is not set up yet (it needs the AGENTMAIL_API_KEY and AGENTMAIL_INBOX settings). Press Send to see what would be sent, or use your own email app below.',
};

/** Paragraphs and lists ("- " lines), the way the email will look (built with textContent only). */
function preview(text: string): HTMLElement {
  const box = el('div', null, 'review-quote review-email-preview');
  for (const block of text.trim().split(/\n{2,}/)) {
    let p: HTMLParagraphElement | null = null;
    let ul: HTMLUListElement | null = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('- ')) {
        p = null;
        if (!ul) box.append((ul = el('ul')));
        ul.append(el('li', line.slice(2)));
      } else {
        ul = null;
        if (p) p.append(el('br'), line);
        else box.append((p = el('p', line)));
      }
    }
  }
  return box;
}

/**
 * A button that opens the email form. `onSent` runs after a real send (not a dry run).
 */
export function composer(opts: { key: string; kind: Kind; label: string; primary?: boolean; saveContact?: boolean; onSent?: (r: { threadId: string; recorded: boolean }) => void }): HTMLElement {
  const wrap = el('div', null, 'review-compose');
  const open = button(opts.label, opts.primary ? 'btn--primary' : 'btn--secondary', async () => {
    const r = await api<Draft>(`/api/review/outreach/draft?key=${encodeURIComponent(opts.key)}&kind=${opts.kind}`);
    if (r.status !== 200) return say(errorText(r));
    open.hidden = true;
    wrap.append(form(r.data));
    wrap.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
  });
  wrap.append(open);

  function form(d: Draft): HTMLFormElement {
    const f = el('form', null, 'review-form');
    f.noValidate = true;
    if (!d.canSend) f.append(el('p', NOT_LIVE[d.reason] || NOT_LIVE.preview!, 'review-state review-state--warn'));
    const to = el('input');
    to.type = 'email';
    to.autocomplete = 'off';
    to.value = d.to;
    to.required = true;
    f.append(field('To', to, d.to ? `Filled in from ${d.toFrom || 'our records'}. Make sure it is right before you send.` : 'Type the email address shown on their website (often on the Contact page). Never use a private address.'));
    let save: HTMLInputElement | null = null;
    if (opts.saveContact && opts.kind === 'permission') {
      const lab = el('label', null, 'review-choose-all');
      save = el('input');
      save.type = 'checkbox';
      save.checked = false;
      lab.append(save, ' This address is published on their website. Save it for next time.');
      f.append(lab);
    }
    const subject = el('input');
    subject.type = 'text';
    subject.maxLength = 150;
    subject.value = d.subject;
    f.append(field('Subject', subject));
    const text = el('textarea');
    text.rows = 14;
    text.maxLength = 6000;
    text.value = d.text;
    f.append(field('Message (you can change anything)', text, 'It comes from the website\'s email address, with the name "Long Island Dance Events". Their answers show up here.'));
    const look = el('details', null, 'review-hint');
    look.append(el('summary', 'See how it will look'));
    const lookBody = el('div');
    look.append(lookBody);
    look.addEventListener('toggle', () => {
      if (look.open) lookBody.replaceChildren(el('p', `To: ${to.value}`), el('p', `Subject: ${subject.value}`), preview(text.value));
    });
    f.append(look);
    let override: HTMLInputElement | null = null;
    const ruleLine = el('p', '', 'review-state review-state--warn');
    ruleLine.hidden = true;
    const showRule = (reason: string) => {
      ruleLine.textContent = reason;
      ruleLine.hidden = false;
      if (!override) {
        const lab = el('label', null, 'review-choose-all');
        override = el('input');
        override.type = 'checkbox';
        lab.append(override, ' Send anyway');
        ruleLine.after(lab);
      }
    };
    f.append(ruleLine);
    if (!d.rule.ok && d.rule.reason) showRule(d.rule.reason);
    const result = el('p', '', 'review-state');
    result.setAttribute('role', 'status');
    const send = el('button', 'Send…', 'btn btn--primary btn--small');
    send.type = 'submit';
    const mailto = link('#', 'Use my own email app', { external: false, cls: 'btn btn--small btn--secondary' });
    mailto.addEventListener('click', () => {
      mailto.href = `mailto:${encodeURIComponent(to.value)}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(text.value)}`;
    });
    const row = el('div', null, 'review-actions');
    row.append(send, mailto);
    f.append(row, result);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const address = to.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) {
        result.textContent = 'Type one email address, like info@example.com.';
        to.focus();
        return;
      }
      if (!confirm(d.canSend ? `Send this email to ${address}?` : `Email can't be sent from here. See what would be sent to ${address}?`)) return;
      send.disabled = true;
      const r = await api('/api/review/outreach/send', { key: opts.key, kind: opts.kind, to: address, subject: subject.value, text: text.value, override: Boolean(override?.checked), saveContact: Boolean(save?.checked) });
      send.disabled = false;
      if (r.status === 409) {
        showRule(errorText(r));
        result.textContent = 'Not sent.';
        return;
      }
      if (r.status !== 200) {
        result.textContent = `Not sent. ${errorText(r)}`;
        return;
      }
      if (r.data.dryRun) {
        result.className = 'review-state review-state--warn';
        result.textContent = `Not sent, because ${d.reason === 'preview' ? 'this is a test copy of the website' : 'email is not set up yet'}. It would have gone to ${r.data.wouldSend.to} from ${r.data.wouldSend.from}.`;
        return;
      }
      f.replaceChildren(el('p', `Sent to ${address}. Their answer will show here.${r.data.recorded ? ' The source moves to "Waiting for an answer".' : ''}`, 'review-state review-state--ok'));
      say(`Email sent to ${address}.`);
      opts.onSent?.({ threadId: r.data.threadId, recorded: r.data.recorded });
    });
    return f;
  }
  return wrap;
}

/** The emails for one key (a source or a message), newest conversation first, opened on demand. */
export function conversations(key: string, o: OutreachSummary | null): HTMLElement | null {
  if (!o) return null;
  const threads = o.threads.filter((t) => t.key === key || t.key === key.replace(/^source:/, 'test:'));
  if (!threads.length) return null;
  const unread = threads.some((t) => t.unread);
  const box = el('details', null, 'review-details review-conversation');
  const summary = el('summary', `Emails (${threads.length})${unread ? ': new answer!' : threads.some((t) => t.hasReply) ? ': they answered' : ': no answer yet'}`);
  if (unread) summary.classList.add('review-state--bad');
  box.append(summary);
  const body = el('div', null, 'review-sub');
  box.append(body);
  box.addEventListener('toggle', async () => {
    if (!box.open || body.childElementCount) return;
    body.append(el('p', 'Loading…', 'spinner'));
    const parts: HTMLElement[] = [];
    for (const t of threads) {
      const r = await api(`/api/review/outreach/thread?id=${encodeURIComponent(t.threadId)}`);
      if (r.status !== 200) {
        parts.push(el('p', errorText(r), 'review-state review-state--warn'));
        continue;
      }
      const ol = el('ol', null, 'review-log');
      if (t.key.startsWith('test:')) parts.push(el('p', 'A test email to our own inbox', 'review-hint'));
      for (const m of r.data.messages as { direction: string; from: string; to: string; at: string; text: string }[]) {
        const li = el('li', null, m.direction === 'received' ? 'review-mail review-mail--in' : 'review-mail');
        li.append(el('strong', `${m.direction === 'received' ? 'Answer from' : 'We sent to'} ${m.direction === 'received' ? m.from : m.to}`), ` · ${new Date(m.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
        const quote = el('blockquote', m.text, 'review-quote');
        quote.tabIndex = 0;
        li.append(quote);
        ol.append(li);
      }
      parts.push(ol);
    }
    body.replaceChildren(...parts);
    summary.classList.remove('review-state--bad');
  });
  return box;
}
