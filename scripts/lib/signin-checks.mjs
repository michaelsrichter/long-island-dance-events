/**
 * Identity checks for the deployed-site test, not browser UI code. A broken endpoint must fail the test,
 * rather than look like a successful sign-out.
 *
 * @typedef {{ admin: boolean, name: string, source: '/.auth/me' | '/api/session' }} Identity
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * SWA returns clientPrincipal; App Service uses /api/session for the site's identity and moderator flag.
 * Never infer site permissions from App Service's raw /.auth/me claims.
 *
 * @param {(path: string) => Promise<{ status: number, data: unknown }>} get
 * @returns {Promise<Identity | null>}
 */
export async function readIdentity(get) {
  const me = await get('/.auth/me');
  if (me.status === 200 && object(me.data) && 'clientPrincipal' in me.data) {
    const principal = me.data.clientPrincipal;
    if (principal === null) return null;
    if (!object(principal) || !Array.isArray(principal.userRoles) || !principal.userRoles.every((role) => typeof role === 'string')) {
      throw new Error('GET /.auth/me returned an invalid SWA clientPrincipal.');
    }
    return {
      admin: principal.userRoles.includes('admin'),
      name: typeof principal.userDetails === 'string' ? principal.userDetails : '',
      source: '/.auth/me',
    };
  }
  if (![200, 401, 404].includes(me.status)) throw new Error(`GET /.auth/me returned HTTP ${me.status}.`);

  const session = await get('/api/session');
  if (session.status !== 200) throw new Error(`GET /api/session returned HTTP ${session.status}.`);
  const data = session.data;
  if (!object(data) || typeof data.signedIn !== 'boolean' || typeof data.admin !== 'boolean' || typeof data.name !== 'string') {
    throw new Error('GET /api/session returned an invalid session.');
  }
  if (!data.signedIn) {
    if (data.admin) throw new Error('GET /api/session reports a signed-out moderator.');
    return null;
  }
  return { admin: data.admin, name: data.name, source: '/api/session' };
}

/**
 * Both deployed hosts protect the review center with a 403 page. Local/older previews can instead show
 * the review center's own "not a moderator" message.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 */
export async function nonModeratorPage(page, url) {
  const response = await page.goto(url);
  const status = response?.status();
  if (status !== 200 && status !== 403) throw new Error(`The non-moderator page returned HTTP ${status ?? 'no response'} (expected 403 or a preview's 200).`);
  if (status === 200) await page.locator('[data-mod-loading]').waitFor({ state: 'hidden', timeout: 60_000 });
  const message = page.locator(status === 403 ? '[data-not-allowed]' : '[data-mod-notmod]');
  await message.waitFor({ state: 'visible', timeout: 30_000 });
  return { status, message: (await message.textContent())?.trim() || '' };
}
