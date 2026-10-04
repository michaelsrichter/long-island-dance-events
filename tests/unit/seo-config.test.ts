import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import { breadcrumbJsonLd, eventJsonLd, faqJsonLd, jsonLdString } from '../../src/lib/seo';
import { inlineMarkdown } from '../../src/lib/markdown';
import { buildCmsConfig } from '../../scripts/build-cms-config.mjs';
import { eventSchema, instructorSchema, organizerSchema, performerSchema, settingsSchema, sourceSchema, styleSchema, venueSchema } from '../../src/lib/schemas';

const root = join(__dirname, '..', '..');

describe('JSON-LD', () => {
  const e = {
    url: '/events/2026-10-06-swing-dance-long-island-lesson-and-dance-tuesdays/',
    title: 'East Coast Swing lesson and social dance',
    status: 'active',
    category: 'lesson-party',
    date: '2026-10-06',
    timeTba: false,
    start: new Date('2026-10-06T23:30:00Z'),
    end: new Date('2026-10-07T02:00:00Z'),
    timezone: 'America/New_York',
    data: { summary: 'A group lesson, then open social dancing.', price: 15, end: '2026-10-06T22:00' },
    price: { known: true, free: false, label: '$15' },
    location: { name: 'Huntington Moose Lodge', address: '631 Pulaski Road', town: 'Greenlawn', state: 'NY', postalCode: '11740', latitude: 40.86, longitude: -73.35, full: '' },
    venue: { id: 'huntington-moose-lodge', data: { phone: '(631) 757-2777' } },
    organizer: { id: 'swing-dance-long-island', data: { name: 'Swing Dance Long Island', website: 'https://www.sdli.org/' } },
    liveActs: [],
    djs: [],
    instructors: [{ id: 'carol-fraser', name: 'Carol Fraser', href: '/instructors/carol-fraser/', kind: 'instructor', links: [] }],
  } as never;
  const ld = eventJsonLd(e, {} as never, 'https://example.org') as Record<string, any>;
  it('emits a DanceEvent with local offsets, the price, the place and the real organizer', () => {
    expect(ld['@type']).toBe('DanceEvent');
    expect(ld.startDate).toBe('2026-10-06T19:30:00-04:00');
    expect(ld.offers).toEqual([expect.objectContaining({ price: '15.00', priceCurrency: 'USD' })]);
    expect(ld.location.address.addressLocality).toBe('Greenlawn');
    expect(ld.organizer).toMatchObject({ name: 'Swing Dance Long Island', url: 'https://www.sdli.org/' });
    expect(ld.performer[0]).toMatchObject({ '@type': 'Person', name: 'Carol Fraser', url: 'https://example.org/instructors/carol-fraser/' });
  });
  it('reflects cancellations', () => {
    const c = eventJsonLd({ ...(e as object), status: 'cancelled' } as never, {} as never, 'https://example.org') as Record<string, any>;
    expect(c.eventStatus).toBe('https://schema.org/EventCancelled');
  });
  it('escapes markup when embedding JSON-LD', () => {
    expect(jsonLdString({ a: '</script><b>' })).not.toContain('</script>');
  });
  it('builds FAQ and breadcrumb data', () => {
    expect((faqJsonLd([{ question: 'Q?', answer: 'A **bold** [link](/x/)' }]) as any).mainEntity[0].acceptedAnswer.text).toBe('A bold link');
    expect((breadcrumbJsonLd([{ name: 'Home', href: '/' }], 'https://example.org') as any).itemListElement[0].item).toBe('https://example.org/');
  });
  it('inline Markdown escapes HTML and only allows safe links', () => {
    const html = inlineMarkdown('<b>x</b> [a](javascript:alert(1)) [ok](/events/)');
    expect(html).not.toMatch(/<b>|href="javascript/);
    expect(html).toContain('href="/events/"');
  });
});

describe('Static Web Apps configuration', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'public', 'staticwebapp.config.json'), 'utf8'));
  it('stays under the 20 KB Azure limit with room for the CSP', () => {
    expect(Buffer.byteLength(JSON.stringify(cfg))).toBeLessThan(8 * 1024);
  });
  it('has no duplicate routes (Azure treats a trailing slash as the same route)', () => {
    const routes = cfg.routes.map((r: any) => r.route.replace(/\/$/, ''));
    expect(new Set(routes).size).toBe(routes.length);
  });
  it('sets security headers and a custom 404', () => {
    expect(cfg.globalHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(cfg.globalHeaders['Content-Security-Policy']).toBe('__SITE_CSP__');
    expect(cfg.responseOverrides['404'].rewrite).toBe('/404.html');
  });
});

