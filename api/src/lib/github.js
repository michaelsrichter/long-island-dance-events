'use strict';
/**
 * GitHub access for the review center (decision P51).
 *
 * The Functions act as a GitHub App installed only on this repository. The owner creates the app once
 * from the review center (GitHub's "app manifest" flow): GitHub hands us the app's private key, which
 * is stored encrypted (AES-256-GCM, key in the REVIEW_SECRET_KEY app setting) in the ReviewState table.
 * GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY app settings, when set, take precedence.
 * Tokens are never logged, returned to the browser or written anywhere else.
 */
const { createCipheriv, createDecipheriv, createHash, createSign, randomBytes } = require('node:crypto');
const { table, TABLES } = require('./store');

const API = 'https://api.github.com';
const REPO = process.env.REVIEW_REPO || 'michaelsrichter/long-island-dance-events';
const BRANCH = process.env.REVIEW_BRANCH || 'main';
const [OWNER, NAME] = REPO.split('/');
const STATE = TABLES.review;
const UA = 'LongIslandDanceReviewCenter/1.0';

class GitHubError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/* ---------- the app's private key ---------- */

function secretKey() {
  const s = process.env.REVIEW_SECRET_KEY || '';
  if (s.length < 32) return null;
  return createHash('sha256').update(s).digest();
}

