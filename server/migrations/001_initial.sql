-- Long Island Dance Events: the live database (Phase 1 of docs/proposals/postgres-live-site.md, decision P56).
--
-- One table per kind of record. Each row keeps:
--   raw  the exact file text from git (src/content/<kind>/<id>.<ext>), so the nightly export gives back
--        the same files byte for byte;
--   doc  the same record parsed (JSON, YAML or Markdown front matter + body), for questions and indexes.
-- A few columns are copied out of doc automatically (GENERATED) so common questions are fast.
-- Every change adds a row to history (who, when, before, after). History rows can never be changed.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Records (one table per kind, same core columns) ----------

CREATE TABLE events (
  id           text PRIMARY KEY,
  path         text NOT NULL UNIQUE,
  raw          text NOT NULL,
  doc          jsonb NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  title        text GENERATED ALWAYS AS (doc->>'title') STORED,
  status       text GENERATED ALWAYS AS (doc->>'status') STORED,
  category     text GENERATED ALWAYS AS (doc->>'category') STORED,
  start_local  text GENERATED ALWAYS AS (doc->>'start') STORED,
  venue_id     text GENERATED ALWAYS AS (doc->>'venueId') STORED,
  organizer_id text GENERATED ALWAYS AS (doc->>'organizerId') STORED,
  source_id    text GENERATED ALWAYS AS (doc->>'sourceId') STORED,
  town         text GENERATED ALWAYS AS (doc->>'town') STORED,
  search       tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, coalesce(doc->>'title', '') || ' ' || coalesce(doc->>'summary', ''))
  ) STORED
);
CREATE INDEX events_status_idx ON events (status);
CREATE INDEX events_venue_idx ON events (venue_id);
CREATE INDEX events_source_idx ON events (source_id);
CREATE INDEX events_search_idx ON events USING gin (search);
CREATE INDEX events_title_trgm_idx ON events USING gin (title gin_trgm_ops);

CREATE TABLE venues (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  name       text GENERATED ALWAYS AS (doc->>'name') STORED,
  town       text GENERATED ALWAYS AS (doc->>'town') STORED,
  county     text GENERATED ALWAYS AS (doc->>'county') STORED
);
CREATE INDEX venues_town_idx ON venues (town);
CREATE INDEX venues_name_trgm_idx ON venues USING gin (name gin_trgm_ops);

CREATE TABLE performers (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  name       text GENERATED ALWAYS AS (doc->>'name') STORED,
  type       text GENERATED ALWAYS AS (doc->>'type') STORED
);
CREATE INDEX performers_name_trgm_idx ON performers USING gin (name gin_trgm_ops);

CREATE TABLE instructors (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  name       text GENERATED ALWAYS AS (doc->>'name') STORED
);

CREATE TABLE organizers (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  name       text GENERATED ALWAYS AS (doc->>'name') STORED,
  type       text GENERATED ALWAYS AS (doc->>'type') STORED
);

CREATE TABLE sources (
  id          text PRIMARY KEY,
  path        text NOT NULL UNIQUE,
  raw         text NOT NULL,
  doc         jsonb NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  name        text GENERATED ALWAYS AS (doc->>'name') STORED,
  adapter     text GENERATED ALWAYS AS (doc->>'adapter') STORED,
  cadence     text GENERATED ALWAYS AS (doc->>'cadence') STORED,
  enabled     boolean GENERATED ALWAYS AS (coalesce((doc->>'enabled')::boolean, true)) STORED,
  last_status text GENERATED ALWAYS AS (doc->>'lastStatus') STORED
);

CREATE TABLE styles (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  name       text GENERATED ALWAYS AS (doc->>'name') STORED
);

CREATE TABLE faqs (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

CREATE TABLE pages (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

CREATE TABLE gallery (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

CREATE TABLE settings (
  id         text PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  raw        text NOT NULL,
  doc        jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

-- ---------- Every date of every event (from the repeat rules), rebuilt with each sync ----------

CREATE TABLE event_dates (
  event_id    text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  day         date NOT NULL,
  slug        text NOT NULL UNIQUE,  -- the page address: /events/<slug>/
  start_local text NOT NULL,         -- "2026-10-17T19:30", or just the date when the time is not known
  end_local   text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  time_tba    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (event_id, day)
);
CREATE INDEX event_dates_starts_idx ON event_dates (starts_at);

-- ---------- Long Island places (src/data/long-island-places.json) ----------

CREATE TABLE places (
  name    text PRIMARY KEY,
  county  text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}'
);

-- ---------- History: every change, never changed afterwards ----------

CREATE TABLE history (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind      text NOT NULL,         -- events, venues, ...
  record_id text NOT NULL,
  action    text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  version   integer NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  who       text NOT NULL,         -- "git 1a2b3c4" for now; later an editor or "collector run 123"
  before    jsonb,
  after     jsonb
);
CREATE INDEX history_record_idx ON history (kind, record_id, id DESC);
CREATE INDEX history_at_idx ON history (at DESC);

CREATE FUNCTION history_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'history rows cannot be changed or deleted';
END;
$$;
CREATE TRIGGER history_no_update_delete BEFORE UPDATE OR DELETE ON history
  FOR EACH ROW EXECUTE FUNCTION history_is_append_only();
CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON history
  FOR EACH STATEMENT EXECUTE FUNCTION history_is_append_only();

-- ---------- State for later phases (empty for now) ----------

CREATE TABLE source_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id   text NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  status      text NOT NULL,
  found       integer,
  kept        integer,
  report      jsonb
);
CREATE INDEX source_runs_source_idx ON source_runs (source_id, started_at DESC);

CREATE TABLE review_state (
  kind       text NOT NULL,
  id         text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);

CREATE TABLE page_fingerprints (
  path        text PRIMARY KEY,
  fingerprint text NOT NULL,
  lastmod     timestamptz NOT NULL
);

-- One row: the data version every copy of the site checks, and the last sync.
CREATE TABLE site_state (
  id                integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data_version      bigint NOT NULL DEFAULT 0,
  last_sync_commit  text,
  last_sync_at      timestamptz,
  last_sync_summary jsonb
);
INSERT INTO site_state (id) VALUES (1);

-- ---------- Ready-made questions ----------

-- Dates still to come (listed or cancelled), with the place.
CREATE VIEW v_upcoming AS
SELECT d.slug, d.day, d.start_local, d.starts_at, d.ends_at, d.time_tba,
       e.id AS event_id, e.title, e.category, e.status,
       e.venue_id, v.name AS venue_name, coalesce(v.town, e.town) AS town, v.county
FROM event_dates d
JOIN events e ON e.id = d.event_id
LEFT JOIN venues v ON v.id = e.venue_id
WHERE e.status IN ('active', 'cancelled') AND d.ends_at > now();

CREATE VIEW v_upcoming_by_town AS
SELECT town, county, count(*) AS dates, count(DISTINCT event_id) AS events
FROM v_upcoming
WHERE status = 'active' AND town IS NOT NULL
GROUP BY town, county;

CREATE VIEW v_upcoming_by_style AS
SELECT s.style, count(*) AS dates, count(DISTINCT u.event_id) AS events
FROM v_upcoming u
JOIN events e ON e.id = u.event_id
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(e.doc->'danceStyles', '[]'::jsonb)) AS s(style)
WHERE u.status = 'active'
GROUP BY s.style;

CREATE VIEW v_source_health AS
SELECT id, name, adapter, cadence, enabled, last_status,
       doc->>'lastScraped' AS last_scraped, doc->>'lastMessage' AS last_message
FROM sources;
