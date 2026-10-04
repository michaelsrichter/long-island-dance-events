import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

const VENUE = '/venues/huntington-moose-lodge/';
const DOC = {
  v: 1,
  key: 'venue:huntington-moose-lodge',
  likes: 4,
  comments: [
    { id: '0000000000000001_abcdefgh', name: 'Ann B', text: 'Great floor!\nFriendly crowd.', at: '2026-10-01T23:00:00Z' },
    { id: '0000000000000002_abcdefgh', name: '<img src=x onerror=alert(1)>', text: '<script>alert(1)</script> shown as text', at: '2026-09-30T23:00:00Z' },
  ],
  photos: [
    {
      id: '0000000000000003_abcdefgh',
      by: 'Cal',
      caption: 'Saturday social',
      alt: 'Couples dancing under string lights',
      w: 2048,
      h: 1536,
      at: '2026-09-29T23:00:00Z',
      src: { s: '/favicon.svg', m: '/favicon.svg', l: '/favicon.svg' },
    },
  ],
  updatedAt: '2026-10-02T00:00:00Z',
};

async function mockCommunity(page: import('@playwright/test').Page, { signedIn = false } = {}) {
  await page.route('**/community/venue/huntington-moose-lodge.json', (r) => r.fulfill({ json: DOC }));
  await page.route('**/.auth/me', (r) => r.fulfill({ json: { clientPrincipal: signedIn ? { userId: 'u1', userRoles: ['anonymous', 'authenticated', 'member'] } : null } }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: signedIn ? { signedIn: true, user: { displayName: 'Ann B', status: 'active', needsProfile: false, canPostPhotos: true, adult: true, isAdmin: false } } : { signedIn: false } }),
  );
  await page.route('**/api/me/likes?**', (r) => r.fulfill({ json: { liked: {} } }));
  await page.route('**/api/likes', (r) => r.fulfill({ json: { key: DOC.key, liked: true, count: 5 } }));
  await page.route('**/api/comments', (r) => r.fulfill({ json: { status: 'pending', message: 'Thanks! A volunteer will check your post before it appears.' } }));
}

