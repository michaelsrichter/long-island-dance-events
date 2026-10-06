/**
 * Who is signed in, remembered in this browser so the header can show it without a network call.
 * Only a display name and a moderator flag are kept (in localStorage, never sent anywhere).
 * Signing in always returns through /account/, which asks the one-time "welcome" questions
 * the first time and then sends the visitor back to the page they came from.
 *
 * Coming back later: the site's own session (a Static Web Apps cookie) ends after 8 hours, but the sign-in
 * service (Microsoft Entra External ID) remembers the visitor until the browser closes (or longer, see
 * COMMUNITY.signInServiceDays). While it does, a sign-in needs no form at all: Microsoft answers at once and
 * Static Web Apps comes straight back. So when this browser has a saved name, the site session is gone and
 * the sign-in service very likely still remembers the visitor, ensureSession() makes that one quick trip
 * and returns to the same page, signed in. "Very likely" is the li-sso cookie: set while signed in, it
 * ends when the sign-in service forgets (when the browser closes, by default). Without it the visitor is
 * simply shown as signed out: no trip to a sign-in form they did not ask for.
 */
import { COMMUNITY } from '../lib/community';

const KEY = 'li-account';
/** sessionStorage: a silent sign-in is under way in this tab ({ at, back }). */
const RESTORE = 'li-restore';
/** sessionStorage: something the visitor clicked while signed out, finished after signing in. */
const PENDING = 'li-pending';
/** sessionStorage: show "your sign-in ended" once on the page we return to. */
const NOTICE = 'li-signed-out-notice';
/** Cookie: the sign-in service most likely still remembers this browser (see above). */
const SSO = 'li-sso';

/** A silent sign-in is tried at most once per tab in this window (no loops). */
export const RESTORE_GUARD_MS = 2 * 60_000;
/** A remembered click is finished only if the visitor comes back within this time. */
export const PENDING_MAX_AGE_MS = 10 * 60_000;

export type CachedAccount = { name: string; admin: boolean };
export type Session = { signedIn: boolean; admin: boolean; name: string };
export type PendingAction = { type: string; key: string; at?: number; [field: string]: unknown };
type RestoreMark = { at: number; back: string };

function read<T>(store: Storage | undefined, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(store: Storage | undefined, key: string, value: unknown) {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage turned off: nothing is remembered */
  }
}
const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);

function setSso(value: '1' | '0' | null) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  const days = Number(COMMUNITY.signInServiceDays) || 0;
  // No Max-Age: a browser-session cookie, gone when the browser closes, like the sign-in service's own.
  const life = value === null ? '; Max-Age=0' : value === '1' && days > 0 ? `; Max-Age=${Math.round(days * 86400)}` : '';
  document.cookie = `${SSO}=${value ?? ''}; Path=/; SameSite=Lax${secure}${life}`;
}
const ssoValue = () => document.cookie.split(/;\s*/).find((c) => c.startsWith(`${SSO}=`))?.slice(SSO.length + 1) ?? '';
const ssoLikely = () => ssoValue() === '1';

/**
 * A brand-new account (the welcome step): the sign-in service does not remember a sign-up the way it remembers
 * a sign-in, so this browser session never tries a silent sign-in. The next normal sign-in allows it again.
 */
export function noteNewAccount() {
  setSso('0');
}

export function cachedAccount(): CachedAccount | null {
  const v = read<CachedAccount>(local(), KEY);
  return v && typeof v.name === 'string' ? { name: v.name, admin: Boolean(v.admin) } : null;
}

/** Set by "Sign out": answers still on their way (who is signed in, the profile) must not undo it. */
let signingOut = false;

export function rememberAccount(account: CachedAccount | null) {
  if (account && signingOut) return;
  write(local(), KEY, account ? { name: account.name, admin: account.admin } : null);
  window.dispatchEvent(new CustomEvent('li-account', { detail: account }));
}

/** "Sign out" (and account deletion): forget the name here, so nothing signs the visitor back in by itself. */
export function markSignedOut() {
  rememberAccount(null);
  signingOut = true;
  setSso(null);
  write(session(), RESTORE, null);
  write(session(), PENDING, null);
}

