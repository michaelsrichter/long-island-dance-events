// @ts-check
import { defineConfig } from 'astro/config';
import liveServer from './server/astro-adapter/index.mjs';

// SITE_URL is the canonical origin. Until DNS cutover it should be the Azure Static Web Apps hostname.
const site = (process.env.SITE_URL || 'https://example.org').replace(/\/$/, '');

// ASTRO_TARGET=server builds the same pages for the live server (App Service, decision P58): pages are made
// when someone asks for them. Without it, the build is the static site exactly as before.
const serverTarget = process.env.ASTRO_TARGET === 'server';
// Optional: load scripts, styles, fonts and images from another address (a free CDN), e.g. https://assets.longisland.dance
const assetsPrefix = process.env.ASSETS_PREFIX || undefined;

export default defineConfig({
  site,
  trailingSlash: 'always',
  // Keep HTML-aware whitespace handling (Astro 7 defaults to JSX-style stripping).
  compressHTML: true,
  build: {
    format: 'directory',
    // External CSS/JS only, so the Content Security Policy needs no 'unsafe-inline'.
    inlineStylesheets: 'never',
    ...(assetsPrefix ? { assetsPrefix } : {}),
  },
  ...(serverTarget
    ? {
        output: 'server',
        adapter: liveServer(),
        outDir: './dist-server',
      }
    : {}),
  vite: {
    build: { assetsInlineLimit: 0 },
    // The live server bundles its code, except sharp (native image library) and satori (share-picture layout,
    // which loads its own WebAssembly file); both are installed with the server (server/package.json).
    ...(serverTarget ? { ssr: { noExternal: true, external: ['sharp', 'satori'] } } : {}),
  },
  prefetch: false,
  // Built-in sharp service plus precise focus-point crops (position: "35% 40%").
  // The live server resizes photos when first asked, reading the originals from its own disk (server/src/site.js).
  image: {
    service: { entrypoint: './src/lib/focus-image-service.mjs' },
    ...(serverTarget ? { endpoint: { route: '/_image', entrypoint: 'astro/assets/endpoint/node' } } : {}),
  },
  // Sitemaps are built by src/pages/sitemap-*.ts (split by kind of page, with real last-changed dates; decision P48).
});