test.describe('community panel', () => {
  test('signed out: shows approved notes and photos, safely, with a sign-in link', async ({ pinned: page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss();
    });
    await mockCommunity(page);
    await page.goto(`${VENUE}#community`);
    const panel = page.locator('[data-community]');
    await expect(panel.getByRole('heading', { name: "Dancers' notes and photos" })).toBeVisible();
    await expect(panel.locator('[data-like-count]')).toHaveText('4');
    await expect(panel.locator('.community__comment')).toHaveCount(2);
    await expect(panel.getByText('<script>alert(1)</script> shown as text')).toBeVisible();
    await expect(panel.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    await expect(panel.getByRole('img', { name: 'Couples dancing under string lights' })).toBeVisible();
    const signIn = panel.getByRole('link', { name: /Sign in to like/ });
    await expect(signIn).toBeVisible();
    expect(await signIn.getAttribute('href')).toMatch(/^\/\.auth\/login\/extid\?post_login_redirect_uri=/);
    await expect(panel.locator('[data-comment-form]')).toBeHidden();
    expect(dialogs, 'no script from user content ran').toEqual([]);
  });

  test('signed in: can like and send a note', async ({ pinned: page }) => {
    await mockCommunity(page, { signedIn: true });
    await page.goto(`${VENUE}#community`);
    const panel = page.locator('[data-community]');
    await expect(panel.getByRole('link', { name: /Sign in to like/ })).toBeHidden();
    const like = panel.locator('[data-like]');
    await expect(like).toBeEnabled();
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-like-count]')).toHaveText('5');
    await panel.getByLabel('Your note').fill('Lovely place to dance.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(panel.locator('[data-status]')).toContainText('A volunteer will check');
  });

  test('signed in panel has no serious accessibility problems', async ({ pinned: page }) => {
    await mockCommunity(page, { signedIn: true });
    await page.goto(`${VENUE}#community`);
    await expect(page.locator('[data-comment-form]')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-community]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test('account page offers sign-in when signed out', async ({ pinned: page }) => {
    await page.route('**/api/me', (r) => r.fulfill({ json: { signedIn: false } }));
    await page.goto('/account/');
    await expect(page.getByRole('link', { name: 'Sign in or create an account' }).first()).toBeVisible();
    await expect(page.getByLabel('Your name, as other dancers will see it')).toBeHidden();
  });

  test('first sign-in: welcome step with a birth-year dropdown, then back to the page', async ({ pinned: page }) => {
    let saved: Record<string, unknown> | null = null;
    await page.route('**/api/me', (r) =>
      r.fulfill({ json: { signedIn: true, suggestedName: 'Mike R', user: { displayName: '', status: 'active', needsProfile: true, canPostPhotos: false, adult: false, ageConfirmed: false, rulesAccepted: false, isAdmin: true } } }),
    );
    await page.route('**/api/me/profile', async (r) => {
      saved = r.request().postDataJSON();
      await r.fulfill({ json: { user: { displayName: 'Mike R', status: 'active', needsProfile: false, canPostPhotos: true, adult: true, ageConfirmed: true, rulesAccepted: true, isAdmin: false } } });
    });
    await page.route('**/venues/huntington-moose-lodge/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>back</title><h1>Back on the venue page</h1>' }));
    await page.goto(`/account/?next=${encodeURIComponent('/venues/huntington-moose-lodge/#community')}`);
    await expect(page.getByRole('heading', { name: 'Welcome! One more step' })).toBeVisible();
    await expect(page.getByLabel('Your name, as other dancers will see it')).toHaveValue('Mike R');
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeHidden();
    const year = page.getByLabel('Year');
    expect(await year.locator('option').count()).toBeGreaterThan(90);
    await page.getByLabel('Month').selectOption({ label: 'May' });
    await year.selectOption('1990');
    await page.getByRole('checkbox', { name: /I agree to the community rules/ }).check();
    await page.getByRole('checkbox', { name: /I am 18 or older/ }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Back on the venue page' })).toBeVisible();
    expect(saved).toMatchObject({ displayName: 'Mike R', birthMonth: 5, birthYear: 1990, acceptRules: true, photoTerms: true });
  });

  test('returning sign-in goes straight back to the page', async ({ pinned: page }) => {
    await page.route('**/api/me', (r) => r.fulfill({ json: { signedIn: true, user: { displayName: 'Mike R', status: 'active', needsProfile: false, isAdmin: false } } }));
    await page.route('**/styles/west-coast-swing/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>back</title><h1>Back on the style page</h1>' }));
    await page.goto(`/account/?next=${encodeURIComponent('/styles/west-coast-swing/')}`);
    await expect(page.getByRole('heading', { name: 'Back on the style page' })).toBeVisible();
  });

  test('header shows "Sign in", then the person\'s name linking to their profile', async ({ pinned: page }) => {
    await page.goto('/');
    const link = page.locator('.site-header [data-account-header]');
    await expect(link).toHaveAttribute('href', /^\/\.auth\/login\/extid\?post_login_redirect_uri=/);
    await expect(link).toContainText('Sign in');
    await page.route('**/.auth/me', (r) => r.fulfill({ json: { clientPrincipal: { userId: 'u1', userDetails: 'Mike R', userRoles: ['anonymous', 'authenticated', 'member'] } } }));
    await page.evaluate(() => localStorage.setItem('li-account', JSON.stringify({ name: 'Mike Richter', admin: false })));
    await page.reload();
    await expect(link).toHaveAttribute('href', '/account/');
    await expect(link).toContainText('Mike');
    await expect(page.locator('.site-footer').getByRole('link', { name: 'Sign out' })).toBeVisible();
  });
});
