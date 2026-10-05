#!/usr/bin/env node
/**
 * End-to-end test of visitor sign-in (Entra External ID, email one-time code) and the
 * "Dancers' notes and photos" panel against a deployed site, usually a PR preview.
 * A real AgentMail inbox receives the one-time code.
 *
 *   $env:AGENTMAIL_API_KEY = '<key>'          # keep it in the environment; never commit it
 *   node scripts/e2e-signin.mjs --base https://<preview>.azurestaticapps.net --email someone@agentmail.to
 *
 * Options
 *   --base <url>      site to test (or E2E_BASE_URL)
 *   --email <addr>    AgentMail inbox that signs in (or E2E_EMAIL)
 *   --venue <id>      venue page to test on (default huntington-moose-lodge)
 *   --steps <list>    e.g. "1-7,10" (default), "8", "9", "11", "cleanup"
 *                       1 signed-out panel      2 sign up            3 welcome step
 *                       4 header and footer     5 like               6 notes and correction
 *                       7 photo upload          8 /moderate/ as non-moderator
 *                       9 moderate as admin (the email must be in ADMIN_EMAILS first)
 *                      10 account: rename, export, delete          11 sign in again after delete
 *                      13 sign out (run in a new command, i.e. after a browser restart) and sign in again
 *                      sa  site session ended, sign-in service session still active: name stays, Like works
 *                          without a reload (also: Like clicked after the session ended completes by itself)
 *                      sb  browser restart: same day (site cookie kept) and next day (site cookie gone)
 *                      sc  sign out, then come back: stays signed out (then signs in again for later steps)
 *                      sd  a fresh private window: "Sign in", no sign-in requests or redirects
 *                      cleanup  delete the test account if it still exists
 *   --out <dir>       screenshots and report.json (default test-results/e2e-signin)
 *   --headed          show the browser
 *   --ux              also take phone/desktop, light/dark screenshots of key pages
 *   --no-cleanup      with step 11: leave the fresh account in place (run "cleanup" later)
 *   --kmsi yes|no     answer to Microsoft's "Stay signed in?" question, if it is asked (default yes)
 *
 * The browser profile is kept in <out>/profile, so steps can be run in separate commands
 * (for example "1-7", then "9" after adding the email to ADMIN_EMAILS, then "10,11").
 * Steps always run in the order listed above (10 before sa-sd), so run "10" in its own command last.
 * ADMIN_EMAILS is set per environment: for a PR preview use
 *   az staticwebapp appsettings set ... --environment-name <PR number> --setting-names "ADMIN_EMAILS=..."
 * Everything the test posts is removed again by step 10 (delete my account).
 * "Sign out" ends only the site's session (no External ID sign-out page); the script also copes with
 * older setups that show "Which account do you want to sign out of?".
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const args = parseArgs(process.argv.slice(2));
const API_KEY = process.env.AGENTMAIL_API_KEY;
const BASE = String(args.base || process.env.E2E_BASE_URL || '').replace(/\/+$/, '');
const EMAIL = String(args.email || process.env.E2E_EMAIL || '');
const VENUE = String(args.venue || 'huntington-moose-lodge');
const OUT = path.resolve(String(args.out || 'test-results/e2e-signin'));
const STEPS = expandSteps(String(args.steps || '1-7,10'));
if (STEPS.includes('9') && !STEPS.includes('9b')) STEPS.splice(STEPS.indexOf('9') + 1, 0, '9b');
if (STEPS.includes('11') && !STEPS.includes('cleanup') && !args['no-cleanup']) STEPS.push('cleanup');
const HEADED = Boolean(args.headed);
const KMSI = String(args.kmsi || 'yes').toLowerCase() === 'no' ? 'no' : 'yes';

if (!API_KEY) fail('AGENTMAIL_API_KEY is not set. Put the AgentMail API key in that environment variable (never in a file).');
if (!/^https?:\/\//.test(BASE)) fail('Pass --base https://<site> (or set E2E_BASE_URL).');
if (!/^[^@\s]+@[^@\s]+$/.test(EMAIL)) fail('Pass --email <inbox address> (or set E2E_EMAIL).');

const ORIGIN = new URL(BASE).origin;
const KEY = `venue:${VENUE}`;
const VENUE_URL = `${BASE}/venues/${VENUE}/`;
const STATE_FILE = path.join(OUT, 'state.json');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const NAME = 'E2E Tester';
const RENAMED = 'E2E Renamed';
// Note texts are kept in state.json so later runs (step 9, 10) can find what step 6 posted.
let CLEAN_NOTE = '';
let PHONE_NOTE = '';
let CORRECTION = '';
function newTexts() {
  const tag = new Date().toISOString().slice(11, 19);
  return {
    clean: `Great floor and friendly crowd, test note ${tag}`,
    phone: `Test note: call me at 631-555-0142 about carpools ${tag}`,
    correction: `Test correction: the parking lot entrance is on the side street ${tag}`,
  };
}
function useTexts(t) {
  state.texts = t;
  ({ clean: CLEAN_NOTE, phone: PHONE_NOTE, correction: CORRECTION } = t);
}

const results = [];
const usedMessages = new Set();
let state = {};
let shotNo = 0;

function fail(msg) {
  console.error(`e2e-signin: ${msg}`);
  process.exit(2);
}

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true;
    out[k] = v;
  }
  return out;
}

function expandSteps(spec) {
  const out = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(String(n));
    else out.push(part);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/* ---------------- AgentMail ---------------- */

async function agentmail(p) {
  const res = await fetch(`https://api.agentmail.to/v0${p}`, { headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`AgentMail ${res.status} for ${p.replace(/\?.*/, '')}`);
  return res.json();
}

/** The code is the only thing read from the email; its content is never followed. */
function extractCode(text) {
  const near = text.match(/code[^0-9]{0,60}?(\d{4,8})\b/i);
  if (near) return near[1];
  const any = text.match(/\b(\d{6,8})\b/);
  return any ? any[1] : null;
}

async function waitForCode(since) {
  const inbox = encodeURIComponent(EMAIL);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    // Unfiltered list (newest first): filtered lists go through AgentMail search, which can lag.
    const list = await agentmail(`/inboxes/${inbox}/messages?limit=10`);
    for (const m of list.messages || []) {
      if (usedMessages.has(m.message_id) || new Date(m.timestamp).getTime() < since - 60_000) continue;
      const full = await agentmail(`/inboxes/${inbox}/messages/${encodeURIComponent(m.message_id)}`);
      const text = [full.subject, full.extracted_text, full.text, full.preview].filter(Boolean).join('\n');
      if (!/code|verif/i.test(text)) continue;
      const code = extractCode(text);
      if (code) {
        usedMessages.add(m.message_id);
        return { code, from: m.from, subject: m.subject, at: m.timestamp, waitedMs: Date.now() - since };
      }
    }
    await sleep(3000);
  }
  throw new Error('No email with a one-time code arrived within 3 minutes.');
}

/* ---------------- browser helpers ---------------- */

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${String(++shotNo).padStart(3, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: Boolean(opts.full) }).catch(() => {});
  return path.basename(file);
}

async function shotEl(locator, name) {
  const file = path.join(OUT, `${String(++shotNo).padStart(3, '0')}-${name}.png`);
  await locator.screenshot({ path: file }).catch(() => {});
  return path.basename(file);
}

