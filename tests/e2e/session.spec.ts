import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** A small mock for the hosting session, the API and External ID's remembered browser session. */
const VENUE = '/venues/huntington-moose-lodge/';
const KEY = 'venue:huntington-moose-lodge';
const HERO_LIKE = '[data-react][data-detail] [data-like]';

type Mock = { site: boolean; idp: boolean; idpError: boolean; liked: boolean; meChecks: number; logins: string[]; likePosts: number[]; logouts: number };
type Options = { baseURL: string; name?: string; site?: boolean; idp?: boolean; idpError?: boolean; cached?: boolean; sso?: boolean };

async function mockSite(page: Page, { baseURL, name = 'Ann B', site = false, idp = true, idpError = false, cached = true, sso = true }: Options): Promise<Mock> {
  const m: Mock = { site, idp, idpError, liked: false, meChecks: 0, logins: [], likePosts: [], logouts: 0 };
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
  await page.route('**/.auth/me', (r) => {
    m.meChecks++;
    return r.fulfill({ json: { clientPrincipal: m.site ? { userId: 'u1', userDetails: name, userRoles: ['anonymous', 'authenticated', 'member'] } : null } });
  });
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

const ssoCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'li-sso')?.value || '';
const header = (page: Page) => page.locator('.site-header [data-account-header]');

test.describe('public browsing after the secure session ended', () => {
  test('an expired returning visitor keeps browsing the requested public pages without an auth check or redirect', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL! });
    const loads = countLoads(page);
    await page.goto(VENUE);
    await expect(header(page)).toHaveAttribute('href', '/account/');
    await expect(header(page)).toContainText('Ann');
    await expect(page.locator(HERO_LIKE)).toBeEnabled();
    await page.goto('/events/');
    await expect(header(page)).toContainText('Ann');
    await page.goto('/');
    await expect(header(page)).toContainText('Ann');
    expect(m.meChecks, 'public navigation must not verify the secure session').toBe(0);
    expect(m.logins, 'public navigation must not start sign-in').toEqual([]);
    expect(loads).toEqual([VENUE, '/events/', '/']);
  });

  test('reauthentication starts only after Like, returns to the same page and finishes the click', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL! });
    await page.goto(VENUE);
    expect(m.meChecks).toBe(0);
    await page.locator(HERO_LIKE).click();
    await expect(page.locator(HERO_LIKE)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`${HERO_LIKE} [data-like-count]`)).toContainText('5');
    expect(m.meChecks).toBeGreaterThan(0);
    expect(m.logins, 'one silent sign-in that comes straight back to the requested page').toHaveLength(1);
    expect(m.logins[0]).toContain(`post_login_redirect_uri=${baseURL}${VENUE}`);
    expect(m.logins[0], 'returning visitors skip the welcome step').not.toContain('/account/');
    expect(m.likePosts).toEqual([200]);
    await expect(page).toHaveURL(new RegExp(`${VENUE}$`));
  });

  test('a protected action after the session ends signs in again and then finishes', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL!, site: true });
    await page.goto(VENUE);
    await expect(page.locator(HERO_LIKE)).toBeEnabled();
    await page.locator(HERO_LIKE).click();
    await expect(page.locator(HERO_LIKE)).toHaveAttribute('aria-pressed', 'true');
    m.site = false; // the site cookie expires while the page is open
    await page.locator(HERO_LIKE).click();
    await expect.poll(() => m.likePosts).toEqual([200, 401, 200]);
    await expect(page.locator(HERO_LIKE)).toHaveAttribute('aria-pressed', 'false');
    expect(m.liked).toBe(false);
    expect(m.logins).toHaveLength(1);
    expect(m.logins[0]).not.toContain('/account/');
    await expect(page).toHaveURL(new RegExp(`${VENUE}$`));
    await expect(header(page)).toContainText('Ann');
  });

  test('without a remembered External ID session, browsing stays public and a protected click opens normal sign-in', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL!, sso: false, idp: false });
    await page.goto(VENUE);
    await expect(header(page)).toContainText('Ann');
    expect(m.meChecks).toBe(0);
    expect(m.logins).toEqual([]);
    await page.locator(HERO_LIKE).click();
    await expect(page).toHaveURL(/\/\.auth\/login\/extid\?post_login_redirect_uri=.*account.*next/);
    expect(m.meChecks).toBe(1);
    expect(m.logins).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem('li-account'))).not.toBeNull();
  });

  test('an expired account page keeps the cached display identity until explicit Sign out', async ({ pinned: page, baseURL }) => {
    await mockSite(page, { baseURL: baseURL!, sso: false });
    await page.goto('/account/');
    await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
    await expect(header(page)).toContainText('Ann');
    expect(await page.evaluate(() => localStorage.getItem('li-account'))).not.toBeNull();
  });

  test('a failed silent restore returns to the public page once without a redirect loop', async ({ pinned: page, baseURL }) => {
    const m = await mockSite(page, { baseURL: baseURL!, idpError: true });
    await page.goto(VENUE);
    expect(m.logins).toEqual([]);
    await page.locator(HERO_LIKE).click();
    await expect(page).toHaveURL(new RegExp(`${VENUE}$`));
    await expect(header(page)).toContainText('Ann');
    await expect(page.locator('[data-toast]')).toContainText('Your sign-in ended');
    expect(await page.evaluate(() => localStorage.getItem('li-account'))).not.toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('li-pending'))).toBeNull();
    expect(await ssoCookie(page)).toBe('');
    expect(m.logins).toHaveLength(1);
    await page.goto('/events/');
    await page.goto(VENUE);
    await expect(page.locator(HERO_LIKE)).toBeEnabled();
    expect(m.logins, 'later public pages do not try again').toHaveLength(1);
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

});

test('a visitor who never signed in: no session checks, sign-ins or redirects while browsing public pages', async ({ pinned: page, baseURL }) => {
  const m = await mockSite(page, { baseURL: baseURL!, cached: false, site: false, sso: false });
  const auth: string[] = [];
  page.on('request', (q) => {
    if (/\/\.auth\/|\/api\/me/.test(q.url())) auth.push(new URL(q.url()).pathname);
  });
  const loads = countLoads(page);
  await page.goto('/');
  await page.goto('/events/');
  await expect(page.locator('[data-upcoming-list] [data-like]').first()).toBeEnabled();
  await expect(header(page)).toContainText('Sign in');
  expect(auth).toEqual([]);
  expect(loads).toEqual(['/', '/events/']);
  expect(m.logins).toEqual([]);
});
