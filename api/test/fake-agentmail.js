'use strict';
/** In-memory stand-in for the parts of the AgentMail API the review center uses. */
function createFakeAgentMail(inbox) {
  const threads = new Map();
  const messages = new Map();
  let n = 0;
  const m = {
    inbox,
    threads,
    messages,
    calls: [],
    sends: [],
    /** Someone answers in a thread (as AgentMail stores an incoming reply). */
    receive(threadId, from, text) {
      const id = `<r${++n}@mail.example>`;
      const msg = { message_id: id, thread_id: threadId, from, to: [inbox], labels: ['received', 'unread'], text, extracted_text: text, subject: 'Re: answer', timestamp: new Date().toISOString() };
      messages.set(id, msg);
      threads.get(threadId).messages.push(msg);
      return id;
    },
  };
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const labelsOf = (t) => [...new Set(t.messages.flatMap((x) => x.labels))];
  const view = (t) => ({ thread_id: t.thread_id, subject: t.messages[0].subject, labels: labelsOf(t), senders: [...new Set(t.messages.map((x) => x.from))], timestamp: t.messages.at(-1).timestamp, message_count: t.messages.length });
  m.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    m.calls.push({ method, path: u.pathname + u.search, body, auth: init.headers && init.headers.Authorization });
    const base = `/v0/inboxes/${encodeURIComponent(inbox)}`;
    if (!u.pathname.startsWith(base)) return json(403, { name: 'ForbiddenError', message: 'Forbidden' });
    const rest = u.pathname.slice(base.length);
    let x;
    if (rest === '/messages/send' && method === 'POST') {
      const id = `<s${++n}@agentmail.to>`;
      const threadId = `t${n}`;
      const msg = { message_id: id, thread_id: threadId, from: `Long Island Dance Events <${inbox}>`, to: body.to, labels: [...(body.labels || []), 'sent'], text: body.text, html: body.html, subject: body.subject, timestamp: new Date().toISOString() };
      messages.set(id, msg);
      threads.set(threadId, { thread_id: threadId, messages: [msg] });
      m.sends.push({ kind: 'send', ...body });
      return json(200, { message_id: id, thread_id: threadId });
    }
    if ((x = /^\/messages\/([^/]+)\/reply$/.exec(rest)) && method === 'POST') {
      const orig = messages.get(decodeURIComponent(x[1]));
      if (!orig) return json(404, { name: 'NotFoundError', message: 'Message not found' });
      const id = `<s${++n}@agentmail.to>`;
      const msg = { message_id: id, thread_id: orig.thread_id, from: `Long Island Dance Events <${inbox}>`, to: orig.to, labels: [...(body.labels || []), 'sent'], text: body.text, subject: `Re: ${orig.subject}`, timestamp: new Date().toISOString() };
      messages.set(id, msg);
      threads.get(orig.thread_id).messages.push(msg);
      m.sends.push({ kind: 'reply', to: orig.to, ...body });
      return json(200, { message_id: id, thread_id: orig.thread_id });
    }
    if ((x = /^\/messages\/([^/]+)$/.exec(rest)) && method === 'PATCH') {
      const msg = messages.get(decodeURIComponent(x[1]));
      if (!msg) return json(404, { name: 'NotFoundError' });
      msg.labels = [...new Set([...msg.labels.filter((l) => !(body.remove_labels || []).includes(l)), ...(body.add_labels || [])])];
      return json(200, { message_id: msg.message_id, labels: msg.labels });
    }
    if (rest === '/threads' && method === 'GET') {
      const want = u.searchParams.getAll('labels');
      // Like the real API: threads with no received email are listed only when the filter names "sent".
      const list = [...threads.values()].filter((t) => want.every((l) => labelsOf(t).includes(l)) && (want.includes('sent') || labelsOf(t).includes('received'))).map(view);
      return json(200, { count: list.length, threads: list });
    }
    if ((x = /^\/threads\/([^/]+)$/.exec(rest)) && method === 'GET') {
      const t = threads.get(decodeURIComponent(x[1]));
      if (!t) return json(404, { name: 'NotFoundError' });
      return json(200, { ...view(t), messages: t.messages });
    }
    return json(404, { name: 'NotFoundError', message: `fake AgentMail has no ${method} ${rest}` });
  };
  return m;
}

module.exports = { createFakeAgentMail };
