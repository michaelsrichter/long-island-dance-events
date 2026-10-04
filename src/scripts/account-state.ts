/**
 * Who is signed in, remembered in this browser so the header can show it without a network call.
 * Only a display name and a moderator flag are kept (in localStorage, never sent anywhere).
 * Signing in always returns through /account/, which asks the one-time "welcome" questions
 * the first time and then sends the visitor back to the page they came from.
 */
const KEY = 'li-account';

export type CachedAccount = { name: string; admin: boolean };

export function cachedAccount(): CachedAccount | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.name === 'string' ? { name: v.name, admin: Boolean(v.admin) } : null;
  } catch {
    return null;
  }
}

export function rememberAccount(account: CachedAccount | null) {
  try {
    if (account) localStorage.setItem(KEY, JSON.stringify({ name: account.name, admin: account.admin }));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the header just shows "Sign in" */
  }
  window.dispatchEvent(new CustomEvent('li-account', { detail: account }));
}

/** Sign-in link that comes back to `next` (a path on this site) after the welcome step. */
export function loginUrl(next: string = location.pathname + location.search + location.hash): string {
  const back = `${location.origin}/account/?next=${encodeURIComponent(next)}`;
  return `/.auth/login/extid?post_login_redirect_uri=${encodeURIComponent(back)}`;
}

export function logoutUrl(): string {
  return `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(`${location.origin}/`)}`;
}

/** Ask Static Web Apps who is signed in (fast; no Function call). */
export async function whoAmI(): Promise<{ signedIn: boolean; admin: boolean; name: string }> {
  try {
    const res = await fetch('/.auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return { signedIn: false, admin: false, name: '' };
    const p = (await res.json())?.clientPrincipal;
    return p ? { signedIn: true, admin: Array.isArray(p.userRoles) && p.userRoles.includes('admin'), name: String(p.userDetails || '') } : { signedIn: false, admin: false, name: '' };
  } catch {
    return { signedIn: false, admin: false, name: '' };
  }
}

/** Short name for the header ("Mike R." stays, long names are cut by CSS). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'You';
}
