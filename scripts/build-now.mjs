// Prints a BUILD_NOW timestamp for repeatable test builds: 8 AM New York time on the day of the latest
// scrape (the newest "lastSeen" date in the event files). The data always has upcoming events as of that
// morning, so end-to-end tests stay meaningful as the weekly data changes.
// Usage (bash):  echo "BUILD_NOW=$(node scripts/build-now.mjs)" >> "$GITHUB_ENV"
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'content', 'events');

export function latestScrapeMorning(files = readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  let latest = '';
  for (const f of files) {
    const seen = JSON.parse(readFileSync(join(dir, f), 'utf8')).lastSeen ?? '';
    if (seen > latest) latest = seen;
  }
  if (!latest) throw new Error('No event has a lastSeen date.');
  // Eastern time is UTC-4 in summer and UTC-5 in winter; pick the right offset for that date.
  const probe = new Date(`${latest}T12:00:00Z`);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const hours = Number(tz.replace('GMT', '') || '-5');
  const offset = `${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
  return `${latest}T08:00:00${offset}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(latestScrapeMorning());