function encrypt(text) {
  const key = secretKey();
  if (!key) throw new Error('REVIEW_SECRET_KEY is not set');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

function decrypt(b64) {
  const key = secretKey();
  if (!key || !b64) return null;
  try {
    const raw = Buffer.from(b64, 'base64');
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function pemFromSetting(v) {
  if (!v) return '';
  if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n');
  try {
    const t = Buffer.from(v, 'base64').toString('utf8');
    return t.includes('-----BEGIN') ? t : '';
  } catch {
    return '';
  }
}

let appCache = null; // { appId, slug, pem, installationId, from, at }
const APP_TTL_MS = 5 * 60 * 1000; // another instance may have set up a new app ("Start over")
let tokenCache = null; // { token, expires }

async function loadApp() {
  if (appCache && (appCache.from === 'settings' || Date.now() - appCache.at < APP_TTL_MS)) return appCache;
  if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) {
    const pem = pemFromSetting(process.env.GITHUB_APP_PRIVATE_KEY);
    if (pem) {
      appCache = { appId: String(process.env.GITHUB_APP_ID), slug: process.env.GITHUB_APP_SLUG || '', pem, installationId: process.env.GITHUB_APP_INSTALLATION_ID || '', from: 'settings', at: Date.now() };
      return appCache;
    }
  }
  let row = null;
  try {
    row = await table(STATE).get('github', 'app');
  } catch {
    row = null;
  }
  const pem = row && decrypt(row.keyCipher);
  if (!row || !pem) return null;
  appCache = { appId: String(row.appId), slug: row.slug || '', pem, installationId: row.installationId || '', from: 'table', at: Date.now() };
  return appCache;
}

function forget() {
  appCache = null;
  tokenCache = null;
}

const b64url = (b) => Buffer.from(b).toString('base64url');

function appJwt(app, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: app.appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(app.pem);
  return `${head}.${body}.${b64url(sig)}`;
}

async function raw(method, path, { body, token, accept } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function installationId(app) {
  if (app.installationId) return app.installationId;
  const r = await raw('GET', `/repos/${REPO}/installation`, { token: appJwt(app) });
  if (r.status !== 200) {
    // Not installed (yet), or the app was replaced: read the stored app again next time.
    if (app.from === 'table') appCache = null;
    return '';
  }
  app.installationId = String(r.data.id);
  if (app.from === 'table') {
    try {
      await table(STATE).merge({ partitionKey: 'github', rowKey: 'app', installationId: app.installationId });
    } catch {
      // Looked up again next time.
    }
  }
  return app.installationId;
}

async function installationToken() {
  if (tokenCache && tokenCache.expires - Date.now() > 5 * 60 * 1000) return tokenCache.token;
  const app = await loadApp();
  if (!app) return null;
  const id = await installationId(app);
  if (!id) return null;
  const r = await raw('POST', `/app/installations/${id}/access_tokens`, { token: appJwt(app), body: { repositories: [NAME] } });
  if (r.status !== 201) {
    if (r.status === 404 || r.status === 401) {
      app.installationId = '';
      tokenCache = null;
      if (app.from === 'table') appCache = null;
    }
    return null;
  }
  tokenCache = { token: r.data.token, expires: Date.parse(r.data.expires_at) };
  return tokenCache.token;
}

/** Where the connection stands, for the review center's setup card. */
async function status() {
  const app = await loadApp();
  if (!app) return { connected: false, installed: false, canSetUp: Boolean(secretKey()), repo: REPO };
  const token = await installationToken();
  return { connected: true, installed: Boolean(token), slug: app.slug, appId: app.appId, canSetUp: Boolean(secretKey()), repo: REPO, installUrl: app.slug ? `https://github.com/apps/${app.slug}/installations/new` : '' };
}

/**
 * A GitHub API call as the app. Reads fall back to an anonymous call (the repository is public) so the
 * review center still shows things before the app is set up; writes need the app.
 */
async function gh(method, path, body, { accept } = {}) {
  const token = await installationToken();
  if (!token && method !== 'GET') throw new GitHubError(428, 'Connect the review center to GitHub first (one-time setup on the To do tab).');
  const r = await raw(method, path, { body, token, accept });
  if (!r.ok) throw new GitHubError(r.status, (r.data && r.data.message) || `GitHub answered ${r.status}`, r.data);
  return r.data;
}

async function graphql(query, variables) {
  const token = await installationToken();
  if (!token) throw new GitHubError(428, 'Connect the review center to GitHub first (one-time setup on the To do tab).');
  const r = await raw('POST', '/graphql', { token, body: { query, variables } });
  if (!r.ok || (r.data && r.data.errors)) throw new GitHubError(r.status === 200 ? 502 : r.status, (r.data && r.data.errors && r.data.errors[0] && r.data.errors[0].message) || 'GitHub GraphQL failed', r.data);
  return r.data.data;
}

/* ---------- reading content files ---------- */

/** The tip of the main branch. */
async function headSha() {
  const d = await gh('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  return d.object.sha;
}

/**
 * Every file in some content folders at one commit, with its text (only for `withText` folders).
 * One small GraphQL call lists the folders (name + blob id); texts are fetched by blob id in batches
 * of 200 and cached by blob id, so after the first load only changed files are fetched again.
 * (Asking GraphQL for the whole folder with its texts at once times out at about 800 files.)
 */
async function readFolders(sha, folders, { withText = folders } = {}) {
  const token = await installationToken();
  if (!token) throw new GitHubError(428, 'Connect the review center to GitHub first (one-time setup on the To do tab).');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new GitHubError(400, 'Bad commit id');
  const parts = folders.map((f, i) => `f${i}: object(expression: "${sha}:src/content/${f}") { ... on Tree { entries { name oid } } }`);
  const data = await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${parts.join(' ')} } }`, { owner: OWNER, name: NAME });
  const out = {};
  const need = [];
  folders.forEach((f, i) => {
    const entries = (data.repository[`f${i}`] && data.repository[`f${i}`].entries) || [];
    out[f] = entries.filter((e) => e.name.endsWith('.json')).map((e) => ({ id: e.name.slice(0, -5), oid: e.oid }));
    if (withText.includes(f)) need.push(...out[f].map((e) => e.oid));
  });
  const texts = await blobs(need);
  for (const f of withText) for (const e of out[f] || []) e.text = texts[e.oid];
  return out;
}

const blobCache = new Map();
const BLOB_BATCH = 200;
const BLOB_CACHE_MAX = 6000;

/** File texts by blob id (cached; blobs never change). */
async function blobs(oids) {
  const missing = [...new Set(oids)].filter((o) => /^[0-9a-f]{40}$/.test(o) && !blobCache.has(o));
  const batches = [];
  for (let i = 0; i < missing.length; i += BLOB_BATCH) batches.push(missing.slice(i, i + BLOB_BATCH));
  for (let i = 0; i < batches.length; i += 4) {
    await Promise.all(
      batches.slice(i, i + 4).map(async (b) => {
        const parts = b.map((o, j) => `b${j}: object(oid: "${o}") { ... on Blob { text } }`);
        const data = await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${parts.join(' ')} } }`, { owner: OWNER, name: NAME });
        b.forEach((o, j) => {
          const x = data.repository[`b${j}`];
          if (x && typeof x.text === 'string') blobCache.set(o, x.text);
        });
      }),
    );
  }
  if (blobCache.size > BLOB_CACHE_MAX) for (const k of [...blobCache.keys()].slice(0, blobCache.size - BLOB_CACHE_MAX)) blobCache.delete(k);
  return Object.fromEntries(oids.map((o) => [o, blobCache.get(o)]));
}

