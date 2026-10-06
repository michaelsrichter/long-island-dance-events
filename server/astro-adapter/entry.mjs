/**
 * Server entry point of the site build (decision P58). `handle(request)` returns the page as a standard
 * Response, or null when no page matches (the Node server then answers with `notFound`).
 */
import { createApp } from 'astro/app/entrypoint';
import { installStaticImageNames } from './static-images.mjs';

// Remembered lists are made again when the data changes or a new day starts (src/lib/freshness.ts).
globalThis.__liLive = true;
const app = createApp();

let ready;
/** Call once before the first page: `clientDir` is the file URL of the build's client folder. */
export function init({ clientDir }) {
  ready ??= installStaticImageNames(clientDir).then((n) => console.log(`[site] ${n} photos keep their static-site addresses`));
  return ready;
}

export function matches(request) {
  return Boolean(app.match(request));
}

export async function handle(request, { clientAddress, locals } = {}) {
  const routeData = app.match(request);
  if (!routeData) return null;
  return app.render(request, { routeData, clientAddress, locals });
}

/** The site's own 404 page, with status 404. */
export async function notFound(request) {
  return app.render(request, { clientAddress: undefined });
}