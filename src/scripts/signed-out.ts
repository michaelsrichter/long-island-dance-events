/** The 401 page (pages/signed-out.astro): finish a silent sign-in that could not happen, or offer to sign in. */
import { finishFailedRestore, loginUrl } from './account-state';

if (!finishFailedRestore()) {
  const signin = document.querySelector<HTMLAnchorElement>('[data-signed-out-page] [data-signin]');
  // Static Web Apps shows this page in place of an editors-only page (like /moderate/) too: come back there after signing in.
  const here = location.pathname;
  const back = here.startsWith('/.auth/') || here.startsWith('/signed-out') ? '/' : here + location.search + location.hash;
  if (signin) signin.href = loginUrl(back);
}
