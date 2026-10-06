/**
 * Photos keep the exact addresses of the static site (decision P58).
 *
 * During a static build Astro names every resized photo through `globalThis.astroAsset.addStaticImage`
 * (/_astro/<name>.<hash>_<size-hash>.webp) and makes the file. That hook does not exist on a server, where
 * Astro would point at /_image/?href=... instead. Here the server provides the hook with Astro's own naming:
 * when the deploy brought that file along (made by the static build of the same commit), the page uses the
 * same address as before, so search engines keep their image history; otherwise it uses /_image/, which
 * the server makes when first asked.
 */
import { readdirSync } from 'node:fs';
import { getConfiguredImageService, imageConfig } from 'astro:assets';
// Astro's naming functions are not a public export; the page-by-page check (scripts/live/parity.mjs) catches changes.
import { hashTransform, propsToFilename } from '../../node_modules/astro/dist/assets/utils/hash.js';

/** Must equal image.service.entrypoint in astro.config.mjs (it is part of every file name). */
export const IMAGE_SERVICE = './src/lib/focus-image-service.mjs';
const ASSETS = '_astro';

export async function installStaticImageNames(clientDir) {
  let made = new Set();
  try {
    made = new Set(readdirSync(new URL(`${ASSETS}/`, clientDir)));
  } catch {
    /* no photos brought along: every photo uses /_image/ */
  }
  const service = await getConfiguredImageService();
  globalThis.astroAsset ??= {};
  globalThis.astroAsset.addStaticImage = (options, hashProperties) => {
    const esm = typeof options.src === 'object';
    const original = esm ? options.src.src : options.src;
    const hash = hashTransform(options, IMAGE_SERVICE, hashProperties);
    const name = propsToFilename(original, options, hash);
    const finalPath = esm ? name : `/${ASSETS}${name}`;
    if (finalPath.startsWith(`/${ASSETS}/`) && made.has(finalPath.slice(ASSETS.length + 2))) return encodeURI(finalPath);
    return service.getURL(options, imageConfig);
  };
  return made.size;
}
