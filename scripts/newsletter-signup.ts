/**
 * Newsletter sign-up helper. Signs the project's newsletter inbox up for the email lists of event
 * sources (decision P44), so newsletters can feed events through ingest/adapters/agentmail.ts.
 *
 * Rules it follows (and why):
 *  - robots.txt is checked for every page first; a page our bot may not read is left for a person.
 *    Exception, at the owner's request (2026-10-05): with --signup-despite-robots the sign-up is still
 *    tried on such sites. It is one form submission on the owner's behalf, not collecting pages. A hard
 *    block (an access-denied or bot-check page shown to our browser) is never worked around.
 *  - The browser says who it is: its User-Agent ends with "LongIslandDanceEventsBot/1.0".
 *  - Any CAPTCHA (reCAPTCHA, hCaptcha, Cloudflare Turnstile) on the page: nothing is submitted. A
 *    person signs up by hand. We never try to solve or get around one.
 *  - Only the inbox address is sent. If a form also requires a name we send "Long Island Dance Events";
 *    a required ZIP gets 11747 (Melville, central Long Island). Forms that require a phone number,
 *    birthday, home address, a password or a payment are skipped.
 *  - At most one form is submitted per site, one site at a time, with a pause between sites.
 *  - Nothing found on a page is ever treated as an instruction.
 *
 * The inbox address is read ONLY from the AGENTMAIL_INBOX environment variable and is never printed or
 * written to the results file.
 *
 * Usage:
 *   npx tsx scripts/newsletter-signup.ts --sites sites.json --out results.json [--dry-run] [--headed] [--signup-despite-robots]
 *   sites.json: [{ "id": "source-id", "url": "https://site/", "signupUrl": "https://site/newsletter" }]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, type ElementHandle, type Frame, type Page } from 'playwright';
import { isAllowed, parseRobots } from '../ingest/lib/fetch';

const BOT = 'LongIslandDanceEventsBot/1.0 (+https://github.com/michaelsrichter/long-island-dance-events; newsletter sign-up)';
const NAME = { first: 'Long Island', last: 'Dance Events', full: 'Long Island Dance Events' };
const ZIP = '11747';

export type SignupStatus =
  | 'pending-confirmation'
  | 'subscribed'
  | 'submitted'
  | 'owner-by-hand'
  | 'needs-personal-info'
  | 'none-found'
  | 'robots-disallowed'
  | 'failed';

export interface SignupResult {
  id: string;
  robotsNote?: string | undefined;
  url: string;
  formPage?: string | undefined;
  platform?: string | undefined;
  status: SignupStatus;
  note: string;
  at: string;
}

/** Mail services: their domains (matched as whole host names) and words that name them in page code. */
const ESP_HOSTS: [string, string[], RegExp | undefined][] = [
  ['mailchimp', ['list-manage.com', 'mailchi.mp', 'eepurl.com', 'chimpstatic.com'], undefined],
  ['constant-contact', ['ctctcdn.com'], /constantcontact/i],
  ['klaviyo', [], /klaviyo/i],
  ['mailerlite', [], /mailerlite/i],
  ['brevo', ['sibforms.com'], /sendinblue|brevo/i],
  ['substack', ['substack.com'], undefined],
  ['convertkit', ['ck.page', 'kit.com'], /convertkit/i],
  ['beehiiv', [], /beehiiv/i],
  ['flodesk', [], /flodesk/i],
  ['emma', ['e2ma.net'], /myemma/i],
  ['aweber', [], /aweber/i],
  ['hubspot', [], /hsforms|hubspot/i],
  ['squarespace', [], /squarespace/i],
  ['wix', ['wix.com', 'wixstatic.com'], /parastorage/i],
];
const HOST_NAMES = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
/** "news.list-manage.com" is on list-manage.com; "toolkit.com" is not on kit.com. */
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const hostsIn = (s: string) => (s.match(HOST_NAMES) ?? []).map((h) => h.toLowerCase());

