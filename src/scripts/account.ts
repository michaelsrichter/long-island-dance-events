/** Account page: profile (display name, neutral age question, rules), data download, account deletion. */
export {};
const root = document.querySelector<HTMLElement>('[data-account]');

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/** Only same-site paths are allowed as "next" (no open redirects). */
function nextPath(): string {
  const n = new URLSearchParams(location.search).get('next') || '';
  return /^\/(?!\/)[\w\-./#%]*$/.test(n) ? n : '';
}

if (root) {
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const say = (t: string) => (status.textContent = t);
  const show = (signedIn: boolean) => {
    root.querySelectorAll<HTMLElement>('[data-signed-in]').forEach((el) => (el.hidden = !signedIn));
    root.querySelectorAll<HTMLElement>('[data-signed-out]').forEach((el) => (el.hidden = signedIn));
  };
  const form = root.querySelector<HTMLFormElement>('[data-profile-form]')!;
  const ageFields = root.querySelector<HTMLElement>('[data-age-fields]')!;
  const rulesRow = root.querySelector<HTMLElement>('[data-rules-row]')!;
  const photoRow = root.querySelector<HTMLElement>('[data-photo-row]')!;
  const blocked = root.querySelector<HTMLElement>('[data-blocked]')!;
  const signin = root.querySelector<HTMLAnchorElement>('[data-signin]')!;
  const signout = root.querySelector<HTMLAnchorElement>('[data-signout]')!;
  const back = `${location.origin}/account/${location.search}`;
  signin.href = `/.auth/login/extid?post_login_redirect_uri=${encodeURIComponent(back)}`;
  signout.href = `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(`${location.origin}/`)}`;

  const fill = (user: any, suggested = '') => {
    (form.elements.namedItem('displayName') as HTMLInputElement).value = user.displayName || suggested;
    // The age question is asked once; after that only "13+" and "18+" are known.
    ageFields.hidden = Boolean(user.ageConfirmed) || user.status === 'under13';
    rulesRow.hidden = Boolean(user.rulesAccepted);
    photoRow.hidden = Boolean(user.canPostPhotos) || (Boolean(user.ageConfirmed) && !user.adult);
    const isBlocked = user.status === 'banned' || user.status === 'under13';
    blocked.hidden = !isBlocked;
    blocked.textContent = user.status === 'banned' ? 'Your account cannot post right now.' : user.status === 'under13' ? 'Sorry, you must be 13 or older to take part.' : '';
    form.hidden = user.status === 'under13';
  };

  (async () => {
    const r = await api('/api/me');
    if (r.status !== 200 || !r.data?.signedIn) {
      show(false);
      return;
    }
    show(true);
    fill(r.data.user, r.data.suggestedName);
  })();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = new FormData(form);
    const body: Record<string, unknown> = { displayName: String(d.get('displayName') || '').trim(), acceptRules: d.get('acceptRules') === 'yes', photoTerms: d.get('photoTerms') === 'yes' };
    if (!ageFields.hidden) {
      body.birthMonth = Number(d.get('birthMonth'));
      body.birthYear = Number(d.get('birthYear'));
    }
    const r = await api('/api/me/profile', { method: 'POST', body: JSON.stringify(body) });
    if (r.status === 200) {
      fill(r.data.user);
      const next = nextPath();
      say(next ? 'Saved! Taking you back…' : 'Saved!');
      if (next) setTimeout(() => (location.href = next), 800);
    } else {
      say(r.data?.message || 'Something went wrong. Please try again.');
      if (r.status === 403 && r.data?.error === 'age') fill({ status: 'under13', needsProfile: false });
    }
  });

  root.querySelector<HTMLFormElement>('[data-delete-form]')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const confirm = String(new FormData(ev.target as HTMLFormElement).get('confirm') || '');
    if (confirm !== 'DELETE') {
      say('Type DELETE (in capital letters) to confirm.');
      return;
    }
    const r = await api('/api/me/delete', { method: 'POST', body: JSON.stringify({ confirm }) });
    say(r.data?.message || (r.status === 200 ? 'Deleted.' : 'Something went wrong.'));
    if (r.status === 200) setTimeout(() => (location.href = signout.href), 1500);
  });
}
