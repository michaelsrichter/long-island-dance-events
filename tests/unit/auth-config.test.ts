import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(new URL('../../public/staticwebapp.config.json', import.meta.url), 'utf8'));
const oidc = config.auth.identityProviders.customOpenIdConnectProviders.extid.registration.openIdConnectConfiguration;

describe('visitor sign-in configuration', () => {
  it('"Sign out" ends only the site session: SWA gets no end-session address for External ID', () => {
    // With the discovery document, SWA sends people to External ID's "Which account do you want to sign out of?"
    // page, which often lists no account and leaves them signed in.
    expect(oidc.wellKnownOpenIdConfiguration).toBeUndefined();
    expect(JSON.stringify(config)).not.toMatch(/oauth2\/v2\.0\/logout|end_session/);
  });

  it('names every sign-in endpoint of the External ID tenant explicitly', () => {
    const tenant = 'a72c253f-3125-4592-b3c6-b8e23ed18054';
    expect(oidc.authorizationEndpoint).toBe(`https://longislanddance.ciamlogin.com/${tenant}/oauth2/v2.0/authorize`);
    expect(oidc.tokenEndpoint).toBe(`https://longislanddance.ciamlogin.com/${tenant}/oauth2/v2.0/token`);
    expect(oidc.issuer).toBe(`https://${tenant}.ciamlogin.com/${tenant}/v2.0`);
    expect(oidc.certificationUri).toBe(`https://longislanddance.ciamlogin.com/${tenant}/discovery/v2.0/keys`);
  });

  it('a sign-in that comes back with an error lands on our own signed-out page, not a bare 401 error', () => {
    // For example the visitor pressed Cancel: Static Web Apps answers 401 at /.auth/login/extid/callback.
    expect(config.responseOverrides['401']).toEqual({ rewrite: '/signed-out/index.html', statusCode: 401 });
    expect(readFileSync(new URL('../../src/pages/signed-out.astro', import.meta.url), 'utf8')).toContain("import '../scripts/signed-out'");
  });
});
