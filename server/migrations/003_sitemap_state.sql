-- 003: sitemap "last changed" dates live in the database (decision P59).
--
-- The static site keeps them between builds in /sitemap-state.json on the live site. The live server keeps
-- them here instead: one row per address with the fingerprint of the facts on that page and the date they
-- last changed (src/lib/sitemap.ts). The first time, the table is filled from the live site's file.
CREATE TABLE sitemap_state (
  loc        text PRIMARY KEY,
  hash       text NOT NULL,
  lastmod    text NOT NULL CHECK (lastmod ~ '^\d{4}-\d{2}-\d{2}$'),
  changed_at timestamptz NOT NULL DEFAULT now()
);