/** Only paths on this site (no other sites, no sign-in addresses) can be returned to. */
export function safePath(next: string): string {
  return /^\/(?![/\\])(?!\.auth\/)[\w\-./#%?=&~+:@!$',;*()]*$/.test(next) ? next : '/';
}

/** Sign-in link that comes back to `next` (a path on this site) after the welcome step. */
export function loginUrl(next: string = location.pathname + location.search + location.hash): string {
  const back = `${location.origin}/account/?next=${encodeURIComponent(next)}`;
  return `/.auth/login/extid?post_login_redirect_uri=${encodeURIComponent(back)}`;
}

/** Silent sign-in for a returning visitor: straight back to `back`, without the welcome step. */
export function restoreUrl(back: string = location.pathname + location.search + location.hash): string {
  return `/.auth/login/extid?post_login_redirect_uri=${encodeURIComponent(location.origin + safePath(back))}`;
}

export function logoutUrl(): string {
  return `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(`${location.origin}/`)}`;
}

let who: Promise<Session> | null = null;
/**
 * Who is signed in, asked once per page. Static Web Apps answers /.auth/me itself (fast; no Function call).
 * On the live server (App Service, decision P60) /.auth/me has another format, so the server's
 * /api/session answers instead.
 */
export function whoAmI(): Promise<Session> {
  who ??= (async () => {
    const out: Session = { signedIn: false, admin: false, name: '' };
    try {
      const res = await fetch('/.auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const body: unknown = res.ok ? await res.json().catch(() => null) : null;
      if (body && typeof body === 'object' && 'clientPrincipal' in body) {
        const p = (body as { clientPrincipal?: { userRoles?: unknown; userDetails?: unknown } | null }).clientPrincipal;
        return p ? { signedIn: true, admin: Array.isArray(p.userRoles) && p.userRoles.includes('admin'), name: String(p.userDetails || '') } : out;
      }
      const s = await fetch('/api/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!s.ok) return out;
      const j = (await s.json()) as Partial<Session>;
      return { signedIn: Boolean(j.signedIn), admin: Boolean(j.admin), name: String(j.name || '') };
    } catch {
      return out;
    }
  })();
  return who;
}

let restoring = false;

function recentRestore(): RestoreMark | null {
  const m = read<RestoreMark>(session(), RESTORE);
  return m && typeof m.at === 'number' && Date.now() - m.at < RESTORE_GUARD_MS ? m : null;
}

/** Can a silent sign-in work now? (A name was saved, the sign-in service likely remembers, not just tried.) */
const canRestore = () => Boolean(cachedAccount()) && ssoLikely() && !recentRestore();

function startRestore(back: string) {
  restoring = true;
  write(session(), RESTORE, { at: Date.now(), back: safePath(back) } satisfies RestoreMark);
  location.replace(restoreUrl(back));
}

/** The visitor is signed out now: forget the name, and say so once if they had been signed in. */
function endedHere() {
  write(session(), RESTORE, null);
  setSso(null);
  if (cachedAccount()) write(session(), NOTICE, 1);
  rememberAccount(null);
}

const here = () => location.pathname + location.search + location.hash;
const quietPage = () => location.pathname.startsWith('/.auth/') || document.documentElement.dataset.pageType === 'signed-out';

let ensured: Promise<Session> | null = null;
/**
 * Who is signed in, signing a returning visitor back in silently when that can work. The silent sign-in is
 * only tried in browsers that were signed in before (a saved name); callers that should cost nothing for
 * other visitors check cachedAccount() first. While the page leaves for the silent sign-in, the promise
 * never settles (nothing on this page should act on it).
 */
export function ensureSession(): Promise<Session> {
  ensured ??= (async () => {
    const hadName = Boolean(cachedAccount());
    const me = await whoAmI();
    if (me.signedIn) {
      write(session(), RESTORE, null);
      if (!signingOut && ssoValue() !== '0') setSso('1');
      return me;
    }
    // Never signed in here, signed out meanwhile (another tab), or on the 401 page: nothing to do.
    if (!hadName || !cachedAccount() || quietPage()) return me;
    if (!canRestore()) {
      endedHere();
      return me;
    }
    startRestore(here());
    return new Promise<Session>(() => {});
  })();
  return ensured;
}

/** Remember a click to finish after signing in (another tab or an old one never sees it). */
export function rememberAction(action: PendingAction) {
  write(session(), PENDING, { ...action, at: Date.now() });
}

/** The remembered click for this page, if any (taken: it is finished only once). */
export function takeAction(key: string, types: string[]): PendingAction | null {
  const a = read<PendingAction>(session(), PENDING);
  if (!a) return null;
  if (typeof a.at !== 'number' || Date.now() - a.at > PENDING_MAX_AGE_MS) {
    write(session(), PENDING, null);
    return null;
  }
  if (a.key !== key || !types.includes(a.type)) return null;
  write(session(), PENDING, null);
  return a;
}

/**
 * Something needs a signed-in visitor (a Like, a note…): remember it, then sign back in silently when that
 * can work, or show the normal sign-in. Either way the action is finished on return.
 */
export function signInFor(action: PendingAction | null, back: string = here()) {
  if (action) rememberAction(action);
  if (restoring) return;
  if (canRestore()) startRestore(back);
  else location.href = loginUrl(safePath(back));
}

/**
 * On the 401 page (/signed-out/): Static Web Apps shows it when a sign-in comes back with an error (for
 * example the visitor pressed Cancel). If this tab was signing in silently, go back to the page, signed out;
 * if they had clicked something, show the normal sign-in instead so the click can still be finished.
 * Returns false when there was nothing to do (the page then just explains and offers to sign in).
 */
export function finishFailedRestore(): boolean {
  const m = read<RestoreMark>(session(), RESTORE);
  write(session(), RESTORE, null);
  if (!m || typeof m.at !== 'number' || Date.now() - m.at > PENDING_MAX_AGE_MS) return false;
  setSso(null);
  if (cachedAccount()) write(session(), NOTICE, 1);
  rememberAccount(null);
  if (read<PendingAction>(session(), PENDING)) {
    write(session(), NOTICE, null);
    location.replace(loginUrl(safePath(m.back)));
  } else location.replace(safePath(m.back));
  return true;
}

/** Once, on the page after a sign-in ended by itself: the text for a short notice (or null). */
export function takeSignedOutNotice(): string | null {
  if (quietPage() || !read(session(), NOTICE)) return null;
  write(session(), NOTICE, null);
  return 'Your sign-in ended. Sign in again to like, save or post.';
}

/** Short name for the header ("Mike R." stays, long names are cut by CSS). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'You';
}
