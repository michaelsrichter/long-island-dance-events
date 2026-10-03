import type { APIRoute } from 'astro';
import { renderSocialPng } from '../../lib/og';
import { getSettings } from '../../lib/content';

export const GET: APIRoute = async () => {
  const s = await getSettings();
  const png = await renderSocialPng(
    { title: 'Find a place to dance on Long Island', lines: ['Social dances, classes and live music', 'Nassau and Suffolk · updated every week'], footer: 'Swing · Ballroom · Latin · Hustle · Tango · Country', brand: s.siteName },
    'og',
  );
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
