/**
 * Header and footer account links: "Sign in" for visitors, the person's name (linking to their
 * profile) once signed in, plus "Sign out" and, for moderators, "Moderation queue".
 * Public pages use only the browser's cached display identity. They never check /.auth/me or redirect
 * during ordinary navigation; protected actions and account pages verify the secure session on demand.
 */
import { cachedAccount, firstName, loginUrl, logoutUrl, markSignedOut, takeSignedOutNotice, type CachedAccount } from './account-state';
import { toast } from './toast';

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
  // The page's own "Sign in" text stays hidden until now when this browser has a saved name (BaseLayout).
  document.documentElement.dataset.accountReady = '';
}

render(cachedAccount());
window.addEventListener('li-account', (e) => render((e as CustomEvent<CachedAccount | null>).detail));

// "Sign out" (header, footer, panel or account page): forget the saved name right away, so coming back
// never signs the visitor in again by itself.
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest?.('[data-account-signout]')) markSignedOut();
  },
  true,
);

const showNotice = () => {
  const notice = takeSignedOutNotice();
  if (notice) window.setTimeout(() => toast(notice), 400);
};

showNotice();
