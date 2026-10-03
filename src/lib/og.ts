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
  /** Site name shown at the top. */
  brand?: string;
  /** Web address shown at the bottom right. */
  host?: string;
}

const C = { night: '#0b0b0d', night2: '#2a0a10', line: '#2c2d35', red: '#c1121f', redSoft: '#ff8a94', silver: '#c9ccd3', white: '#ffffff', soft: '#c8cad1' };

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
  const titleSize = card.title.length > 48 ? 54 : card.title.length > 30 ? 64 : 76;
  return h(
    'div',
    {
      width: w,
      height: hgt,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: square ? 80 : 64,
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
        ...(card.day ? [ticket(card, s)] : []),
        h('div', { display: 'flex', flexDirection: 'column', gap: 14, ...(square ? {} : { flex: 1 }) }, [
          ...(card.status ? [h('div', { fontSize: 34, fontWeight: 800, color: C.redSoft, letterSpacing: 2 }, card.status.toUpperCase())] : []),
          h('div', { fontWeight: 800, fontSize: square ? titleSize * 1.05 : titleSize, lineHeight: 1.05, letterSpacing: -1.5 }, card.title),
          ...card.lines.map((l) => h('div', { fontSize: square ? 38 : 34, color: C.soft }, l)),
        ]),
      ]),
      h('div', { display: 'flex', justifyContent: 'space-between', fontSize: 28, color: C.soft, borderTop: `2px solid ${C.line}`, paddingTop: 22 }, [
        h('div', { display: 'flex' }, card.footer ?? 'Check with the organizer before you go'),
        h('div', { display: 'flex', color: C.silver, fontWeight: 700 }, card.host ?? 'Long Island Dance Events'),
      ]),
    ],
  );
}

export async function renderSocialPng(card: SocialCard, size: 'og' | 'square'): Promise<Buffer> {
  const [w, hgt] = size === 'og' ? [1200, 630] : [1080, 1080];
  const svg = await satori(tree(card, w, hgt) as never, { width: w, height: hgt, fonts: getFonts() });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

import type { ResolvedEvent } from './content';
import { dateParts } from './time';

export function cardFor(e: ResolvedEvent): SocialCard {
  const p = dateParts(e.date);
  const lines = [
    [e.timeLabel ?? 'Time not listed', e.lessonLabel && e.category !== 'class-lesson' ? `lesson ${e.lessonLabel}` : ''].filter(Boolean).join(' · '),
    [e.location.name, e.location.town].filter(Boolean).join(', '),
    e.liveActs.length ? `Live music: ${e.liveActs.map((a) => a.name).join(', ')}` : e.styles.slice(0, 3).map((s) => s.name).join(' · '),
  ].filter(Boolean);
  const host = (process.env.SITE_URL ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    title: e.title,
    month: p.monthShort,
    day: p.day,
    weekday: p.weekdayShort,
    lines,
    status: e.status === 'cancelled' ? 'Cancelled' : undefined,
    footer: e.categoryLabel,
    host: host && host !== 'example.org' ? host : undefined,
  };
}