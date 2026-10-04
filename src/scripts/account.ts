/**
 * Account page. Every sign-in returns here (with ?next=<page>):
 *  - first time: "Welcome! One more step" (name, neutral age question, rules), then back to <page>
 *  - later: straight back to <page>
 *  - without ?next: the profile, moderator link, download and delete
 */
import { loginUrl, rememberAccount } from './account-state';

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

/** Only same-site paths are allowed as "next" (no open redirects, no sign-in loops). */
function nextPath(): string {
  const n = new URLSearchParams(location.search).get('next') || '';
  return /^\/(?![/\\])(?!\.auth\/)(?!account\/)[\w\-./#%?=&]*$/.test(n) ? n : '';
}

if (root) {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const status = $('[data-status]');
  const say = (t: string) => (status.textContent = t);
  const next = nextPath();
  const form = $<HTMLFormElement>('[data-profile-form]');
  const save = $<HTMLButtonElement>('[data-save]');
  const ageFields = $('[data-age-fields]');
  const rulesFields = $('[data-rules-fields]');
  const rulesRow = $('[data-rules-row]');
  const photoRow = $('[data-photo-row]');
  const heading = $('[data-profile-heading]');
  const intro = $('[data-profile-intro]');
  const blocked = $('[data-blocked]');
  let user: any = null;

  const show = (sel: string, on: boolean) => root.querySelectorAll<HTMLElement>(sel).forEach((el) => (el.hidden = !on));
  const goBack = () => {
    show('[data-returning]', true);
    location.replace(next);
  };

  function renderProfile(u: any, suggested = '') {
    user = u;
    rememberAccount({ name: u.displayName || suggested || 'You', admin: Boolean(u.isAdmin) });
    show('[data-profile]', true);
    // During the one-time welcome step, show only the form; the rest appears once it's saved.
    show('[data-signed-in]', u.status !== 'under13' && !u.needsProfile);
    show('[data-moderator]', Boolean(u.isAdmin) && !u.needsProfile);
    const nameInput = form.elements.namedItem('displayName') as HTMLInputElement;
    if (!nameInput.value) nameInput.value = u.displayName || suggested;
    ageFields.hidden = Boolean(u.ageConfirmed) || u.status === 'under13';
    rulesRow.hidden = Boolean(u.rulesAccepted);
    photoRow.hidden = Boolean(u.canPostPhotos) || (Boolean(u.ageConfirmed) && !u.adult);
    rulesFields.hidden = rulesRow.hidden && photoRow.hidden;
    if (u.needsProfile) {
      heading.textContent = 'Welcome! One more step';
      intro.textContent = 'Choose the name other dancers will see, tell us when you were born, and agree to the community rules. You only do this once.';
      save.textContent = next ? 'Save and continue' : 'Save';
    } else {
      heading.textContent = 'Your profile';
      intro.textContent = `You're signed in as ${u.displayName}. You can change your name here.`;
      save.textContent = 'Save';
    }
    const isBlocked = u.status === 'banned' || u.status === 'under13';
    blocked.hidden = !isBlocked;
    blocked.textContent = u.status === 'banned' ? 'Your account cannot post right now. See the community rules if you have questions.' : u.status === 'under13' ? 'Sorry, you must be 13 or older to take part.' : '';
    form.hidden = u.status === 'under13';
  }

  (async () => {
    const r = await api('/api/me');
    show('[data-loading]', false);
    if (r.status !== 200 || !r.data?.signedIn) {
      rememberAccount(null);
      $<HTMLAnchorElement>('[data-signin]').href = loginUrl(next || '/account/');
      show('[data-signed-out]', true);
      return;
    }
    const u = r.data.user;
    if (next && !u.needsProfile && u.status !== 'under13') {
      rememberAccount({ name: u.displayName || 'You', admin: Boolean(u.isAdmin) });
      goBack();
      return;
    }
    renderProfile(u, r.data.suggestedName);
  })();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = new FormData(form);
    const body: Record<string, unknown> = { displayName: String(d.get('displayName') || '').trim(), acceptRules: d.get('acceptRules') === 'yes', photoTerms: d.get('photoTerms') === 'yes' };
    if (!ageFields.hidden) {
      if (!d.get('birthMonth') || !d.get('birthYear')) {
        say('Please choose the month and year you were born.');
        return;
      }
      body.birthMonth = Number(d.get('birthMonth'));
      body.birthYear = Number(d.get('birthYear'));
    }
    if (!rulesRow.hidden && !body.acceptRules) {
      say('Please tick the box to agree to the community rules.');
      return;
    }
    const label = save.textContent;
    save.disabled = true;
    save.setAttribute('aria-busy', 'true');
    save.textContent = 'Saving…';
    const r = await api('/api/me/profile', { method: 'POST', body: JSON.stringify(body) });
    save.disabled = false;
    save.removeAttribute('aria-busy');
    save.textContent = label;
    if (r.status === 200) {
      const u = r.data.user;
      if (next && !u.needsProfile) {
        rememberAccount({ name: u.displayName, admin: Boolean(user?.isAdmin) });
        say('All set!');
        goBack();
        return;
      }
      renderProfile({ ...u, isAdmin: user?.isAdmin });
      say('Saved!');
    } else {
      say(r.data?.message || 'Something went wrong. Please try again.');
      if (r.status === 403 && r.data?.error === 'age') renderProfile({ ...(user || {}), status: 'under13', needsProfile: false });
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
    if (r.status === 200) {
      rememberAccount(null);
      setTimeout(() => (location.href = root.querySelector<HTMLAnchorElement>('[data-account-signout]')!.href), 1500);
    }
  });
}
