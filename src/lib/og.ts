/** Build-time social images (Open Graph 1200x630 and square 1080x1080) rendered with satori + sharp. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import sharp from 'sharp';

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
  const [w, hgt] = size === 'og' ? [1200, 630] : [1080, 1080];
  const svg = await satori(tree(card, w, hgt) as never, { width: w, height: hgt, fonts: getFonts() });
  // A 256-colour palette looks the same for these flat cards and halves the file size,
  // which keeps the site well under the Static Web Apps size limit (two images per upcoming event).
  return sharp(Buffer.from(svg)).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9, dither: 1 }).toBuffer();
}

/** Cards with a photo or logo are JPEG (photos look wrong in a 256-colour palette). */
export async function renderSocialJpeg(card: SocialCard): Promise<Buffer> {
  const svg = await satori(tree(card, 1200, 630) as never, { width: 1200, height: 630, fonts: getFonts() });
  return sharp(Buffer.from(svg)).jpeg({ quality: 80, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
}

/**
 * A photo cropped around its focus point ("35% 40%") to the card's photo panel, as a data: URL.
 * Returns undefined when the photo is too small (we never stretch a photo more than a little).
 */
export async function photoPanel(path: string, focus = '50% 50%'): Promise<string | undefined> {
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
  const buf = await sharp(path).rotate().resize(rw, rh).extract({ left, top, width: W, height: H }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/** A logo as a PNG data: URL that fits the white plate (SVG logos are drawn by sharp). */
export async function logoPlate(path: string): Promise<string | undefined> {
  try {
    const buf = await sharp(path, { density: 300 }).resize(268, 268, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
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
