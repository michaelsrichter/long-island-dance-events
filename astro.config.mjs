// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL is the canonical origin. Until DNS cutover it should be the Azure Static Web Apps hostname.
const site = (process.env.SITE_URL || 'https://example.org').replace(/\/$/, '');

export default defineConfig({
  site,
  trailingSlash: 'always',
  // Keep HTML-aware whitespace handling (Astro 7 defaults to JSX-style stripping).
  compressHTML: true,
  build: {
    format: 'directory',
    // External CSS/JS only, so the Content Security Policy needs no 'unsafe-inline'.
    inlineStylesheets: 'never',
  },
  vite: {
    build: { assetsInlineLimit: 0 },
  },
  prefetch: false,
  // Built-in sharp service plus precise focus-point crops (position: "35% 40%").
  image: { service: { entrypoint: './src/lib/focus-image-service.mjs' } },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin/') && !page.includes('/404'),
    }),
  ],
});
