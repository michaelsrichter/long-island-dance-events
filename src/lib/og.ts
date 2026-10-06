/** Build-time social images (Open Graph 1200x630 and square 1080x1080) rendered with satori + sharp. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';

/** This file's own text, put into the live server's build (astro.config.mjs), which has no src/ folder. */
declare const __OG_SOURCE__: string | undefined;

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
let fonts: { name: string; data: Buffer; weight: 400 | 700 | 800; style: 'normal' }[] | undefined;
function getFonts() {
  fonts ??= [
    { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-800-normal.woff'), weight: 800, style: 'normal' },
  ];
  return fonts;
}

/*
 * Saved pictures (Phase 0 of docs/proposals/postgres-live-site.md). Drawing ~1,700 share pictures took about
 * 4 of the 5.5 minutes of every build, and most are the same as last time. Each finished picture is saved under
 * a fingerprint of everything that goes into it: the card (text, photo or logo), the size, this file's drawing
 * code, the fonts and the satori and sharp versions. A later build with the same fingerprint reuses the file.
 * The deploy workflow keeps the folder between runs and drops pictures not used for 14 days (a reused picture
 * gets a fresh date). OG_CACHE_DIR picks the folder (default .cache/og); OG_CACHE_DIR=off turns it off.
 *
 * On the live server (decision P64) the folder is /home/data/og-cache (kept between restarts and deploys), and
 * OG_SEED_DIR is a read-only folder in the package with the pictures of the static build of the same commit,
 * so a picture is drawn there only when its card changed.
 */
const SOURCE = join(process.cwd(), 'src', 'lib', 'og.ts');
const sha = (...parts: (string | Buffer)[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};
function packageVersion(name: string): string {
  try {
    let dir = dirname(require.resolve(name));
    for (let i = 0; i < 6; i++, dir = dirname(dir)) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
        if (pkg.name === name) return pkg.version ?? '';
      } catch {
        /* not here: look one folder up */
      }
    }
  } catch {
    /* not installed the usual way */
  }
  return '';
}
type Store = { dir: string; seed?: string; design: string; hits: number; drawn: number; used: Set<string> };
let store: Store | null | undefined;
function getStore(): Store | null {
  if (store !== undefined) return store;
  const setting = process.env.OG_CACHE_DIR;
  if (setting === 'off') return (store = null);
  let code: Buffer;
  try {
    // Without the drawing code we cannot tell when the design changed, so nothing is saved.
    code = typeof __OG_SOURCE__ === 'string' ? Buffer.from(__OG_SOURCE__, 'utf8') : readFileSync(SOURCE);
  } catch {
    return (store = null);
  }
  const design = sha(code, ...getFonts().map((f) => f.data), packageVersion('satori'), JSON.stringify(sharp.versions));
  const s: Store = { dir: setting || join(process.cwd(), '.cache', 'og'), seed: process.env.OG_SEED_DIR || undefined, design, hits: 0, drawn: 0, used: new Set() };
  process.once('exit', () => {
    if (s.hits || s.drawn) console.log(`[og] share pictures: ${s.hits} reused, ${s.drawn} drawn (saved in ${s.dir})`);
    // Which saved pictures this build used: the live server's package takes exactly these (scripts/live/build-server.mjs).
    if (s.used.size && !(globalThis as { __liLive?: boolean }).__liLive) {
      try {
        writeFileSync(join(s.dir, 'last-build.txt'), [...s.used].sort().join('\n') + '\n');
      } catch {
        /* only used to make the server's package smaller */
      }
    }
  });
  return (store = s);
}

/** How many pictures were reused and drawn so far (for tests and the build log). */
export function ogCacheStats(): { enabled: boolean; dir?: string; hits: number; drawn: number } {
  const s = getStore();
  return s ? { enabled: true, dir: s.dir, hits: s.hits, drawn: s.drawn } : { enabled: false, hits: 0, drawn: 0 };
}

/** On the live server pictures are drawn one at a time, so a burst of requests cannot fill the small server's memory. */
let drawing: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(draw: () => Promise<T>): Promise<T> {
  const run = drawing.then(draw, draw);
  drawing = run.catch(() => undefined);
  return run;
}

