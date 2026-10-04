-- Long Island Dance Events - SQLite database design
-- ------------------------------------------------------------------
-- Purpose: one small file that ties together events, dates, venues, bands/DJs, teachers,
-- organizers, dance styles, themes, sources and the evidence behind every fact, so the owner
-- can ask questions ("how many swing nights in Huntington this fall?") and build reports.
--
-- Design rules
--   * Ids are the same lowercase-dash ids used by the JSON/YAML files in src/content/**
--     (file name without extension), so the database can be rebuilt from git at any time.
--   * Local date-times are stored as text 'YYYY-MM-DDTHH:MM' in the event's timezone
--     (default America/New_York), exactly like the content files. Never UTC offsets.
--   * Text we show visitors (title, summary, description) is written in our own words.
--     Raw pages and PDFs stay OUTSIDE git (Blob storage or the CI cache); here we keep only
--     their hash, size and where they are stored.
--   * Private people's personal data is never stored. Contact fields are public business
--     contacts from public listings only.
--   * STRICT tables make SQLite reject wrong types. Requires SQLite 3.37+ (Node 22.13+
--     node:sqlite, Python 3.11+ sqlite3 and the sqlite3 CLI all qualify).
--
-- Volume this is sized for: a few thousand events per year, ~100 sources, ~1,000 venues,
-- ~1,000 bands/DJs. Everything fits in a file of a few MB (see docs/database-plan.md).
-- ------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- ==================================================================
-- 1. Lookup tables
-- ==================================================================

-- Towns, villages and hamlets of Nassau and Suffolk (from src/data/long-island-places.json).
CREATE TABLE IF NOT EXISTS places (
  name        TEXT PRIMARY KEY,                       -- 'Huntington Station'
  county      TEXT NOT NULL CHECK (county IN ('Nassau', 'Suffolk'))
) STRICT;

CREATE TABLE IF NOT EXISTS place_aliases (
  alias       TEXT PRIMARY KEY,                       -- 'Huntington Sta'
  place_name  TEXT NOT NULL REFERENCES places(name) ON DELETE CASCADE
) STRICT;

-- Kind of dancing (the site's "how will I dance?" filter).
--   partner   = two people dance together (swing, ballroom, salsa, hustle, tango, two-step, contra)
--   line      = everyone dances the same steps in lines (line dancing)
--   freestyle = dance on your own or in a group to a band or DJ (club or bar dancing)
CREATE TABLE IF NOT EXISTS dance_kinds (
  id          TEXT PRIMARY KEY CHECK (id IN ('partner', 'line', 'freestyle')),
  label       TEXT NOT NULL,
  help        TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS dance_styles (
  id          TEXT PRIMARY KEY,                       -- 'west-coast-swing' (src/content/styles/*.yml)
  name        TEXT NOT NULL,
  family      TEXT NOT NULL CHECK (family IN ('swing', 'ballroom', 'latin', 'tango', 'country', 'folk', 'club', 'other')),
  dance_kind  TEXT NOT NULL REFERENCES dance_kinds(id),
  sort_order  INTEGER,
  summary     TEXT,
  music       TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS style_aliases (
  alias       TEXT NOT NULL,                          -- 'WCS', 'Westie'
  style_id    TEXT NOT NULL REFERENCES dance_styles(id) ON DELETE CASCADE,
  PRIMARY KEY (alias, style_id)
) STRICT;

-- Themes: "Halloween party", "80s night", "Pizza night", "Glow party".
CREATE TABLE IF NOT EXISTS themes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL
) STRICT;

-- Free-form labels for reports: 'beginner-friendly', 'outdoor', 'singles', 'over-40', 'free-parking'.
CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'general'          -- 'audience', 'setting', 'general'
) STRICT;

-- ==================================================================
-- 2. Sources, permission and collection history
-- ==================================================================

CREATE TABLE IF NOT EXISTS sources (
  id                 TEXT PRIMARY KEY,                -- 'sdli-events' (catalog/sources.json and src/content/sources/*.json)
  name               TEXT NOT NULL,
  url                TEXT NOT NULL,                   -- listing page
  feed_url           TEXT,                            -- iCal / JSON / sitemap when there is one
  status             TEXT NOT NULL CHECK (status IN (
                       'live', 'in-progress', 'verified', 'needs-permission', 'manual-intake',
                       'recheck-from-ci', 'seasonal-recheck', 'set-aside', 'paused', 'opted-out')),
  publisher_type     TEXT CHECK (publisher_type IN (
                       'venue', 'organizer-club', 'studio', 'band-dj', 'instructor', 'aggregator-calendar',
                       'municipal-library', 'media-newsletter', 'religious-civic')),
  format             TEXT CHECK (format IN (
                       'jsonld', 'ical', 'google-calendar', 'api-json', 'html', 'pdf', 'js-widget',
                       'image-flyer', 'social-only', 'none')),
  adapter            TEXT,                            -- file name in ingest/adapters/ (when wired)
  priority           TEXT CHECK (priority IN ('High', 'Medium', 'Low', 'None')),
  effort             TEXT CHECK (effort IN ('S', 'M', 'L')),
  check_cadence      TEXT CHECK (check_cadence IN ('daily', 'twice-weekly', 'weekly', 'monthly', 'seasonal', 'manual')),
  rate_limit_seconds INTEGER NOT NULL DEFAULT 5,
  robots_result      TEXT CHECK (robots_result IN ('allowed', 'disallowed', 'none', 'unverified')),
  robots_note        TEXT,
  robots_checked_at  TEXT,
  terms_note         TEXT,
  counties           TEXT,                            -- 'Nassau', 'Suffolk', 'Nassau + Suffolk'
  events_per_month   REAL,                            -- rough estimate from the catalog
  attribution        TEXT,                            -- credit line shown on /sources/
  enabled            INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),  -- 1 = collected by the scheduled run
  approved_by_owner  INTEGER NOT NULL DEFAULT 0 CHECK (approved_by_owner IN (0, 1)),
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- What a source covers (a source can have several): partner-dancing, line-dancing, freestyle-club, live-music.
CREATE TABLE IF NOT EXISTS source_content_types (
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('partner-dancing', 'line-dancing', 'freestyle-club', 'live-music')),
  PRIMARY KEY (source_id, content_type)
) STRICT;

-- Permission requests and consent ("may we collect your calendar?", "can you share an .ics feed?").
-- A granted row is what turns a needs-permission source into one we may collect.
CREATE TABLE IF NOT EXISTS source_permissions (
  id             INTEGER PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  requested_at   TEXT NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('contact-form', 'email', 'phone', 'in-person', 'organizer-initiated')),
  asked_for      TEXT NOT NULL CHECK (asked_for IN ('collect-page', 'ics-feed', 'manual-submissions', 'robots-allow')),
  status         TEXT NOT NULL CHECK (status IN ('pending', 'granted', 'denied', 'no-reply', 'withdrawn')),
  decided_at     TEXT,
  scope_note     TEXT,                               -- 'OK to read /events weekly with link back'
  feed_url       TEXT,                               -- feed the organizer gave us, if any
  evidence_ref   TEXT,                               -- where the written consent is kept (not the message itself)
  expires_at     TEXT
) STRICT;

-- One row per scheduled or manual check of a source.
CREATE TABLE IF NOT EXISTS source_runs (
  id                 INTEGER PRIMARY KEY,
  source_id          TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at         TEXT NOT NULL,
  finished_at        TEXT,
  trigger            TEXT NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual', 'retry', 'backfill')),
  status             TEXT NOT NULL CHECK (status IN ('ok', 'unchanged', 'empty', 'invalid', 'error', 'blocked', 'skipped')),
  http_status        INTEGER,
  documents_fetched  INTEGER NOT NULL DEFAULT 0,
  documents_changed  INTEGER NOT NULL DEFAULT 0,      -- 0 when every ETag/hash matched last time
  found              INTEGER NOT NULL DEFAULT 0,      -- listings found in the documents
  kept               INTEGER NOT NULL DEFAULT 0,      -- on Long Island and valid
  out_of_area        INTEGER NOT NULL DEFAULT 0,
  created            INTEGER NOT NULL DEFAULT 0,
  updated            INTEGER NOT NULL DEFAULT 0,
  marked_past        INTEGER NOT NULL DEFAULT 0,
  needs_review       INTEGER NOT NULL DEFAULT 0,
  ai_input_tokens    INTEGER NOT NULL DEFAULT 0,
  ai_output_tokens   INTEGER NOT NULL DEFAULT 0,
  ai_cost_usd        REAL NOT NULL DEFAULT 0,
  message            TEXT,                            -- short error or summary text
  runner             TEXT                             -- 'github-actions', 'local'
) STRICT;

-- Every downloaded file. The content itself is NOT in git; storage_uri points to Blob storage or the cache.
CREATE TABLE IF NOT EXISTS raw_documents (
  id             INTEGER PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  run_id         INTEGER REFERENCES source_runs(id) ON DELETE SET NULL,
  url            TEXT NOT NULL,
  fetched_at     TEXT NOT NULL,
  http_status    INTEGER,
  content_type   TEXT,
  etag           TEXT,
  last_modified  TEXT,
  sha256         TEXT,                               -- change detection: same hash = nothing new
  bytes          INTEGER,
  storage_uri    TEXT,                               -- 'blob://raw/2026/10/<sha256>.html' (never a public URL)
  parse_status   TEXT CHECK (parse_status IN ('parsed', 'unchanged', 'failed', 'skipped')),
  expires_at     TEXT                                -- delete the stored copy after this date (default 90 days)
) STRICT;

-- ==================================================================
-- 3. People, places and groups
-- ==================================================================

CREATE TABLE IF NOT EXISTS venues (
  id                   TEXT PRIMARY KEY,              -- 'huntington-moose-lodge'
  name                 TEXT NOT NULL,
  venue_type           TEXT CHECK (venue_type IN (
                         'bar', 'restaurant', 'lodge-hall', 'studio', 'ballroom', 'church-temple', 'library',
                         'park-beach', 'theater', 'brewery-winery', 'hotel', 'school', 'community-center', 'other')),
  address              TEXT,
  town                 TEXT,                          -- should match places.name
  county               TEXT CHECK (county IN ('Nassau', 'Suffolk')),
  state                TEXT NOT NULL DEFAULT 'NY',
  postal_code          TEXT,
  latitude             REAL,
  longitude            REAL,
  coordinates_source   TEXT,
  website              TEXT,
  phone                TEXT,                          -- public business phone only
  google_maps_url      TEXT,
  facebook_url         TEXT,
  parking_notes        TEXT,
  accessibility_notes  TEXT,
  -- Dance-floor facts used by the dancing likelihood score (each backed by rows in evidence).
  room_to_dance        TEXT NOT NULL DEFAULT 'unknown' CHECK (room_to_dance IN ('dance-floor', 'some-room', 'seated', 'outdoor-lawn', 'unknown')),
  floor_type           TEXT,                          -- 'wood', 'tile', 'carpet', 'grass'
  dance_floor_notes    TEXT,
  facts_checked_at     TEXT,
  description          TEXT,
  review_notes         TEXT                           -- editors only, never shown
) STRICT;

CREATE TABLE IF NOT EXISTS venue_aliases (
  alias     TEXT NOT NULL,
  venue_id  TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  PRIMARY KEY (alias, venue_id)
) STRICT;

CREATE TABLE IF NOT EXISTS organizers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT CHECK (type IN ('studio', 'club', 'nonprofit', 'promoter', 'venue', 'school', 'dj', 'instructor', 'other')),
  town           TEXT,
  home_venue_id  TEXT REFERENCES venues(id) ON DELETE SET NULL,
  website        TEXT,
  phone          TEXT,                                -- public business contact only
  email          TEXT,                                -- public business contact only
  opt_out        INTEGER NOT NULL DEFAULT 0 CHECK (opt_out IN (0, 1)),  -- 1 = never list their events
  description    TEXT,
  review_notes   TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS organizer_aliases (
  alias         TEXT NOT NULL,
  organizer_id  TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  PRIMARY KEY (alias, organizer_id)
) STRICT;

-- Bands, DJs and solo acts.
CREATE TABLE IF NOT EXISTS performers (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('band', 'dj', 'solo')),
  -- Dance-band facts used by the dancing likelihood score.
  danceability         TEXT NOT NULL DEFAULT 'unknown' CHECK (danceability IN (
                         'dance-band', 'party-cover-band', 'dj', 'mixed', 'listening-act', 'unknown')),
  danceability_notes   TEXT,
  website              TEXT,
  facebook_url         TEXT,
  instagram_url        TEXT,
  youtube_url          TEXT,
  gig_calendar_url     TEXT,                          -- the band's own public gig list, if any
  home_area            TEXT,                          -- 'Nassau', 'Suffolk', 'Long Island', 'NYC'
  description          TEXT,
  review_notes         TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS performer_aliases (
  alias         TEXT NOT NULL,
  performer_id  TEXT NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  PRIMARY KEY (alias, performer_id)
) STRICT;

CREATE TABLE IF NOT EXISTS performer_genres (
  performer_id  TEXT NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  genre         TEXT NOT NULL,                       -- 'classic rock', '80s', 'Motown', 'swing'
  PRIMARY KEY (performer_id, genre)
) STRICT;

CREATE TABLE IF NOT EXISTS instructors (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,                       -- public professional name as listed
  website       TEXT,
  description   TEXT,
  review_notes  TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS instructor_styles (
  instructor_id  TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  style_id       TEXT NOT NULL REFERENCES dance_styles(id) ON DELETE CASCADE,
  PRIMARY KEY (instructor_id, style_id)
) STRICT;

CREATE TABLE IF NOT EXISTS instructor_organizers (
  instructor_id  TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  organizer_id   TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  PRIMARY KEY (instructor_id, organizer_id)
) STRICT;

CREATE TABLE IF NOT EXISTS organizer_styles (
  organizer_id  TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  style_id      TEXT NOT NULL REFERENCES dance_styles(id) ON DELETE CASCADE,
  PRIMARY KEY (organizer_id, style_id)
) STRICT;

-- ==================================================================
-- 4. Events and their dates
-- ==================================================================

-- One row per listing. A repeating listing ("every Tuesday") is ONE event with a repeat rule;
-- each date is a row in event_occurrences.
CREATE TABLE IF NOT EXISTS events (
  id                    TEXT PRIMARY KEY,             -- file id, e.g. '2026-10-06-sdli-tuesday-swing'
  title                 TEXT NOT NULL,                -- our own words
  summary               TEXT NOT NULL,                -- our own words, 1-2 sentences
  description           TEXT,                         -- our own words
  category              TEXT NOT NULL CHECK (category IN ('social-dance', 'class-lesson', 'lesson-party', 'live-music', 'festival')),
  start_local           TEXT NOT NULL,                -- first date: 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD'
  end_local             TEXT,
  timezone              TEXT NOT NULL DEFAULT 'America/New_York',
  rrule                 TEXT,                         -- 'FREQ=WEEKLY;BYDAY=TU' (no 'RRULE:')
  cadence_text          TEXT,                         -- as the source wrote it: '1st and 3rd Fridays'
  lesson_time           TEXT,                         -- 'HH:MM'
  venue_id              TEXT REFERENCES venues(id) ON DELETE SET NULL,
  town                  TEXT,                         -- when the venue is unknown
  organizer_id          TEXT REFERENCES organizers(id) ON DELETE SET NULL,
  price_min             REAL CHECK (price_min IS NULL OR price_min >= 0),
  price_max             REAL CHECK (price_max IS NULL OR price_max >= 0),
  is_free               INTEGER CHECK (is_free IN (0, 1)),
  price_notes           TEXT,
  skill_level           TEXT CHECK (skill_level IN ('all-levels', 'beginner', 'intermediate', 'advanced', 'mixed')),
  age_group             TEXT CHECK (age_group IN ('adults', 'kids', 'teens', 'all-ages')),
  ticket_url            TEXT,
  info_url              TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past', 'cancelled', 'pending-review')),
  cancelled_note        TEXT,
  -- How sure we are that people will dance (0 = seated concert, 1 = a dance). Computed from venue
  -- room_to_dance, performer danceability, category and source signals; the inputs are kept in
  -- dancing_basis (JSON) and backed by evidence rows. NULL = not scored yet.
  dancing_likelihood    REAL CHECK (dancing_likelihood IS NULL OR dancing_likelihood BETWEEN 0 AND 1),
  dancing_basis         TEXT CHECK (dancing_basis IS NULL OR json_valid(dancing_basis)),
  confidence            REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),  -- how sure the extraction is
  extracted_by          TEXT CHECK (extracted_by IN ('rules', 'feed', 'ai', 'ai-vision', 'editor')),
  match_key             TEXT UNIQUE,                  -- recognises the same listing on the next run
  primary_source_id     TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_url            TEXT,
  source_ref            TEXT,                         -- 'page 17', 'The Dance Calendar, October 2026'
  first_seen            TEXT NOT NULL,
  last_seen             TEXT NOT NULL,
  locked_fields         TEXT CHECK (locked_fields IS NULL OR json_valid(locked_fields)),  -- fields an editor fixed by hand
  review_notes          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (venue_id IS NOT NULL OR town IS NOT NULL),
  CHECK (price_max IS NULL OR price_min IS NULL OR price_max >= price_min)
) STRICT;

-- Every concrete date of an event (expanded from rrule + extra dates - skipped dates, or listed one by one).
CREATE TABLE IF NOT EXISTS event_occurrences (
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  start_local     TEXT NOT NULL,                      -- 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD'
  end_local       TEXT,
  occurrence_date TEXT GENERATED ALWAYS AS (substr(start_local, 1, 10)) STORED,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'moved')),
  origin          TEXT NOT NULL DEFAULT 'rrule' CHECK (origin IN ('rrule', 'rdate', 'single', 'editor')),
  note            TEXT,                               -- 'No class - Thanksgiving'
  PRIMARY KEY (event_id, start_local)
) STRICT;

-- Dates the source says are skipped ("no dance Nov 26").
CREATE TABLE IF NOT EXISTS event_exdates (
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  skip_date   TEXT NOT NULL,                          -- 'YYYY-MM-DD'
  PRIMARY KEY (event_id, skip_date)
) STRICT;

CREATE TABLE IF NOT EXISTS event_styles (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  style_id  TEXT NOT NULL REFERENCES dance_styles(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, style_id)
) STRICT;

-- Kinds of dancing at the event. Usually follows from the styles, but freestyle bar nights have
-- no style, and a country night can be both 'line' and 'partner'.
CREATE TABLE IF NOT EXISTS event_dance_kinds (
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  dance_kind  TEXT NOT NULL REFERENCES dance_kinds(id),
  PRIMARY KEY (event_id, dance_kind)
) STRICT;

CREATE TABLE IF NOT EXISTS event_performers (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  performer_id  TEXT NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  billing_order INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (event_id, performer_id)
) STRICT;

CREATE TABLE IF NOT EXISTS event_instructors (
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  instructor_id  TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, instructor_id)
) STRICT;

CREATE TABLE IF NOT EXISTS event_themes (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  theme_id  TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, theme_id)
) STRICT;

CREATE TABLE IF NOT EXISTS event_tags (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_id)
) STRICT;

-- Every source that lists this event (the same dance can appear in The Dance Calendar, the
-- organizer's site and Ira's List). Used for credit, freshness and dedup.
CREATE TABLE IF NOT EXISTS event_sources (
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id        TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_url       TEXT,
  source_ref       TEXT,
  raw_document_id  INTEGER REFERENCES raw_documents(id) ON DELETE SET NULL,
  first_seen       TEXT NOT NULL,
  last_seen        TEXT NOT NULL,
  is_primary       INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (event_id, source_id)
) STRICT;

-- ==================================================================
-- 5. Evidence, duplicates and the review queue
-- ==================================================================

-- "Why do we believe this?" One row per fact we checked: a venue's dance floor, a band being a
-- dance band, a source's robots.txt result, an event's price.
CREATE TABLE IF NOT EXISTS evidence (
  id            INTEGER PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('event', 'venue', 'performer', 'organizer', 'instructor', 'source')),
  subject_id    TEXT NOT NULL,
  field         TEXT,                                 -- 'room_to_dance', 'danceability', 'robots', 'price'
  url           TEXT NOT NULL,
  note          TEXT,                                 -- our own words: 'Photos show a wood dance floor'
  checked_at    TEXT NOT NULL
) STRICT;

-- Duplicate handling: when two event rows are the same real-world event.
CREATE TABLE IF NOT EXISTS event_merges (
  kept_event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  merged_event_id  TEXT NOT NULL,                     -- the id that was folded in (its row may be deleted)
  method           TEXT NOT NULL CHECK (method IN ('match-key', 'same-venue-time', 'embedding', 'editor')),
  score            REAL,                              -- similarity 0-1 for automatic matches
  status           TEXT NOT NULL CHECK (status IN ('proposed', 'merged', 'rejected')),
  decided_by       TEXT,                              -- 'auto' or an editor handle (not a real name)
  decided_at       TEXT,
  PRIMARY KEY (kept_event_id, merged_event_id)
) STRICT;

-- Human-in-the-loop intake: an editor or organizer uploads a flyer/screenshot THEY viewed
-- themselves (we never screenshot blocked or social sites). A cheap vision model drafts the
-- facts; the event stays pending-review until an editor approves it.
CREATE TABLE IF NOT EXISTS intake_submissions (
  id                 INTEGER PRIMARY KEY,
  submitted_at       TEXT NOT NULL,
  submitter_role     TEXT NOT NULL CHECK (submitter_role IN ('editor', 'organizer', 'visitor')),
  submitter_ref      TEXT,                            -- opaque id from sign-in; no names or emails here
  source_id          TEXT REFERENCES sources(id) ON DELETE SET NULL,  -- e.g. a manual-intake source
  original_url       TEXT,                            -- where the submitter saw it (e.g. a public post)
  file_sha256        TEXT,
  storage_uri        TEXT,                            -- private Blob path; deleted after review
  media_type         TEXT,                            -- 'image/jpeg', 'application/pdf', 'text/plain'
  rights_confirmed   INTEGER NOT NULL DEFAULT 0 CHECK (rights_confirmed IN (0, 1)),  -- submitter says they may share it
  extraction_model   TEXT,                            -- 'gpt-5-nano (2025-08-07)'
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cost_usd           REAL,
  extracted_json     TEXT CHECK (extracted_json IS NULL OR json_valid(extracted_json)),
  status             TEXT NOT NULL CHECK (status IN ('received', 'extracted', 'pending-review', 'approved', 'rejected', 'duplicate')),
  reviewed_by        TEXT,
  reviewed_at        TEXT,
  event_id           TEXT REFERENCES events(id) ON DELETE SET NULL,
  note               TEXT
) STRICT;

-- Anything a person needs to look at: low-confidence extractions, possible duplicates,
-- events that vanished from their source, failed sources, visitor "report a problem" notes.
CREATE TABLE IF NOT EXISTS review_queue (
  id            INTEGER PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('event', 'venue', 'performer', 'organizer', 'source', 'intake', 'merge')),
  subject_id    TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN (
                  'low-confidence', 'possible-duplicate', 'vanished-from-source', 'source-failed',
                  'new-venue', 'new-performer', 'intake-upload', 'visitor-report', 'out-of-area-check')),
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  resolved_by   TEXT,
  resolved_at   TEXT
) STRICT;

-- ==================================================================
-- 6. Indexes
-- ==================================================================

CREATE INDEX IF NOT EXISTS idx_occ_date          ON event_occurrences(occurrence_date, status);
CREATE INDEX IF NOT EXISTS idx_events_status     ON events(status, category);
CREATE INDEX IF NOT EXISTS idx_events_venue      ON events(venue_id);
CREATE INDEX IF NOT EXISTS idx_events_organizer  ON events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_events_source     ON events(primary_source_id);
CREATE INDEX IF NOT EXISTS idx_events_town       ON events(town);
CREATE INDEX IF NOT EXISTS idx_event_styles      ON event_styles(style_id);
CREATE INDEX IF NOT EXISTS idx_event_kinds       ON event_dance_kinds(dance_kind);
CREATE INDEX IF NOT EXISTS idx_event_performers  ON event_performers(performer_id);
CREATE INDEX IF NOT EXISTS idx_event_sources_src ON event_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_venues_town       ON venues(county, town);
CREATE INDEX IF NOT EXISTS idx_runs_source       ON source_runs(source_id, started_at);
CREATE INDEX IF NOT EXISTS idx_raw_hash          ON raw_documents(source_id, sha256);
CREATE INDEX IF NOT EXISTS idx_evidence_subject  ON evidence(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_review_open       ON review_queue(status, reason);
CREATE INDEX IF NOT EXISTS idx_sources_status    ON sources(status, priority);

-- ==================================================================
-- 7. Views for reports (all read-only)
-- ==================================================================

-- Where an event happens: venue town/county, or the event's own town.
CREATE VIEW IF NOT EXISTS v_event_place AS
SELECT e.id AS event_id,
       COALESCE(v.town, e.town)                                   AS town,
       COALESCE(v.county, p.county, pa_p.county)                  AS county,
       v.name                                                     AS venue_name,
       v.room_to_dance                                            AS room_to_dance
FROM events e
LEFT JOIN venues v          ON v.id = e.venue_id
LEFT JOIN places p          ON p.name = COALESCE(v.town, e.town)
LEFT JOIN place_aliases pa  ON pa.alias = COALESCE(v.town, e.town)
LEFT JOIN places pa_p       ON pa_p.name = pa.place_name;

-- Kinds of dancing per event: explicit rows plus the kinds implied by its styles.
CREATE VIEW IF NOT EXISTS v_event_kinds AS
SELECT event_id, dance_kind FROM event_dance_kinds
UNION
SELECT es.event_id, ds.dance_kind FROM event_styles es JOIN dance_styles ds ON ds.id = es.style_id;

-- Every upcoming date that a visitor could go to (today or later, event active, date not cancelled).
CREATE VIEW IF NOT EXISTS v_upcoming AS
SELECT o.occurrence_date, o.start_local, o.end_local,
       e.id AS event_id, e.title, e.category, e.price_min, e.is_free,
       e.dancing_likelihood, e.organizer_id, e.venue_id,
       pl.venue_name, pl.town, pl.county
FROM event_occurrences o
JOIN events e         ON e.id = o.event_id
JOIN v_event_place pl ON pl.event_id = e.id
LEFT JOIN organizers org ON org.id = e.organizer_id
WHERE e.status = 'active'
  AND o.status = 'scheduled'
  AND COALESCE(org.opt_out, 0) = 0
  AND o.occurrence_date >= date('now', 'localtime');

-- Upcoming dates by town (for "what's on near me" and coverage gaps).
CREATE VIEW IF NOT EXISTS v_upcoming_by_town AS
SELECT county, town, COUNT(*) AS dates, COUNT(DISTINCT event_id) AS events
FROM v_upcoming GROUP BY county, town;

-- Upcoming dates by dance style.
CREATE VIEW IF NOT EXISTS v_upcoming_by_style AS
SELECT ds.family, ds.name AS style, ds.dance_kind, COUNT(*) AS dates, COUNT(DISTINCT u.event_id) AS events
FROM v_upcoming u
JOIN event_styles es ON es.event_id = u.event_id
JOIN dance_styles ds ON ds.id = es.style_id
GROUP BY ds.id;

-- Upcoming dates by kind of dancing (partner / line / freestyle / listening only).
CREATE VIEW IF NOT EXISTS v_upcoming_by_kind AS
SELECT COALESCE(k.dance_kind, 'not-stated') AS dance_kind, COUNT(*) AS dates, COUNT(DISTINCT u.event_id) AS events
FROM v_upcoming u
LEFT JOIN v_event_kinds k ON k.event_id = u.event_id
GROUP BY COALESCE(k.dance_kind, 'not-stated');

-- Health of each source: last run, last success, how many events it gives us.
CREATE VIEW IF NOT EXISTS v_source_health AS
SELECT s.id, s.name, s.status, s.enabled, s.check_cadence,
       (SELECT MAX(started_at) FROM source_runs r WHERE r.source_id = s.id)                     AS last_run,
       (SELECT MAX(started_at) FROM source_runs r WHERE r.source_id = s.id AND r.status IN ('ok', 'unchanged')) AS last_success,
       (SELECT status FROM source_runs r WHERE r.source_id = s.id ORDER BY started_at DESC LIMIT 1) AS last_status,
       (SELECT COUNT(*) FROM event_sources es JOIN events e ON e.id = es.event_id
          WHERE es.source_id = s.id AND e.status = 'active')                                      AS active_events
FROM sources s;

-- Events per month per source (for "is this source worth it?").
CREATE VIEW IF NOT EXISTS v_events_per_month_by_source AS
SELECT es.source_id, substr(o.occurrence_date, 1, 7) AS month, COUNT(*) AS dates
FROM event_occurrences o
JOIN event_sources es ON es.event_id = o.event_id
GROUP BY es.source_id, month;

-- Bands and DJs ranked by upcoming dates, with their dance rating.
CREATE VIEW IF NOT EXISTS v_performer_upcoming AS
SELECT p.id, p.name, p.type, p.danceability, COUNT(*) AS upcoming_dates, MIN(u.occurrence_date) AS next_date
FROM v_upcoming u
JOIN event_performers ep ON ep.event_id = u.event_id
JOIN performers p        ON p.id = ep.performer_id
GROUP BY p.id;

-- Open work for editors.
CREATE VIEW IF NOT EXISTS v_review_open AS
SELECT reason, COUNT(*) AS items, MIN(created_at) AS oldest
FROM review_queue WHERE status = 'open' GROUP BY reason;

-- ==================================================================
-- 8. Seed rows for fixed lists
-- ==================================================================

INSERT OR IGNORE INTO dance_kinds (id, label, help) VALUES
  ('partner',   'Partner dancing',  'Two people dance together: swing, ballroom, salsa, hustle, tango, two-step, contra.'),
  ('line',      'Line dancing',     'Everyone does the same steps side by side, in lines. No partner needed.'),
  ('freestyle', 'Freestyle dancing','Dance your own way, alone or with friends, to a band or DJ, like at a club or bar.');