async function readFiles(sha, paths) {
  if (!paths.length) return {};
  const token = await installationToken();
  if (!token) throw new GitHubError(428, 'Connect the review center to GitHub first (one-time setup on the To do tab).');
  const parts = paths.map((p, i) => `f${i}: object(expression: ${JSON.stringify(`${sha}:${p}`)}) { ... on Blob { text } }`);
  const data = await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${parts.join(' ')} } }`, { owner: OWNER, name: NAME });
  const out = {};
  paths.forEach((p, i) => {
    const o = data.repository[`f${i}`];
    out[p] = o ? o.text : null;
  });
  return out;
}

/**
 * One commit on main with several changed files. If main moved meanwhile, `build` runs again on the
 * new tip (it reads the files fresh), so a decision never overwrites someone else's change.
 *   build(sha, files) -> { files: { path: text }, message } | null (nothing to change)
 */
async function commitFiles(build, { attempts = 3 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const base = await headSha();
    const plan = await build(base);
    if (!plan || !Object.keys(plan.files).length) return null;
    const commit = await gh('GET', `/repos/${REPO}/git/commits/${base}`);
    const tree = await gh('POST', `/repos/${REPO}/git/trees`, {
      base_tree: commit.tree.sha,
      tree: Object.entries(plan.files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
    });
    const next = await gh('POST', `/repos/${REPO}/git/commits`, { message: plan.message, tree: tree.sha, parents: [base] });
    try {
      await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: next.sha, force: false });
      return { sha: next.sha, url: `https://github.com/${REPO}/commit/${next.sha}` };
    } catch (e) {
      if (!(e instanceof GitHubError) || e.status !== 422 || i === attempts - 1) throw e;
    }
  }
  return null;
}

/* ---------- one-time setup (GitHub App manifest flow) ---------- */

function manifest(origin) {
  return {
    name: 'Long Island Dance review center',
    url: origin,
    description: 'Lets the owner of longisland.dance publish, fix or hide listings, publish collected events, manage sources and answer messages from the review center (/moderate/). Installed only on the long-island-dance-events repository.',
    hook_attributes: { url: `${origin}/api/github-setup`, active: false },
    redirect_url: `${origin}/api/github-setup`,
    setup_url: `${origin}/moderate/?github=installed`,
    public: false,
    default_permissions: { contents: 'write', pull_requests: 'write', issues: 'write', actions: 'write', checks: 'read', statuses: 'read', metadata: 'read' },
    default_events: [],
  };
}

async function startSetup(origin, actor) {
  const state = randomBytes(24).toString('base64url');
  await table(STATE).upsert({ partitionKey: 'setup', rowKey: state, at: new Date().toISOString(), actor: String(actor).slice(0, 100), used: false });
  return { state, action: `https://github.com/settings/apps/new?state=${state}`, manifest: manifest(origin) };
}

/** GitHub sent the browser back with a one-time code: swap it for the app's key and keep it, encrypted. */
async function finishSetup(state, code) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(state || '') || !/^[A-Za-z0-9]{10,64}$/.test(code || '')) return { ok: false, reason: 'bad_request' };
  const row = await table(STATE).get('setup', state);
  if (!row || row.used || Date.now() - Date.parse(row.at) > 60 * 60 * 1000) return { ok: false, reason: 'expired' };
  await table(STATE).merge({ partitionKey: 'setup', rowKey: state, used: true });
  if (!secretKey()) return { ok: false, reason: 'no_secret' };
  const r = await raw('POST', `/app-manifests/${code}/conversions`);
  if (r.status !== 201 || !r.data || !r.data.pem) return { ok: false, reason: 'github' };
  const owner = r.data.owner && r.data.owner.login;
  if (String(owner).toLowerCase() !== OWNER.toLowerCase()) return { ok: false, reason: 'wrong_owner', owner };
  await table(STATE).upsert({
    partitionKey: 'github',
    rowKey: 'app',
    appId: String(r.data.id),
    slug: r.data.slug,
    owner,
    keyCipher: encrypt(r.data.pem),
    installationId: '',
    connectedAt: new Date().toISOString(),
    actor: row.actor || '',
  });
  forget();
  return { ok: true, slug: r.data.slug, appId: String(r.data.id), actor: row.actor || '' };
}

module.exports = {
  REPO, BRANCH, OWNER, NAME, GitHubError,
  gh, graphql, headSha, readFolders, readFiles, commitFiles, status, installationToken,
  startSetup, finishSetup, manifest, encrypt, decrypt, appJwt, forget,
};
