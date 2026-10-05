'use strict';
/** In-memory stand-in for the parts of the GitHub API the review center uses (REST + GraphQL). */
const { randomBytes } = require('node:crypto');

const sha = () => randomBytes(20).toString('hex');

function createFakeGitHub(repo, files) {
  const commits = new Map();
  const trees = new Map();
  const first = sha();
  commits.set(first, { files: new Map(Object.entries(files)), parents: [], message: 'initial' });
  const gh = {
    repo,
    head: first,
    commits,
    calls: [],
    pulls: [],
    issues: [],
    checkRuns: {},
    runs: [],
    dispatches: [],
    comments: [],
    merged: [],
    labels: new Set(),
    installed: true,
    failNextRefUpdate: false,
    manifestCodes: new Map(),
    file(path, at = gh.head) {
      return commits.get(at).files.get(path);
    },
    commitCount() {
      return commits.size - 1;
    },
  };
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  function graphql(query) {
    const repository = {};
    for (const m of query.matchAll(/(f\d+): object\(expression: ("(?:[^"\\]|\\.)*")\)/g)) {
      const alias = m[1];
      const expr = JSON.parse(m[2]);
      const rest = query.slice(m.index + m[0].length);
      const next = rest.search(/f\d+: object\(/);
      const chunk = next < 0 ? rest : rest.slice(0, next);
      const kind = chunk.includes('on Tree') ? 'Tree' : 'Blob';
      const i = expr.indexOf(':');
      const [at, path] = [expr.slice(0, i), expr.slice(i + 1)];
      const c = commits.get(at);
      if (!c) {
        repository[alias] = null;
        continue;
      }
      if (kind === 'Blob') {
        repository[alias] = c.files.has(path) ? { text: c.files.get(path) } : null;
      } else {
        const prefix = `${path}/`;
        const withText = chunk.includes('text');
        const entries = [...c.files.keys()]
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .sort()
          .map((p) => ({ name: p.slice(prefix.length), ...(withText ? { object: { text: c.files.get(p) } } : {}) }));
        repository[alias] = entries.length ? { entries } : null;
      }
    }
    return json(200, { data: { repository } });
  }

  gh.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    const path = u.pathname;
    gh.calls.push({ method, path: path + u.search, body, auth });
    const R = `/repos/${repo}`;
    if (method === 'POST' && path === '/graphql') return auth ? graphql(body.query) : json(401, { message: 'Requires authentication' });
    let m;
    if ((m = /^\/app-manifests\/([^/]+)\/conversions$/.exec(path))) {
      const conv = gh.manifestCodes.get(m[1]);
      if (!conv) return json(404, { message: 'Not Found' });
      gh.manifestCodes.delete(m[1]);
      return json(201, conv);
    }
    if (path === `${R}/installation`) return gh.installed ? json(200, { id: 77 }) : json(404, { message: 'Not Found' });
    if (path === '/app/installations/77/access_tokens' && method === 'POST') return !gh.installed ? json(404, { message: 'Not Found' }) : json(201, { token: 'ghs_test', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    if (path === `${R}/git/ref/heads/main`) return json(200, { object: { sha: gh.head } });
    if ((m = new RegExp(`^${R}/git/commits/([0-9a-f]{40})$`).exec(path))) return json(200, { sha: m[1], tree: { sha: `tree-${m[1]}` }, parents: ((commits.get(m[1]) || {}).parents || []).map((p) => ({ sha: p })) });
    if (path === `${R}/git/trees` && method === 'POST') {
      const base = commits.get(body.base_tree.replace(/^tree-/, ''));
      const next = new Map(base.files);
      for (const t of body.tree) next.set(t.path, t.content);
      const id = `tree-${sha()}`;
      trees.set(id, next);
      return json(201, { sha: id });
    }
    if (path === `${R}/git/commits` && method === 'POST') {
      const id = sha();
      commits.set(id, { files: trees.get(body.tree), parents: body.parents, message: body.message });
      return json(201, { sha: id });
    }
    if (path === `${R}/git/refs/heads/main` && method === 'PATCH') {
      if (gh.failNextRefUpdate) {
        gh.failNextRefUpdate = false;
        // Someone else pushed meanwhile.
        const other = sha();
        const files2 = new Map(commits.get(gh.head).files);
        files2.set('README.md', 'changed by someone else');
        commits.set(other, { files: files2, parents: [gh.head], message: 'other' });
        gh.head = other;
      }
      const c = commits.get(body.sha);
      if (!c || c.parents[0] !== gh.head) return json(422, { message: 'Update is not a fast forward' });
      gh.head = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    if (path === `${R}/pulls` && method === 'GET') {
      const state = u.searchParams.get('state');
      const head = u.searchParams.get('head');
      return json(200, gh.pulls.filter((p) => p.state === state && (!head || `${repo.split('/')[0]}:${p.head.ref}` === head)));
    }
    if ((m = new RegExp(`^${R}/pulls/(\\d+)$`).exec(path))) {
      const p = gh.pulls.find((x) => x.number === Number(m[1]));
      return p ? json(200, p) : json(404, { message: 'Not Found' });
    }
    if ((m = new RegExp(`^${R}/pulls/(\\d+)/merge$`).exec(path)) && method === 'PUT') {
      const p = gh.pulls.find((x) => x.number === Number(m[1]));
      if (p.head.sha !== body.sha) return json(409, { message: 'Head branch was modified' });
      p.state = 'closed';
      p.merged_at = new Date().toISOString();
      gh.merged.push({ number: p.number, method: body.merge_method, auth });
      return json(200, { sha: sha(), merged: true });
    }
    if ((m = new RegExp(`^${R}/commits/([0-9a-f]{40})/check-runs$`).exec(path))) return json(200, { check_runs: gh.checkRuns[m[1]] || [] });
    if (path === `${R}/issues` && method === 'GET') {
      const labels = u.searchParams.get('labels');
      return json(200, gh.issues.filter((i) => i.state === 'open' && (!labels || i.labels.some((l) => l.name === labels))));
    }
    if (path === `${R}/issues` && method === 'POST') {
      const issue = { number: 900 + gh.issues.length, title: body.title, body: body.body, labels: (body.labels || []).map((name) => ({ name })), state: 'open', html_url: `https://github.com/${repo}/issues/${900 + gh.issues.length}`, created_at: new Date().toISOString(), user: { login: 'review-bot[bot]' } };
      gh.issues.push(issue);
      return json(201, issue);
    }
    if ((m = new RegExp(`^${R}/issues/(\\d+)$`).exec(path))) {
      const i = gh.issues.find((x) => x.number === Number(m[1]));
      if (!i) return json(404, { message: 'Not Found' });
      if (method === 'PATCH') Object.assign(i, body);
      return json(200, i);
    }
    if ((m = new RegExp(`^${R}/issues/(\\d+)/comments$`).exec(path)) && method === 'POST') {
      gh.comments.push({ number: Number(m[1]), body: body.body });
      return json(201, { id: 1 });
    }
    if (path === `${R}/labels` && method === 'POST') {
      if (gh.labels.has(body.name)) return json(422, { message: 'already_exists' });
      gh.labels.add(body.name);
      return json(201, { name: body.name });
    }
    if (path === `${R}/actions/workflows/ingest-scheduled.yml/dispatches` && method === 'POST') {
      gh.dispatches.push(body);
      return json(204);
    }
    if (path === `${R}/actions/workflows/ingest-scheduled.yml/runs`) return json(200, { workflow_runs: gh.runs });
    return json(404, { message: `fake GitHub has no ${method} ${path}` });
  };
  return gh;
}

module.exports = { createFakeGitHub };