function watch(page) {
  const log = { console: [], pageErrors: [], badResponses: [] };
  const where = () => {
    try {
      const u = new URL(page.url());
      return `${u.host === new URL(ORIGIN).host ? '' : u.host}${u.pathname}`;
    } catch {
      return '?';
    }
  };
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.console.push(`${m.type()} on ${where()}: ${m.text()}`.slice(0, 400));
  });
  page.on('pageerror', (e) => log.pageErrors.push(`on ${where()}: ${String(e)} ${String(e.stack || '').split('\n')[1] || ''}`.slice(0, 400)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(ORIGIN)) log.badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(ORIGIN, '')}`);
  });
  return log;
}

function drain(log) {
  const copy = { console: [...log.console], pageErrors: [...log.pageErrors], badResponses: [...log.badResponses] };
  log.console.length = 0;
  log.pageErrors.length = 0;
  log.badResponses.length = 0;
  return copy;
}

async function readModel(page) {
  const src = await page.locator('[data-community]').getAttribute('data-src');
  const url = new URL(src, BASE).toString();
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
  if (res.status === 404) return { url, doc: { likes: 0, comments: [], photos: [] } };
  if (!res.ok) return { url, status: res.status, doc: null };
  return { url, doc: await res.json() };
}

async function dismissConsent(page) {
  const no = page.getByRole('button', { name: 'No, thanks' });
  if (await no.isVisible().catch(() => false)) await no.click().catch(() => {});
}

/** Scroll an element into view the way the browser does for focus, then report what (if anything) sits on top of it. */
async function coveredBy(page, locator) {
  return locator.evaluate((el) => {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || top === el || el.contains(top) || top.contains(el) || (el.labels && [...el.labels].some((l) => l.contains(top)))) return '';
    return `${top.tagName.toLowerCase()}${top.closest('[data-consent]') ? ' in the consent pop-up' : ''}`;
  });
}

/** The Like button at the top of a detail page (components/Reactions.astro, variant "hero"). */
const HERO_LIKE = '[data-react][data-detail] [data-like]';

async function likeCount(page) {
  const text = (await page.locator(`${HERO_LIKE} [data-like-count]`).textContent()) || '';
  return Number(text.replace(/\D+/g, '')) || 0;
}

async function waitPanelReady(page) {
  await page.locator('[data-community]').waitFor({ timeout: 30_000 });
  await dismissConsent(page);
  // The panel code loads only when the panel scrolls into view (or the address ends in #community).
  await page.locator('[data-community]').scrollIntoViewIfNeeded();
  await page.locator('[data-panel-loading]').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  // Signed-in state settles after /api/me returns: the Like button is enabled and one of the two panel blocks shows.
  await page.waitForFunction((sel) => {
    const p = document.querySelector('[data-community]');
    if (!p) return false;
    const out = p.querySelector('[data-signed-out]');
    const inn = p.querySelector('[data-signed-in]');
    const like = document.querySelector(sel);
    return like && !like.disabled && ((out && !out.hidden) !== (inn && !inn.hidden));
  }, HERO_LIKE, { timeout: 60_000 });
  // Signed-in visitors: wait until /api/me and /api/me/likes have answered and the member area shows.
  if (await principal(page)) await page.locator('#community [data-signed-in]').waitFor({ state: 'visible', timeout: 60_000 });
}

async function headerLabel(page) {
  return (await page.locator('[data-account-header] [data-account-label]').first().textContent())?.trim();
}

async function api(page, p, init) {
  // The API only accepts POSTs whose Origin is the site itself (CSRF protection).
  const res = init ? await page.request.post(`${BASE}${p}`, { ...init, headers: { Origin: ORIGIN, ...(init.headers || {}) } }) : await page.request.get(`${BASE}${p}`);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status(), data };
}

async function principal(page) {
  const r = await api(page, '/.auth/me');
  return r.data?.clientPrincipal || null;
}

function loginUrl(next) {
  return `${BASE}/.auth/login/extid?post_login_redirect_uri=${encodeURIComponent(`${ORIGIN}/account/?next=${encodeURIComponent(next)}`)}`;
}

/** Take overflow, light/dark and phone/desktop screenshots of the current page (step 12 evidence). */
async function uxShots(page, name) {
  const notes = [];
  const size = page.viewportSize();
  for (const [w, h] of [
    [390, 844],
    [1280, 900],
  ]) {
    for (const scheme of ['light', 'dark']) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) notes.push(`${name} at ${w}px ${scheme}: page scrolls sideways by ${overflow}px`);
      await shot(page, `ux-${name}-${w}-${scheme}`, { full: true });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  if (size) await page.setViewportSize(size);
  return notes;
}

/* ---------------- External ID sign-in ---------------- */

const SEL = {
  email: 'input[type=email], input[name=loginfmt], input[name=username], input[name=email], input[autocomplete=username]',
  code: 'input[name=otc], #idTxtBx_OTC_Password, input[autocomplete="one-time-code"], input[aria-label*="code" i], input[placeholder*="code" i], input[name*="code" i], input[id*="code" i], input[id*="otc" i]',
  password: 'input[type=password]',
  name: 'input[name*="displayName" i], input[id*="displayName" i], input[aria-label*="display name" i], input[placeholder*="display name" i], input[name=givenName], input[id*="givenName" i], input[name=surname], input[id*="surname" i]',
  primary: '#idSIButton9, button[type=submit], input[type=submit]',
};

async function firstVisible(page, selector) {
  const all = page.locator(selector);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function clickPrimary(page) {
  const named = page.getByRole('button', { name: /^(next|continue|sign in|verify|create|create account|accept|yes|submit|send code)$/i });
  if (await named.first().isVisible().catch(() => false)) return named.first().click();
  const btn = await firstVisible(page, SEL.primary);
  if (btn) return btn.click();
  return null;
}

async function settle(page, before) {
  const t = Date.now();
  while (Date.now() - t < 25_000) {
    await sleep(500);
    const url = page.url();
    if (url !== before.url) return;
    const body = await page.locator('body').innerText().catch(() => '');
    if (body !== before.body) return;
  }
}

/**
 * Drive the hosted External ID pages until we are back on the site. Works for sign-up and sign-in:
 * fills the email, reads the one-time code from AgentMail, fills a display name if asked, and
 * answers "Stay signed in?" with --kmsi (default yes).
 */
async function completeAuth(page, { signup = false, label = 'auth' } = {}) {
  const t0 = Date.now();
  const hops = [];
  let codeRequestedAt = Date.now();
  let clickedCreate = !signup;
  let lastSig = '';
  let same = 0;
  for (let i = 0; i < 30; i++) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const url = page.url();
    const u = new URL(url);
    if (u.origin === ORIGIN && !u.pathname.startsWith('/.auth/')) return { ms: Date.now() - t0, hops };
    if (u.origin === ORIGIN || /^about:/.test(url)) {
      await sleep(700);
      continue;
    }
    await sleep(800);
    // The hosted page renders with JavaScript; wait until it shows a field or a button.
    await page.locator(`${SEL.email}, ${SEL.code}, ${SEL.primary}, button`).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    const body = await page.locator('body').innerText().catch(() => '');
    // The page may have finished redirecting while we waited; only act on Microsoft sign-in pages.
    if (!/(ciamlogin\.com|microsoftonline\.com|login\.live\.com)$/i.test(new URL(page.url()).hostname)) continue;
    const sig = `${u.host}${u.pathname}|${body.slice(0, 300)}`;
    same = sig === lastSig ? same + 1 : 0;
    lastSig = sig;
    if (same >= 6) {
      await shot(page, `${label}-stuck`, { full: true });
      throw new Error(`Sign-in page did not move on: ${u.host}${u.pathname} - "${body.replace(/\s+/g, ' ').slice(0, 200)}"`);
    }
    const before = { url, body };
    const step = { at: Date.now() - t0, host: u.host, text: body.replace(/\s+/g, ' ').slice(0, 120) };
    hops.push(step);
    if (same > 0) await shot(page, `${label}-${i}`);
    else step.shot = await shot(page, `${label}-${i}`);

    if (/stay signed in/i.test(body)) {
      step.action = `stay-signed-in: ${KMSI}`;
      await page.getByRole('button', { name: KMSI === 'yes' ? /^yes$/i : /^no$/i }).click().catch(() => clickPrimary(page));
      await settle(page, before);
      continue;
    }
    if (/pick an account/i.test(body)) {
      const signingOut = /sign out of/i.test(body);
      const tile = page.getByText(EMAIL, { exact: false }).first();
      if (!(await tile.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
        await shot(page, `${label}-empty-picker`);
        throw new Error(`External ID "${signingOut ? 'Which account do you want to sign out of?' : 'Pick an account'}" page lists no account to click`);
      }
      step.action = signingOut ? 'picked the account to sign out' : 'picked the account';
      await tile.click();
      codeRequestedAt = Date.now();
      await settle(page, before);
      continue;
    }
    const codeInput = await firstVisible(page, SEL.code);
    if (codeInput) {
      const mail = await waitForCode(codeRequestedAt);
      step.action = `code from AgentMail after ${secs(mail.waitedMs)} (sender ${mail.from})`;
      step.mailWaitMs = mail.waitedMs;
      await codeInput.fill(mail.code);
      await clickPrimary(page);
      await settle(page, before);
      continue;
    }
    if (!clickedCreate) {
      const create = page.getByText(/create one|create an account|sign up/i).first();
      if (await create.isVisible().catch(() => false)) {
        clickedCreate = true;
        step.action = 'clicked "Create one"';
        await create.click();
        await settle(page, before);
        continue;
      }
    }
    const email = await firstVisible(page, SEL.email);
    if (email && !(await email.inputValue())) {
      step.action = 'entered email';
      await email.fill(EMAIL);
      codeRequestedAt = Date.now();
      await clickPrimary(page);
      await settle(page, before);
      continue;
    }
    if (await firstVisible(page, SEL.password)) {
      const alt = page.getByText(/email code|use a code|send code|sign in another way|send me a code/i).first();
      if (await alt.isVisible().catch(() => false)) {
        step.action = 'asked for a code instead of a password';
        codeRequestedAt = Date.now();
        await alt.click();
        await settle(page, before);
        continue;
      }
      throw new Error('External ID asked for a password; this test expects email one-time codes only.');
    }
    const nameInput = await firstVisible(page, SEL.name);
    if (nameInput && !(await nameInput.inputValue())) {
      step.action = 'filled display name';
      await nameInput.fill(NAME);
    }
    for (const box of await page.locator('input[type=checkbox]:visible').all()) {
      if (!(await box.isChecked()) && (await box.getAttribute('required')) !== null) await box.check().catch(() => {});
    }
    if (/couldn.t find an account|doesn.t exist|no account found/i.test(body) && !clickedCreate) continue;
    if (/already exists|already have an account|already registered/i.test(body)) {
      const instead = page.getByText(/sign in instead|sign in/i).first();
      if (await instead.isVisible().catch(() => false)) {
        step.action = 'account exists: "Sign in instead"';
        await instead.click();
        await settle(page, before);
        continue;
      }
    }
    step.action = `${step.action ? `${step.action}; ` : ''}clicked primary button`;
    if ((await clickPrimary(page)) === null) await sleep(1500);
    else await settle(page, before);
  }
  throw new Error('Gave up after 30 sign-in pages.');
}

/* ---------------- steps ---------------- */

const NEEDS_SIGN_IN = new Set(['3', '4', '5', '6', '7', '8', '9', '9b', '10', 'sa', 'sb', 'sc']);
let blocked = '';

async function step(id, title, fn, page, watchLog) {
  if (!STEPS.includes(id)) return;
  const r = { step: id, title, pass: true, notes: [], issues: [], timings: {}, shots: [] };
  if (blocked && NEEDS_SIGN_IN.has(id)) {
    r.pass = false;
    r.skipped = true;
    r.issues.push(`Skipped: ${blocked}`);
    console.log(`\n== Step ${id}: ${title}\nSKIP (${blocked})`);
    results.push(r);
    return;
  }
  const t0 = Date.now();
  const check = (ok, msg) => {
    if (!ok) {
      r.pass = false;
      r.issues.push(msg);
    }
    return ok;
  };
  console.log(`\n== Step ${id}: ${title}`);
  try {
    await fn({ r, check });
  } catch (e) {
    r.pass = false;
    r.issues.push(`Exception: ${e.message}`);
    r.shots.push(await shot(page, `step${id}-error`, { full: true }));
  }
  r.timings.total = Date.now() - t0;
  // Later steps need a signed-in, finished profile; a soft check (like the spinner) does not block them.
  if ((id === '2' || id === '3') && r.issues.some((i) => /^Exception|clientPrincipal|did not get the welcome/.test(i))) blocked = `step ${id} (sign-in) failed`;
  const seen = drain(watchLog);
  const unexpected = [...seen.pageErrors, ...seen.console.filter((c) => !/Failed to load resource: the server responded with a status of 40[134]/.test(c))];
  if (unexpected.length) r.notes.push(`Console: ${unexpected.join(' | ')}`);
  if (seen.badResponses.length) r.notes.push(`HTTP 4xx/5xx on the site: ${[...new Set(seen.badResponses)].join(', ')}`);
  console.log(`${r.pass ? 'PASS' : 'FAIL'} (${secs(r.timings.total)})${r.issues.length ? `\n  - ${r.issues.join('\n  - ')}` : ''}${r.notes.length ? `\n  notes: ${r.notes.join('\n         ')}` : ''}`);
  results.push(r);
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function signOut(page) {
  const t = Date.now();
  await page.goto(`${BASE}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(`${ORIGIN}/`)}`);
  // SWA also signs out of External ID, which asks "Which account do you want to sign out of?".
  const auth = await completeAuth(page, { label: 'signout' });
  await page.evaluate(() => localStorage.removeItem('li-account')).catch(() => {});
  return { ms: Date.now() - t, landed: page.url(), hops: auth.hops };
}

const hopText = (hops) => hops.map((h) => `[${secs(h.at)}] ${h.action || '-'} :: ${h.text}`).join(' || ');

/* ---------------- session helpers (steps sa-sd) ---------------- */

/** The site's own sign-in cookies (Static Web Apps). The sign-in service's cookies are on ciamlogin.com. */
const isSiteAuthCookie = (c) => /^(StaticWebAppsAuth|AppServiceAuthSession)/.test(c.name);

/** End only the site's session, as if its cookie expired; the sign-in service session stays. */
async function dropSiteSession(context) {
  await context.clearCookies({ name: /^(StaticWebAppsAuth|AppServiceAuthSession)/ });
}

/** Page loads (including each redirect) and auth-related requests from now on (call stop() to read them). */
function trackNav(page) {
  const t0 = Date.now();
  const navs = [];
  const authReqs = [];
  const onReq = (req) => {
    const u = req.url();
    let main = false;
    try {
      main = req.isNavigationRequest() && req.frame() === page.mainFrame();
    } catch {
      main = false;
    }
    if (main) {
      const p = new URL(u);
      navs.push({ at: Date.now() - t0, host: p.host, path: p.pathname, url: u });
    }
    if (/\/\.auth\/|ciamlogin\.com|\/api\/me\b/.test(u)) authReqs.push(`${req.method()} ${u.replace(/\?.*$/, '')}`);
  };
  page.on('request', onReq);
  return {
    stop() {
      page.off('request', onReq);
      return { navs, authReqs, text: navs.map((n) => `[${secs(n.at)}] ${n.host === new URL(ORIGIN).host ? '' : n.host}${n.path}`).join(' > ') };
    },
  };
}

/** Records every text the header account link shows on each page (window.__labels). */
async function recordHeaderLabels(context) {
  await context.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__labels = [];
    const rec = () => {
      const el = document.querySelector('[data-account-header] [data-account-label]');
      const t = el && el.textContent ? el.textContent.trim() : null;
      if (t !== null && w.__labels[w.__labels.length - 1] !== t) w.__labels.push(t);
    };
    new MutationObserver(rec).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

/** Header texts after the page's own (static) "Sign in": the name must never turn back into "Sign in". */
async function headerFlips(page) {
  const labels = (await page.evaluate(() => /** @type {any} */ (window).__labels || []).catch(() => [])) || [];
  const firstName = labels.findIndex((l) => l !== 'Sign in');
  const flipped = firstName >= 0 && labels.slice(firstName).includes('Sign in');
  return { labels, flipped };
}

async function waitSettled(page) {
  // A silent sign-in may leave and come back right after the page loads: start over when that happens.
  for (const end = Date.now() + 90_000; ; ) {
    try {
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForURL((u) => u.origin === ORIGIN && !u.pathname.startsWith('/.auth/'), { timeout: 60_000 });
      await page.waitForTimeout(1500);
      await waitPanelReady(page);
      return;
    } catch (e) {
      if (Date.now() > end || !/context|navigat|destroyed|detached/i.test(String(e?.message))) throw e;
    }
  }
}

/** How long the sign-in service remembers visitors after the browser closes (src/data/community.json). */
async function signInServiceDays() {
  try {
    const cfg = JSON.parse(await readFile(new URL('../src/data/community.json', import.meta.url), 'utf8'));
    return Number(cfg.signInServiceDays) || 0;
  } catch {
    return 0;
  }
}

/** From a page's sign-in link to "back on that page": External ID, then /account/ (welcome step if needed). */
async function signInFromPanel(page, r, { signup, welcome }) {
  await page.goto(`${VENUE_URL}#community`);
  await waitPanelReady(page);
  const t0 = Date.now();
  await page.locator('[data-signin]').click();
  const auth = await completeAuth(page, { signup, label: signup ? 'signup' : 'signin' });
  r.timings.externalId = auth.ms;
  r.timings.mailWait = auth.hops.filter((h) => h.mailWaitMs).map((h) => h.mailWaitMs);
  r.notes.push(`External ID pages: ${auth.hops.map((h) => `[${secs(h.at)}] ${h.action || '-'} :: ${h.text}`).join(' || ')}`);
  r.shots.push(...auth.hops.map((h) => h.shot).filter(Boolean));
  const arrive = Date.now();
  // Timeline of what the account page shows while it loads (spinner, "taking you back", form).
  const timeline = [];
  let spinner = false;
  let lastState = '';
  let outcome = '';
  while (Date.now() - arrive < 90_000) {
    const s = await page
      .evaluate(() => {
        const vis = (sel) => {
          const el = document.querySelector(sel);
          return Boolean(el && !el.hidden && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        };
        return { path: location.pathname, ready: document.readyState, spinner: vis('[data-loading]'), returning: vis('[data-returning]'), form: vis('[data-profile]') };
      })
      .catch(() => ({ path: '(navigating)', ready: '', spinner: false, returning: false, form: false }));
    const label = `${s.path} ${s.ready}${s.spinner ? ' spinner' : ''}${s.returning ? ' taking-you-back' : ''}${s.form ? ' form' : ''}`;
    if (label !== lastState) {
      timeline.push(`${secs(Date.now() - arrive)} ${label}`);
      if (timeline.length <= 6) r.shots.push(await shot(page, `account-loading-${timeline.length}`));
      lastState = label;
    }
    if (s.spinner) spinner = true;
    if (s.form) {
      outcome = 'welcome';
      break;
    }
    if (s.path.startsWith(`/venues/${VENUE}/`)) {
      outcome = 'back';
      break;
    }
    await sleep(150);
  }
  if (!outcome) throw new Error(`The account page did not show the form or return within 90 s (${timeline.join(' > ')})`);
  r.notes.push(`Account page timeline: ${timeline.join(' > ')}`);
  r.timings.accountPage = Date.now() - arrive;
  r.timings.signInTotal = Date.now() - t0;
  return { outcome, spinner, welcome, hops: auth.hops };
}

