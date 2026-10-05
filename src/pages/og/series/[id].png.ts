import type { APIRoute, GetStaticPaths } from 'astro';
import { buildNow, getAllEvents, type ResolvedEvent } from '../../../lib/content';
import { seriesNeedingImages } from '../../../lib/entity-meta';
import { cardFor, renderSocialPng, seriesCardFor } from '../../../lib/og';

/** One share picture per event series for dates past the three-week window (decision P46). */
export const getStaticPaths: GetStaticPaths = async () => {
  const series = seriesNeedingImages(await getAllEvents(), buildNow());
  return series.map((e) => ({ params: { id: e.eventId }, props: { e } }));
};

export const GET: APIRoute = async ({ props }) => {
  const e = props.e as ResolvedEvent;
  const png = await renderSocialPng(e.recurring ? seriesCardFor(e) : cardFor(e), 'og');
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
