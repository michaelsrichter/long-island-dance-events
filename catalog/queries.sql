-- Sample report queries for data/li-dance.sqlite (built by catalog/scripts/build-sqlite.ts).
-- Each query starts with "-- name:" and a one-line plain-English question. The loader runs all of
-- them and writes the answers to data/li-dance-report.md. Run one by hand with:
--   sqlite3 data/li-dance.sqlite < catalog/queries.sql
-- "Upcoming" means today or later (the v_upcoming view).

-- name: upcoming-by-town | Which towns have the most dance and music dates in the next 60 days?
SELECT county, town, COUNT(*) AS dates, COUNT(DISTINCT event_id) AS events
FROM v_upcoming
WHERE occurrence_date <= date('now', 'localtime', '+60 days')
GROUP BY county, town
ORDER BY dates DESC, town
LIMIT 15;

-- name: upcoming-by-style | Which dance styles have the most upcoming dates?
SELECT style, family, dance_kind, dates, events
FROM v_upcoming_by_style
ORDER BY dates DESC
LIMIT 15;

-- name: upcoming-by-kind | How will people dance? (partner, line, freestyle, not stated)
SELECT dance_kind, dates, events FROM v_upcoming_by_kind ORDER BY dates DESC;

-- name: this-weekend | What is on this coming Friday to Sunday?
SELECT u.occurrence_date AS date, substr(u.start_local, 12, 5) AS time, u.title, u.town, u.county
FROM v_upcoming u
WHERE u.occurrence_date BETWEEN date('now', 'localtime', 'weekday 5') AND date('now', 'localtime', 'weekday 5', '+2 days')
ORDER BY u.start_local
LIMIT 25;

-- name: lesson-then-dance | Partner-dance nights that start with a lesson, next 30 days
SELECT u.occurrence_date AS date, e.lesson_time, u.title, u.town
FROM v_upcoming u
JOIN events e ON e.id = u.event_id
WHERE e.lesson_time IS NOT NULL
  AND u.occurrence_date <= date('now', 'localtime', '+30 days')
ORDER BY u.start_local
LIMIT 20;

-- name: free-events | Free events coming up
SELECT u.occurrence_date AS date, u.title, u.town
FROM v_upcoming u
WHERE u.is_free = 1
ORDER BY u.start_local
LIMIT 20;

-- name: busiest-performers | Which bands and DJs play most often?
SELECT name, type, danceability, upcoming_dates, next_date
FROM v_performer_upcoming
ORDER BY upcoming_dates DESC, name
LIMIT 15;

-- name: busiest-venues | Which venues host the most upcoming dates, and is there room to dance?
SELECT v.name, v.town, v.room_to_dance, COUNT(*) AS dates
FROM v_upcoming u
JOIN venues v ON v.id = u.venue_id
GROUP BY v.id
ORDER BY dates DESC, v.name
LIMIT 15;

-- name: dates-per-month | How many event dates per month (all sources)?
SELECT substr(occurrence_date, 1, 7) AS month, COUNT(*) AS dates, COUNT(DISTINCT event_id) AS events
FROM event_occurrences
WHERE status = 'scheduled'
GROUP BY month
ORDER BY month
LIMIT 18;

-- name: source-catalog | How many sources are in each status, and how many are switched on?
SELECT status, COUNT(*) AS sources, SUM(enabled) AS switched_on,
       SUM(CASE WHEN priority = 'High' THEN 1 ELSE 0 END) AS high_priority
FROM sources
GROUP BY status
ORDER BY sources DESC;

-- name: source-health | For each switched-on source: last run, last success and active events
SELECT id, status, check_cadence, last_run, last_success, last_status, active_events
FROM v_source_health
WHERE enabled = 1
ORDER BY active_events DESC, id
LIMIT 25;

-- name: permission-needed | Sources we may not collect until the organizer agrees
SELECT s.id, s.name, s.robots_result, s.priority
FROM sources s
WHERE s.status = 'needs-permission'
ORDER BY CASE s.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, s.id;

-- name: coverage-gaps | Long Island towns with no upcoming events (top 15 by county, alphabetical)
SELECT p.county, p.name AS town
FROM places p
WHERE NOT EXISTS (SELECT 1 FROM v_upcoming u WHERE u.town = p.name)
ORDER BY p.county, p.name
LIMIT 15;

-- name: review-queue | Open items waiting for an editor
SELECT reason, items, oldest FROM v_review_open ORDER BY items DESC;
