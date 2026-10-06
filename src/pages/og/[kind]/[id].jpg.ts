import type { APIRoute, GetStaticPaths } from 'astro';
import { pageProps } from '../../../lib/page-props';
import { allEntityMeta, type EntityMeta } from '../../../lib/entity-meta';
import { logoPlate, photoPanel, renderSocialJpeg } from '../../../lib/og';

/** Share pictures for venue, band and DJ, teacher, organizer and dance-style pages (with their photo or logo). */
export const getStaticPaths: GetStaticPaths = async () => {
  const all = await allEntityMeta(import.meta.env.SITE ?? 'https://example.org');
  return all.map(({ kind, id, meta }) => ({ params: { kind, id }, props: { meta } }));
};

const fsPath = (img: unknown): string | undefined => (img as { fsPath?: string } | undefined)?.fsPath;

export const GET: APIRoute = async (ctx) => {
  const props = await pageProps(ctx, getStaticPaths);
  if (!props) return new Response('Not found', { status: 404 });
  const meta = props.meta as EntityMeta;
  const photoPath = fsPath(meta.photo?.image);
  const logoPath = fsPath(meta.logo?.image);
  const photo = photoPath ? await photoPanel(photoPath, meta.photo?.focus).catch(() => undefined) : undefined;
  const logo = !photo && logoPath ? await logoPlate(logoPath) : undefined;
  const jpg = await renderSocialJpeg({ ...meta.card, ...(photo ? { photo } : logo ? { logo } : {}) });
  return new Response(new Uint8Array(jpg), { headers: { 'Content-Type': 'image/jpeg' } });
};