/** The saved copy of a picture with this fingerprint, or draw it once and save it. */
async function saved(kind: string, parts: (string | Buffer)[], draw: () => Promise<Buffer>): Promise<Buffer> {
  const s = getStore();
  const live = Boolean((globalThis as { __liLive?: boolean }).__liLive);
  if (!s) return live ? oneAtATime(draw) : draw();
  const key = sha(s.design, kind, ...parts);
  const file = join(s.dir, key.slice(0, 2), `${key}.${kind}`);
  if (!live) s.used.add(`${key.slice(0, 2)}/${key}.${kind}`);
  try {
    const buf = readFileSync(file);
    s.hits++;
    try {
      const now = new Date();
      utimesSync(file, now, now);
    } catch {
      /* only used to keep pictures that are still in use */
    }
    return buf;
  } catch {
    /* not saved yet */
  }
  if (s.seed) {
    try {
      const buf = readFileSync(join(s.seed, key.slice(0, 2), `${key}.${kind}`));
      s.hits++;
      return buf;
    } catch {
      /* not in the package either */
    }
  }
  const make = async (): Promise<Buffer> => {
    if (live) {
      try {
        // Asked for twice at once: the first request has just drawn and saved it.
        const buf = readFileSync(file);
        s.hits++;
        return buf;
      } catch {
        /* still not saved */
      }
    }
    const buf = await draw();
    s.drawn++;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, file);
    } catch {
      /* saving is only a speed-up */
    }
    return buf;
  };
  return live ? oneAtATime(make) : make();
}

/** Fingerprint of a photo or logo file, so a new photo under the same name is drawn again. */
const fileFingerprint = (path: string): string => {
  try {
    return sha(readFileSync(path));
  } catch {
    return `missing:${path}`;
  }
};

/**
 * The original file of an imported photo or logo. The build gives the path where it found it (`fsPath`); the
 * live server runs elsewhere, so it uses the build's byte-identical copy in its client folder (`src`,
 * /_astro/...; `__liClientDir` is set by server/astro-adapter/entry.mjs).
 */
export function originalFile(img: unknown): string | undefined {
  const o = img as { fsPath?: string; src?: string } | undefined;
  if (!o) return undefined;
  if (o.fsPath && existsSync(o.fsPath)) return o.fsPath;
  const dir = (globalThis as { __liClientDir?: string }).__liClientDir;
  if (dir && typeof o.src === 'string' && o.src.startsWith('/_astro/')) {
    const copy = join(dir, decodeURIComponent(o.src.split('?')[0] ?? ''));
    if (copy.startsWith(join(dir, '_astro')) && existsSync(copy)) return copy;
  }
  return o.fsPath;
}

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({ type, props: { style, children } });

export interface SocialCard {
  title: string;
  month?: string;
  day?: string;
  weekday?: string;
  lines: string[];
  footer?: string;
  status?: string;
  /** Small label above the title, e.g. "Venue · Huntington" or "Every Tuesday". */
  kicker?: string;
  /** Site name shown at the top. */
  brand?: string;
  /** Web address shown at the bottom right. */
  host?: string;
  /** A photo (data: URL, already cropped to 440x630) shown down the right side. */
  photo?: string;
  /** A logo (data: URL) shown on a white plate on the right when there is no photo. */
  logo?: string;
}

const C = { night: '#0b0b0d', night2: '#2a0a10', line: '#2c2d35', red: '#c1121f', redSoft: '#ff8a94', silver: '#c9ccd3', white: '#ffffff', soft: '#c8cad1' };
/** Size of the photo panel on 1200x630 cards. */
export const PHOTO_PANEL = { width: 440, height: 630 } as const;

function ticket(card: SocialCard, scale: number) {
  return h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: 170 * scale,
      height: 200 * scale,
      background: 'linear-gradient(180deg, #ffffff 0%, #e4e6ea 100%)',
      color: C.night,
      borderRadius: 18 * scale,
      flexShrink: 0,
    },
    [
      h('div', { fontWeight: 800, fontSize: 30 * scale, letterSpacing: 4, color: C.red }, (card.month ?? '').toUpperCase()),
      h('div', { fontWeight: 800, fontSize: 92 * scale, lineHeight: 1, letterSpacing: -3 }, card.day ?? ''),
      h('div', { fontWeight: 700, fontSize: 28 * scale, borderTop: `2px solid #b4b7bf`, paddingTop: 6 * scale, marginTop: 4 * scale }, (card.weekday ?? '').toUpperCase()),
    ],
  );
}

