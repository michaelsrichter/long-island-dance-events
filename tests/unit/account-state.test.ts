import { afterEach, describe, expect, it, vi } from 'vitest';

type Answer = { status: number; body?: unknown } | Error;

/** A fresh copy of account-state (whoAmI asks once per page) with a stand-in fetch. */
async function whoAmIWith(answers: Record<string, Answer>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const a = answers[url];
    if (!a) throw new Error(`unexpected ${url}`);
    if (a instanceof Error) throw a;
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
  });
  vi.resetModules();
  const { whoAmI } = await import('../../src/scripts/account-state');
  return { session: await whoAmI(), calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('whoAmI on both hosts (decision P60)', () => {
  it('Static Web Apps, signed in: reads /.auth/me only', async () => {
    const { session, calls } = await whoAmIWith({ '/.auth/me': { status: 200, body: { clientPrincipal: { userRoles: ['anonymous', 'authenticated', 'admin'], userDetails: 'Mike' } } } });
    expect(session).toEqual({ signedIn: true, admin: true, name: 'Mike' });
    expect(calls).toEqual(['/.auth/me']);
  });

  it('Static Web Apps, signed out: reads /.auth/me only', async () => {
    const { session, calls } = await whoAmIWith({ '/.auth/me': { status: 200, body: { clientPrincipal: null } } });
    expect(session).toEqual({ signedIn: false, admin: false, name: '' });
    expect(calls).toEqual(['/.auth/me']);
  });

  it('App Service: /.auth/me in another format or refused, so the server answers', async () => {
    for (const me of [{ status: 401 }, { status: 404 }, { status: 200, body: [] }]) {
      const { session, calls } = await whoAmIWith({ '/.auth/me': me, '/api/session': { status: 200, body: { signedIn: true, admin: false, name: 'Ann' } } });
      expect(session).toEqual({ signedIn: true, admin: false, name: 'Ann' });
      expect(calls).toEqual(['/.auth/me', '/api/session']);
    }
  });

  it('no network or an error: signed out', async () => {
    expect((await whoAmIWith({ '/.auth/me': new Error('offline') })).session.signedIn).toBe(false);
    expect((await whoAmIWith({ '/.auth/me': { status: 404 }, '/api/session': { status: 500 } })).session.signedIn).toBe(false);
  });
});
