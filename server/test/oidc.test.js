import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { AuthError, verifyGithubRequest } from '../src/lib/oidc.js';

const ISSUER = 'https://token.actions.githubusercontent.com';
const WF = 'michaelsrichter/long-island-dance-events/.github/workflows/database-sync.yml';
const settings = { audience: 'li-dance-server', repository: 'michaelsrichter/long-island-dance-events', ref: 'refs/heads/main', workflows: [WF] };

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });

const good = {
  repository: 'michaelsrichter/long-island-dance-events',
  ref: 'refs/heads/main',
  job_workflow_ref: `${WF}@refs/heads/main`,
  event_name: 'schedule',
  run_id: '1',
  sha: 'abc1234def',
};

async function token(claims = {}, { aud = 'li-dance-server', iss = ISSUER, exp = '5m', key = privateKey } = {}) {
  return new SignJWT({ ...good, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key);
}
const check = async (t) => verifyGithubRequest(`Bearer ${t}`, settings, { keys, issuer: ISSUER });

test('accepts the database sync workflow on main', async () => {
  const claims = await check(await token());
  assert.equal(claims.run_id, '1');
});

test('refuses a missing or malformed Authorization header', async () => {
  await assert.rejects(verifyGithubRequest(undefined, settings, { keys }), AuthError);
  await assert.rejects(verifyGithubRequest('Basic abc', settings, { keys }), AuthError);
});

test('refuses another audience, issuer, repository, branch or workflow', async () => {
  await assert.rejects(check(await token({}, { aud: 'someone-else' })), AuthError);
  await assert.rejects(check(await token({}, { iss: 'https://evil.example' })), AuthError);
  await assert.rejects(check(await token({ repository: 'someone/fork' })), AuthError);
  await assert.rejects(check(await token({ ref: 'refs/heads/feature' })), AuthError);
  await assert.rejects(check(await token({ job_workflow_ref: `${WF}@refs/heads/feature` })), AuthError);
  await assert.rejects(check(await token({ job_workflow_ref: 'michaelsrichter/long-island-dance-events/.github/workflows/ci.yml@refs/heads/main' })), AuthError);
});

test('refuses an expired token or one signed by another key', async () => {
  await assert.rejects(check(await token({}, { exp: Math.floor(Date.now() / 1000) - 120 })), AuthError);
  const other = await generateKeyPair('RS256');
  await assert.rejects(check(await token({}, { key: other.privateKey })), AuthError);
});

test('refuses everything when no workflow is allowed', async () => {
  await assert.rejects(verifyGithubRequest(`Bearer ${await token()}`, { ...settings, workflows: [] }, { keys, issuer: ISSUER }), AuthError);
});