export const platformOf = (s: string): string | undefined => {
  const hosts = hostsIn(s);
  return ESP_HOSTS.find(([, domains, words]) => hosts.some((h) => domains.some((d) => onDomain(h, d))) || Boolean(words?.test(s)))?.[0];
};

/** Words around a newsletter form (and ones that mean it is some other kind of form). */
export const NEWSLETTER_RE =
  /\b(newsletter|e-?news|e-?blast|subscribe|subscription|mailing list|email list|e-?mail updates|join (?:our|the) (?:e-?mail |mailing )?list|stay (?:in the know|up to date|updated|informed|in touch|connected)|sign ?up|get (?:the latest|updates|notified)|notify me|keep me (?:posted|updated|informed)|never miss|be the first to (?:know|hear)|get on (?:the|our) list|vip (?:list|club)|insiders?|e-?club)\b/i;
export const OTHER_FORM_RE = /\b(password|log ?in|sign ?in|checkout|billing|card number|donat|reservation|book a table|search|comment|your message|inquir|enquir|quote|apply|application|rsvp|register for)\b/i;
const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  '.g-recaptcha',
  '[data-sitekey]',
  'script[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.h-captcha',
  'script[src*="hcaptcha"]',
  '.cf-turnstile',
  'iframe[src*="challenges.cloudflare.com"]',
  'script[src*="challenges.cloudflare.com/turnstile"]',
  'input[name="cf-turnstile-response"]',
  'textarea[name="g-recaptcha-response"]',
  'textarea[name="h-captcha-response"]',
  'input[name*="captcha" i]',
  'img[src*="captcha" i]',
];
const SUCCESS_RE = /\b(thank(?:s| you)|success|subscribed|you(?:'|’)re (?:in|on the list|subscribed|all set)|welcome|almost (?:finished|done|there)|check your (?:e-?mail|inbox)|confirm(?:ation)? (?:e-?mail|link)|we(?:'|’)ve sent)\b/i;
const CONFIRM_RE = /\b(confirm|verify|check your (?:e-?mail|inbox)|almost (?:finished|done|there)|activate)\b/i;
const ERROR_RE = /\b(error|invalid|not valid|try again|too many|could not|couldn(?:'|’)t|failed|required field)\b/i;
const ALREADY_RE = /\b(already (?:subscribed|a (?:subscriber|member)|on (?:our|the) list))\b/i;
const SIGNUP_LINK_RE = /\b(newsletter|mailing list|e-?mail list|e-?news|subscribe|join (?:our|the) (?:e-?mail |mailing )?list|sign up for (?:our )?(?:e-?mails?|news|updates))\b/i;
const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'linkedin.com', 'eventbrite.com', 'spotify.com', 'apple.com'];
/** A link to social media or a big platform (by its host name, so "dropbox.com" is not "x.com"). */
export const isSocialLink = (href: string): boolean => {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return SOCIAL_DOMAINS.some((d) => onDomain(host, d));
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SIGNUP_DESPITE_ROBOTS = process.argv.includes('--signup-despite-robots');
const BOT_WALL_RE = /\b(access denied|forbidden|just a moment|checking your browser|verify you are human|are you a robot|attention required|request blocked|unusual traffic)\b/i;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const robotsCache = new Map<string, ReturnType<typeof parseRobots> | 'blocked'>();
async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules: ReturnType<typeof parseRobots> | 'blocked' = { allow: [], disallow: [] };
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': BOT }, signal: AbortSignal.timeout(20000) });
      if (res.ok) rules = parseRobots(await res.text());
      else if (res.status === 401 || res.status === 403) rules = 'blocked';
    } catch {
      // Not reachable: treated as allowed, like the collector does.
    }
    robotsCache.set(u.origin, rules);
  }
  const rules = robotsCache.get(u.origin)!;
  return rules !== 'blocked' && isAllowed(rules, u.pathname + u.search);
}

