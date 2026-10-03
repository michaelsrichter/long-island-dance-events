'use strict';
/**
 * Minimal GitHub OAuth bridge for Decap CMS on Azure Static Web Apps.
 *
 *   GET /api/auth      -> redirects to GitHub with a CSRF "state" cookie
 *   GET /api/callback  -> verifies state, exchanges the code for a token, hands it to the CMS window
 *
 * Secrets come only from app settings: GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET.
 * Tokens are never logged or stored server-side.
 */
const telemetry = require('../telemetry-setup');
const { app } = require('@azure/functions');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { publicHost, isAllowedHost } = require('../hosts');
const { instruments, flush } = telemetry;

const STATE_COOKIE = 'starter_oauth_state';
const SCOPES = new Set(['public_repo', 'repo']);

function publicOrigin(request) {
  const host = publicHost(request);
  if (!isAllowedHost(host)) return null;
  const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
  return `${proto}://${host}`;
}

function cookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

const htmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function messagePage(origin, status, payload) {
  // The handshake script is a static file (/admin/oauth-callback.js) so the page needs no inline script.
  const message = `authorization:github:${status}:${JSON.stringify(payload)}`;
  return {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie': `${STATE_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signing in…</title><meta name="robots" content="noindex"></head><body>
<p id="oauth" data-origin="${htmlEscape(origin)}" data-message="${htmlEscape(message)}">${status === 'success' ? 'Signed in. You can close this window.' : 'Sign-in failed. Please close this window and try again.'}</p>
<script src="/admin/oauth-callback.js"></script></body></html>`,
  };
}

app.http('auth', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth',
  handler: async (request) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const origin = publicOrigin(request);
    if (!clientId || !origin) {
      instruments.cmsAuth.add(1, { result: !clientId ? 'config_missing' : 'bad_host' });
      await flush(500);
      return { status: 503, headers: { 'Content-Type': 'text/plain' }, body: 'CMS sign-in is not configured for this address. See docs/editor-guide.md.' };
    }
    const requested = new URL(request.url).searchParams.get('scope') || 'public_repo';
    const scope = requested.split(/[ ,]+/).filter((s) => SCOPES.has(s))[0] || 'public_repo';
    const state = randomBytes(24).toString('base64url');
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('redirect_uri', `${origin}/api/callback`);
    authorize.searchParams.set('scope', `${scope} read:user`);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'false');
    instruments.cmsAuth.add(1, { result: 'started' });
    await flush(500);
    return {
      status: 302,
      headers: {
        Location: authorize.toString(),
        'Cache-Control': 'no-store',
        'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      },
    };
  },
});

app.http('callback', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'callback',
  handler: async (request, context) => {
    const origin = publicOrigin(request);
    if (!origin) return { status: 400, body: 'Unknown host' };
    const params = new URL(request.url).searchParams;
    const code = params.get('code') || '';
    const state = params.get('state') || '';
    const expected = cookie(request, STATE_COOKIE);
    const fail = async (result, message) => {
      instruments.cmsAuth.add(1, { result });
      await flush(500);
      return messagePage(origin, 'error', { message });
    };
    if (params.get('error')) return fail('github_denied', 'GitHub sign-in was cancelled.');
    if (!/^[\w-]{10,64}$/.test(code)) return fail('bad_code', 'Missing or invalid sign-in code.');
    const a = Buffer.from(state);
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return fail('state_mismatch', 'Sign-in expired or was tampered with. Please try again.');

    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'home-website-cms' },
        body: JSON.stringify({
          client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
          client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
          code,
          redirect_uri: `${origin}/api/callback`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.access_token) {
        context.warn(`GitHub token exchange failed: ${res.status} ${data.error || ''}`);
        return fail('github_error', 'GitHub did not accept the sign-in. Please try again.');
      }
      instruments.cmsAuth.add(1, { result: 'success' });
      await flush(500);
      return messagePage(origin, 'success', { token: data.access_token, provider: 'github' });
    } catch (err) {
      context.warn(`GitHub token exchange error: ${err && err.message}`);
      return fail('exception', 'Could not reach GitHub. Please try again.');
    }
  },
});