function tree(card: SocialCard, w: number, hgt: number): Node {
  const square = w === hgt;
  const s = square ? 1.1 : 1;
  const side = !square && (card.photo || card.logo);
  const narrow = side ? 0.82 : 1;
  const titleSize = Math.round((card.title.length > 48 ? 54 : card.title.length > 30 ? 64 : 76) * narrow);
  const textW = side ? w - PHOTO_PANEL.width : w;
  const text = h(
    'div',
    {
      width: textW,
      height: hgt,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: square ? 80 : side ? 56 : 64,
      background: `radial-gradient(circle at 90% 10%, #7a0b16 0%, ${C.night2} 35%, ${C.night} 70%)`,
      color: C.white,
      fontFamily: 'Inter',
    },
    [
      h('div', { display: 'flex', alignItems: 'center', gap: 18, fontSize: 30, color: C.silver, fontWeight: 700, letterSpacing: 1 }, [
        h('div', { width: 46, height: 46, borderRadius: 46, background: `linear-gradient(135deg, ${C.red}, #5c0812)`, display: 'flex' }),
        card.brand ?? 'Long Island Dance Events',
      ]),
      h('div', { display: 'flex', flexDirection: square ? 'column' : 'row', gap: 44, alignItems: square ? 'flex-start' : 'center' }, [
        ...(card.day ? [ticket(card, s * (side ? 0.85 : 1))] : []),
        h('div', { display: 'flex', flexDirection: 'column', gap: 14, ...(square ? {} : { flex: 1 }) }, [
          ...(card.status ? [h('div', { fontSize: 34, fontWeight: 800, color: C.redSoft, letterSpacing: 2 }, card.status.toUpperCase())] : []),
          ...(card.kicker ? [h('div', { fontSize: square ? 34 : 28, fontWeight: 800, color: C.redSoft, letterSpacing: 2 }, card.kicker.toUpperCase())] : []),
          h('div', { fontWeight: 800, fontSize: square ? titleSize * 1.05 : titleSize, lineHeight: 1.05, letterSpacing: -1.5 }, card.title),
          ...card.lines.map((l) => h('div', { fontSize: square ? 38 : side ? 30 : 34, color: C.soft }, l)),
        ]),
      ]),
      h('div', { display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: side ? 24 : 28, color: C.soft, borderTop: `2px solid ${C.line}`, paddingTop: 22 }, [
        h('div', { display: 'flex' }, card.footer ?? 'Check with the organizer before you go'),
        h('div', { display: 'flex', color: C.silver, fontWeight: 700 }, card.host ?? 'Long Island Dance Events'),
      ]),
    ],
  );
  if (!side) return text;
  const panel = card.photo
    ? { type: 'img', props: { src: card.photo, width: PHOTO_PANEL.width, height: PHOTO_PANEL.height, style: { width: PHOTO_PANEL.width, height: PHOTO_PANEL.height } } }
    : h('div', { width: PHOTO_PANEL.width, height: hgt, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.night }, [
        h('div', { width: 340, height: 340, borderRadius: 32, background: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 36 }, [
          { type: 'img', props: { src: card.logo, style: { maxWidth: 268, maxHeight: 268, objectFit: 'contain' } } },
        ]),
      ]);
  return h('div', { width: w, height: hgt, display: 'flex', flexDirection: 'row', background: C.night }, [text, panel]);
}

export async function renderSocialPng(card: SocialCard, size: 'og' | 'square'): Promise<Buffer> {
  return saved('png', [size, JSON.stringify(card)], async () => {
    const [w, hgt] = size === 'og' ? [1200, 630] : [1080, 1080];
    const svg = await satori(tree(card, w, hgt) as never, { width: w, height: hgt, fonts: getFonts() });
    // A 256-colour palette looks the same for these flat cards and halves the file size,
    // which keeps the site well under the Static Web Apps size limit (two images per upcoming event).
    return sharp(Buffer.from(svg)).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9, dither: 1 }).toBuffer();
  });
}

