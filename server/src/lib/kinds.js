/**
 * The kinds of records the database holds: one table each, and one folder in src/content/.
 * scripts/db/content-files.ts has the same list (a test checks they match).
 */
export const KINDS = Object.freeze(['events', 'venues', 'performers', 'instructors', 'organizers', 'sources', 'styles', 'faqs', 'pages', 'gallery', 'settings']);

const KIND_SET = new Set(KINDS);
export const isKind = (k) => KIND_SET.has(k);

/** Record ids are file names without the extension (for example "club-brumidi"). */
export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,159}$/;
/** Where a record lives in git, for example "src/content/venues/club-brumidi.json". */
export const pathRe = (kind) => new RegExp(`^src/content/${kind}/[a-z0-9][a-z0-9._-]{0,159}\\.(json|ya?ml|md)$`);
