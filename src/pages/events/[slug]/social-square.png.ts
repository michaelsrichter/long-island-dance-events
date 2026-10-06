import type { APIRoute, GetStaticPaths } from 'astro';
import { pageProps } from '../../../lib/page-props';
import { getEventGroups, hasShareImage, type ResolvedEvent } from '../../../lib/content';
import { cardFor, renderSocialPng } from '../../../lib/og';

export const getStaticPaths: GetStaticPaths = async () => {
  const { upcoming, now } = await getEventGroups();
  return upcoming.filter((e) => hasShareImage(e, now)).map((e) => ({ params: { slug: e.slug }, props: { e } }));
};

export const GET: APIRoute = async (ctx) => {
  const props = await pageProps(ctx, getStaticPaths);
  if (!props) return new Response('Not found', { status: 404 });
  const png = await renderSocialPng(cardFor(props.e as ResolvedEvent), 'square');
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};