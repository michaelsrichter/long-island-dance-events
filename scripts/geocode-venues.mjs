// Fills in latitude/longitude for venues that do not have them yet.
// Reads the allowed map center and maximum distance from src/content/settings/site.yml.
// Optional flags: --force, --dry, --center=41.5,-73.9, --max-distance-km=80.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const venuesDir = join(root, 'src', 'content', 'venues');
const settingsPath = join(root, 'src', 'content', 'settings', 'site.yml');

export const CENSUS_SOURCE = 'U.S. Census Bureau Geocoder';
export const NOMINATIM_SOURCE = 'OpenStreetMap Nominatim (© OpenStreetMap contributors, ODbL)';

export function readGeocodeSettings(env = process.env) {
  const s = YAML.parse(readFileSync(settingsPath, 'utf8')) ?? {};
  const siteUrl = (env.SITE_URL || 'https://example.org').replace(/\/$/, '');
  return {
    center: s.mapCenter ?? { lat: 39.5, lng: -98.35 },
    maxDistanceKm: Number(s.maxDistanceKm ?? 250),
    userAgent: `${s.shortName ?? 'community-site'}-geocoder/1.0 (+${siteUrl}; ${s.email ?? 'info@example.org'})`,
  };
}

export function parseFlags(argv) {
  const flags = { force: false, dry: false };
  for (const arg of argv) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry') flags.dry = true;
    else if (arg.startsWith('--center=')) {
      const [lat, lng] = arg.slice('--center='.length).split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Use --center=lat,lng');
      flags.center = { lat, lng };
    } else if (arg.startsWith('--max-distance-km=')) {
      const n = Number(arg.slice('--max-distance-km='.length));
      if (!Number.isFinite(n) || n <= 0) throw new Error('Use --max-distance-km=number');
      flags.maxDistanceKm = n;
    }
  }
  return flags;
}

export function oneLineAddress(v) {
  const street = String(v.address ?? '').replace(/,?\s*(suite|ste\.?|unit|apt\.?|floor|fl\.?|room|rm\.?|#)\s*[\w-]+/gi, '').trim();
  return [street, v.city, [v.state ?? 'NY', v.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function parseCensus(json) {
  const m = json?.result?.addressMatches?.[0];
  if (!m?.coordinates) return undefined;
  return { lat: Number(m.coordinates.y), lng: Number(m.coordinates.x), matched: m.matchedAddress, source: CENSUS_SOURCE };
}

export function parseNominatim(json) {
  const m = Array.isArray(json) ? json[0] : undefined;
  if (!m) return undefined;
  return { lat: Number(m.lat), lng: Number(m.lon), matched: m.display_name, source: NOMINATIM_SOURCE };
}

const round = (n) => Math.round(n * 1e6) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, userAgent) {
  const res = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function census(address, userAgent) {
  const u = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  u.searchParams.set('address', address);
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('format', 'json');
  return parseCensus(await getJson(u, userAgent));
}

let lastNominatim = 0;
async function nominatim(address, userAgent) {
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await sleep(wait);
  lastNominatim = Date.now();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', address);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');
  u.searchParams.set('countrycodes', 'us');
  return parseNominatim(await getJson(u, userAgent));
}

export async function geocode(address, { name, center, maxDistanceKm, userAgent } = {}) {
  const cfg = readGeocodeSettings();
  const c = center ?? cfg.center;
  const maxKm = maxDistanceKm ?? cfg.maxDistanceKm;
  const ua = userAgent ?? cfg.userAgent;
  const attempts = [() => census(address, ua), () => nominatim(address, ua), ...(name ? [() => nominatim(`${name}, ${address}`, ua)] : [])];
  for (const attempt of attempts) {
    try {
      const hit = await attempt();
      if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng) && distanceKm(c, hit) <= maxKm) return hit;
    } catch (e) {
      console.warn(`  ! ${e.message}`);
    }
  }
  return undefined;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const settings = readGeocodeSettings();
  const center = flags.center ?? settings.center;
  const maxDistanceKm = flags.maxDistanceKm ?? settings.maxDistanceKm;
  let updated = 0;
  const missing = [];
  for (const file of readdirSync(venuesDir).filter((f) => f.endsWith('.md')).sort()) {
    const path = join(venuesDir, file);
    const text = readFileSync(path, 'utf8');
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
    if (!m) continue;
    const doc = YAML.parseDocument(m[1]);
    const v = doc.toJS();
    if (!flags.force && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)) continue;
    if (!v.address || !v.city) { missing.push(`${file} (no street address)`); continue; }
    const address = oneLineAddress(v);
    const hit = await geocode(address, { name: v.name, center, maxDistanceKm, userAgent: settings.userAgent });
    if (!hit) { missing.push(`${file} (${address})`); console.warn(`✗ ${file}: no match for "${address}"`); continue; }
    console.log(`✓ ${file}: ${round(hit.lat)}, ${round(hit.lng)} ← ${hit.source}${hit.matched ? `: ${hit.matched}` : ''}`);
    if (flags.dry) continue;
    doc.set('latitude', round(hit.lat));
    doc.set('longitude', round(hit.lng));
    doc.set('coordinatesSource', hit.source);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const front = doc.toString({ lineWidth: 0 }).trimEnd().replace(/\n/g, eol);
    writeFileSync(path, `---${eol}${front}${eol}---${m[2] ?? eol}`);
    updated++;
  }
  console.log(`\n[geocode] ${updated} venue(s) updated${flags.dry ? ' (dry run)' : ''}. Center ${center.lat},${center.lng}; max ${maxDistanceKm} km.`);
  if (missing.length) console.log(`[geocode] Could not place on the map (add coordinates by hand in the CMS):\n  ${missing.join('\n  ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
