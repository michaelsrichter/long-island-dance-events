import type { APIRoute, GetStaticPaths } from 'astro';
import { calendarEventOf, getEventGroups } from '../../../lib/content';
import { buildIcs } from '../../../lib/calendar';

export const getStaticPaths: GetStaticPaths = async () => {
  const { all } = await getEventGroups();
  return all.map((e) => ({ params: { slug: e.slug } }));
};

export const GET: APIRoute = async ({ params, site }) => {
  const { all, now } = await getEventGroups();
  const e = all.find((x) => x.slug === params.slug)!;
  const body = buildIcs([calendarEventOf(e, site!)], { name: e.title, now });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${e.slug}.ics"`,
    },
  });
};
