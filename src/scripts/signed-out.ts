/** The 401 page (pages/signed-out.astro): finish a silent sign-in that could not happen, or offer to sign in. */
import { finishFailedRestore, loginUrl } from './account-state';

if (!finishFailedRestore()) {
  const signin = document.querySelector<HTMLAnchorElement>('[data-signed-out-page] [data-signin]');
  if (signin) signin.href = loginUrl('/');
}