interface FieldInfo {
  index: number;
  tag: string;
  type: string;
  key: string;
  required: boolean;
  visible: boolean;
}
interface FormInfo {
  index: number;
  text: string;
  /** Visible text around the form (a heading such as "Join our mailing list" is often just outside it). */
  context?: string;
  action: string;
  fields: FieldInfo[];
  hasTextarea: boolean;
  hasPassword: boolean;
  emailIndex: number;
}

/**
 * Runs in the page: describe every block that holds an email box (its form, or the nearest small
 * container) and its fields. Plain JavaScript text, because tsx would add helpers the page lacks.
 */
const DESCRIBE_FORMS_JS = `(() => {
  function isEmail(i) {
    if (i.tagName !== 'INPUT') return false;
    var t = (i.type || '').toLowerCase();
    if (t === 'email') return true;
    if (t && t !== 'text') return false;
    var k = (i.name + ' ' + i.id + ' ' + (i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.autocomplete || '')).toLowerCase();
    return /e-?mail/.test(k);
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }
  var containers = [];
  var inputs = Array.from(document.querySelectorAll('input'));
  for (var n = 0; n < inputs.length; n++) {
    var input = inputs[n];
    if (!isEmail(input)) continue;
    var box = input.closest('form');
    if (!box) {
      box = input.parentElement;
      while (box && box.parentElement && box.querySelectorAll('input,select,textarea').length < 2 && box.parentElement !== document.body) box = box.parentElement;
    }
    if (box && containers.indexOf(box) < 0) containers.push(box);
  }
  window.__lideForms = containers;
  return containers.map(function (box, index) {
    var els = Array.from(box.querySelectorAll('input,select,textarea'));
    var fields = els.map(function (el, i) {
      var label = el.id ? ((document.querySelector('label[for="' + CSS.escape(el.id) + '"]') || {}).textContent || '') : '';
      var wrap = el.closest('label');
      var key = [el.name || '', el.id || '', el.getAttribute('placeholder') || '', el.getAttribute('aria-label') || '', el.getAttribute('autocomplete') || '', label, wrap ? wrap.textContent : '']
        .join(' ').replace(/\\s+/g, ' ').trim().toLowerCase().slice(0, 200);
      return {
        index: i,
        tag: el.tagName.toLowerCase(),
        type: (el.type || '').toLowerCase(),
        key: key,
        required: Boolean(el.required) || el.getAttribute('aria-required') === 'true' || /\\*/.test(label),
        visible: visible(el),
      };
    });
    return {
      index: index,
      text: (box.innerText || box.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 600),
      context: box.parentElement ? (box.parentElement.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 600) : '',
      action: typeof box.action === 'string' ? box.action : '',
      fields: fields,
      hasTextarea: fields.some(function (f) { return f.tag === 'textarea' && f.visible; }),
      hasPassword: fields.some(function (f) { return f.type === 'password'; }),
      emailIndex: fields.findIndex(function (f) { return f.visible && (f.type === 'email' || /e-?mail/.test(f.key)); }),
    };
  });
})()`;

async function describeForms(frame: Frame): Promise<FormInfo[]> {
  return (await frame.evaluate(DESCRIBE_FORMS_JS)) as FormInfo[];
}

export type FieldPlan = { index: number; value: string } | { index: number; check: true } | { skip: string };

/** What to type in each required field, or why the form must be left to a person. */
export function planFields(form: Pick<FormInfo, 'fields' | 'emailIndex'>): FieldPlan[] {
  const plan: FieldPlan[] = [];
  for (const f of form.fields) {
    if (f.index === form.emailIndex || !f.visible) continue;
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(f.type)) continue;
    const k = f.key;
    if (f.type === 'checkbox' || f.type === 'radio') {
      if (f.required) {
        if (/consent|agree|newsletter|e-?mail|subscribe|terms|privacy|marketing|opt.?in|updates/.test(k)) plan.push({ index: f.index, check: true });
        else return [{ skip: `required choice "${k.slice(0, 40)}"` }];
      }
      continue;
    }
    if (/phone|mobile|cell|tel\b|sms|birth|dob|age\b|street|address|password|card|social/.test(k) || f.type === 'tel' || f.type === 'password') {
      if (f.required) return [{ skip: `required personal field "${k.slice(0, 40)}"` }];
      continue;
    }
    let value: string | undefined;
    if (/first|fname|given/.test(k)) value = NAME.first;
    else if (/last|lname|surname|family/.test(k)) value = NAME.last;
    else if (/zip|postal/.test(k)) value = ZIP;
    else if (/compan|organi[sz]ation|business/.test(k)) value = NAME.full;
    else if (/\bname\b|full.?name|your name/.test(k)) value = NAME.full;
    if (value) {
      if (f.required || /first|last|name/.test(k)) plan.push({ index: f.index, value });
      continue;
    }
    if (f.required) return [{ skip: `required field "${k.slice(0, 40)}"` }];
  }
  return plan;
}

