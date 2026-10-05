import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Coming back after the site's own session ended (its cookie lasts 8 hours) while the sign-in service still
 * remembers the visitor (until the browser closes). A small mock plays both: /.auth/me, the API and the
 * sign-in service (which answers at once, without a form, when it remembers the visitor).
 */
const VENUE = '/venues/huntington-moose-lodge/';
const KEY = 'venue:huntington-moose-lodge';
const HERO_LIKE = '[data-react][data-detail] [data-like]';

type Mock = { site: boolean; idp: boolean; idpError: boolean; liked: boolean; logins: string[]; likePosts: number[]; logouts: number };
type Options = { baseURL: string; name?: string; site?: boolean; idp?: boolean; idpError?: boolean; cached?: boolean; sso?: boolean };

async function mockSite(page: Page, { baseURL, name = 'Ann B', site = false, idp = true, idpError = false, cached = true, sso = true }: Options): Promise<Mock> {
  const m: Mock = { site, idp, idpError, liked: false, logins: [], likePosts: [], logouts: 0 };
  // The browser was signed in before (seeded once per test, so the app's own changes to it stick).
  if (cached) {
    await page.addInitScript((n) => {
      if (!sessionStorage.getItem('test-seeded')) {
        sessionStorage.setItem('test-seeded', '1');
        localStorage.setItem('li-account', JSON.stringify({ name: n, admin: false }));
      }
    }, name);
  }
  // Same browser session as the last sign-in: the sign-in service most likely still remembers the visitor.
  if (sso) await page.context().addCookies([{ name: 'li-sso', value: '1', url: baseURL }]);
  // Every text the header account link shows, per page load (the page's own "Sign in" comes first).
  await page.addInitScript(() => {
    const w = window as any;
    w.__labels = [];
    new MutationObserver(() => {
      const t = document.querySelector('[data-account-header] [data-account-label]')?.textContent?.trim();
      if (t && w.__labels[w.__labels.length - 1] !== t) w.__labels.push(t);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const signedOutPage = await (await page.request.get('/signed-out/')).text();
  await page.route('**/community/venue/huntington-moose-lodge.json', (r) => r.fulfill({ json: { v: 1, key: KEY, likes: 4, comments: [], photos: [] } }));
  await page.route('**/community/counts/venue.json', (r) => r.fulfill({ json: { v: 1, type: 'venue', likes: { 'huntington-moose-lodge': 4 } } }));
  await page.route('**/.auth/me', (r) => r.fulfill({ json: { clientPrincipal: m.site ? { userId: 'u1', userDetails: name, userRoles: ['anonymous', 'authenticated', 'member'] } : null } }));
  await page.route('**/.auth/login/extid**', async (r) => {
    const u = new URL(r.request().url());
    m.logins.push(decodeURIComponent(u.search));
    const back = u.searchParams.get('post_login_redirect_uri') || '/';
    if (m.idpError) {
      // The sign-in came back with an error (for example "Cancel"); Static Web Apps shows its 401 page (our /signed-out/).
      return r.fulfill({ status: 401, contentType: 'text/html', body: signedOutPage });
    }
    if (!m.idp) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>sign in</title><h1>Sign-in page</h1>' });
    m.site = true;
    return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>location.replace(${JSON.stringify(back)})</script>` });
  });
  await page.route('**/.auth/logout**', (r) => {
    m.logouts++;
    m.site = false;
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><script>location.replace("/")</script>' });
  });
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: m.site ? { signedIn: true, user: { displayName: name, status: 'active', needsProfile: false, canPostPhotos: true, adult: true, isAdmin: false } } : { signedIn: false } }),
  );
  await page.route('**/api/me/likes**', (r) => r.fulfill({ json: { liked: m.site && m.liked ? { [KEY]: true } : {} } }));
  await page.route('**/api/likes', async (r) => {
    m.likePosts.push(m.site ? 200 : 401);
    if (!m.site) return r.fulfill({ status: 401, json: { error: 'sign_in', message: 'Please sign in first.' } });
    m.liked = Boolean(r.request().postDataJSON().like);
    return r.fulfill({ json: { key: KEY, liked: m.liked, count: m.liked ? 5 : 4 } });
  });
  return m;
}

/** Page loads (and redirects) of the main frame from now on. */
function countLoads(page: Page) {
  const loads: string[] = [];
  page.on('request', (q) => {
    if (q.isNavigationRequest() && q.frame() === page.mainFrame()) loads.push(new URL(q.url()).pathname);
  });
  return loads;
}

const labels = (page: Page) => page.evaluate(() => (window as any).__labels as string[]);
const ssoCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'li-sso')?.value || '';
const header = (page: Page) => page.locator('.site-header [data-account-header]');

test.describe('coming back after the site session ended', () => {
  test('the name stays in the header: one silent sign-in, then Like works without a page reload', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL! });
    await page.goto(VENUE);
    await expect(header(page)).toHaveAttribute('href', '/account/');
    await expect(page.locator(HERO_LIKE)).toBeEnabled();
    expect(m.logins, 'one quick sign-in that comes straight back to the page').toHaveLength(1);
    expect(m.logins[0]).toContain(`post_login_redirect_uri=${baseURL}${VENUE}`);
    expect(m.logins[0], 'returning visitors skip the welcome step').not.toContain('/account/');
    await expect(page).toHaveURL(new RegExp(`${VENUE}$`));
    const seen = await labels(page);
    expect(seen.slice(seen.findIndex((l) => l !== 'Sign in')), `header texts: ${seen.join(' > ')}`).not.toContain('Sign in');
    await expect(header(page)).toContainText('Ann');

    const loads = countLoads(page);
    await page.locator(HERO_LIKE).click();
    await expect(page.locator(HERO_LIKE)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`${HERO_LIKE} [data-like-count]`)).toContainText('5');
    expect(m.likePosts).toEqual([200]);
    expect(loads, 'Like must not reload or leave the page').toEqual([]);
  });

  test('a Like clicked after the session ended signs in again by itself and then finishes the like', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL!, site: true });
    await page.goto(VENUE);
    await expect(page.locator(HERO_LIKE)).toBeEnabled();
    m.site = false; // the site cookie expires while the page is open
    await page.locator(HERO_LIKE).click();
    await expect(page.locator(HERO_LIKE)).toHaveAttribute('aria-pressed', 'true');
    expect(m.likePosts).toEqual([401, 200]);
    expect(m.logins).toHaveLength(1);
    expect(m.logins[0]).not.toContain('/account/');
    await expect(page).toHaveURL(new RegExp(`${VENUE}$`));
    await expect(header(page)).toContainText('Ann');
  });

  test('after the browser was closed: shown as signed out at once, with no trip to a sign-in form', async ({ pinned: page, baseURL }) => {
    // Closing the browser ended both the site cookie li-sso and the sign-in service's memory of the visitor.
    const m = await mockSite(page, { baseURL: baseURL!, sso: false, idp: false });
    await page.goto(VENUE);
    await expect(header(page)).toContainText('Sign in');
    await expect(page.locator('[data-toast]')).toContainText('Your sign-in ended');
    expect(await page.evaluate(() => localStorage.getItem('li-account'))).toBeNull();
    expect(m.logins).toEqual([]);
    // Clicking Like then shows the normal sign-in, and the like is finished after it.
    await page.locator(HERO_LIKE).click();
    await expect(page).toHaveURL(/\/\.auth\/login\/extid\?post_login_redirect_uri=.*account.*next/);
  });

  test('right after signing up (the welcome step), no silent sign-in is tried in that browser session', async ({ pinned: page, baseURL }) => {
    // The sign-in service keeps nothing to reuse after a sign-up, so a silent trip would end on its sign-in form.
    const m = await mockSite(page, { baseURL: baseURL!, cached: false, site: true, idp: false, sso: false });
    await page.route('**/api/me', (r) =>
      r.fulfill({ json: m.site ? { signedIn: true, suggestedName: '', user: { displayName: '', status: 'active', needsProfile: true, canPostPhotos: false, adult: false, ageConfirmed: false, rulesAccepted: false, isAdmin: false } } : { signedIn: false } }),
    );
    await page.goto('/account/');
    await expect(page.getByRole('heading', { name: 'Welcome! One more step' })).toBeVisible();
    expect(await ssoCookie(page)).toBe('0');
    await page.evaluate(() => localStorage.setItem('li-account', JSON.stringify({ name: 'Ann B', admin: false })));
    m.site = false; // 8 hours later
    await page.goto(VENUE);
    await expect(header(page)).toContainText('Sign in');
    expect(m.logins).toEqual([]);
  });

  test('a sign-in that comes back with an error: back on the page, signed out, once (no loop)', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL!, idpError: true });
    await page.goto(VENUE);
    await expect(page).toHaveURL(new RegExp(`${VENUE}$`));
    await expect(header(page)).toContainText('Sign in');
    await expect(page.locator('[data-toast]')).toContainText('Your sign-in ended');
    expect(await page.evaluate(() => localStorage.getItem('li-account'))).toBeNull();
    expect(await ssoCookie(page)).toBe('');
    expect(m.logins).toHaveLength(1);
    await page.goto('/events/');
    await page.goto(VENUE);
    await expect(page.locator(HERO_LIKE)).toBeEnabled();
    expect(m.logins, 'later pages do not try again').toHaveLength(1);
  });

  test('the 401 page itself explains and offers to sign in', async ({ pinned: page }) => {
    await page.goto('/signed-out/');
    await expect(page.getByRole('heading', { name: "You're signed out" })).toBeVisible();
    await expect(page.locator('[data-signed-out-page] [data-signin]')).toHaveAttribute('href', /^\/\.auth\/login\/extid\?post_login_redirect_uri=/);
  });
});

test.describe('signing out stays signed out', () => {
  for (const [where, from, button] of [
    ['footer', VENUE, '.site-footer [data-account-signout]'],
    ['account page', '/account/', '[data-account] [data-account-signout]'],
  ] as const) {
    test(`"Sign out" in the ${where} forgets the name at once, and coming back does not sign in again`, async ({ pinned: page, baseURL }) => {
      const m = await mockSite(page, { baseURL: baseURL!, site: true });
      await page.goto(from);
      await expect(page.locator(button)).toBeVisible();
      await page.locator(button).click();
      await expect(page).toHaveURL(/\/$/);
      expect(m.logouts).toBe(1);
      expect(await page.evaluate(() => localStorage.getItem('li-account'))).toBeNull();
      expect(await ssoCookie(page)).toBe('');
      await page.goto(VENUE);
      await expect(page.locator(HERO_LIKE)).toBeEnabled();
      await expect(header(page)).toContainText('Sign in');
      expect(m.logins, 'no sign-in of any kind after "Sign out"').toEqual([]);
    });
  }

  test('"Sign out" clicked while the page is still checking who is signed in: late answers do not bring the name back', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL!, site: true });
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const signedIn = { clientPrincipal: { userId: 'u1', userDetails: 'Ann B', userRoles: ['anonymous', 'authenticated', 'member'] } };
    await page.route('**/.auth/me', async (r) => {
      await held;
      await r.fulfill({ json: m.site ? signedIn : { clientPrincipal: null } }).catch(() => {});
    });
    await page.route('**/api/me', async (r) => {
      await held;
      await r.fulfill({ json: { signedIn: true, user: { displayName: 'Ann B', status: 'active', needsProfile: false, canPostPhotos: true, adult: true, isAdmin: false } } }).catch(() => {});
    });
    // The real sign-out takes a moment; the old page keeps running (and hears those answers) until it is done.
    await page.route('**/.auth/logout**', async (r) => {
      release();
      await new Promise((done) => setTimeout(done, 1500));
      m.logouts++;
      m.site = false;
      await r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><script>location.replace("/")</script>' });
    });
    await page.goto(VENUE);
    const button = page.locator('.site-footer [data-account-signout]');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(/\/$/);
    expect(m.logouts).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('li-account'))).toBeNull();
    expect(await ssoCookie(page)).toBe('');
    await page.goto(VENUE);
    await expect(page.locator(HERO_LIKE)).toBeEnabled();
    await expect(header(page)).toContainText('Sign in');
    expect(m.logins, 'no sign-in of any kind after "Sign out"').toEqual([]);
  });
});

test('a visitor who never signed in: no session checks, sign-ins or redirects on list pages', async ({ pinned: page, baseURL }) => {
  const m = await mockSite(page, { baseURL: baseURL!, cached: false, site: false, sso: false });
  const auth: string[] = [];
  page.on('request', (q) => {
    if (/\/\.auth\/|\/api\/me/.test(q.url())) auth.push(new URL(q.url()).pathname);
  });
  const loads = countLoads(page);
  await page.goto('/events/');
  await expect(page.locator('[data-upcoming-list] [data-like]').first()).toBeEnabled();
  await expect(header(page)).toContainText('Sign in');
  expect(auth).toEqual([]);
  expect(loads).toEqual(['/events/']);
  expect(m.logins).toEqual([]);
});