async function fillWelcome(page, r, check, { photoRules }) {
  const heading = (await page.locator('[data-profile-heading]').textContent())?.trim();
  check(heading === 'Welcome! One more step', `Welcome heading was "${heading}"`);
  const name = await page.locator('#acct-name').inputValue();
  r.notes.push(`Name prefilled with "${name}"`);
  // External ID asks only for the email, so there may be no name to suggest; never a placeholder or an email.
  check(!/^unknown$/i.test(name) && !name.includes('@'), `Name prefilled with a placeholder or email: "${name}"`);
  const months = await page.locator('#acct-month option').count();
  const years = await page.locator('#acct-year option').count();
  check(months === 13, `Month dropdown has ${months} options (expected 12 + placeholder)`);
  check(years >= 100, `Year dropdown has ${years} options`);
  r.shots.push(await shot(page, 'welcome-form', { full: true }));
  if (STEPS.includes('12') || args.ux) r.notes.push(...(await uxShots(page, 'welcome')));
  // The consent pop-up may show on first visit; the form's fields and Save button must be reachable above it.
  if (await page.locator('[data-consent]').isVisible().catch(() => false)) {
    for (const [w, h] of [
      [390, 844],
      [1280, 900],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      for (const sel of ['#acct-year', 'input[name=photoTerms]', '[data-save]']) {
        const covered = await coveredBy(page, page.locator(sel));
        check(!covered, `At ${w}px the consent pop-up covers ${sel} even after scrolling to it (${covered})`);
      }
      r.shots.push(await shot(page, `welcome-with-consent-${w}`));
    }
  }
  await dismissConsent(page);
  await page.locator('#acct-name').fill(NAME);
  const year = new Date().getFullYear() - 30;
  await page.locator('#acct-month').selectOption('1');
  await page.locator('#acct-year').selectOption(String(year));
  await page.locator('input[name=acceptRules]').check();
  if (photoRules) await page.locator('input[name=photoTerms]').check();
  r.shots.push(await shot(page, 'welcome-filled', { full: true }));
  const t = Date.now();
  const saved = page.waitForResponse((res) => res.url().includes('/api/me/profile'), { timeout: 60_000 });
  await page.locator('[data-save]').click();
  const res = await saved;
  r.timings.profileSave = Date.now() - t;
  check(res.status() === 200, `POST /api/me/profile returned ${res.status()}`);
  await page.waitForURL((u) => u.pathname.startsWith(`/venues/${VENUE}/`), { timeout: 30_000 });
  r.timings.saveToBack = Date.now() - t;
  await waitPanelReady(page);
  r.shots.push(await shot(page, 'back-on-venue'));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  shotNo = (await readdir(OUT)).filter((f) => f.endsWith('.png')).length;
  if (existsSync(STATE_FILE)) state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
  useTexts(STEPS.includes('1') || !state.texts ? newTexts() : state.texts);
  const context = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
    headless: !HEADED,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  context.setDefaultTimeout(30_000);
  await recordHeaderLabels(context);
  const page = context.pages()[0] || (await context.newPage());
  const log = watch(page);

  await step('1', 'Signed out: venue panel, sign-in button, header', async ({ r, check }) => {
    await context.clearCookies();
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    const t = Date.now();
    await page.goto(`${VENUE_URL}#community`);
    await waitPanelReady(page);
    r.timings.panelReady = Date.now() - t;
    const panel = page.locator('#community');
    check(await panel.isVisible(), 'Panel #community not visible');
    check((await page.locator('#community-h').textContent())?.trim() === "Dancers' notes and photos", 'Panel heading text differs');
    const btn = page.locator('[data-signin]');
    check(await btn.isVisible(), 'Sign-in button not visible');
    check(/Sign in to like, comment or add a photo/.test((await btn.textContent()) || ''), `Sign-in button text: ${await btn.textContent()}`);
    const href = await btn.getAttribute('href');
    check(href?.includes('/.auth/login/extid') && href.includes(encodeURIComponent('/account/?next=')), `Sign-in href: ${href}`);
    check((await headerLabel(page)) === 'Sign in', `Header says "${await headerLabel(page)}"`);
    const { doc, url } = await readModel(page);
    state.baseline = { likes: doc?.likes || 0, comments: doc?.comments?.length || 0, photos: doc?.photos?.length || 0, url };
    r.notes.push(`Read model ${url}: ${JSON.stringify(state.baseline)}`);
    r.shots.push(await shotEl(panel, 'signed-out-panel'), await shot(page, 'signed-out-page'));
    if (STEPS.includes('12') || args.ux) r.notes.push(...(await uxShots(page, 'signed-out-venue')));
  }, page, log);

  let welcome = null;
  await step('2', 'Sign up with the AgentMail address (External ID, one-time code)', async ({ r, check }) => {
    const res = await signInFromPanel(page, r, { signup: true });
    welcome = res;
    check(!res.hops.some((h) => /add details/i.test(h.text)), 'External ID still asks for extra details (a display name) at sign-up');
    r.notes.push(`Account page: spinner seen ${res.spinner}; ${secs(r.timings.accountPage)} from arriving to the form`);
    if (r.timings.accountPage > 3000) r.notes.push(`Slow: the account page took ${secs(r.timings.accountPage)} to show the welcome form`);
    check(res.outcome === 'welcome', `After sign-up we did not get the welcome step (outcome: ${res.outcome})`);
    const p = await principal(page);
    check(Boolean(p), '/.auth/me has no clientPrincipal after sign-in');
    if (p) r.notes.push(`Roles: ${p.userRoles.join(', ')}; provider ${p.identityProvider}`);
  }, page, log);

  await step('3', 'Welcome step on /account/ and return to the venue', async ({ r, check }) => {
    if (!page.url().includes('/account/')) throw new Error(`Not on the account page (${page.url()})`);
    if (welcome && !welcome.spinner) r.notes.push('The "Loading your account…" spinner was not seen (the form showed before the first check, so loading was fast)');
    await fillWelcome(page, r, check, { photoRules: true });
    const me = await api(page, '/api/me');
    r.notes.push(`/api/me: ${JSON.stringify(me.data?.user)}`);
    check(me.data?.user?.canPostPhotos === true && me.data?.user?.adult === true, 'User is not marked adult / allowed to post photos');
    state.displayName = me.data?.user?.displayName;
  }, page, log);

  await step('4', 'Header shows first name; footer shows "Your profile" and "Sign out"', async ({ r, check }) => {
    await page.goto(VENUE_URL);
    await waitPanelReady(page);
    const label = await headerLabel(page);
    check(label === NAME.split(' ')[0], `Header label "${label}"`);
    const footerLabel = (await page.locator('.site-footer [data-account-label]').textContent())?.trim();
    check(footerLabel === 'Your profile', `Footer label "${footerLabel}"`);
    check(await page.locator('.site-footer [data-account-signout]').isVisible(), 'Footer "Sign out" hidden');
    check(!(await page.locator('.site-footer [data-account-when="admin"]').isVisible()), 'Footer shows the moderation link to a non-moderator');
    r.shots.push(await shotEl(page.locator('header').first(), 'header-signed-in'), await shotEl(page.locator('.site-footer section[aria-labelledby=footer-account]'), 'footer-signed-in'));
    if (STEPS.includes('12') || args.ux) {
      await page.locator('[data-photo-details] summary').click();
      r.notes.push(...(await uxShots(page, 'signed-in-venue')));
      await page.locator('[data-photo-details] summary').click();
    }
  }, page, log);

  await step('5', 'Like, persist after reload, unlike and like again', async ({ r, check }) => {
    await page.goto(`${VENUE_URL}#community`);
    await waitPanelReady(page);
    const like = page.locator(HERO_LIKE);
    const before = (await likeCount(page));
    if ((await like.getAttribute('aria-pressed')) === 'true') {
      r.notes.push('Already liked from an earlier run; unliking first');
      await like.click();
      await page.waitForFunction(() => document.querySelector('[data-react][data-detail] [data-like]')?.getAttribute('aria-pressed') === 'false');
    }
    const t = Date.now();
    const resP = page.waitForResponse((x) => x.url().includes('/api/likes'));
    await like.click();
    const res = await resP;
    r.timings.like = Date.now() - t;
    check(res.status() === 200, `POST /api/likes ${res.status()}`);
    await page.waitForFunction(() => document.querySelector('[data-react][data-detail] [data-like]')?.getAttribute('aria-pressed') === 'true');
    const count = (await likeCount(page));
    r.notes.push(`Count ${before} -> ${count}; toast "${(await page.locator('.toast, [data-toast]').last().textContent().catch(() => '')) || ''}"`);
    check(count >= 1, 'Like count did not show');
    r.shots.push(await shotEl(page.locator('.page-header'), 'liked'));
    const liked = await api(page, `/api/me/likes?keys=${encodeURIComponent(KEY)}`);
    check(liked.data?.liked?.[KEY] === true, `/api/me/likes says ${JSON.stringify(liked.data)}`);
    console.log('  waiting 65 s for the 60-second cache…');
    await sleep(65_000);
    await page.reload();
    await waitPanelReady(page);
    const after = (await likeCount(page));
    check(after === count, `After reload the count is ${after}, expected ${count}`);
    check((await like.getAttribute('aria-pressed')) === 'true', 'After reload the button is not "Liked"');
    const { doc } = await readModel(page);
    check(doc?.likes === count, `Read model likes ${doc?.likes}, expected ${count}`);
    r.shots.push(await shotEl(page.locator('.page-header'), 'liked-after-reload'));
    let t2 = Date.now();
    await like.click();
    await page.waitForFunction(() => document.querySelector('[data-react][data-detail] [data-like]')?.getAttribute('aria-pressed') === 'false');
    r.timings.unlike = Date.now() - t2;
    check((await likeCount(page)) === count - 1, 'Unlike did not lower the count');
    t2 = Date.now();
    await like.click();
    await page.waitForFunction(() => document.querySelector('[data-react][data-detail] [data-like]')?.getAttribute('aria-pressed') === 'true');
    r.timings.relike = Date.now() - t2;
    check((await likeCount(page)) === count, 'Like again did not restore the count');
    state.likeCount = count;
  }, page, log);

  await step('6', 'Notes: clean note publishes, phone number waits, private correction', async ({ r, check }) => {
    await page.goto(`${VENUE_URL}#community`);
    await waitPanelReady(page);
    const form = page.locator('[data-comment-form]');
    const send = async (kind, text) => {
      await form.locator(`input[name=kind][value=${kind}]`).check();
      await page.locator('#community-text').fill(text);
      await page.evaluate(() => (document.querySelector('#community [data-status]').textContent = ''));
      const t = Date.now();
      const resP = page.waitForResponse((x) => x.url().includes('/api/comments') && x.request().method() === 'POST', { timeout: 60_000 });
      await form.locator('button[type=submit]').click();
      const res = await resP;
      const body = await res.json().catch(() => ({}));
      await page.waitForFunction(() => (document.querySelector('#community [data-status]')?.textContent || '').length > 0);
      const shown = (await page.locator('#community [data-status]').textContent())?.trim();
      return { status: res.status(), body, shown, ms: Date.now() - t };
    };
    const clean = await send('comment', CLEAN_NOTE);
    r.timings.cleanNote = clean.ms;
    r.notes.push(`Clean note: ${clean.status} ${JSON.stringify(clean.body)}`);
    check(clean.status === 200 && clean.body.status === 'published', `Clean note was not published (${clean.status} ${clean.body.status})`);
    state.cleanNoteId = clean.body.id || clean.body.commentId || null;
    const t = Date.now();
    let visible = false;
    while (Date.now() - t < 90_000) {
      if (await page.locator('[data-comment-list] li', { hasText: CLEAN_NOTE }).count()) {
        visible = true;
        break;
      }
      await sleep(10_000);
      await page.reload();
      await waitPanelReady(page);
    }
    r.timings.cleanNoteVisible = Date.now() - t;
    check(visible, 'Clean note did not appear on the page within 90 s');
    r.shots.push(await shotEl(page.locator('#community'), 'clean-note'));

    const phone = await send('comment', PHONE_NOTE);
    r.timings.phoneNote = phone.ms;
    r.notes.push(`Phone note: ${phone.status} ${JSON.stringify(phone.body)}`);
    check(/volunteer/i.test(phone.shown || ''), `Phone note message: "${phone.shown}"`);
    check(phone.body.status !== 'published', 'Phone note was published right away');
    r.shots.push(await shotEl(page.locator('#community'), 'phone-note-pending'));

    const corr = await send('correction', CORRECTION);
    r.timings.correction = corr.ms;
    r.notes.push(`Correction: ${corr.status} ${JSON.stringify(corr.body)}`);
    check(corr.status === 200, `Correction returned ${corr.status}`);
    r.shots.push(await shotEl(page.locator('#community'), 'correction-sent'));
    await page.reload();
    await waitPanelReady(page);
    check((await page.locator('[data-comment-list] li', { hasText: PHONE_NOTE }).count()) === 0, 'Phone note is public');
    check((await page.locator('[data-comment-list] li', { hasText: CORRECTION }).count()) === 0, 'Correction is public');
  }, page, log);

  await step('7', 'Photo upload with GPS EXIF goes to review', async ({ r, check }) => {
    const file = path.join(OUT, 'test-photo-gps.jpg');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="100%" height="100%" fill="#2a5"/><circle cx="800" cy="500" r="300" fill="#fd0"/><text x="80" y="140" font-size="90" font-family="Arial" fill="#fff">E2E test photo ${RUN.slice(0, 10)}</text></svg>`);
    await sharp(svg)
      .jpeg({ quality: 85 })
      .withExif({
        IFD0: { Make: 'E2ECam', Model: 'Test', Artist: 'E2E Tester' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 52/1 3000/100', GPSLongitudeRef: 'W', GPSLongitude: '73/1 25/1 1000/100' },
      })
      .toFile(file);
    const meta = await sharp(file).metadata();
    const gpsIn = Boolean(meta.exif && meta.exif.includes(Buffer.from([0x25, 0x88])));
    r.notes.push(`Test JPEG has EXIF: ${Boolean(meta.exif)} (GPS IFD pointer: ${gpsIn})`);
    check(Boolean(meta.exif), 'Could not write EXIF into the test JPEG');
    await page.goto(`${VENUE_URL}#community`);
    await waitPanelReady(page);
    const photosBefore = await page.locator('[data-photo-list] figure').count();
    await page.locator('[data-photo-details] summary').click();
    check(!(await page.locator('[data-photo-needs]').isVisible()), '"You must be 18" notice shows for an adult with photo rules');
    await page.locator('#community-file').setInputFiles(file);
    await page.locator('[data-photo-preview]').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => check(false, 'No photo preview appeared'));
    await page.locator('#community-alt').fill('Green test card with a yellow circle');
    await page.locator('#community-caption').fill('E2E test photo');
    for (const n of ['own', 'people', 'noKids']) await page.locator(`[data-photo-form] input[name=${n}]`).check();
    r.shots.push(await shotEl(page.locator('#community'), 'photo-form-filled'));
    await page.evaluate(() => (document.querySelector('#community [data-status]').textContent = ''));
    const t = Date.now();
    const resP = page.waitForResponse((x) => x.url().includes('/api/photos') && x.request().method() === 'POST', { timeout: 90_000 });
    await page.locator('[data-photo-form] button[type=submit]').click();
    const res = await resP;
    r.timings.photoUpload = Date.now() - t;
    const body = await res.json().catch(() => ({}));
    r.notes.push(`Photo: ${res.status()} ${JSON.stringify(body)}`);
    await page.waitForFunction(() => /photo/i.test(document.querySelector('#community [data-status]')?.textContent || ''), null, { timeout: 30_000 }).catch(() => {});
    const shown = (await page.locator('#community [data-status]').textContent())?.trim();
    check(res.status() === 200, `POST /api/photos ${res.status()}`);
    check(/volunteer/i.test(shown || ''), `Photo message: "${shown}"`);
    r.shots.push(await shotEl(page.locator('#community'), 'photo-sent'));
    await page.reload();
    await waitPanelReady(page);
    check((await page.locator('[data-photo-list] figure').count()) === photosBefore, 'A photo appeared publicly before review');
    state.photoUploaded = true;
  }, page, log);

  await step('8', '/moderate/ as a signed-in non-moderator', async ({ r, check }) => {
    await page.goto(`${BASE}/moderate/`);
    await page.locator('[data-mod-loading]').waitFor({ state: 'hidden', timeout: 60_000 });
    const notMod = page.locator('[data-mod-notmod]');
    check(await notMod.isVisible(), 'The "not a moderator" message is not shown');
    r.notes.push(`Message: "${(await notMod.textContent())?.trim()}"`);
    const q = await api(page, '/api/moderation/queue');
    check(q.status === 403, `/api/moderation/queue returned ${q.status} (expected 403)`);
    r.shots.push(await shot(page, 'moderate-not-moderator', { full: true }));
  }, page, log);

  await step('9', 'Moderate as admin: approve photo and phone note, mark correction done, report own note', async ({ r, check }) => {
    let p = await principal(page);
    if (!p?.userRoles?.includes('admin')) {
      r.notes.push('Not admin yet: signing out and in again so the roles are refreshed');
      const out = await signOut(page);
      r.timings.signOut = out.ms;
      r.notes.push(`Sign-out pages: ${hopText(out.hops)}; landed on ${out.landed}`);
      r.shots.push(await shot(page, 'after-sign-out'));
      await page.goto(loginUrl('/moderate/'));
      const auth = await completeAuth(page, { label: 'admin-signin' });
      r.timings.reSignIn = auth.ms;
      r.notes.push(`Sign-in pages: ${hopText(auth.hops)}`);
      await page.waitForURL((u) => u.pathname.startsWith('/moderate/'), { timeout: 60_000 });
      p = await principal(page);
    }
    check(p?.userRoles?.includes('admin'), `Roles after sign-in: ${p?.userRoles?.join(', ')}. Add the email to ADMIN_EMAILS first.`);
    if (!p?.userRoles?.includes('admin')) return;
    await page.goto(`${BASE}/moderate/`);
    const t = Date.now();
    await page.locator('[data-mod-tools]').waitFor({ state: 'visible', timeout: 60_000 });
    r.timings.queueLoad = Date.now() - t;
    r.shots.push(await shot(page, 'moderate-queue', { full: true }));
    if (STEPS.includes('12') || args.ux) r.notes.push(...(await uxShots(page, 'moderate')));
    await dismissConsent(page);
    const me = state.displayName || NAME;
    const cards = page.locator('[data-mod-list] > li', { hasText: `By ${me}` });
    r.notes.push(`Queue items from ${me}: ${await cards.count()}`);
    const decide = async (card, button) => {
      const resP = page.waitForResponse((x) => x.url().includes('/api/moderation/decide'));
      await card.getByRole('button', { name: button, exact: true }).click();
      const res = await resP;
      return { status: res.status(), body: await res.json().catch(() => ({})) };
    };
    const photoCards = page.locator('[data-mod-list] > li').filter({ hasText: `By ${me}` }).filter({ has: page.locator('img.moderate__photo') });
    const nPhotos = await photoCards.count();
    check(nPhotos >= 1, 'No photo from the test user in the queue');
    for (let i = 0; i < nPhotos; i++) {
      const d = await decide(photoCards.first(), 'Approve');
      r.notes.push(`Approve photo: ${d.status} ${JSON.stringify(d.body)}`);
      check(d.status === 200, `Approve photo returned ${d.status}`);
      await page.waitForTimeout(300);
    }
    const phoneCard = page.locator('[data-mod-list] > li', { hasText: PHONE_NOTE }).first();
    if (await phoneCard.count()) {
      const d = await decide(phoneCard, 'Approve');
      r.notes.push(`Approve phone note: ${d.status} ${JSON.stringify(d.body)}`);
      check(d.status === 200, `Approve phone note returned ${d.status}`);
    } else check(false, 'Phone-number note not found in the queue');
    const corrCard = page.locator('[data-mod-list] > li', { hasText: CORRECTION }).first();
    if (await corrCard.count()) {
      const d = await decide(corrCard, 'Done');
      r.notes.push(`Correction done: ${d.status} ${JSON.stringify(d.body)}`);
      check(d.status === 200, `Mark correction done returned ${d.status}`);
    } else check(false, 'Correction not found in the queue');
    await page.locator('[data-mod-log]').click();
    await page.locator('[data-mod-log-panel]').waitFor({ state: 'visible' });
    const logText = (await page.locator('[data-mod-log-list]').innerText()) || '';
    check(/approve/i.test(logText), 'The log has no "approve" entry');
    r.shots.push(await shot(page, 'moderate-log', { full: true }));

    const t2 = Date.now();
    let doc = null;
    while (Date.now() - t2 < 120_000) {
      await page.goto(`${VENUE_URL}#community`);
      await waitPanelReady(page);
      ({ doc } = await readModel(page));
      if ((doc?.photos || []).some((x) => x.by === me)) break;
      await sleep(10_000);
    }
    r.timings.photoPublic = Date.now() - t2;
    const mine = (doc?.photos || []).filter((x) => x.by === me);
    check(mine.length >= 1, 'Approved photo is not in the public read model after 2 minutes');
    await page.reload();
    await waitPanelReady(page);
    check((await page.locator('[data-photo-list] figure', { hasText: `Photo by ${me}` }).count()) >= 1, 'Approved photo not shown on the page');
    r.shots.push(await shotEl(page.locator('#community'), 'photo-approved'));
    for (const ph of mine) {
      const url = new URL(ph.src.l, BASE).toString();
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const m = await sharp(buf).metadata();
      const chunks = buf.toString('latin1');
      r.notes.push(`Full-size ${url}: ${res.status} ${m.format} ${m.width}x${m.height} exif=${Boolean(m.exif)} xmp=${Boolean(m.xmp)} EXIF-chunk=${chunks.includes('EXIF')} GPS-text=${/GPS/.test(chunks)}`);
      check(res.ok && m.format === 'webp', `Full-size photo ${res.status} ${m.format}`);
      check(!m.exif && !m.xmp && !chunks.includes('EXIF'), 'Full-size photo still has EXIF/XMP metadata');
      await writeFile(path.join(OUT, `downloaded-${ph.id}-l.webp`), buf);
    }
  }, page, log);

  await step('9b', 'Report your own note from the panel (and see it in the queue if moderator)', async ({ r, check }) => {
    await page.goto(`${VENUE_URL}#community`);
    await waitPanelReady(page);
    const note = page.locator('[data-comment-list] li', { hasText: CLEAN_NOTE }).first();
    if (await note.count()) {
      await note.getByRole('button', { name: 'Report' }).click();
      await page.locator('[data-report-dialog]').waitFor({ state: 'visible' });
      r.shots.push(await shot(page, 'report-dialog'));
      await page.locator('[data-report-form] input[name=reason][value=other]').check();
      await page.locator('#report-note').fill('E2E test report of my own note');
      await page.evaluate(() => (document.querySelector('#community [data-status]').textContent = ''));
      const resP = page.waitForResponse((x) => x.url().includes('/api/flags'));
      await page.locator('[data-report-form] button[type=submit]').click();
      const res = await resP;
      const body = await res.json().catch(() => ({}));
      await page.waitForFunction(() => (document.querySelector('#community [data-status]')?.textContent || '').length > 0, null, { timeout: 10_000 }).catch(() => {});
      r.notes.push(`Report own note: ${res.status()} ${JSON.stringify(body)}; page says "${(await page.locator('#community [data-status]').textContent())?.trim()}"`);
      check(res.status() === 200, `POST /api/flags ${res.status()}`);
      r.shots.push(await shotEl(page.locator('#community'), 'reported'));
    } else check(false, `Own note "${CLEAN_NOTE}" not on the page, so it could not be reported`);
    const p = await principal(page);
    if (p?.userRoles?.includes('admin')) {
      await page.goto(`${BASE}/moderate/`);
      await page.locator('[data-mod-tools]').waitFor({ state: 'visible', timeout: 60_000 });
      const card = page.locator('[data-mod-list] > li', { hasText: CLEAN_NOTE });
      r.notes.push(`Queue card for the reported note: ${(await card.count()) ? (await card.first().innerText()).replace(/\s+/g, ' ').slice(0, 300) : 'none'}`);
      check((await card.count()) >= 1, 'The reported note is not in the moderation queue');
      r.shots.push(await shot(page, 'moderate-reported', { full: true }));
    }
  }, page, log);

  await step('10', 'Account page: rename, download data, delete account', async ({ r, check }) => {
    await page.goto(`${BASE}/account/`);
    const t = Date.now();
    await page.locator('[data-profile]').waitFor({ state: 'visible', timeout: 60_000 });
    r.timings.accountLoad = Date.now() - t;
    check((await page.locator('[data-profile-heading]').textContent())?.trim() === 'Your profile', 'Heading is not "Your profile"');
    r.shots.push(await shot(page, 'account-page', { full: true }));
    if (STEPS.includes('12') || args.ux) r.notes.push(...(await uxShots(page, 'account')));
    await dismissConsent(page);
    await page.locator('#acct-name').fill(RENAMED);
    const resP = page.waitForResponse((x) => x.url().includes('/api/me/profile'));
    await page.locator('[data-save]').click();
    const res = await resP;
    check(res.status() === 200, `Rename returned ${res.status()}`);
    await page.waitForFunction(() => /saved/i.test(document.querySelector('[data-account] [data-status]')?.textContent || ''), null, { timeout: 10_000 }).catch(() => check(false, 'No "Saved!" message'));
    await page.waitForTimeout(500);
    const label = await headerLabel(page);
    check(label === RENAMED.split(' ')[0], `Header did not update after rename ("${label}")`);
    r.shots.push(await shot(page, 'account-renamed'));

    const dlP = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('link', { name: /download my data/i }).click();
    const dl = await dlP;
    const exportFile = path.join(OUT, 'my-data-export.json');
    await dl.saveAs(exportFile);
    const data = JSON.parse(await readFile(exportFile, 'utf8'));
    const ids = new Set();
    JSON.stringify(data, (k, v) => {
      if (/^(userId|by|authorId)$/.test(k) && typeof v === 'string') ids.add(v);
      return v;
    });
    r.notes.push(`Export file "${dl.suggestedFilename()}": keys ${Object.keys(data).join(', ')}; profile ${JSON.stringify(data.profile)}; likes ${data.likes?.length}; comments ${data.comments?.length}; photos ${data.photos?.length}; distinct user ids ${ids.size}`);
    check(data.profile?.displayName === RENAMED, `Export profile name ${data.profile?.displayName}`);
    check(ids.size <= 1, `Export contains ${ids.size} different user ids`);
    check(!JSON.stringify(data).includes('michaelsrichter'), 'Export mentions another person');

    await page.locator('#acct-delete').fill('DELETE');
    const delP = page.waitForResponse((x) => x.url().includes('/api/me/delete'));
    const t2 = Date.now();
    await page.locator('[data-delete-form] button[type=submit]').click();
    const del = await delP;
    r.timings.delete = Date.now() - t2;
    r.notes.push(`Delete: ${del.status()} ${JSON.stringify(await del.json().catch(() => ({})))}`);
    check(del.status() === 200, `Delete returned ${del.status()}`);
    r.shots.push(await shot(page, 'account-deleted-message'));
    // Sign-out leaves the account page (straight back to the site, or through External ID pages on older setups).
    await page.waitForURL((u) => !(u.origin === ORIGIN && u.pathname.startsWith('/account/')), { timeout: 30_000 });
    try {
      const out = await completeAuth(page, { label: 'delete-signout' });
      check(out.hops.length === 0, `Sign-out after delete went through External ID pages: ${hopText(out.hops)}`);
      r.notes.push(`Sign-out pages after delete: ${hopText(out.hops)}`);
      r.timings.deleteToSignedOut = Date.now() - t2;
      check(!(await principal(page)), 'Still signed in after deleting the account');
      check((await headerLabel(page)) === 'Sign in', `Header after delete: "${await headerLabel(page)}"`);
      r.shots.push(await shot(page, 'after-delete-landing'));
    } catch (e) {
      check(false, `Sign-out after delete did not finish: ${e.message}`);
      r.notes.push(`Site session still active after delete: ${Boolean(await principal(page))}`);
    }
    console.log('  waiting 65 s for the 60-second cache…');
    await sleep(65_000);
    const back = trackNav(page);
    await page.goto(`${VENUE_URL}#community`);
    await waitPanelReady(page);
    const seenBack = back.stop();
    check(!seenBack.navs.some((n) => n.host !== new URL(ORIGIN).host || n.path.startsWith('/.auth/')), `Coming back after deleting the account signed in again by itself: ${seenBack.text}`);
    check(!(await principal(page)), 'Signed in again after deleting the account');
    check((await page.evaluate(() => localStorage.getItem('li-account'))) === null, 'The saved name is still in this browser after deleting the account');
    const { doc } = await readModel(page);
    const leftovers = [...(doc?.comments || []).filter((c) => [NAME, RENAMED].includes(c.name)), ...(doc?.photos || []).filter((p) => [NAME, RENAMED].includes(p.by))];
    r.notes.push(`Read model after delete: likes ${doc?.likes}, comments ${doc?.comments?.length}, photos ${doc?.photos?.length}`);
    check(leftovers.length === 0, `Still public after delete: ${JSON.stringify(leftovers)}`);
    if (state.baseline) check(doc?.likes === state.baseline.likes, `Likes ${doc?.likes}, baseline before the test ${state.baseline.likes}`);
    check((await page.locator('[data-comment-list] li', { hasText: 'test note' }).count()) === 0, 'Test note still on the page');
    r.shots.push(await shotEl(page.locator('#community'), 'panel-after-delete'));
    state.deleted = true;
  }, page, log);

  await step('11', 'Sign in again after delete: fresh welcome step (then delete again)', async ({ r, check }) => {
    const res = await signInFromPanel(page, r, { signup: false });
    check(res.outcome === 'welcome', `Expected the welcome step, got "${res.outcome}"`);
    if (res.outcome !== 'welcome') return;
    r.shots.push(await shot(page, 'welcome-again', { full: true }));
    await fillWelcome(page, r, check, { photoRules: false });
    state.deleted = false;
    const p = await principal(page);
    if (p?.userRoles?.includes('admin')) {
      await page.goto(`${BASE}/moderate/`);
      await page.locator('[data-mod-tools]').waitFor({ state: 'visible', timeout: 60_000 });
      const left = page.locator('[data-mod-list] > li').filter({ hasText: /test note|Test correction|Green test card/ });
      const n = await left.count();
      const texts = [];
      for (let i = 0; i < n; i++) texts.push((await left.nth(i).innerText()).replace(/\s+/g, ' ').slice(0, 160));
      r.notes.push(`Queue items left from the deleted account: ${n}${n ? ` -> ${texts.join(' || ')}` : ''}`);
      check(n === 0, `${n} moderation queue item(s) from the deleted account are still waiting`);
      r.shots.push(await shot(page, 'moderate-after-delete', { full: true }));
    }
  }, page, log);

  await step('13', 'Sign out (e.g. after a browser restart): straight back to the site; signing in again asks for a code', async ({ r, check }) => {
    // Run in a new command after the sign-in steps (for example "--steps 1-3", then "--steps 13"), so the browser restarted.
    if (!(await principal(page))) throw new Error('Not signed in; run the sign-in steps first');
    await page.goto(VENUE_URL);
    await page.locator('.site-footer [data-account-signout]').waitFor({ state: 'visible', timeout: 30_000 });
    const hosts = new Set();
    const onNav = (f) => {
      if (f === page.mainFrame()) hosts.add(new URL(f.url()).host);
    };
    page.on('framenavigated', onNav);
    const t = Date.now();
    await page.locator('.site-footer [data-account-signout]').click();
    await page.waitForURL((u) => u.origin === ORIGIN && u.pathname === '/', { timeout: 30_000 }); // sign-out returns to the home page
    r.timings.signOut = Date.now() - t;
    page.off('framenavigated', onNav);
    const elsewhere = [...hosts].filter((h) => h !== new URL(ORIGIN).host);
    check(elsewhere.length === 0, `Sign-out went through other sites: ${elsewhere.join(', ')}`);
    check(!(await principal(page)), 'Still signed in after "Sign out"');
    await page.waitForTimeout(1500);
    check((await headerLabel(page)) === 'Sign in', `Header after sign-out: "${await headerLabel(page)}"`);
    r.shots.push(await shot(page, 'after-sign-out'));
    // Shared computers: the next sign-in must ask for an email code, not silently reuse the last person.
    await page.goto(loginUrl('/'));
    const auth = await completeAuth(page, { label: 'signin-after-signout' });
    r.timings.signInAgain = auth.ms;
    r.notes.push(`Sign-in pages after sign-out: ${hopText(auth.hops)}`);
    check(auth.hops.some((h) => h.mailWaitMs), 'Signing in again after "Sign out" did not ask for an email code');
  }, page, log);

  await step('sa', 'Site session ended, sign-in service still signed in: name stays, Like works without a reload', async ({ r, check }) => {
    if (!(await principal(page))) throw new Error('Not signed in; run the sign-in steps first');
    const first = (state.displayName || NAME).split(' ')[0];
    const like = page.locator(HERO_LIKE);
    const liked = async () => (await api(page, `/api/me/likes?keys=${encodeURIComponent(KEY)}`)).data?.liked?.[KEY] === true;
    const sso = async () => (await context.cookies(ORIGIN)).find((c) => c.name === 'li-sso')?.value ?? '(none)';

    // A returning visitor signed in the usual way. (Right after a sign-up the sign-in service keeps nothing to
    // reuse, so the site marks that browser session with li-sso=0 and does not try.)
    r.notes.push(`li-sso before: ${await sso()}`);
    if ((await sso()) !== '1') {
      await page.goto(VENUE_URL);
      await waitSettled(page);
      await page.locator('.site-footer [data-account-signout]').click();
      await page.waitForURL((u) => u.origin === ORIGIN && u.pathname === '/', { timeout: 30_000 }); // sign-out returns to the home page
      const again = await signInFromPanel(page, r, { signup: false });
      check(again.outcome === 'back', `Signing in again did not return to the page (${again.outcome})`);
      await page.waitForTimeout(1000);
      r.notes.push(`li-sso after a normal sign-in: ${await sso()}`);
      check((await sso()) === '1', 'The site did not note that the sign-in service remembers this browser');
    }

    // 1. Coming back after the site's session ended (its cookie expires after 8 hours).
    await dropSiteSession(context);
    check(!(await principal(page)), 'The site session is still there after deleting its cookies');
    let nav = trackNav(page);
    const t = Date.now();
    await page.goto(VENUE_URL);
    await waitSettled(page);
    await page.waitForTimeout(1500);
    r.timings.comeBack = Date.now() - t;
    let seen = nav.stop();
    const flips = await headerFlips(page);
    r.notes.push(`Coming back: ${seen.text}; header texts on the last page: ${flips.labels.join(' > ')}`);
    check((await headerLabel(page)) === first, `After coming back the header shows "${await headerLabel(page)}" (expected "${first}")`);
    check(!flips.flipped, `The header turned back into "Sign in": ${flips.labels.join(' > ')}`);
    check(Boolean(await principal(page)), 'The site session was not restored');
    r.shots.push(await shot(page, 'sa-came-back'));

    // 2. Like right away: no reload, no trip to the sign-in pages.
    const before = await liked();
    nav = trackNav(page);
    const resP = page.waitForResponse((x) => x.url().includes('/api/likes') && x.request().method() === 'POST', { timeout: 30_000 }).catch(() => null);
    await like.click();
    const res = await resP;
    await page.waitForTimeout(1000);
    seen = nav.stop();
    r.notes.push(`Like after coming back: ${res ? res.status() : 'no POST /api/likes'}; page loads: ${seen.text || 'none'}`);
    check(res?.status() === 200, `Like did not go through (${res ? res.status() : 'no request'})`);
    check(seen.navs.length === 0, `The page reloaded or left when Like was clicked: ${seen.text}`);
    check((await liked()) !== before, 'The like did not change');

    // 3. The session ends while the page is open: Like signs in again by itself and then completes.
    await page.goto(VENUE_URL);
    await waitSettled(page);
    const before3 = await liked();
    await dropSiteSession(context);
    nav = trackNav(page);
    const t3 = Date.now();
    await like.click();
    let pressed = '';
    for (const end = Date.now() + 60_000; Date.now() < end; await sleep(500)) {
      const onVenue = page.url().startsWith(VENUE_URL);
      pressed = onVenue ? ((await page.locator(HERO_LIKE).getAttribute('aria-pressed').catch(() => '')) || '') : '';
      if (onVenue && pressed === String(!before3) && (await principal(page))) break;
    }
    r.timings.likeAfterSessionEnded = Date.now() - t3;
    await page.waitForTimeout(1000);
    seen = nav.stop();
    const after3 = await liked();
    r.notes.push(`Like clicked after the session ended: ${secs(r.timings.likeAfterSessionEnded)}; ${seen.text}; liked ${before3} -> ${after3}`);
    check(after3 !== before3, 'The like clicked after the session ended never happened');
    check(page.url().startsWith(VENUE_URL), `Ended on ${page.url()} instead of the venue page`);
    check(!seen.navs.some((n) => n.path.startsWith('/account/')), `Went through the account page: ${seen.text}`);
    r.shots.push(await shot(page, 'sa-like-after-session-ended'));
    // Leave the like as it was before this step.
    if ((await liked()) !== before) {
      const back = page.waitForResponse((x) => x.url().includes('/api/likes'), { timeout: 30_000 }).catch(() => null);
      await page.locator(HERO_LIKE).click();
      await back;
    }
  }, page, log);

  await step('sb', 'Browser restart: still signed in the same day (site cookie kept) and the next day (site cookie gone)', async ({ r, check }) => {
    if (!(await principal(page))) throw new Error('Not signed in; run the sign-in steps first');
    const first = (state.displayName || NAME).split(' ')[0];
    const st = await context.storageState();
    const persistent = st.cookies.filter((c) => c.expires !== -1);
    const name = (c) => `${c.domain.replace(/^\./, '')}:${c.name}`;
    r.notes.push(`Kept after a restart: ${persistent.map(name).join(', ')}`);
    r.notes.push(`Lost on a restart: ${st.cookies.filter((c) => c.expires === -1).map(name).join(', ') || 'none'}`);
    const siteCookie = persistent.find((c) => c.name === 'StaticWebAppsAuthCookie');
    if (siteCookie) r.notes.push(`Site session cookie expires in ${((siteCookie.expires * 1000 - Date.now()) / 3_600_000).toFixed(1)} h`);
    const browser = await chromium.launch({ headless: !HEADED });
    const days = await signInServiceDays();
    try {
      for (const [variant, cookies] of [
        ['same day', persistent],
        ['next day', persistent.filter((c) => !isSiteAuthCookie(c))],
      ]) {
        const ctx = await browser.newContext({ storageState: { cookies, origins: st.origins }, viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' });
        await recordHeaderLabels(ctx);
        const p = await ctx.newPage();
        const nav = trackNav(p);
        const t = Date.now();
        await p.goto(VENUE_URL);
        let settled = true;
        await waitSettled(p).catch(() => (settled = false));
        await p.waitForTimeout(1500);
        const seen = nav.stop();
        const label = await headerLabel(p).catch(() => '?');
        const signedIn = Boolean(await principal(p).catch(() => null));
        const flips = await headerFlips(p);
        r.notes.push(`${variant}: ${secs(Date.now() - t)}; header "${label}"; signed in: ${signedIn}; ${seen.text}; header texts: ${flips.labels.join(' > ')}`);
        r.shots.push(await shot(p, `sb-${variant.replace(' ', '-')}`));
        check(settled, `${variant}: the page did not finish loading (${p.url()})`);
        if (variant === 'same day' || days > 0) {
          check(signedIn && label === first, `${variant}: not signed in after a browser restart (header "${label}")`);
          check(!flips.flipped, `${variant}: the header turned back into "Sign in": ${flips.labels.join(' > ')}`);
        } else {
          // The sign-in service forgets visitors when the browser closes (signInServiceDays 0, External ID's default):
          // the page must land cleanly, signed out, without a trip to a sign-in form. See docs/deployment.md.
          r.notes.push('next day: shown as signed out, as expected while signInServiceDays is 0 (owner step in docs/deployment.md)');
          check(!signedIn && label === 'Sign in', `${variant}: expected signed out, header "${label}"`);
          check(p.url().startsWith(VENUE_URL), `${variant}: ended on ${p.url()} instead of the venue page`);
          check(!seen.navs.some((n) => n.host !== new URL(ORIGIN).host || n.path.startsWith('/.auth/')), `${variant}: went to a sign-in page: ${seen.text}`);
          check((await p.evaluate(() => localStorage.getItem('li-account'))) === null, `${variant}: the saved name was not cleared`);
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }, page, log);

  await step('sc', 'Sign out, then come back: stays signed out (no automatic sign-in)', async ({ r, check }) => {
    if (!(await principal(page))) throw new Error('Not signed in; run the sign-in steps first');
    const ownHost = new URL(ORIGIN).host;
    const comeBack = async (where) => {
      for (const url of [VENUE_URL, `${BASE}/`, `${BASE}/events/`]) {
        const nav = trackNav(page);
        await page.goto(url);
        await page.waitForLoadState('load');
        await page.waitForTimeout(2500);
        const seen = nav.stop();
        const away = seen.navs.filter((n) => n.host !== ownHost || n.path.startsWith('/.auth/'));
        check(away.length === 0, `${where}: visiting ${url.replace(BASE, '') || '/'} signed in again by itself: ${seen.text}`);
        check(!(await principal(page)), `${where}: signed in again after visiting ${url.replace(BASE, '') || '/'}`);
        check((await headerLabel(page)) === 'Sign in', `${where}: header shows "${await headerLabel(page)}" on ${url.replace(BASE, '') || '/'}`);
      }
    };
    for (const [where, from, button] of [
      ['Sign out in the footer', VENUE_URL, '.site-footer [data-account-signout]'],
      ['Sign out on the account page', `${BASE}/account/`, '[data-account] [data-account-signout]'],
    ]) {
      if (!(await principal(page))) {
        const again = await signInFromPanel(page, r, { signup: false });
        check(again.outcome === 'back', `Signing in again did not return to the page (${again.outcome})`);
      }
      await page.goto(from);
      await page.locator(button).waitFor({ state: 'visible', timeout: 60_000 });
      const t = Date.now();
      await page.locator(button).click();
      await page.waitForURL((u) => u.origin === ORIGIN && u.pathname === '/', { timeout: 30_000 }); // sign-out returns to the home page
      await page.waitForTimeout(1000);
      r.timings[where] = Date.now() - t;
      check(!(await principal(page)), `${where}: still signed in`);
      check((await page.evaluate(() => localStorage.getItem('li-account'))) === null, `${where}: the saved name is still in this browser`);
      await comeBack(where);
    }
    r.shots.push(await shot(page, 'sc-signed-out'));
    // Sign in again so later steps (for example 10, delete the account) can run.
    const again = await signInFromPanel(page, r, { signup: false });
    check(again.outcome === 'back', `Signing in again did not return to the page (${again.outcome})`);
  }, page, log);

  await step('sd', 'A fresh private window: "Sign in", and no sign-in requests or redirects', async ({ r, check }) => {
    const browser = await chromium.launch({ headless: !HEADED });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' });
      const p = await ctx.newPage();
      const nav = trackNav(p);
      await p.goto(VENUE_URL);
      await p.waitForLoadState('load');
      await p.locator('[data-community]').scrollIntoViewIfNeeded();
      await p.waitForTimeout(4000);
      check((await headerLabel(p)) === 'Sign in', `Venue page header shows "${await headerLabel(p)}"`);
      await p.goto(`${BASE}/events/`);
      await p.waitForLoadState('load');
      await p.waitForTimeout(2500);
      check((await headerLabel(p)) === 'Sign in', `Events page header shows "${await headerLabel(p)}"`);
      const seen = nav.stop();
      r.notes.push(`Page loads: ${seen.text}; auth requests: ${seen.authReqs.join(', ') || 'none'}`);
      check(seen.navs.length === 2, `Extra page loads or redirects: ${seen.text}`);
      check(!seen.authReqs.some((u) => /\/\.auth\/login|ciamlogin\.com|\/api\/me/.test(u)), `Sign-in requests for someone who never signed in: ${seen.authReqs.join(', ')}`);
      check(seen.authReqs.filter((u) => /\/\.auth\/me/.test(u)).length <= 1, `More than one "who is signed in?" check: ${seen.authReqs.join(', ')}`);
      r.shots.push(await shot(p, 'sd-fresh-window'));
    } finally {
      await browser.close();
    }
  }, page, log);

  await step('cleanup', 'Delete the test account if it exists', async ({ r, check }) => {
    if (!(await principal(page))) {
      r.notes.push('Not signed in; nothing to delete from this browser');
      return;
    }
    const me = await api(page, '/api/me');
    if (me.data?.user && !me.data.user.needsProfile) {
      await page.goto(`${BASE}/account/`);
      await page.locator('#acct-delete').waitFor({ state: 'visible', timeout: 60_000 });
      await page.locator('#acct-delete').fill('DELETE');
      const delP = page.waitForResponse((x) => x.url().includes('/api/me/delete'));
      await page.locator('[data-delete-form] button[type=submit]').click();
      const del = await delP;
      r.notes.push(`Delete through the account page: ${del.status()}`);
      check(del.status() === 200, `Delete returned ${del.status()}`);
      // Sign-out leaves the account page (straight back to the site, or through External ID pages on older setups).
    await page.waitForURL((u) => !(u.origin === ORIGIN && u.pathname.startsWith('/account/')), { timeout: 30_000 });
      const out = await completeAuth(page, { label: 'cleanup-signout' });
      r.notes.push(`Sign-out pages: ${hopText(out.hops)}`);
    } else {
      r.notes.push('Profile not finished; the delete form only shows after the welcome step, so deleting through the API');
      const del = await api(page, '/api/me/delete', { data: { confirm: 'DELETE' } });
      r.notes.push(`Delete: ${del.status} ${JSON.stringify(del.data)}`);
      check(del.status === 200, `Delete returned ${del.status}`);
      await signOut(page);
    }
    check(!(await principal(page)), 'Still signed in');
    state.deleted = true;
  }, page, log);

  await context.close();
  const reportFile = path.join(OUT, 'report.json');
  const earlier = existsSync(reportFile) ? JSON.parse(await readFile(reportFile, 'utf8')).results || [] : [];
  const merged = [...earlier.filter((e) => !results.some((r) => r.step === e.step)), ...results].sort((a, b) => (Number(a.step) || 99) - (Number(b.step) || 99));
  await writeFile(reportFile, JSON.stringify({ base: BASE, email: EMAIL, updated: new Date().toISOString(), results: merged }, null, 2));
  console.log('\nStep | Result | Time');
  for (const r of results) console.log(`${r.step.padEnd(7)} | ${r.skipped ? 'SKIP' : r.pass ? 'PASS' : 'FAIL'} | ${secs(r.timings.total || 0)} | ${r.title}\n        timings: ${Object.entries(r.timings).map(([k, v]) => `${k} ${Array.isArray(v) ? v.map(secs).join('/') : secs(v)}`).join(', ')}`);
  console.log(`\nScreenshots and report.json: ${OUT}`);
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
