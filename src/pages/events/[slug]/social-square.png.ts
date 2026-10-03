import type { APIRoute, GetStaticPaths } from 'astro';
import { getEventGroups, type ResolvedEvent } from '../../../lib/content';
import { cardFor, renderSocialPng } from '../../../lib/og';

export const getStaticPaths: GetStaticPaths = async () => {
  const { upcoming } = await getEventGroups();
  return upcoming.map((e) => ({ params: { slug: e.slug }, props: { e } }));
};

export const GET: APIRoute = async ({ props }) => {
  const png = await renderSocialPng(cardFor(props.e as ResolvedEvent), 'square');
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};