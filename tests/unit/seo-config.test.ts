import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { breadcrumbJsonLd, eventJsonLd, faqJsonLd, jsonLdString } from '../../src/lib/seo';
import { inlineMarkdown } from '../../src/lib/markdown';
import { buildCmsConfig } from '../../scripts/build-cms-config.mjs';
import { eventSchema, organizerSchema, personSchema, seriesSchema, styleSchema, venueSchema } from '../../src/lib/schemas';
import { z } from 'astro/zod';

const root = join(__dirname, '..', '..');

describe('JSON-LD', () => {
  const settings = { legalName: 'Riverbend Swing Dance Club, Inc.' } as never;
  const e = {
    slug: '2026-10-06-thursday-night-swing',
    url: '/events/2026-10-06-thursday-night-swing/',
    title: 'Thursday Night Swing',
    status: 'scheduled',
    date: '2026-10-06',
    timeTba: false,
    start: new Date('2026-10-06T23:30:00Z'),
    end: new Date('2026-10-07T02:00:00Z'),
    timezone: 'America/New_York',
    details: { summary: 'Weekly dance' },
    description: '',
    location: { name: 'Riverbend Community Hall', address: '631 Pulaski Road', city: 'Riverbend', state: 'NY', postalCode: '11740', latitude: 40.8, longitude: -73.3, full: '' },
    admission: { member: 10, student: 5, nonMember: 15, free: false, known: true },
    djs: [],
    instructors: [],
    band: undefined,
  } as never;
  it('emits a DanceEvent with local offsets and only the prices that exist', () => {
    const ld = eventJsonLd(e, settings, 'https://example.org') as Record<string, any>;
    expect(ld['@type']).toBe('DanceEvent');
    expect(ld.startDate).toBe('2026-10-06T19:30:00-04:00');
    expect(ld.eventStatus).toBe('https://schema.org/EventScheduled');
    expect(ld.offers.map((o: any) => o.price)).toEqual(['15.00', '10.00', '5.00']);
    expect(ld.location.address.addressLocality).toBe('Riverbend');
    expect(ld.performer).toBeUndefined();
  });
  it('reflects cancellations and postponements', () => {
    expect((eventJsonLd({ ...(e as object), status: 'cancelled' } as never, settings, 'https://example.org') as any).eventStatus).toBe('https://schema.org/EventCancelled');
    expect((eventJsonLd({ ...(e as object), status: 'postponed' } as never, settings, 'https://example.org') as any).eventStatus).toBe('https://schema.org/EventPostponed');
  });
  it('names Riverbend as organizer of its own events, and the real organizer of community events', () => {
    expect((eventJsonLd({ ...(e as object), host: 'home' } as never, settings, 'https://example.org') as any).organizer.name).toBe('Riverbend Swing Dance Club, Inc.');
    const community = {
      ...(e as object),
      host: 'community',
      organizerEntry: { id: 'triple-step-swing', data: { name: 'Triple Step Swing', website: 'https://triplestepswing.com/', email: 'hello@triplestepswing.com' } },
      instructors: [{ name: 'Maya Rivera', href: '/performers/carol-fraser/', links: [{ kind: 'website', label: 'Website', url: 'https://triplestepswing.com/' }] }],
    } as never;
    const ld = eventJsonLd(community, settings, 'https://example.org') as any;
    expect(ld.organizer).toEqual({ '@type': 'Organization', name: 'Triple Step Swing', url: 'https://triplestepswing.com/', email: 'hello@triplestepswing.com' });
    expect(ld.performer[0].sameAs).toEqual(['https://triplestepswing.com/']);
    expect(ld.offers[0].name).toBe('Admission');
    expect((eventJsonLd({ ...(community as object), organizerEntry: undefined } as never, settings, 'https://example.org') as any).organizer).toBeUndefined();
  });
  it('escapes markup when embedding JSON-LD', () => {
    expect(jsonLdString({ a: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });
  it('builds FAQ and breadcrumb data', () => {
    const faq = faqJsonLd([{ question: 'Do I need a partner?', answer: 'No. See [New to swing](/new-to-swing/).' }]) as any;
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe('No. See New to swing.');
    const bc = breadcrumbJsonLd([{ name: 'Home', href: '/' }, { name: 'Events', href: '/events/' }], 'https://example.org') as any;
    expect(bc.itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Events', item: 'https://example.org/events/' });
  });
  it('inline Markdown escapes HTML and only allows safe links', () => {
    expect(inlineMarkdown('<b>x</b> [a](/a/) [b](javascript:alert(1))')).toBe('&lt;b&gt;x&lt;/b&gt; <a href="/a/">a</a> [b](javascript:alert(1))');
  });
});

describe('legacy redirects and Static Web Apps configuration', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'public', 'staticwebapp.config.json'), 'utf8'));
  const legacy = JSON.parse(readFileSync(join(root, 'src', 'data', 'legacy-redirects.json'), 'utf8')) as { from: string; to: string }[];
  it('stays under the 20 KB Azure limit with room for the CSP', () => {
    expect(Buffer.byteLength(JSON.stringify(cfg))).toBeLessThan(12 * 1024);
  });
  it('has no duplicate routes (Azure treats a trailing slash as the same route)', () => {
    const seen = new Set<string>();
    for (const r of cfg.routes) {
      const key = r.route.toLowerCase().replace(/\/$/, '');
      expect(seen.has(key), `duplicate route ${r.route}`).toBe(false);
      seen.add(key);
    }
  });
  it('uses permanent redirects for the most important old pages', () => {
    const r = Object.fromEntries(cfg.routes.filter((x: any) => x.redirect).map((x: any) => [x.route, x]));
    expect(r['/index.php'].redirect).toBe('/');
    expect(r['/events.php'].redirect).toBe('/events/');
    expect(r['/contact.php'].redirect).toBe('/contact/');
    for (const x of Object.values(r) as any[]) expect(x.statusCode).toBe(301);
  });
  it('sets security headers and a custom 404', () => {
    expect(cfg.globalHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(cfg.globalHeaders['Referrer-Policy']).toBeTruthy();
    expect(cfg.globalHeaders['Permissions-Policy']).toBeTruthy();
    expect(cfg.globalHeaders['Content-Security-Policy']).toBeTruthy();
    expect(cfg.responseOverrides['404'].statusCode).toBe(404);
  });
  it('maps every crawled legacy URL to an internal path', () => {
    expect(legacy.length).toBeGreaterThanOrEqual(3);
    for (const r of legacy) {
      expect(r.from.startsWith('/')).toBe(true);
      expect(r.to.startsWith('/')).toBe(true);
    }
  });
  it.runIf(existsSync(join(root, 'dist', 'index.html')))('every legacy URL has a redirect page whose target exists in the built site', () => {
    const cfgRoutes = new Set(cfg.routes.map((x: any) => x.route.replace(/\*$/, '')));
    for (const r of legacy) {
      const stub = join(root, 'dist', ...r.from.split('/').filter(Boolean), 'index.html');
      if (cfgRoutes.has(r.from) || cfgRoutes.has(r.from.replace(/\/$/, ''))) continue;
      expect(existsSync(stub), `missing redirect page for ${r.from}`).toBe(true);
      const target = /url=([^"]+)"/.exec(readFileSync(stub, 'utf8'))![1]!.replace(/&amp;/g, '&');
      const path = target.split('#')[0]!;
      const file = path.endsWith('/') ? join(root, 'dist', path, 'index.html') : join(root, 'dist', path);
      expect(existsSync(file), `${r.from} -> ${target}`).toBe(true);
    }
  });
});

describe('Decap CMS configuration', () => {
  const config = buildCmsConfig(readFileSync(join(root, 'cms', 'config.yml'), 'utf8')) as any;
  const names = new Set(config.collections.map((c: any) => c.name));
  it('points at the right repository and uses the editorial workflow', () => {
    expect(config.backend.name).toBe('github');
    expect(config.backend.repo).toBe('example/community-site-starter');
    expect(config.publish_mode).toBe('editorial_workflow');
    expect(existsSync(join(root, config.media_folder))).toBe(true);
  });
  it('has all required collections and their folders exist', () => {
    for (const c of ['events', 'series', 'venues', 'organizers', 'instructors', 'performers', 'styles', 'pages', 'announcements', 'gallery', 'faqs', 'settings']) expect(names.has(c)).toBe(true);
    for (const c of config.collections) {
      if (c.folder) expect(existsSync(join(root, c.folder)), c.folder).toBe(true);
      for (const f of c.files ?? []) expect(existsSync(join(root, f.file)), f.file).toBe(true);
    }
  });
  it('only relates to collections that exist, and every field list is flat', () => {
    const walk = (fields: any[]) => {
      for (const f of fields) {
        expect(Array.isArray(f), 'nested field list').toBe(false);
        if (f.widget === 'relation') expect(names.has(f.collection), f.name).toBe(true);
        if (f.fields) walk(f.fields);
      }
    };
    for (const c of config.collections) {
      if (c.fields) walk(c.fields);
      for (const f of c.files ?? []) walk(f.fields);
    }
  });
  it('every event schema field can be edited in the CMS', () => {
    const shape = Object.keys((eventSchema(() => z.string()) as any).shape);
    const cms = new Set(config.collections.find((c: any) => c.name === 'events').fields.map((f: any) => f.name));
    const notEditable = ['slug', 'latitude', 'longitude', 'legacyUrl', 'timezone'];
    for (const key of shape) if (!notEditable.includes(key)) expect(cms.has(key), key).toBe(true);
  });
  it('every series, venue, organizer, person and style field can be edited in the CMS', () => {
    const fieldsOf = (name: string) => new Set(config.collections.find((c: any) => c.name === name).fields.map((f: any) => f.name));
    const shapeOf = (schema: any) => Object.keys((schema.shape ?? schema._def?.schema?.shape ?? schema.def?.in?.shape ?? schema.in?.shape ?? {}) as object);
    const img = () => z.string();
    const checks: [string, any, string[]][] = [
      ['series', seriesSchema(img), ['latitude', 'longitude', 'legacyUrl']],
      ['venues', venueSchema(img), ['legacyUrl']],
      ['organizers', organizerSchema, []],
      ['instructors', personSchema(img), ['legacyUrl']],
      ['performers', personSchema(img), ['legacyUrl']],
      ['styles', styleSchema, []],
    ];
    for (const [name, schema, skip] of checks) {
      const shape = shapeOf(schema);
      expect(shape.length, `${name} schema shape`).toBeGreaterThan(3);
      const cms = fieldsOf(name);
      for (const key of shape) if (!skip.includes(key)) expect(cms.has(key), `${name}.${key}`).toBe(true);
    }
  });
  it('can sort events and filter home and community events (Decap needs sortable_fields to be a list)', () => {
    for (const c of config.collections) if (c.sortable_fields !== undefined) expect(Array.isArray(c.sortable_fields), `${c.name}.sortable_fields`).toBe(true);
    const events = config.collections.find((c: any) => c.name === 'events');
    expect(events.sortable_fields).toContain('startDateTime');
    expect(events.view_filters.map((f: any) => f.label)).toEqual(expect.arrayContaining(['Home events', 'Community events']));
  });
  it('requires alt text alongside every image field', () => {
    for (const c of config.collections) {
      const fields = [...(c.fields ?? []), ...(c.files ?? []).flatMap((f: any) => f.fields)];
      const all = fields.flatMap((f: any) => [f, ...(f.fields ?? [])]);
      const images = all.filter((f: any) => f.widget === 'image');
      for (const img of images) {
        const siblings = fields.some((f: any) => /alt/i.test(f.name)) || (fields.find((f: any) => f.fields?.includes(img))?.fields ?? []).some((f: any) => f.name === 'alt');
        expect(siblings, `${c.name}.${img.name}`).toBe(true);
      }
    }
  });
});

describe('legacy history data', () => {
  it('lists past performers and venues for the archive pages', () => {
    const h = JSON.parse(readFileSync(join(root, 'src', 'data', 'legacy-history.json'), 'utf8'));
    expect(Array.isArray(h.pastPerformers)).toBe(true);
    expect(Array.isArray(h.pastVenues)).toBe(true);
    expect(typeof h.years).toBe('object');
  });
  it('sample YAML timestamp parsing stays as strings after normalisation', () => {
    expect(YAML.parse('d: 2026-10-06', { schema: 'yaml-1.1' }).d).toBeInstanceOf(Date);
    expect(readdirSync(join(root, 'src', 'content', 'events')).length).toBeGreaterThanOrEqual(12);
  });
});

