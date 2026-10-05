/** Absolute URLs of an entity's optimized logo and photos, for JSON-LD (same files as on the page). */
import { getImage } from 'astro:assets';
import { entityImageOptions, type EntityImageData } from './directory';

export interface EntityImageUrls {
  logo?: string;
  images: string[];
}

export async function entityImageUrls(d: { logo?: EntityImageData | undefined; photos?: EntityImageData[] | undefined }, site: URL): Promise<EntityImageUrls> {
  const url = async (img: EntityImageData, kind: 'photo' | 'logo') => {
    const { widths: _w, ...opts } = entityImageOptions(img.image, kind, img.focus);
    const r = await getImage({ src: img.image, ...opts });
    return new URL(r.src, site).toString();
  };
  const images = await Promise.all((d.photos ?? []).slice(0, 3).map((p) => url(p, 'photo')));
  return { ...(d.logo ? { logo: await url(d.logo, 'logo') } : {}), images };
}
