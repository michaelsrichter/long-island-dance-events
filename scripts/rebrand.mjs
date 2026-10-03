import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export function slugify(input) {
  return String(input).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = value;
  }
  for (const k of ['name', 'short', 'slug', 'domain', 'email', 'region']) {
    if (!out[k]) throw new Error(`Missing --${k}`);
  }
  return out;
}

function updateYaml(file, updater) {
  const text = readFileSync(file, 'utf8');
  const doc = YAML.parseDocument(text);
  updater(doc);
  writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf8');
}

function updateJson(file, updater) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  updater(json);
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

function replaceIn(file, replacements) {
  if (!existsSync(file)) return;
  let text = readFileSync(file, 'utf8');
  for (const [from, to] of replacements) text = text.replace(from, to);
  writeFileSync(file, text, 'utf8');
}

export function checklist(args) {
  return [
    'Manual rebrand checklist:',
    '- Replace the logo SVG and regenerate icons.',
    '- Choose brand colors in src/styles/global.css tokens.',
    '- Replace sample pages, events, venues, people, FAQs, and gallery photos.',
    '- Use only photos your organization has permission to publish; keep credits.',
    '- Run npm run geocode after venue addresses are final.',
    '- Create a GitHub OAuth app for Decap CMS; uncheck token expiration and set the callback to your live domain.',
    '- Add analytics IDs only if you use GA4, Clarity, or Azure Monitor.',
    '- Deploy Azure resources, add DNS records, validate the custom domain, and update SITE_URL.',
  ].join('\n');
}

export function plannedUpdates(args) {
  const slug = slugify(args.slug);
  return {
    packageName: `${slug}-website`,
    siteName: args.name,
    shortName: args.short,
    domain: args.domain.replace(/\/$/, ''),
    email: args.email,
    region: args.region,
  };
}

export function applyRebrand(args, base = root) {
  const u = plannedUpdates(args);
  updateYaml(join(base, 'src/content/settings/site.yml'), (doc) => {
    doc.set('siteName', u.siteName);
    doc.set('shortName', u.shortName);
    doc.set('legalName', `${u.siteName}, Inc.`);
    doc.set('region', u.region);
    doc.set('email', u.email);
    doc.set('newsletterUrl', `${u.domain}/newsletter`);
    doc.set('facebookLabel', `${u.shortName} Facebook group`);
  });
  updateJson(join(base, 'package.json'), (pkg) => { pkg.name = u.packageName; });
  updateJson(join(base, 'public/site.webmanifest'), (m) => { m.name = u.siteName; m.short_name = u.shortName; m.start_url = '/'; });
  replaceIn(join(base, 'infra/deploy.ps1'), [[/\[string\]\$Name = '([^']+)'/, `[string]$Name = '${slugify(args.slug)}'`]]);
  replaceIn(join(base, 'infra/main.bicepparam'), [[/param staticWebAppName = 'swa-[^']+'/g, `param staticWebAppName = 'swa-${slugify(args.slug)}-web'`]]);
  replaceIn(join(base, 'README.md'), [[/^# .+$/m, `# ${u.siteName} website`]]);
  return checklist(args);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseArgs(process.argv.slice(2));
    console.log(applyRebrand(args));
  } catch (err) {
    console.error(err.message);
    console.error('Usage: node scripts/rebrand.mjs --name "Full Org Name" --short "Short" --slug short-slug --domain https://www.example.org --email info@example.org --region "Region"');
    process.exit(1);
  }
}
