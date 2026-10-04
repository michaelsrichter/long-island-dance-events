/**
 * Header and footer account links: "Sign in" for visitors, the person's name (linking to their
 * profile) once signed in, plus "Sign out" and, for moderators, "Moderation queue".
 * Only calls /.auth/me when this browser has signed in before, so most visitors cause no request.
 */
import { cachedAccount, firstName, loginUrl, logoutUrl, rememberAccount, whoAmI, type CachedAccount } from './account-state';

function render(account: CachedAccount | null) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-account-link]')) {
    const label = a.querySelector<HTMLElement>('[data-account-label]');
    if (account) {
      a.href = '/account/';
      if (label) label.textContent = a.hasAttribute('data-account-header') ? firstName(account.name) : 'Your profile';
      a.setAttribute('aria-label', a.hasAttribute('data-account-header') ? `Your profile (${account.name})` : 'Your profile');
    } else {
      a.href = loginUrl();
      if (label) label.textContent = a.hasAttribute('data-account-header') ? 'Sign in' : 'Sign in or create an account';
      a.removeAttribute('aria-label');
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-account-when="in"]')) el.hidden = !account;
  for (const el of document.querySelectorAll<HTMLElement>('[data-account-when="admin"]')) el.hidden = !account?.admin;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-account-signout]')) a.href = logoutUrl();
}

render(cachedAccount());
window.addEventListener('li-account', (e) => render((e as CustomEvent<CachedAccount | null>).detail));
document.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest?.('[data-account-signout]')) rememberAccount(null);
});

const cached = cachedAccount();
if (cached) {
  whoAmI().then((me) => {
    if (!me.signedIn) rememberAccount(null);
    else if (me.admin !== cached.admin) rememberAccount({ ...cached, admin: me.admin });
  });
}
