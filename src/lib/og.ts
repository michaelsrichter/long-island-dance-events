/** Build-time social images (Open Graph 1200x630 and square 1080x1080) rendered with satori + sharp. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
let fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] | undefined;
function getFonts() {
  fonts ??= [
    { name: 'Fraunces', data: font('@fontsource/fraunces', 'fraunces-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Atkinson', data: font('@fontsource/atkinson-hyperlegible', 'atkinson-hyperlegible-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Atkinson', data: font('@fontsource/atkinson-hyperlegible', 'atkinson-hyperlegible-latin-700-normal.woff'), weight: 700, style: 'normal' },
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
}

const C = { night: '#24162f', night2: '#3a2147', gold: '#f2b134', cream: '#fff4e4', soft: '#e9d8ea', red: '#ffaaa5' };

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
      background: C.gold,
      color: C.night,
      borderRadius: 18 * scale,
      flexShrink: 0,
    },
    [
      h('div', { fontFamily: 'Atkinson', fontWeight: 700, fontSize: 30 * scale, letterSpacing: 4 }, (card.month ?? '').toUpperCase()),
      h('div', { fontFamily: 'Fraunces', fontSize: 92 * scale, lineHeight: 1 }, card.day ?? ''),
      h('div', { fontFamily: 'Atkinson', fontWeight: 700, fontSize: 28 * scale, borderTop: `3px dashed ${C.night}`, paddingTop: 6 * scale, marginTop: 4 * scale }, (card.weekday ?? '').toUpperCase()),
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
      background: `radial-gradient(circle at 85% 15%, ${C.night2} 0%, ${C.night} 60%)`,
      color: C.cream,
      fontFamily: 'Atkinson',
    },
    [
      h('div', { display: 'flex', alignItems: 'center', gap: 18, fontSize: 30, color: C.gold, fontWeight: 700, letterSpacing: 2 }, [
        h('div', { width: 46, height: 46, borderRadius: 46, background: C.gold, display: 'flex' }),
        'Riverbend Swing Dance Club',
      ]),
      h('div', { display: 'flex', flexDirection: square ? 'column' : 'row', gap: 44, alignItems: square ? 'flex-start' : 'center' }, [
        ...(card.day ? [ticket(card, s)] : []),
        h('div', { display: 'flex', flexDirection: 'column', gap: 14, ...(square ? {} : { flex: 1 }) }, [
          ...(card.status ? [h('div', { fontSize: 34, fontWeight: 700, color: C.red, letterSpacing: 2 }, card.status.toUpperCase())] : []),
          h('div', { fontFamily: 'Fraunces', fontSize: square ? titleSize * 1.05 : titleSize, lineHeight: 1.05 }, card.title),
          ...card.lines.map((l) => h('div', { fontSize: square ? 38 : 34, color: C.soft }, l)),
        ]),
      ]),
      h('div', { display: 'flex', justifyContent: 'space-between', fontSize: 28, color: C.soft, borderTop: `2px solid ${C.night2}`, paddingTop: 22 }, [
        h('div', { display: 'flex' }, card.footer ?? 'Beginners welcome · No partner needed'),
        h('div', { display: 'flex', color: C.gold, fontWeight: 700 }, 'example.org'),
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
import { dateParts, formatTime } from './time';

export function cardFor(e: ResolvedEvent): SocialCard {
  const p = dateParts(e.date);
  const d = e.details;
  const lines = [
    [d.lessonStartTime && `Lesson ${formatTime(d.lessonStartTime, true)}`, d.danceStartTime && `Dancing ${formatTime(d.danceStartTime, true)}`].filter(Boolean).join(' · ') ||
      (e.timeLabel ?? 'Time to be announced'),
    [e.location.name, e.location.city].filter(Boolean).join(', '),
    e.band ? `Live band: ${e.band.name}` : '',
  ].filter(Boolean);
  return {
    title: e.title,
    month: p.monthShort,
    day: p.day,
    weekday: p.weekdayShort,
    lines,
    status: e.status === 'cancelled' ? 'Cancelled' : e.status === 'postponed' ? 'Postponed' : undefined,
  };
}
