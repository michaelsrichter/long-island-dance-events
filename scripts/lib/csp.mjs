// Content-Security-Policy for the site (one place for both hosts, decision P58):
// - static build: scripts/postbuild.mjs fills in the inline-script hashes of every page and writes
//   staticwebapp.config.json;
// - live server: scripts/postbuild.mjs (ASTRO_TARGET=server) writes the policies with a __HASHES__ marker,
//   and the server fills in the hashes of each page it sends (server/src/rules.js).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const thirdPartyScripts = ['https://www.googletagmanager.com', 'https://www.clarity.ms', 'https://*.clarity.ms'];
const thirdPartyConnectBase = [
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
  'https://*.clarity.ms',
  'https://c.bing.com',
];
const thirdPartyImgBase = ['https://*.google-analytics.com', 'https://*.googletagmanager.com', 'https://*.clarity.ms', 'https://c.bing.com', 'https://tile.openstreetmap.org'];

/** Builders for the three policies: the site, the review center (/moderate/) and Decap (/admin/). */
export function cspBuilders(root) {
  // Community features read approved photos and per-page JSON straight from Blob Storage.
  const community = JSON.parse(readFileSync(join(root, 'src', 'data', 'community.json'), 'utf8'));
  const communityOrigin = new URL(community.blobBase).origin;
  const thirdPartyImg = [...thirdPartyImgBase, communityOrigin];
  const thirdPartyConnect = [...thirdPartyConnectBase, communityOrigin];
  const siteCspParts = (scriptHashes, formAction) =>
    [
      "default-src 'self'",
      `script-src 'self' ${[...scriptHashes].join(' ')} ${thirdPartyScripts.join(' ')}`.replace(/\s+/g, ' ').trim(),
      "style-src 'self'",
      `img-src 'self' data: ${thirdPartyImg.join(' ')}`,
      "font-src 'self'",
      "media-src 'self'",
      `connect-src 'self' ${thirdPartyConnect.join(' ')}`,
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      formAction,
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');
  const adminCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.githubusercontent.com https://github.com",
    "media-src 'self' blob: https://*.githubusercontent.com",
    "connect-src 'self' https://api.github.com https://*.githubusercontent.com",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    site: (hashes) => siteCspParts(hashes, "form-action 'self'"),
    // The review center may send the one-time "create a GitHub App" form to github.com (decision P51).
    review: (hashes) => siteCspParts(hashes, "form-action 'self' https://github.com"),
    admin: adminCsp,
  };
}

/** sha256 hashes of a page's inline scripts (not JSON-LD, not empty), in CSP form. */
export function inlineScriptHashes(html, createHash) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].trim()) continue;
    out.push(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  return out;
}
