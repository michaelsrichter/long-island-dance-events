/** Shared by analytics (browser) and tests. */

/** The kind of page a path is, for "where did they come from on this site". */
export function pageTypeOf(path: string): string {
  const p = path.replace(/\/+$/, '/') || '/';
  if (p === '/') return 'home';
  const [a, b] = p.split('/').filter(Boolean);
  if (a === 'events') return !b ? 'events' : b === 'calendar' ? 'calendar' : b === 'map' ? 'map' : b === 'past' ? 'past' : 'event';
  const dir: Record<string, [string, string]> = { venues: ['venues', 'venue'], performers: ['performers', 'person'], instructors: ['instructors', 'person'], organizers: ['organizers', 'organizer'], styles: ['styles', 'style'], towns: ['towns', 'town'] };
  if (a && dir[a]) return b ? dir[a][1] : dir[a][0];
  return (a ?? 'page').slice(0, 30);
}