/** Is this block a newsletter form we may fill? Returns a reason when it is not. */
export function judgeForm(form: Pick<FormInfo, 'text' | 'context' | 'action' | 'hasTextarea' | 'hasPassword' | 'emailIndex' | 'fields'>, pageUrl = ''): string | undefined {
  if (form.emailIndex < 0) return 'no visible email box';
  if (form.hasPassword) return 'login or account form';
  if (form.hasTextarea) return 'contact form (has a message box)';
  const words = `${form.text} ${form.context ?? ''} ${form.action} ${form.fields.map((f) => f.key).join(' ')}`;
  // A form on the site's own "newsletter" or "mailing list" page counts even without those words.
  let signupPage = false;
  try {
    signupPage = /newsletter|mailing-?list|email-?list|subscribe|sign-?up|join-our/i.test(new URL(pageUrl).pathname);
  } catch {}
  if (!NEWSLETTER_RE.test(words) && !platformOf(form.action) && !signupPage) return 'not a newsletter form';
  if (OTHER_FORM_RE.test(form.text) && !/newsletter|subscribe|mailing list|email list/i.test(`${form.text} ${form.fields.map((f) => f.key).join(' ')}`)) return 'another kind of form';
  return undefined;
}

async function hasCaptcha(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (/recaptcha|hcaptcha|challenges\.cloudflare\.com/.test(frame.url())) return true;
    for (const sel of CAPTCHA_SELECTORS) {
      try {
        if (await frame.locator(sel).count()) return true;
      } catch {}
    }
  }
  return false;
}

async function pageText(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const frame of page.frames()) {
    try {
      parts.push(await frame.locator('body').innerText({ timeout: 3000 }));
    } catch {}
  }
  return parts.join('\n');
}

/** Lines that appeared after submitting (a thank-you or error message), ignoring text that was already there. */
export function newLines(before: string, after: string): string {
  const old = new Set(before.split('\n').map((l) => l.trim()));
  return after
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !old.has(l))
    .join(' ')
    .slice(0, 5000);
}

async function findForm(page: Page): Promise<{ frame: Frame; form: FormInfo } | { reason: string }> {
  const reasons: string[] = [];
  for (const frame of page.frames()) {
    let forms: FormInfo[] = [];
    try {
      forms = await describeForms(frame);
    } catch {
      continue;
    }
    for (const form of forms) {
      const why = judgeForm(form, page.url());
      if (process.env.SIGNUP_DEBUG) console.error(JSON.stringify({ frame: frame.url().slice(0, 80), why, text: form.text.slice(0, 160), action: form.action.slice(0, 80), fields: form.fields.map((f) => `${f.type}:${f.key.slice(0, 30)}${f.required ? '*' : ''}${f.visible ? '' : '(hidden)'}`) }));
      if (!why) return { frame, form };
      reasons.push(why);
    }
  }
  return { reason: reasons.length ? `email boxes found, but: ${[...new Set(reasons)].join('; ')}` : 'no email sign-up box on the page' };
}

