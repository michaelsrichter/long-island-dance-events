/**
 * Who may call the sync endpoints: only named GitHub Actions workflows of this repository, running on main.
 *
 * Each run asks GitHub for a short-lived signed token (OpenID Connect). We check GitHub's signature, the
 * audience, the repository, the branch and the exact workflow file. There is no password or key to leak.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';

export class AuthError extends Error {}

let remoteKeys;
const githubKeys = () => (remoteKeys ??= createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`), { cacheMaxAge: 60 * 60 * 1000 }));

export function settingsFromEnv(env = process.env) {
  return {
    audience: env.OIDC_AUDIENCE || 'li-dance-server',
    repository: env.OIDC_REPOSITORY || 'michaelsrichter/long-island-dance-events',
    ref: env.OIDC_REF || 'refs/heads/main',
    workflows: (env.OIDC_ALLOWED_WORKFLOWS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** Returns the token's claims, or throws AuthError. */
export async function verifyGithubRequest(authorization, settings = settingsFromEnv(), { keys = githubKeys(), issuer = GITHUB_ISSUER } = {}) {
  const m = /^Bearer\s+([A-Za-z0-9_\-.]+)$/.exec(authorization || '');
  if (!m) throw new AuthError('A GitHub Actions token is required.');
  let payload;
  try {
    ({ payload } = await jwtVerify(m[1], keys, { issuer, audience: settings.audience, algorithms: ['RS256'], clockTolerance: 30 }));
  } catch (err) {
    throw new AuthError(`Token rejected: ${err.code || err.message}`);
  }
  if (payload.repository !== settings.repository) throw new AuthError('Token is from another repository.');
  if (payload.ref !== settings.ref) throw new AuthError('Token is not from the main branch.');
  const wf = String(payload.job_workflow_ref || '');
  const wfPath = wf.replace(/@.*$/, '');
  const wfRef = wf.slice(wfPath.length + 1);
  if (wfRef !== settings.ref || !settings.workflows.some((w) => w === wfPath || w === wf)) {
    throw new AuthError('This workflow may not call the server.');
  }
  return payload;
}
