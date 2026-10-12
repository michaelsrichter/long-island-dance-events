import { describe, expect, it, vi } from 'vitest';
import { readIdentity } from '../../scripts/lib/signin-checks.mjs';

type Answer = { status: number; data: unknown };

function api(answers: Record<string, Answer>) {
  return vi.fn(async (path: string) => {
    const answer = answers[path];
    if (!answer) throw new Error(`Unexpected GET ${path}`);
    return answer;
  });
}

describe('deployed sign-in test identity on both hosts', () => {
  it.each([false, true])('preserves SWA identity and moderator=%s without asking /api/session', async (admin) => {
    const get = api({ '/.auth/me': { status: 200, data: { clientPrincipal: { userDetails: 'Test visitor', userRoles: ['authenticated', ...(admin ? ['admin'] : [])] } } } });
    expect(await readIdentity(get)).toEqual({ admin, name: 'Test visitor', source: '/.auth/me' });
    expect(get.mock.calls).toEqual([['/.auth/me']]);
  });

  it('preserves SWA signed-out coverage without falling back to another endpoint', async () => {
    const get = api({ '/.auth/me': { status: 200, data: { clientPrincipal: null } } });
    expect(await readIdentity(get)).toBeNull();
    expect(get.mock.calls).toEqual([['/.auth/me']]);
  });

  it.each([
    { status: 200, data: [] },
    { status: 200, data: [{ provider_name: 'extid', user_claims: [{ typ: 'roles', val: 'admin' }] }] },
    { status: 401, data: null },
    { status: 404, data: null },
  ])('uses the App Service session, not raw claims, after /.auth/me $status', async (me) => {
    const get = api({ '/.auth/me': me, '/api/session': { status: 200, data: { signedIn: true, admin: false, name: 'Test visitor' } } });
    expect(await readIdentity(get)).toEqual({ admin: false, name: 'Test visitor', source: '/api/session' });
    expect(get.mock.calls).toEqual([['/.auth/me'], ['/api/session']]);
  });

  it('uses /api/session for App Service moderator permissions', async () => {
    const get = api({ '/.auth/me': { status: 404, data: null }, '/api/session': { status: 200, data: { signedIn: true, admin: true, name: 'Test editor' } } });
    expect(await readIdentity(get)).toEqual({ admin: true, name: 'Test editor', source: '/api/session' });
  });

  it('detects a real App Service sign-out after cookie removal', async () => {
    const get = api({ '/.auth/me': { status: 200, data: [] }, '/api/session': { status: 200, data: { signedIn: false, admin: false, name: '' } } });
    expect(await readIdentity(get)).toBeNull();
  });

  it.each([401, 403, 404, 500])('fails instead of treating an App Service session HTTP %s as signed out', async (status) => {
    const get = api({ '/.auth/me': { status: 404, data: null }, '/api/session': { status, data: null } });
    await expect(readIdentity(get)).rejects.toThrow(`GET /api/session returned HTTP ${status}`);
  });

  it.each([null, [], {}, { signedIn: 'false', admin: false, name: '' }, { signedIn: true, admin: 'true', name: '' }, { signedIn: true, admin: false }])('rejects an invalid App Service session %#', async (data) => {
    const get = api({ '/.auth/me': { status: 404, data: null }, '/api/session': { status: 200, data } });
    await expect(readIdentity(get)).rejects.toThrow('invalid session');
  });

  it('rejects a signed-out moderator instead of accepting inconsistent session data', async () => {
    const get = api({ '/.auth/me': { status: 404, data: null }, '/api/session': { status: 200, data: { signedIn: false, admin: true, name: '' } } });
    await expect(readIdentity(get)).rejects.toThrow('signed-out moderator');
  });

  it.each([{}, { userRoles: 'admin' }, { userRoles: [1] }])('fails on malformed SWA principals instead of switching hosts %#', async (clientPrincipal) => {
    const get = api({ '/.auth/me': { status: 200, data: { clientPrincipal } } });
    await expect(readIdentity(get)).rejects.toThrow('invalid SWA clientPrincipal');
    expect(get.mock.calls).toEqual([['/.auth/me']]);
  });

  it('surfaces identity endpoint failures rather than claiming successful sign-out', async () => {
    await expect(readIdentity(api({ '/.auth/me': { status: 500, data: null } }))).rejects.toThrow('GET /.auth/me returned HTTP 500');
    await expect(readIdentity(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });
});
