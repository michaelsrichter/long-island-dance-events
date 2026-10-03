import type { APIRoute } from 'astro';
import { renderSocialPng } from '../../lib/og';
import { getSettings } from '../../lib/content';

export const GET: APIRoute = async () => {
  const s = await getSettings();
  const png = await renderSocialPng(
    { title: 'Swing dancing every Tuesday night on Riverbend Valley', lines: ['Lesson 7:30 PM · Dancing 8 to 10 PM', 'Riverbend Community Hall, Riverbend, NY'], footer: `${s.hotlineLabel}: ${s.hotlinePhone}` },
    'og',
  );
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