/** Cards with a photo or logo are JPEG (photos look wrong in a 256-colour palette). */
export async function renderSocialJpeg(card: SocialCard): Promise<Buffer> {
  return saved('jpg', ['og', JSON.stringify(card)], async () => {
    const svg = await satori(tree(card, 1200, 630) as never, { width: 1200, height: 630, fonts: getFonts() });
    return sharp(Buffer.from(svg)).jpeg({ quality: 80, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
  });
}

/**
 * A photo cropped around its focus point ("35% 40%") to the card's photo panel, as a data: URL.
 * Returns undefined when the photo is too small (we never stretch a photo more than a little).
 */
export async function photoPanel(path: string, focus = '50% 50%'): Promise<string | undefined> {
  // An empty saved file means "too small": the answer is remembered too.
  const buf = await saved('panel', [fileFingerprint(path), focus], async () => (await cropPanel(path, focus)) ?? Buffer.alloc(0));
  return buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : undefined;
}

async function cropPanel(path: string, focus: string): Promise<Buffer | undefined> {
  const { width: W, height: H } = PHOTO_PANEL;
  const img = sharp(path).rotate();
  const meta = await img.metadata();
  const [sw, sh] = (meta.orientation ?? 1) >= 5 ? [meta.height!, meta.width!] : [meta.width!, meta.height!];
  if (!sw || !sh) return undefined;
  const scale = Math.max(W / sw, H / sh);
  if (scale > 1.25) return undefined;
  const rw = Math.max(W, Math.round(sw * scale));
  const rh = Math.max(H, Math.round(sh * scale));
  const [fx, fy] = focus.split(/\s+/).map((p) => (Number.parseFloat(p) || 50) / 100) as [number, number];
  const left = Math.min(rw - W, Math.max(0, Math.round((fx ?? 0.5) * rw - W / 2)));
  const top = Math.min(rh - H, Math.max(0, Math.round((fy ?? 0.5) * rh - H / 2)));
  return sharp(path).rotate().resize(rw, rh).extract({ left, top, width: W, height: H }).jpeg({ quality: 82 }).toBuffer();
}

/** A logo as a PNG data: URL that fits the white plate (SVG logos are drawn by sharp). */
export async function logoPlate(path: string): Promise<string | undefined> {
  const buf = await saved('logo', [fileFingerprint(path)], async () => {
    try {
      return await sharp(path, { density: 300 }).resize(268, 268, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
    } catch {
      return Buffer.alloc(0);
    }
  });
  return buf.length ? `data:image/png;base64,${buf.toString('base64')}` : undefined;
}

import type { ResolvedEvent } from './content';
import { dateParts, formatDateShort } from './time';
import { dancingLine, listNames, shortTime } from './page-meta';

export function siteHost(): string | undefined {
  const host = (process.env.SITE_URL ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return host && host !== 'example.org' ? host : undefined;
}

function whoOrStyles(e: ResolvedEvent): string {
  if (e.liveActs.length) return `Live music: ${listNames(e.liveActs.map((a) => a.name), 2)}`;
  if (e.instructors.length && e.category === 'class-lesson') return `With ${listNames(e.instructors.map((a) => a.name), 2)}`;
  return e.styles.slice(0, 3).map((s) => s.name).join(' · ');
}

export function cardFor(e: ResolvedEvent): SocialCard {
  const p = dateParts(e.date);
  const lines = [
    [e.timeLabel ?? 'Time not listed', e.lessonLabel && e.category !== 'class-lesson' ? `lesson ${e.lessonLabel}` : '', e.price.known ? (e.price.free ? 'Free' : e.price.label) : ''].filter(Boolean).join(' · '),
    [e.location.name, e.location.town].filter(Boolean).join(', '),
    whoOrStyles(e),
  ].filter(Boolean);
  return {
    title: e.title,
    month: p.monthShort,
    day: p.day,
    weekday: p.weekdayShort,
    lines,
    status: e.status === 'cancelled' ? 'Cancelled' : undefined,
    footer: dancingLine(e) ?? e.categoryLabel,
    host: siteHost(),
  };
}

/** One picture for every far-off date of a repeating event: "Every Tuesday", time, place, who. */
export function seriesCardFor(e: ResolvedEvent): SocialCard {
  const time = shortTime(e);
  return {
    title: e.title,
    kicker: e.cadence ?? e.categoryLabel,
    lines: [
      [time ?? 'Time not listed', e.price.known ? (e.price.free ? 'Free' : e.price.label) : ''].filter(Boolean).join(' · '),
      [e.location.name, e.location.town].filter(Boolean).join(', '),
      whoOrStyles(e),
    ].filter(Boolean),
    footer: dancingLine(e) ?? e.categoryLabel,
    host: siteHost(),
  };
}

/** Directory pages (venues, bands, teachers, organizers, styles, towns). */
export function entityCard(o: { kicker: string; title: string; events: { date: string; title: string }[]; extra?: string | undefined; footer: string }): SocialCard {
  const n = o.events.length;
  const next = o.events[0];
  return {
    title: o.title,
    kicker: o.kicker,
    lines: [
      n ? `${n} ${n === 1 ? 'event' : 'events'} coming up` : 'No events listed right now',
      ...(next ? [`Next: ${formatDateShort(next.date)}`] : []),
      ...(o.extra ? [o.extra] : []),
    ],
    footer: o.footer,
    host: siteHost(),
  };
}
