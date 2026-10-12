import { createServer, type Server } from 'node:http';
import { test as base, expect, type Page } from '@playwright/test';
import { nonModeratorPage, readIdentity } from '../../scripts/lib/signin-checks.mjs';

type Site = {
  url: string;
  host: 'swa' | 'app-service';
  admin: boolean;
  preview: boolean;
  calls: string[];
};

const test = base.extend<{ site: Site }>({
  site: async ({}, use) => {
    const site: Site = { url: '', host: 'app-service', admin: false, preview: false, calls: [] };
    const server: Server = createServer((request, response) => {
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      site.calls.push(pathname);
      const signedIn = /(?:^|;\s*)(?:AppServiceAuthSession|StaticWebAppsAuthCookie)=test(?:;|$)/.test(request.headers.cookie || '');
      let status = 200;
      let body: unknown;
      let html = false;
      if (pathname === '/.auth/me') {
        body = site.host === 'swa'
          ? { clientPrincipal: signedIn ? { userDetails: 'Test visitor', userRoles: ['authenticated', ...(site.admin ? ['admin'] : [])] } : null }
          : signedIn ? [{ provider_name: 'extid', user_claims: [{ typ: 'roles', val: 'admin' }] }] : [];
      } else if (pathname === '/api/session') {
        body = { signedIn, admin: signedIn && site.admin, name: signedIn ? 'Test visitor' : '' };
      } else if (pathname === '/moderate/') {
        html = true;
        status = !signedIn ? 401 : site.preview ? 200 : 403;
        body = status === 401 ? '<h1>Please sign in</h1>'
          : site.preview ? '<div data-mod-loading hidden></div><div data-mod-notmod>Only moderators can open this page.</div>'
            : '<h1>Editors only</h1><div data-not-allowed>You are signed in, but not an editor.</div>';
      } else if (pathname === '/api/moderation/queue') {
        status = signedIn ? 403 : 401;
        body = { error: signedIn ? 'not_admin' : 'sign_in' };
      } else {
        status = 404;
        body = { error: 'not_found' };
      }
      response.writeHead(status, { 'Content-Type': html ? 'text/html' : 'application/json' });
      response.end(html ? String(body) : JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The test server has no TCP address.');
    site.url = `http://127.0.0.1:${address.port}`;
    try {
      await use(site);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  },
});

async function identity(page: Page, site: Site) {
  return readIdentity(async (path: string) => {
    const response = await page.request.get(site.url + path);
    return { status: response.status(), data: await response.json() };
  });
}

async function signIn(page: Page, site: Site) {
  const name = site.host === 'swa' ? 'StaticWebAppsAuthCookie' : 'AppServiceAuthSession';
  await page.context().addCookies([{ name, value: 'test', url: site.url, httpOnly: true }]);
}

test('App Service identity and cookie removal use /api/session, not raw provider roles', async ({ page, site }) => {
  await signIn(page, site);
  await expect(identity(page, site)).resolves.toEqual({ admin: false, name: 'Test visitor', source: '/api/session' });
  await page.context().clearCookies();
  await expect(identity(page, site)).resolves.toBeNull();
  expect(site.calls).toEqual(['/.auth/me', '/api/session', '/.auth/me', '/api/session']);
});

test('App Service moderator permission comes from /api/session', async ({ page, site }) => {
  site.admin = true;
  await signIn(page, site);
  await expect(identity(page, site)).resolves.toEqual({ admin: true, name: 'Test visitor', source: '/api/session' });
});

test('SWA keeps its signed-in and signed-out clientPrincipal checks without /api/session', async ({ page, site }) => {
  site.host = 'swa';
  site.admin = true;
  await signIn(page, site);
  await expect(identity(page, site)).resolves.toEqual({ admin: true, name: 'Test visitor', source: '/.auth/me' });
  await page.context().clearCookies();
  await expect(identity(page, site)).resolves.toBeNull();
  expect(site.calls).toEqual(['/.auth/me', '/.auth/me']);
});

test('a signed-in non-moderator gets the protected 403 page and API refusal', async ({ page, site }) => {
  await signIn(page, site);
  await expect(identity(page, site)).resolves.toMatchObject({ admin: false });
  await expect(nonModeratorPage(page, site.url + '/moderate/')).resolves.toEqual({
    status: 403, message: 'You are signed in, but not an editor.',
  });
  expect((await page.request.get(site.url + '/api/moderation/queue')).status()).toBe(403);
});

test('an older preview can show its own non-moderator message with HTTP 200', async ({ page, site }) => {
  site.host = 'swa';
  site.preview = true;
  await signIn(page, site);
  await expect(nonModeratorPage(page, site.url + '/moderate/')).resolves.toEqual({
    status: 200, message: 'Only moderators can open this page.',
  });
  expect((await page.request.get(site.url + '/api/moderation/queue')).status()).toBe(403);
});

test('a signed-out 401 page does not falsely pass the non-moderator test', async ({ page, site }) => {
  await expect(nonModeratorPage(page, site.url + '/moderate/')).rejects.toThrow('HTTP 401');
});