describe('Decap CMS configuration', () => {
  const config = buildCmsConfig(readFileSync(join(root, 'cms', 'config.yml'), 'utf8')) as any;
  const names = new Set(config.collections.map((c: any) => c.name));
  const fieldsOf = (name: string) => new Set(config.collections.find((c: any) => c.name === name).fields.map((f: any) => f.name));
  const shapeOf = (schema: any): string[] => Object.keys(schema.shape ?? schema.def?.in?.shape ?? schema.in?.shape ?? schema._def?.schema?.shape ?? {});
  it('points at this repository and uses the editorial workflow', () => {
    expect(config.backend.name).toBe('github');
    expect(config.backend.repo).toBe('michaelsrichter/long-island-dance-events');
    // Least access: the repository is public, so sign-in must not ask for every private repository.
    expect(config.backend.auth_scope).toBe('public_repo');
    expect(config.publish_mode).toBe('editorial_workflow');
    expect(existsSync(join(root, config.media_folder))).toBe(true);
  });
  it('has every entity collection, stored as JSON, and their folders exist', () => {
    for (const c of ['events', 'venues', 'organizers', 'instructors', 'performers', 'sources', 'styles', 'faqs', 'pages', 'gallery', 'settings']) expect(names.has(c), c).toBe(true);
    for (const c of ['events', 'venues', 'organizers', 'instructors', 'performers', 'sources']) {
      const col = config.collections.find((x: any) => x.name === c);
      expect([col.format, col.extension], c).toEqual(['json', 'json']);
    }
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
  it('every schema field can be edited in the CMS', () => {
    const checks: [string, any, string[]][] = [
      ['events', eventSchema, ['embedding']],
      ['venues', venueSchema, []],
      ['organizers', organizerSchema, []],
      ['instructors', instructorSchema, []],
      ['performers', performerSchema, []],
      ['sources', sourceSchema, []],
      ['styles', styleSchema, []],
    ];
    for (const [name, schema, skip] of checks) {
      const shape = shapeOf(schema);
      expect(shape.length, `${name} schema shape`).toBeGreaterThan(3);
      const cms = fieldsOf(name);
      for (const key of shape) if (!skip.includes(key)) expect(cms.has(key), `${name}.${key}`).toBe(true);
    }
    const settings = config.collections.find((c: any) => c.name === 'settings').files[0].fields.map((f: any) => f.name);
    for (const key of shapeOf(settingsSchema(() => z.string()))) expect(settings, `settings.${key}`).toContain(key);
  });
  it('can sort and filter events (Decap needs sortable_fields to be a list)', () => {
    for (const c of config.collections) if (c.sortable_fields !== undefined) expect(Array.isArray(c.sortable_fields), `${c.name}.sortable_fields`).toBe(true);
    const events = config.collections.find((c: any) => c.name === 'events');
    expect(events.sortable_fields).toContain('start');
    expect(events.view_filters.map((f: any) => f.label)).toContain('Waiting for review');
  });
  it('requires alt text alongside every image field', () => {
    for (const c of config.collections) {
      const fields = [...(c.fields ?? []), ...(c.files ?? []).flatMap((f: any) => f.fields)];
      const all = fields.flatMap((f: any) => [f, ...(f.fields ?? [])]);
      for (const img of all.filter((f: any) => f.widget === 'image')) {
        const siblings = fields.some((f: any) => /alt/i.test(f.name)) || (fields.find((f: any) => f.fields?.includes(img))?.fields ?? []).some((f: any) => f.name === 'alt');
        expect(siblings, `${c.name}.${img.name}`).toBe(true);
      }
    }
  });
});
