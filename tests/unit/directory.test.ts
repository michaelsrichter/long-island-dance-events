import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import sharp from 'sharp';
import { MAX_ENTITY_PHOTOS, instructorSchema, organizerSchema, performerSchema, styleSchema, venueSchema } from '../../src/lib/schemas';
import { linkIcon, linksOf, telHref } from '../../src/lib/links';
import { cardMedia, entityImageOptions, initialsOf, searchText, upcomingLabel } from '../../src/lib/directory';
import { instructorJsonLd, organizerJsonLd, performerJsonLd, venueJsonLd } from '../../src/lib/seo';
import { buildCmsConfig } from '../../scripts/build-cms-config.mjs';

const root = join(__dirname, '..', '..');
const content = join(root, 'src', 'content');
const DIRS = ['venues', 'performers', 'instructors', 'organizers', 'styles'] as const;
const photo = (n = 1) => ({ image: `../../assets/entities/venues/x-${n}.webp`, alt: 'The brick front of the hall', credit: 'Photo: Example Hall (website)', creditUrl: 'https://example.org/', focus: '50% 30%' });
const venue = { name: 'Example Hall', address: '1 Main St', town: 'Patchogue', county: 'Suffolk' };

describe('directory schemas (logos, photos, links, contacts)', () => {
  it('accepts the new optional fields on every directory entity', () => {
    const v = venueSchema.parse({
      ...venue,
      email: 'info@example.org',
      hours: 'Tue-Sun 4 PM-midnight; closed Mon',
      tiktokUrl: 'https://www.tiktok.com/@example',
      xUrl: 'https://x.com/example',
      logo: { image: '../../assets/entities/venues/x-logo.webp', alt: 'Example Hall logo', imageSource: 'https://example.org/logo.png' },
      photos: [photo(1), { ...photo(2), licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
      evidence: [{ url: 'https://example.org/', note: 'Their site lists the address and hours.' }],
      factsSource: 'Checked October 4, 2026. Source: example.org.',
    });
    expect(v.logo?.alt).toBe('Example Hall logo');
    expect(v.photos).toHaveLength(2);
    const p = performerSchema.parse({ name: 'Example Band', type: 'band', town: 'Massapequa', spotifyUrl: 'https://open.spotify.com/artist/1', bandcampUrl: 'https://example.bandcamp.com/', bookingUrl: 'https://example.org/book', email: 'book@example.org', phone: '(631) 555-0100', logo: { image: 'x.webp', alt: 'Example Band logo' } });
    expect(p.bookingUrl).toBe('https://example.org/book');
    expect(instructorSchema.parse({ name: 'Pat Example', bookingUrl: 'https://example.org/lessons', email: 'pat@example.org', photos: [photo()] }).photos).toHaveLength(1);
    expect(organizerSchema.parse({ name: 'Example Club', type: 'club', address: '2 Main St', postalCode: '11772', county: 'Suffolk', hours: 'Mon 7-10 PM' }).county).toBe('Suffolk');
    const s = styleSchema.parse({ name: 'Example Swing', family: 'swing', summary: 'A bouncy partner dance.', photos: [photo()], moreLinks: [{ label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Swing_(dance)' }] });
    expect(s.moreLinks?.[0]?.label).toBe('Wikipedia');
  });

  it('keeps old files and new ingest stubs valid (every new field is optional)', () => {
    const stub = performerSchema.parse({ name: 'New Band', type: 'band' });
    expect(stub.photos).toBeUndefined();
    expect(stub.logo).toBeUndefined();
    expect(stub.evidence).toBeUndefined();
    expect(venueSchema.parse(venue).photos).toBeUndefined();
  });

  it('treats an empty logo box saved by the CMS as "no logo"', () => {
    expect(venueSchema.parse({ ...venue, logo: {} }).logo).toBeUndefined();
    expect(venueSchema.parse({ ...venue, logo: { image: '', alt: '' } }).logo).toBeUndefined();
    expect(venueSchema.parse({ ...venue, logo: null }).logo).toBeUndefined();
  });

  it('requires alt text and a credit on every photo, a valid focus point and at most 6 photos', () => {
    expect(venueSchema.safeParse({ ...venue, photos: [{ image: 'x.webp', alt: '', credit: 'Photo: X' }] }).success).toBe(false);
    expect(venueSchema.safeParse({ ...venue, photos: [{ image: 'x.webp', alt: 'The hall' }] }).success).toBe(false);
    expect(venueSchema.safeParse({ ...venue, photos: [{ ...photo(), focus: 'top' }] }).success).toBe(false);
    expect(venueSchema.safeParse({ ...venue, photos: Array.from({ length: MAX_ENTITY_PHOTOS + 1 }, (_, i) => photo(i)) }).success).toBe(false);
    expect(venueSchema.safeParse({ ...venue, evidence: [{ url: 'https://example.org/', note: 'x'.repeat(241) }] }).success).toBe(false);
    expect(venueSchema.safeParse({ ...venue, hours: 'x'.repeat(301) }).success).toBe(false);
  });

  it('a logo saved without alt text never breaks the build (pages say "<name> logo")', () => {
    const v = venueSchema.parse({ ...venue, logo: { image: 'x.webp', alt: '' } });
    expect(v.logo?.image).toBe('x.webp');
    expect(v.logo?.alt).toBeUndefined();
  });

  it('only accepts web addresses for links (never javascript: or data:)', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/']) {
      expect(venueSchema.safeParse({ ...venue, website: bad }).success, bad).toBe(false);
      expect(venueSchema.safeParse({ ...venue, moreLinks: [{ label: 'Link', url: bad }] }).success, bad).toBe(false);
      expect(venueSchema.safeParse({ ...venue, photos: [{ ...photo(), creditUrl: bad }] }).success, bad).toBe(false);
    }
    expect(venueSchema.safeParse({ ...venue, website: 'http://moose318.com/' }).success).toBe(true);
  });
});

describe('directory content and image files', () => {
  const load = (dir: string) =>
    readdirSync(join(content, dir))
      .filter((f) => /\.(json|ya?ml)$/.test(f))
      .map((f) => ({ id: f.replace(/\.(json|ya?ml)$/, ''), file: join(content, dir, f), data: f.endsWith('.json') ? JSON.parse(readFileSync(join(content, dir, f), 'utf8')) : YAML.parse(readFileSync(join(content, dir, f), 'utf8')) }));
  const images = DIRS.flatMap((dir) =>
    load(dir).flatMap(({ id, file, data }) => [
      ...(data.logo ? [{ dir, id, file, kind: 'logo', img: data.logo }] : []),
      ...((data.photos ?? []) as any[]).map((img) => ({ dir, id, file, kind: 'photo', img })),
    ]),
  );

  it('every logo and photo points to a file in src/assets/entities/<collection>/; photos have alt text and a credit', () => {
    expect(images.length).toBeGreaterThan(0);
    for (const { dir, id, file, kind, img } of images) {
      const path = resolve(dirname(file), img.image);
      expect(existsSync(path), `${dir}/${id} ${kind}: ${img.image}`).toBe(true);
      expect(path.replace(/\\/g, '/'), `${dir}/${id}`).toContain(`/src/assets/entities/${dir}/`);
      if (kind === 'logo' && !img.alt) continue;
      expect(img.alt?.length ?? 0, `${dir}/${id} ${kind} alt`).toBeGreaterThanOrEqual(3);
      if (kind === 'photo') expect(img.credit, `${dir}/${id} ${kind} credit`).toBeTruthy();
    }
  });

  it('dance-style photos are openly licensed and say so', () => {
    for (const { dir, id, kind, img } of images.filter((i) => i.dir === 'styles')) {
      expect(img.credit, `${dir}/${id}`).toMatch(/Wikimedia Commons/);
      if (/public domain/i.test(img.credit)) continue;
      expect(img.licenseUrl, `${dir}/${id} ${kind}`).toMatch(/^https:\/\/creativecommons\.org\//);
    }
  });

  it('stored pictures stay small: at most 1600 px wide, no camera data, under 3 MB each and 60 MB in total', async () => {
    let total = 0;
    const checks: Promise<void>[] = [];
    for (const dir of DIRS) {
      const folder = join(root, 'src', 'assets', 'entities', dir);
      if (!existsSync(folder)) continue;
      for (const f of readdirSync(folder)) {
        const path = join(folder, f);
        const size = statSync(path).size;
        total += size;
        expect(size, f).toBeLessThan(3 * 1024 * 1024);
        if (/\.svg$/i.test(f)) continue;
        checks.push(
          sharp(path)
            .metadata()
            .then((meta) => {
              expect(meta.width ?? 0, f).toBeLessThanOrEqual(1600);
              expect(meta.exif, `${f} should have no camera data`).toBeUndefined();
            }),
        );
      }
    }
    await Promise.all(checks);
    expect(total).toBeLessThan(60 * 1024 * 1024);
  }, 60_000);
});

describe('Decap CMS: directory pictures and links', () => {
  const config = buildCmsConfig(readFileSync(join(root, 'cms', 'config.yml'), 'utf8')) as any;
  const col = (name: string) => config.collections.find((c: any) => c.name === name);
  it('saves each collection\'s pictures in src/assets/entities/<collection>/ with a path Astro can resolve', () => {
    for (const dir of DIRS) {
      const c = col(dir);
      expect(c.media_folder, dir).toBe(`/src/assets/entities/${dir}`);
      expect(existsSync(join(root, c.media_folder)), dir).toBe(true);
      // public_folder is relative to the entry file, so it must lead from the collection folder to the media folder.
      expect(resolve(root, c.folder, c.public_folder)).toBe(resolve(root, c.media_folder.slice(1)));
    }
  });
  it('has logo, photo, social and contact fields with plain-language labels', () => {
    for (const dir of DIRS) {
      const fields = col(dir).fields;
      const photos = fields.find((f: any) => f.name === 'photos');
      expect(photos?.widget, dir).toBe('list');
      expect(photos.max).toBe(MAX_ENTITY_PHOTOS);
      const sub = photos.fields.map((f: any) => f.name);
      for (const k of ['image', 'alt', 'credit', 'creditUrl', 'licenseUrl', 'imageSource', 'focus']) expect(sub, `${dir}.photos.${k}`).toContain(k);
      const img = photos.fields.find((f: any) => f.name === 'image');
      expect(img.media_processing).toMatchObject({ enabled: true, strip_metadata: true });
      for (const k of ['image', 'alt', 'credit']) expect(photos.fields.find((f: any) => f.name === k).required, `${dir}.photos.${k} must be required`).not.toBe(false);
      for (const f of fields) expect(f.label?.length ?? 0, `${dir}.${f.name} label`).toBeGreaterThan(2);
    }
    for (const dir of ['venues', 'organizers', 'instructors', 'performers']) {
      const names = col(dir).fields.map((f: any) => f.name);
      for (const k of ['logo', 'website', 'facebookUrl', 'instagramUrl', 'youtubeUrl', 'tiktokUrl', 'xUrl', 'phone', 'email', 'evidence', 'factsSource']) expect(names, `${dir}.${k}`).toContain(k);
    }
    for (const k of ['spotifyUrl', 'bandcampUrl', 'bookingUrl']) expect(col('performers').fields.map((f: any) => f.name)).toContain(k);
  });
  it('never makes the parts of an optional logo required (Decap checks them even when the logo is empty)', () => {
    for (const dir of ['venues', 'organizers', 'instructors', 'performers']) {
      const logo = col(dir).fields.find((f: any) => f.name === 'logo');
      expect(logo.required, dir).toBe(false);
      for (const f of logo.fields) expect(f.required, `${dir}.logo.${f.name}`).toBe(false);
    }
  });
});

describe('directory helpers', () => {
  it('lists website, social and music links in a fixed order without duplicates', () => {
    const links = linksOf({ website: 'https://a.org/', facebookUrl: 'https://facebook.com/a', tiktokUrl: 'https://tiktok.com/@a', xUrl: 'https://x.com/a', spotifyUrl: 'https://open.spotify.com/artist/a', bandcampUrl: 'https://a.bandcamp.com/', moreLinks: [{ label: 'Same site', url: 'https://a.org' }] });
    expect(links.map((l) => l.kind)).toEqual(['website', 'facebook', 'tiktok', 'x', 'spotify', 'bandcamp']);
    expect(linkIcon('x')).toBe('xsocial');
    expect(linkIcon('website')).toBe('link');
    expect(telHref('(631) 476-3707')).toBe('tel:+16314763707');
    expect(telHref('1-516-555-0100')).toBe('tel:+15165550100');
  });
  it('makes two-letter initials for cards without a picture', () => {
    expect(initialsOf('The Nutty Irishman')).toBe('NI');
    expect(initialsOf('89 North Music Venue')).toBe('8N');
    expect(initialsOf('Mirelle\u2019s')).toBe('MI');
    expect(initialsOf('DJ Scott')).toBe('SC');
    expect(initialsOf('Café Allegro')).toBe('CA');
  });
  it('builds search text and labels', () => {
    expect(searchText('Café  Allegro', undefined, 'Patchogue')).toBe('cafe allegro patchogue');
    expect(upcomingLabel(0)).toBe('Nothing listed now');
    expect(upcomingLabel(3)).toBe('3 coming up');
  });
  it('picks the first photo for the card, and never asks for a bigger image than the original', () => {
    const img = (w: number, h: number) => ({ image: { src: '/x.webp', width: w, height: h, format: 'webp' } as any, alt: 'x' });
    expect(cardMedia({ photos: [img(1200, 800)], logo: img(300, 300) })).toMatchObject({ photo: { alt: 'x' }, logo: { alt: 'x' } });
    expect(cardMedia({})).toEqual({});
    expect(entityImageOptions(img(1200, 800).image, 'photo', '50% 30%')).toMatchObject({ widths: [400, 800], width: 800, height: 450, fit: 'cover', position: '50% 30%', format: 'webp' });
    expect(entityImageOptions(img(600, 900).image, 'photo')).toMatchObject({ widths: [400], width: 400, height: 225 });
    expect(entityImageOptions(img(150, 150).image, 'logo')).toMatchObject({ widths: [150], width: 150, height: 150 });
    expect(entityImageOptions(img(150, 150).image, 'logo')).not.toHaveProperty('fit');
  });
});

describe('directory JSON-LD', () => {
  const site = 'https://example.org';
  const x = { logo: 'https://example.org/_astro/logo.webp', images: ['https://example.org/_astro/p1.webp'], links: [{ url: 'https://example-bar.com/' }, { url: 'https://facebook.com/examplebar' }] };
  it('describes a venue with its type, logo, photos, social pages, phone and address', () => {
    const ld = venueJsonLd('example-bar', { ...venue, state: 'NY', postalCode: '11772', phone: '(631) 555-0100', email: 'info@example-bar.com', kind: 'bar', latitude: 40.7, longitude: -73 }, site, x) as any;
    expect(ld['@type']).toBe('BarOrPub');
    expect(ld).toMatchObject({ logo: x.logo, image: x.images, telephone: '(631) 555-0100', email: 'info@example-bar.com', sameAs: ['https://example-bar.com/', 'https://facebook.com/examplebar'] });
    expect(ld.address).toMatchObject({ streetAddress: '1 Main St', addressLocality: 'Patchogue', postalCode: '11772', addressRegion: 'NY' });
    expect(ld.geo).toMatchObject({ latitude: 40.7 });
    const park = venueJsonLd('p', { ...venue, kind: 'park', email: 'parks@example.gov' }, site) as any;
    expect(park['@type']).toBe('Park');
    expect(park.email).toBeUndefined();
  });
  it('describes bands, teachers and organizers', () => {
    const band = performerJsonLd('b', { name: 'Example Band', type: 'band', genres: ['rock'], phone: '(631) 555-0100' }, site, x) as any;
    expect(band).toMatchObject({ '@type': 'MusicGroup', logo: x.logo, image: x.images, telephone: '(631) 555-0100', genre: ['rock'] });
    const dj = performerJsonLd('d', { name: 'DJ Example', type: 'dj' }, site, { images: [] }) as any;
    expect(dj).toMatchObject({ '@type': 'Person', jobTitle: 'DJ' });
    expect(dj.image).toBeUndefined();
    expect(instructorJsonLd('t', { name: 'Pat Example' }, site, { styles: ['Hustle'], links: x.links }) as any).toMatchObject({ '@type': 'Person', jobTitle: 'Dance teacher', knowsAbout: ['Hustle'] });
    const org = organizerJsonLd('o', { name: 'Example Club', address: '2 Main St', town: 'Patchogue', postalCode: '11772' }, site, x) as any;
    expect(org).toMatchObject({ '@type': 'Organization', logo: x.logo, address: { streetAddress: '2 Main St', addressLocality: 'Patchogue' } });
  });
});