async function signupLinks(page: Page, base: string): Promise<string[]> {
  const links = (await page.evaluate(
    "Array.from(document.querySelectorAll('a[href]')).map(function (a) { return { href: a.href, text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) }; })",
  )) as { href: string; text: string }[];
  const bare = (h: string) => h.replace(/^www\./, '');
  const host = bare(new URL(base).host);
  const out: string[] = [];
  for (const l of links) {
    if (!/^https?:/.test(l.href) || isSocialLink(l.href)) continue;
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    const esp = platformOf(u.host) && !/squarespace|wix/.test(platformOf(u.host)!);
    const sameSite = bare(u.host) === host;
    if (esp || (sameSite && (SIGNUP_LINK_RE.test(l.text) || /newsletter|mailing-?list|email-?list|subscribe/i.test(u.pathname)))) {
      if (!out.includes(l.href)) out.push(l.href);
    }
  }
  return out.slice(0, 3);
}

async function trySignup(page: Page, site: { id: string; url: string; signupUrl?: string }, inbox: string, dryRun: boolean): Promise<SignupResult> {
  const at = new Date().toISOString();
  const base: SignupResult = { id: site.id, url: site.url, status: 'none-found', note: '', at };
  const pages = [site.signupUrl ?? site.url];
  const tried = new Set<string>();
  while (pages.length) {
    const url = pages.shift()!;
    if (tried.has(url) || tried.size >= 3) continue;
    tried.add(url);
    const robotsOk = await robotsAllows(url);
    if (!robotsOk && SIGNUP_DESPITE_ROBOTS) {
      base.robotsNote = 'robots.txt asks bots to stay away; the sign-up was tried at the owner\'s request (one form, no pages collected).';
    } else if (!robotsOk) {
      if (tried.size === 1) return { ...base, formPage: url, status: 'robots-disallowed', note: 'robots.txt does not let our bot read this page; sign up by hand.' };
      base.status = 'robots-disallowed';
      base.formPage = url;
      base.note = `The sign-up page (${new URL(url).host}) does not let our bot in (robots.txt); sign up by hand.`;
      continue;
    }
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await page.title().catch(() => '');
      if ((res && [401, 403, 429, 503].includes(res.status())) || BOT_WALL_RE.test(title)) {
        return { ...base, formPage: url, status: 'owner-by-hand', note: `The site shows an access-denied or bot-check page to our browser (${res?.status() ?? 'no answer'}); sign up by hand.` };
      }
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.mouse.wheel(0, 20000);
      await sleep(2500);
    } catch (e) {
      base.note = `page did not open (${String(e).slice(0, 80)})`;
      continue;
    }
    const found = await findForm(page);
    if ('reason' in found) {
      base.note = found.reason;
      for (const l of await signupLinks(page, url)) if (!tried.has(l)) pages.push(l);
      continue;
    }
    const { frame, form } = found;
    const platform = platformOf(`${form.action} ${frame.url()}`) ?? platformOf(await page.content().then((h) => h.slice(0, 300000)));
    const result: SignupResult = { ...base, formPage: url, platform };
    if ((await hasCaptcha(page)) || form.fields.some((f) => /captcha|enter (?:the )?code/.test(f.key)) || /enter (?:the )?code/i.test(form.text))
      return { ...result, status: 'owner-by-hand', note: 'The sign-up form is protected by a CAPTCHA; a person must sign up by hand.' };
    const plan = planFields(form);
    const skip = plan.find((p): p is { skip: string } => 'skip' in p);
    if (skip) return { ...result, status: 'needs-personal-info', note: `Not submitted: ${skip.skip}.` };
    if (dryRun) return { ...result, status: 'submitted', note: `dry run: would fill email${plan.length ? ` + ${plan.length} field(s)` : ''}` };

    const fieldsOf = async () => frame.evaluateHandle(`window.__lideForms[${form.index}]`);
    const container = (await fieldsOf()).asElement() as ElementHandle<Element> | null;
    if (!container) return { ...result, status: 'failed', note: 'form disappeared' };
    const inputs = await container.$$('input,select,textarea');
    await inputs[form.emailIndex]!.fill(inbox);
    for (const p of plan) {
      if ('value' in p) await inputs[p.index]!.fill(p.value).catch(() => {});
      else if ('check' in p) await inputs[p.index]!.check({ force: true }).catch(() => {});
    }
    const before = await pageText(page);
    // The button closest to the email box (a big block can hold other buttons, like "Reserve").
    const submit = (
      await frame.evaluateHandle(`(() => {
        var box = window.__lideForms[${form.index}];
        var email = box.querySelectorAll('input,select,textarea')[${form.emailIndex}];
        var sel = 'button[type=submit],input[type=submit],button:not([type=button]):not([type=reset]),button,[role=button],a[class*=submit],div[class*=submit]';
        for (var el = email.parentElement; el && el !== box.parentElement; el = el.parentElement) {
          var b = el.querySelector(sel);
          if (b) return b;
        }
        return null;
      })()`)
    ).asElement() as ElementHandle<Element> | null;
    if (submit) await submit.click({ timeout: 8000 }).catch(() => inputs[form.emailIndex]!.press('Enter'));
    else await inputs[form.emailIndex]!.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await sleep(4000);
    if (await hasCaptcha(page)) return { ...result, status: 'owner-by-hand', note: 'A CAPTCHA appeared after submitting; stopped. A person must sign up by hand.' };
    const after = await pageText(page);
    const added = newLines(before, after);
    if (ALREADY_RE.test(added)) return { ...result, status: 'subscribed', note: 'The site says the inbox is already subscribed.' };
    if (SUCCESS_RE.test(added)) {
      return CONFIRM_RE.test(added)
        ? { ...result, status: 'pending-confirmation', note: 'Submitted; the site asks to confirm by email.' }
        : { ...result, status: 'subscribed', note: 'Submitted; the site showed a thank-you message.' };
    }
    if (ERROR_RE.test(added)) return { ...result, status: 'failed', note: 'The site showed an error after submitting.' };
    return { ...result, status: 'submitted', note: 'Submitted; no clear thank-you message. Watch the inbox.' };
  }
  return base;
}

