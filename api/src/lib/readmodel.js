'use strict';
/**
 * Public "read model": one small JSON file per page in the public "community" container,
 * rewritten after every change. Browsers read it straight from Blob Storage (cached 60 seconds),
 * so showing likes, comments and photos never calls our Functions.
 */
const { table, container, TABLES, CONTAINERS } = require('./store');
const { splitKey } = require('./http');

const MAX_COMMENTS = 50;
const MAX_PHOTOS = 60;
const PHOTO_SIZES = { s: 480, m: 1024, l: 2048 };

function photoPaths(key, photoId) {
  const { type, id } = splitKey(key);
  const out = {};
  for (const [k, px] of Object.entries(PHOTO_SIZES)) out[k] = `${type}/${id}/${photoId}-${px}.webp`;
  return out;
}

function commentView(row) {
  return { id: row.rowKey, name: row.displayName || 'A dancer', text: row.body, at: row.createdAt, ...(row.occurrenceDate ? { date: row.occurrenceDate } : {}) };
}

function photoView(row, url) {
  const paths = photoPaths(row.partitionKey, row.photoId);
  return {
    id: row.rowKey,
    by: row.displayName || 'A dancer',
    caption: row.caption || '',
    alt: row.alt || '',
    w: Number(row.width) || 0,
    h: Number(row.height) || 0,
    at: row.createdAt,
    src: { s: url(paths.s), m: url(paths.m), l: url(paths.l) },
  };
}

/** Rebuild one page's JSON. Returns the document that was written. */
async function rebuild(key) {
  const { type, id } = splitKey(key);
  const [comments, photos, likes] = await Promise.all([
    table(TABLES.comments).list(key, { filter: "status eq 'published'", limit: MAX_COMMENTS }),
    table(TABLES.photos).list(key, { filter: "status eq 'published'", limit: MAX_PHOTOS }),
    table(TABLES.likes).list(key),
  ]);
  const photoUrl = (p) => container(CONTAINERS.photos).url(p);
  const doc = {
    v: 1,
    key,
    likes: likes.length,
    comments: comments.map(commentView),
    photos: photos.map((p) => photoView(p, photoUrl)),
    updatedAt: new Date().toISOString(),
  };
  await container(CONTAINERS.community).upload(`${type}/${id}.json`, Buffer.from(JSON.stringify(doc)), 'application/json; charset=utf-8', 'public, max-age=60');
  return doc;
}

/** Store a page's like count and rewrite counts/<type>.json (used by list pages). */
async function rebuildCounts(key, count) {
  const { type, id } = splitKey(key);
  const counts = table(TABLES.likeCounts);
  if (count > 0) await counts.upsert({ partitionKey: type, rowKey: id, count });
  else await counts.remove(type, id);
  const rows = await counts.list(type);
  const doc = { v: 1, type, likes: Object.fromEntries(rows.map((r) => [r.rowKey, Number(r.count) || 0])), updatedAt: new Date().toISOString() };
  await container(CONTAINERS.community).upload(`counts/${type}.json`, Buffer.from(JSON.stringify(doc)), 'application/json; charset=utf-8', 'public, max-age=300');
}

module.exports = { rebuild, rebuildCounts, photoPaths, commentView, photoView, PHOTO_SIZES };
