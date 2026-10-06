/**
 * The old host's rules (public/staticwebapp.config.json), applied by the live server so both hosts send the
 * same headers (decision P58). scripts/postbuild.mjs turns the file into site/server/site-rules.json.
 *
 * Like Azure Static Web Apps: routes are checked in order and the first match wins; its headers are added to
 * the global ones. Policies marked __SITE_CSP__ / __REVIEW_CSP__ get the hashes of the page's own inline
 * scripts (the same rule as scripts/lib/csp.mjs).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function patternOf(route) {
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  if (route.endsWith('/*')) return new RegExp(`^${esc(route.slice(0, -2))}(/.*)?$`);
  return new RegExp(`^${route.split('*').map(esc).join('.*')}$`);
}

export function inlineScriptHashes(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].trim()) continue;
    out.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  return [...out];
}

export function loadRules(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    raw = { csp: {}, globalHeaders: {}, routes: [], responseOverrides: {}, mimeTypes: {} };
  }
  const routes = (raw.routes || []).map((r) => ({ ...r, re: patternOf(r.route) }));
  const policy = (value, hashes) => {
    const template = raw.csp?.[value];
    if (!template) return value;
    return template.replace('__HASHES__', hashes.join(' ')).replace(/ {2,}/g, ' ');
  };
  return {
    mimeTypes: raw.mimeTypes || {},
    responseOverrides: raw.responseOverrides || {},
    /** The first route that matches the address, or undefined. */
    route(pathname) {
      return routes.find((r) => r.re.test(pathname));
    },
    /** Headers for an answer: global headers, then the route's; `html` gives the page's script hashes. */
    headers(pathname, html) {
      const r = this.route(pathname);
      const merged = { ...(raw.globalHeaders || {}), ...(r?.headers || {}) };
      const needsHashes = Object.values(merged).some((v) => v === '__SITE_CSP__' || v === '__REVIEW_CSP__');
      const hashes = needsHashes && html ? inlineScriptHashes(html) : [];
      return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, policy(v, hashes)]));
    },
  };
}