async function main() {
  const sitesFile = arg('sites');
  const outFile = arg('out');
  if (!sitesFile || !outFile) {
    console.error('Usage: npx tsx scripts/newsletter-signup.ts --sites sites.json --out results.json [--dry-run] [--headed] [--signup-despite-robots]');
    process.exit(2);
  }
  const dryRun = process.argv.includes('--dry-run');
  const inbox = process.env.AGENTMAIL_INBOX ?? '';
  if (!dryRun && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(inbox)) {
    console.error('Set AGENTMAIL_INBOX (the newsletter inbox address) in the environment for this command only.');
    process.exit(2);
  }
  const sites = JSON.parse(readFileSync(sitesFile, 'utf8')) as { id: string; url: string; signupUrl?: string }[];
  let previous: SignupResult[] = [];
  try {
    previous = JSON.parse(readFileSync(outFile, 'utf8')) as SignupResult[];
  } catch {}
  const done = new Set(previous.filter((r) => r.status !== 'failed' || dryRun).map((r) => r.id));
  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/${browser.version()} Safari/537.36 ${BOT}`;
  const results = [...previous];
  for (const site of sites) {
    if (done.has(site.id)) continue;
    const context = await browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    let r: SignupResult;
    try {
      r = await trySignup(page, site, inbox, dryRun);
    } catch (e) {
      r = { id: site.id, url: site.url, status: 'failed', note: String(e).slice(0, 160), at: new Date().toISOString() };
    }
    await context.close();
    // Never write the inbox address anywhere.
    if (inbox) r.note = r.note.split(inbox).join('[inbox]');
    const i = results.findIndex((x) => x.id === r.id);
    if (i >= 0) results[i] = r;
    else results.push(r);
    writeFileSync(outFile, JSON.stringify(results, null, 1) + '\n');
    console.log(`${r.status.padEnd(20)} ${r.id.padEnd(36)} ${r.platform ?? ''} ${r.note}`);
    await sleep(4000);
  }
  await browser.close();
}

if (process.argv[1] && /newsletter-signup\.ts$/.test(process.argv[1])) await main();
